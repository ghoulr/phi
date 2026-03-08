import {
	SessionManager,
	type AgentSession,
} from "@mariozechner/pi-coding-agent";
import type { AssistantMessage } from "@mariozechner/pi-ai";

import type { ChatExecutor } from "@phi/core/chat-executor";
import {
	ensureChatWorkspaceLayout,
	resolveChatWorkspaceDirectory,
} from "@phi/core/chat-workspace";
import type {
	PhiConfig,
	ResolvedCronChatServiceConfig,
} from "@phi/core/config";
import type { ChatReloadRegistry } from "@phi/core/reload";
import {
	createPhiAgentSession,
	type ChatSessionRuntime,
} from "@phi/core/runtime";
import { computeCronJobNextRunAtMs } from "@phi/cron/schedule";
import { appendCronRunLog, loadCronJobs } from "@phi/cron/store";
import type {
	CronReloadResult,
	CronRunResult,
	LoadedCronJob,
} from "@phi/cron/types";

const EMPTY_USAGE = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	cost: {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		total: 0,
	},
};

export interface RunningCronService {
	done: Promise<void>;
	stop(): Promise<void>;
}

export interface CronServiceDependencies {
	runJob(
		chatId: string,
		phiConfig: PhiConfig,
		prompt: string
	): Promise<CronRunResult>;
	publishResult(
		runtime: ChatSessionRuntime<AgentSession>,
		chatExecutor: ChatExecutor,
		chatId: string,
		assistantMessage: AssistantMessage
	): Promise<void>;
}

const defaultCronServiceDependencies: CronServiceDependencies = {
	async runJob(
		chatId: string,
		phiConfig: PhiConfig,
		prompt: string
	): Promise<CronRunResult> {
		const session = await createPhiAgentSession(chatId, phiConfig, {
			sessionManager: SessionManager.inMemory(),
		});
		try {
			await session.sendUserMessage(prompt);
			const assistantMessage = session.messages
				.slice()
				.reverse()
				.find(
					(message): message is AssistantMessage =>
						message.role === "assistant"
				);
			if (!assistantMessage) {
				throw new Error(
					`Cron job returned no assistant message for chat ${chatId}`
				);
			}

			const assistantText = assistantMessage.content
				.filter((content) => content.type === "text")
				.map((content) => content.text)
				.join("")
				.trim();
			if (assistantText.length === 0) {
				throw new Error(
					`Cron job returned empty assistant text for chat ${chatId}`
				);
			}

			return {
				assistantMessage: {
					...assistantMessage,
					content: [{ type: "text", text: assistantText }],
					timestamp: Date.now(),
				},
				assistantText,
			};
		} finally {
			session.dispose();
		}
	},
	async publishResult(
		runtime: ChatSessionRuntime<AgentSession>,
		chatExecutor: ChatExecutor,
		chatId: string,
		assistantMessage: AssistantMessage
	): Promise<void> {
		await chatExecutor.run(chatId, async () => {
			const session = await runtime.getOrCreateSession(chatId);
			session.sessionManager.appendMessage(assistantMessage);
			session.agent.replaceMessages(
				session.sessionManager.buildSessionContext().messages
			);
		});
	},
};

function createAssistantErrorMessage(
	session: AgentSession,
	text: string
): AssistantMessage {
	const model = session.model;
	if (!model) {
		throw new Error("Cannot publish cron error without an active model.");
	}

	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: EMPTY_USAGE,
		stopReason: "error",
		errorMessage: text,
		timestamp: Date.now(),
	};
}

class ChatCronScheduler {
	private timer: ReturnType<typeof setTimeout> | undefined;
	private jobs: LoadedCronJob[] = [];
	private readonly runningJobs = new Set<string>();

	public constructor(
		private readonly chatConfig: ResolvedCronChatServiceConfig,
		private readonly phiConfig: PhiConfig,
		private readonly runtime: ChatSessionRuntime<AgentSession>,
		private readonly chatExecutor: ChatExecutor,
		private readonly dependencies: CronServiceDependencies
	) {}

	public async start(): Promise<void> {
		await this.reload();
	}

	public stop(): void {
		if (this.timer) {
			clearTimeout(this.timer);
			this.timer = undefined;
		}
	}

	public async reload(): Promise<CronReloadResult> {
		const previousJobs = this.jobs;
		const previousTimer = this.timer;

		try {
			const workspaceDir = resolveChatWorkspaceDirectory(
				this.chatConfig.workspace
			);
			const layout = ensureChatWorkspaceLayout(workspaceDir);
			const loadedJobs = loadCronJobs({ layout });
			if (loadedJobs.length > 0 && !this.chatConfig.timezone) {
				throw new Error(
					`Missing timezone for cron chat ${this.chatConfig.chatId}`
				);
			}
			const scheduledJobs = loadedJobs.map((job) => ({
				...job,
				nextRunAtMs: this.computeNextRunAtMs(job),
			}));

			this.jobs = scheduledJobs;
			if (previousTimer) {
				clearTimeout(previousTimer);
			}
			this.timer = undefined;
			this.armTimer();

			return {
				jobCount: this.jobs.length,
				nextRunAtMs: this.jobs
					.map((job) => job.nextRunAtMs)
					.filter(
						(nextRunAtMs): nextRunAtMs is number =>
							typeof nextRunAtMs === "number"
					)
					.sort((left, right) => left - right)[0],
			};
		} catch (error: unknown) {
			this.jobs = previousJobs;
			this.timer = previousTimer;
			throw error;
		}
	}

	private getTimezone(): string {
		if (!this.chatConfig.timezone) {
			return Intl.DateTimeFormat().resolvedOptions().timeZone;
		}
		return this.chatConfig.timezone;
	}

	private computeNextRunAtMs(job: LoadedCronJob): number | undefined {
		return computeCronJobNextRunAtMs(job, this.getTimezone(), Date.now());
	}

	private armTimer(): void {
		const nextRunAtMs = this.jobs
			.map((job) => job.nextRunAtMs)
			.filter((value): value is number => typeof value === "number")
			.sort((left, right) => left - right)[0];
		if (nextRunAtMs === undefined) {
			return;
		}

		this.timer = setTimeout(
			() => {
				this.timer = undefined;
				void this.processDueJobs();
			},
			Math.max(nextRunAtMs - Date.now(), 0)
		);
	}

	private async processDueJobs(): Promise<void> {
		const nowMs = Date.now();
		const dueJobs = this.jobs.filter(
			(job) =>
				typeof job.nextRunAtMs === "number" && job.nextRunAtMs <= nowMs
		);

		this.jobs = this.jobs.map((job) => ({
			...job,
			nextRunAtMs: computeCronJobNextRunAtMs(
				job,
				this.getTimezone(),
				nowMs
			),
		}));
		this.armTimer();

		await Promise.all(
			dueJobs.map(async (job) => {
				if (this.runningJobs.has(job.id)) {
					return;
				}
				this.runningJobs.add(job.id);
				try {
					await this.runJob(job);
				} finally {
					this.runningJobs.delete(job.id);
				}
			})
		);
	}

	private async runJob(job: LoadedCronJob): Promise<void> {
		const workspaceDir = resolveChatWorkspaceDirectory(
			this.chatConfig.workspace
		);
		const layout = ensureChatWorkspaceLayout(workspaceDir);
		const startedAt = new Date().toISOString();

		try {
			const result = await this.dependencies.runJob(
				this.chatConfig.chatId,
				this.phiConfig,
				job.promptText
			);
			await this.dependencies.publishResult(
				this.runtime,
				this.chatExecutor,
				this.chatConfig.chatId,
				result.assistantMessage
			);
			appendCronRunLog(layout.cronRunsFilePath, {
				chatId: this.chatConfig.chatId,
				jobId: job.id,
				status: "ok",
				text: result.assistantText,
				startedAt,
				finishedAt: new Date().toISOString(),
			});
		} catch (error: unknown) {
			const message =
				error instanceof Error ? error.message : String(error);
			await this.publishError(message);
			appendCronRunLog(layout.cronRunsFilePath, {
				chatId: this.chatConfig.chatId,
				jobId: job.id,
				status: "error",
				error: message,
				startedAt,
				finishedAt: new Date().toISOString(),
			});
		}
	}

	private async publishError(message: string): Promise<void> {
		await this.chatExecutor.run(this.chatConfig.chatId, async () => {
			const session = await this.runtime.getOrCreateSession(
				this.chatConfig.chatId
			);
			const assistantMessage = createAssistantErrorMessage(
				session,
				`Cron job failed: ${message}`
			);
			session.sessionManager.appendMessage(assistantMessage);
			session.agent.replaceMessages(
				session.sessionManager.buildSessionContext().messages
			);
		});
	}
}

export async function startCronService(params: {
	runtime: ChatSessionRuntime<AgentSession>;
	phiConfig: PhiConfig;
	chatExecutor: ChatExecutor;
	reloadRegistry: ChatReloadRegistry;
	chatConfigs: ResolvedCronChatServiceConfig[];
	dependencies?: CronServiceDependencies;
}): Promise<RunningCronService> {
	const dependencies = params.dependencies ?? defaultCronServiceDependencies;
	const schedulers = new Map<string, ChatCronScheduler>();
	const unregisterHandlers: Array<() => void> = [];
	let stopped = false;
	let resolveDone: (() => void) | undefined;
	const done = new Promise<void>((resolve) => {
		resolveDone = resolve;
	});

	for (const chatConfig of params.chatConfigs) {
		const scheduler = new ChatCronScheduler(
			chatConfig,
			params.phiConfig,
			params.runtime,
			params.chatExecutor,
			dependencies
		);
		await scheduler.start();
		schedulers.set(chatConfig.chatId, scheduler);
		unregisterHandlers.push(
			params.reloadRegistry.register(chatConfig.chatId, async () => {
				const result = await scheduler.reload();
				return [`cron:${String(result.jobCount)}`];
			})
		);
	}

	return {
		done,
		async stop(): Promise<void> {
			if (stopped) {
				return;
			}
			stopped = true;
			for (const unregister of unregisterHandlers) {
				unregister();
			}
			for (const scheduler of schedulers.values()) {
				scheduler.stop();
			}
			resolveDone?.();
		},
	};
}
