import {
	SessionManager,
	type AgentSession,
	type ExtensionFactory,
} from "@mariozechner/pi-coding-agent";
import type { AssistantMessage } from "@mariozechner/pi-ai";

import type { ChatExecutor } from "@phi/core/chat-executor";
import {
	ensureChatWorkspaceLayout,
	resolveChatWorkspaceDirectory,
} from "@phi/core/chat-workspace";
import {
	resolveChatRuntimeConfig,
	type PhiConfig,
	type ResolvedCronChatServiceConfig,
} from "@phi/core/config";
import { getPhiLogger } from "@phi/core/logger";
import type { ChatReloadRegistry } from "@phi/core/reload";
import {
	loadPhiWorkspaceConfig,
	resolveWorkspaceTimezone,
} from "@phi/core/workspace-config";
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
import { createPhiMessagingExtension } from "@phi/extensions/messaging";
import { resolvePlainAssistantMessage } from "@phi/messaging/assistant-output";
import type { PhiMessage } from "@phi/messaging/types";
import type { PhiRouteDeliveryRegistry } from "@phi/messaging/route-delivery";

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

const log = getPhiLogger("cron");

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
		result: CronRunResult
	): Promise<void>;
}

export interface CreateDefaultCronServiceDependenciesParams {
	deliveryRegistry: PhiRouteDeliveryRegistry;
	createAgentSession?: typeof createPhiAgentSession;
}

function getLastAssistantMessage(
	session: AgentSession
): AssistantMessage | undefined {
	return session.messages
		.slice()
		.reverse()
		.find(
			(message): message is AssistantMessage =>
				message.role === "assistant"
		);
}

function createPublishedAssistantMessage(
	assistantMessage: AssistantMessage | undefined,
	assistantText: string | undefined
): AssistantMessage | undefined {
	if (!assistantMessage || !assistantText) {
		return undefined;
	}
	return {
		...assistantMessage,
		content: [{ type: "text", text: assistantText }],
		timestamp: Date.now(),
	};
}

function buildCronLogText(result: CronRunResult): string {
	return result.outboundMessages
		.map((message) => {
			const attachments = message.attachments
				.map((attachment) => attachment.name)
				.join(", ");
			if (message.text && attachments) {
				return `${message.text}\n[attachments: ${attachments}]`;
			}
			return message.text ?? `[attachments: ${attachments}]`;
		})
		.join("\n\n")
		.trim();
}

function resolvePublishedAssistantText(
	outboundMessages: PhiMessage[]
): string | undefined {
	return outboundMessages
		.map((message) => message.text?.trim())
		.filter((text): text is string => Boolean(text))
		.at(-1);
}

function createMessagingExtensionFactories(params: {
	chatId: string;
	deliveryRegistry: PhiRouteDeliveryRegistry;
	deliveryMessages: PhiMessage[];
}): ExtensionFactory[] {
	return [
		createPhiMessagingExtension({
			deliverMessage: async (message, phase) => {
				if (phase === "instant") {
					await params.deliveryRegistry
						.require(params.chatId)
						.deliver(message);
					return;
				}
				params.deliveryMessages.push(message);
			},
		}),
	];
}

export function createDefaultCronServiceDependencies(
	params: CreateDefaultCronServiceDependenciesParams
): CronServiceDependencies {
	const createAgentSession =
		params.createAgentSession ?? createPhiAgentSession;
	const deliveryRegistry = params.deliveryRegistry;
	return {
		async runJob(
			chatId: string,
			phiConfig: PhiConfig,
			prompt: string
		): Promise<CronRunResult> {
			const chatConfig = resolveChatRuntimeConfig(phiConfig, chatId);
			const workspaceDir = resolveChatWorkspaceDirectory(
				chatConfig.workspace
			);
			ensureChatWorkspaceLayout(workspaceDir);
			const outboundMessages: PhiMessage[] = [];
			const messagingExtensionFactories =
				createMessagingExtensionFactories({
					chatId,
					deliveryRegistry,
					deliveryMessages: outboundMessages,
				});
			const session = await createAgentSession(chatId, phiConfig, {
				sessionManager: SessionManager.inMemory(),
				extensionFactories: messagingExtensionFactories,
			});
			try {
				await session.sendUserMessage(prompt);
				const assistantText = session.getLastAssistantText();
				if (!assistantText) {
					throw new Error(
						`Cron job returned empty assistant text for chat ${chatId}`
					);
				}

				if (
					outboundMessages.length === 0 &&
					messagingExtensionFactories.length === 0
				) {
					outboundMessages.push(
						...resolvePlainAssistantMessage(assistantText)
					);
				}
				return {
					assistantMessage: createPublishedAssistantMessage(
						getLastAssistantMessage(session),
						resolvePublishedAssistantText(outboundMessages)
					),
					outboundMessages,
				};
			} finally {
				session.dispose();
			}
		},
		async publishResult(
			runtime: ChatSessionRuntime<AgentSession>,
			chatExecutor: ChatExecutor,
			chatId: string,
			result: CronRunResult
		): Promise<void> {
			log.debug("cron.publish.started", {
				chatId,
				outboundMessageCount: result.outboundMessages.length,
				hasAssistantMessage: result.assistantMessage !== undefined,
			});
			await chatExecutor.run(chatId, async () => {
				if (result.assistantMessage) {
					const session = await runtime.getOrCreateSession(chatId);
					session.sessionManager.appendMessage(
						result.assistantMessage
					);
					session.agent.replaceMessages(
						session.sessionManager.buildSessionContext().messages
					);
				}
				for (const message of result.outboundMessages) {
					await deliveryRegistry.require(chatId).deliver(message);
				}
			});
			log.debug("cron.publish.completed", {
				chatId,
				outboundMessageCount: result.outboundMessages.length,
			});
		},
	};
}

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
	private timezone: string | undefined;
	private readonly runningJobs = new Set<string>();

	public constructor(
		private readonly chatConfig: ResolvedCronChatServiceConfig,
		private readonly phiConfig: PhiConfig,
		private readonly runtime: ChatSessionRuntime<AgentSession>,
		private readonly chatExecutor: ChatExecutor,
		private readonly deliveryRegistry: PhiRouteDeliveryRegistry,
		private readonly dependencies: CronServiceDependencies
	) {}

	public async start(): Promise<void> {
		log.info("cron.scheduler.starting", {
			chatId: this.chatConfig.chatId,
		});
		await this.reload();
		log.info("cron.scheduler.started", {
			chatId: this.chatConfig.chatId,
			jobCount: this.jobs.length,
		});
	}

	public stop(): void {
		if (this.timer) {
			clearTimeout(this.timer);
			this.timer = undefined;
		}
		log.info("cron.scheduler.stopped", {
			chatId: this.chatConfig.chatId,
		});
	}

	public async reload(): Promise<CronReloadResult> {
		const previousJobs = this.jobs;
		const previousTimer = this.timer;
		const previousTimezone = this.timezone;
		log.debug("cron.scheduler.reload_started", {
			chatId: this.chatConfig.chatId,
		});

		try {
			const workspaceDir = resolveChatWorkspaceDirectory(
				this.chatConfig.workspace
			);
			const layout = ensureChatWorkspaceLayout(workspaceDir);
			const workspaceConfig = loadPhiWorkspaceConfig(
				layout.configFilePath
			);
			const timezone = resolveWorkspaceTimezone(
				workspaceConfig,
				layout.configFilePath
			);
			const loadedJobs = loadCronJobs({
				layout,
				workspaceConfig,
			});
			if (loadedJobs.length > 0 && !timezone) {
				throw new Error(
					`Missing chat.timezone for cron chat ${this.chatConfig.chatId}`
				);
			}
			this.timezone = timezone;
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

			const result = {
				jobCount: this.jobs.length,
				nextRunAtMs: this.jobs
					.map((job) => job.nextRunAtMs)
					.filter(
						(nextRunAtMs): nextRunAtMs is number =>
							typeof nextRunAtMs === "number"
					)
					.sort((left, right) => left - right)[0],
			};
			log.debug("cron.scheduler.reload_completed", {
				chatId: this.chatConfig.chatId,
				jobCount: result.jobCount,
				nextRunAtMs: result.nextRunAtMs,
			});
			return result;
		} catch (error: unknown) {
			this.jobs = previousJobs;
			this.timer = previousTimer;
			this.timezone = previousTimezone;
			log.error("cron.scheduler.reload_failed", {
				chatId: this.chatConfig.chatId,
				err: error instanceof Error ? error : new Error(String(error)),
			});
			throw error;
		}
	}

	private getTimezone(): string {
		if (!this.timezone) {
			return Intl.DateTimeFormat().resolvedOptions().timeZone;
		}
		return this.timezone;
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
		const startedAtDate = new Date();
		const startedAt = startedAtDate.toISOString();
		const startedAtMs = startedAtDate.getTime();
		log.info("cron.job.started", {
			chatId: this.chatConfig.chatId,
			jobId: job.id,
			promptPath: job.prompt,
		});

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
				result
			);
			appendCronRunLog({
				chatId: this.chatConfig.chatId,
				jobId: job.id,
				status: "ok",
				text: buildCronLogText(result),
				startedAt,
				finishedAt: new Date().toISOString(),
			});
			log.info("cron.job.completed", {
				chatId: this.chatConfig.chatId,
				jobId: job.id,
				outboundMessageCount: result.outboundMessages.length,
				durationMs: Date.now() - startedAtMs,
			});
		} catch (error: unknown) {
			const message =
				error instanceof Error ? error.message : String(error);
			await this.publishError(message);
			appendCronRunLog({
				chatId: this.chatConfig.chatId,
				jobId: job.id,
				status: "error",
				error: message,
				startedAt,
				finishedAt: new Date().toISOString(),
			});
			log.error("cron.job.failed", {
				chatId: this.chatConfig.chatId,
				jobId: job.id,
				durationMs: Date.now() - startedAtMs,
				err: error instanceof Error ? error : new Error(String(error)),
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
			await this.deliveryRegistry
				.require(this.chatConfig.chatId)
				.deliver({
					text: `Cron job failed: ${message}`,
					attachments: [],
				});
		});
	}
}

export async function startCronService(params: {
	runtime: ChatSessionRuntime<AgentSession>;
	phiConfig: PhiConfig;
	chatExecutor: ChatExecutor;
	reloadRegistry: ChatReloadRegistry;
	chatConfigs: ResolvedCronChatServiceConfig[];
	deliveryRegistry: PhiRouteDeliveryRegistry;
	dependencies?: CronServiceDependencies;
}): Promise<RunningCronService> {
	const dependencies =
		params.dependencies ??
		createDefaultCronServiceDependencies({
			deliveryRegistry: params.deliveryRegistry,
		});
	const schedulers = new Map<string, ChatCronScheduler>();
	log.info("cron.service.starting", {
		chatCount: params.chatConfigs.length,
	});
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
			params.deliveryRegistry,
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
	log.info("cron.service.started", {
		chatCount: params.chatConfigs.length,
	});

	return {
		done,
		async stop(): Promise<void> {
			if (stopped) {
				return;
			}
			stopped = true;
			log.info("cron.service.stopping", {
				chatCount: params.chatConfigs.length,
			});
			for (const unregister of unregisterHandlers) {
				unregister();
			}
			for (const scheduler of schedulers.values()) {
				scheduler.stop();
			}
			resolveDone?.();
			log.info("cron.service.stopped", {
				chatCount: params.chatConfigs.length,
			});
		},
	};
}
