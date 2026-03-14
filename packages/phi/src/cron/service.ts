import { getPhiLogger } from "@phi/core/logger";
import {
	resolveEnabledChatRouteKeys,
	type PhiConfig,
	type ResolvedCronChatServiceConfig,
} from "@phi/core/config";
import type { ChatReloadRegistry } from "@phi/core/reload";
import {
	ensureChatWorkspaceLayout,
	resolveChatWorkspaceDirectory,
} from "@phi/core/chat-workspace";
import {
	loadPhiWorkspaceConfig,
	resolveWorkspaceCronDestination,
	resolveWorkspaceTimezone,
} from "@phi/core/workspace-config";
import { computeCronJobNextRunAtMs } from "@phi/cron/schedule";
import { appendCronRunLog, loadCronJobs } from "@phi/cron/store";
import type { CronReloadResult, LoadedCronJob } from "@phi/cron/types";
import type { PhiMessage } from "@phi/messaging/types";
import type { ChatHandlerCronInput, ServiceRoutes } from "@phi/services/routes";

const log = getPhiLogger("cron");

export interface RunningCronService {
	done: Promise<void>;
	stop(): Promise<void>;
}

export interface CronServiceDependencies {
	dispatchTrigger(
		chatId: string,
		input: ChatHandlerCronInput
	): Promise<PhiMessage[]>;
}

function buildCronLogText(outboundMessages: PhiMessage[]): string {
	return outboundMessages
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

function assertCronDestinationConfigured(params: {
	phiConfig: PhiConfig;
	chatId: string;
	outboundDestination: string;
}): void {
	const routeKeys = resolveEnabledChatRouteKeys(
		params.phiConfig,
		params.chatId
	);
	if (routeKeys.includes(params.outboundDestination)) {
		return;
	}
	throw new Error(
		`Invalid cron.destination for chat ${params.chatId}: ${params.outboundDestination}`
	);
}

class ChatCronScheduler {
	private timer: ReturnType<typeof setTimeout> | undefined;
	private jobs: LoadedCronJob[] = [];
	private timezone: string | undefined;
	private outboundDestination: string | undefined;
	private readonly runningJobs = new Set<string>();

	public constructor(
		private readonly phiConfig: PhiConfig,
		private readonly chatConfig: ResolvedCronChatServiceConfig,
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

	public async validate(): Promise<CronReloadResult> {
		const state = this.loadValidatedState();
		return this.buildReloadResult(state.jobs);
	}

	public async reload(): Promise<CronReloadResult> {
		const previousJobs = this.jobs;
		const previousTimer = this.timer;
		const previousTimezone = this.timezone;
		const previousOutboundDestination = this.outboundDestination;
		log.debug("cron.scheduler.reload_started", {
			chatId: this.chatConfig.chatId,
		});

		try {
			const state = this.loadValidatedState();
			this.timezone = state.timezone;
			this.outboundDestination = state.outboundDestination;
			this.jobs = state.jobs;
			if (previousTimer) {
				clearTimeout(previousTimer);
			}
			this.timer = undefined;
			this.armTimer();

			const result = this.buildReloadResult(this.jobs);
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
			this.outboundDestination = previousOutboundDestination;
			log.error("cron.scheduler.reload_failed", {
				chatId: this.chatConfig.chatId,
				err: error instanceof Error ? error : new Error(String(error)),
			});
			throw error;
		}
	}

	private loadValidatedState(): {
		timezone: string | undefined;
		outboundDestination: string | undefined;
		jobs: LoadedCronJob[];
	} {
		const workspaceDir = resolveChatWorkspaceDirectory(
			this.chatConfig.workspace
		);
		const layout = ensureChatWorkspaceLayout(workspaceDir);
		const workspaceConfig = loadPhiWorkspaceConfig(layout.configFilePath);
		const timezone = resolveWorkspaceTimezone(
			workspaceConfig,
			layout.configFilePath
		);
		const outboundDestination = resolveWorkspaceCronDestination(
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
		if (loadedJobs.length > 0 && !outboundDestination) {
			throw new Error(
				`Missing cron.destination for chat ${this.chatConfig.chatId}`
			);
		}
		if (outboundDestination) {
			assertCronDestinationConfigured({
				phiConfig: this.phiConfig,
				chatId: this.chatConfig.chatId,
				outboundDestination,
			});
		}
		return {
			timezone,
			outboundDestination,
			jobs: loadedJobs.map((job) => ({
				...job,
				nextRunAtMs: this.computeNextRunAtMs(job, timezone),
			})),
		};
	}

	private buildReloadResult(jobs: LoadedCronJob[]): CronReloadResult {
		return {
			jobCount: jobs.length,
			nextRunAtMs: jobs
				.map((job) => job.nextRunAtMs)
				.filter(
					(nextRunAtMs): nextRunAtMs is number =>
						typeof nextRunAtMs === "number"
				)
				.sort((left, right) => left - right)[0],
		};
	}

	private getTimezone(): string {
		if (!this.timezone) {
			return Intl.DateTimeFormat().resolvedOptions().timeZone;
		}
		return this.timezone;
	}

	private computeNextRunAtMs(
		job: LoadedCronJob,
		timezone: string | undefined = this.timezone
	): number | undefined {
		return computeCronJobNextRunAtMs(
			job,
			timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
			Date.now()
		);
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
		const outboundDestination = this.outboundDestination;
		if (!outboundDestination) {
			throw new Error(
				`Missing cron.destination for chat ${this.chatConfig.chatId}`
			);
		}
		const startedAtDate = new Date();
		const startedAt = startedAtDate.toISOString();
		const startedAtMs = startedAtDate.getTime();
		log.info("cron.job.started", {
			chatId: this.chatConfig.chatId,
			jobId: job.id,
			promptPath: job.prompt,
		});

		try {
			const outboundMessages = await this.dependencies.dispatchTrigger(
				this.chatConfig.chatId,
				{ text: job.promptText, outboundDestination }
			);
			appendCronRunLog({
				chatId: this.chatConfig.chatId,
				jobId: job.id,
				status: "ok",
				text: buildCronLogText(outboundMessages),
				startedAt,
				finishedAt: new Date().toISOString(),
			});
			log.info("cron.job.completed", {
				chatId: this.chatConfig.chatId,
				jobId: job.id,
				outboundMessageCount: outboundMessages.length,
				durationMs: Date.now() - startedAtMs,
			});
		} catch (error: unknown) {
			const message =
				error instanceof Error ? error.message : String(error);
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
}

export async function startCronService(params: {
	phiConfig: PhiConfig;
	reloadRegistry: ChatReloadRegistry;
	chatConfigs: ResolvedCronChatServiceConfig[];
	routes: ServiceRoutes;
	dependencies?: CronServiceDependencies;
}): Promise<RunningCronService> {
	const dependencies =
		params.dependencies ??
		({
			dispatchTrigger: async (
				chatId: string,
				input: ChatHandlerCronInput
			) => await params.routes.dispatchCron(chatId, input),
		} satisfies CronServiceDependencies);
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
			params.phiConfig,
			chatConfig,
			dependencies
		);
		await scheduler.start();
		schedulers.set(chatConfig.chatId, scheduler);
		unregisterHandlers.push(
			params.reloadRegistry.register(chatConfig.chatId, {
				validate: async () => {
					const result = await scheduler.validate();
					return [`cron:${String(result.jobCount)}`];
				},
				apply: async () => {
					const result = await scheduler.reload();
					return [`cron:${String(result.jobCount)}`];
				},
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
