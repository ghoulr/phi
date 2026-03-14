import { getPhiLogger } from "@phi/core/logger";
import type {
	PhiConfig,
	ResolvedCronSessionServiceConfig,
} from "@phi/core/config";
import type { ChatReloadRegistry } from "@phi/core/reload";
import {
	ensureChatWorkspaceLayout,
	resolveChatWorkspaceDirectory,
} from "@phi/core/chat-workspace";
import {
	loadPhiWorkspaceConfig,
	resolveWorkspaceTimezone,
} from "@phi/core/workspace-config";
import { computeCronJobNextRunAtMs } from "@phi/cron/schedule";
import { appendCronRunLog, loadCronJobs } from "@phi/cron/store";
import type { CronReloadResult, LoadedCronJob } from "@phi/cron/types";
import type { PhiMessage } from "@phi/messaging/types";
import type { CronInput, ServiceRoutes } from "@phi/services/routes";

const log = getPhiLogger("cron");

export interface RunningCronService {
	done: Promise<void>;
	stop(): Promise<void>;
}

export interface CronServiceDependencies {
	dispatchTrigger(chatId: string, input: CronInput): Promise<PhiMessage[]>;
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

class SessionCronScheduler {
	private timer: ReturnType<typeof setTimeout> | undefined;
	private jobs: LoadedCronJob[] = [];
	private timezone: string | undefined;
	private readonly runningJobs = new Set<string>();

	public constructor(
		private readonly sessionConfig: ResolvedCronSessionServiceConfig,
		private readonly dependencies: CronServiceDependencies
	) {}

	public async start(): Promise<void> {
		log.info("cron.scheduler.starting", {
			chatId: this.sessionConfig.chatId,
			sessionId: this.sessionConfig.sessionId,
		});
		await this.reload();
		log.info("cron.scheduler.started", {
			chatId: this.sessionConfig.chatId,
			sessionId: this.sessionConfig.sessionId,
			jobCount: this.jobs.length,
		});
	}

	public stop(): void {
		if (this.timer) {
			clearTimeout(this.timer);
			this.timer = undefined;
		}
		log.info("cron.scheduler.stopped", {
			chatId: this.sessionConfig.chatId,
			sessionId: this.sessionConfig.sessionId,
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
		log.debug("cron.scheduler.reload_started", {
			chatId: this.sessionConfig.chatId,
			sessionId: this.sessionConfig.sessionId,
		});

		try {
			const state = this.loadValidatedState();
			this.timezone = state.timezone;
			this.jobs = state.jobs;
			if (previousTimer) {
				clearTimeout(previousTimer);
			}
			this.timer = undefined;
			this.armTimer();

			const result = this.buildReloadResult(this.jobs);
			log.debug("cron.scheduler.reload_completed", {
				chatId: this.sessionConfig.chatId,
				sessionId: this.sessionConfig.sessionId,
				jobCount: result.jobCount,
				nextRunAtMs: result.nextRunAtMs,
			});
			return result;
		} catch (error: unknown) {
			this.jobs = previousJobs;
			this.timer = previousTimer;
			this.timezone = previousTimezone;
			log.error("cron.scheduler.reload_failed", {
				chatId: this.sessionConfig.chatId,
				sessionId: this.sessionConfig.sessionId,
				err: error instanceof Error ? error : new Error(String(error)),
			});
			throw error;
		}
	}

	private loadValidatedState(): {
		timezone: string | undefined;
		jobs: LoadedCronJob[];
	} {
		const workspaceDir = resolveChatWorkspaceDirectory(
			this.sessionConfig.workspace
		);
		const layout = ensureChatWorkspaceLayout(workspaceDir);
		const workspaceConfig = loadPhiWorkspaceConfig(layout.configFilePath);
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
				`Missing chat.timezone for cron chat ${this.sessionConfig.chatId}`
			);
		}
		return {
			timezone,
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
		const startedAtDate = new Date();
		const startedAt = startedAtDate.toISOString();
		const startedAtMs = startedAtDate.getTime();
		log.info("cron.job.started", {
			chatId: this.sessionConfig.chatId,
			sessionId: this.sessionConfig.sessionId,
			jobId: job.id,
			promptPath: job.prompt,
		});

		try {
			const outboundMessages = await this.dependencies.dispatchTrigger(
				this.sessionConfig.chatId,
				{ text: job.promptText }
			);
			appendCronRunLog({
				chatId: this.sessionConfig.chatId,
				jobId: job.id,
				status: "ok",
				text: buildCronLogText(outboundMessages),
				startedAt,
				finishedAt: new Date().toISOString(),
			});
			log.info("cron.job.completed", {
				chatId: this.sessionConfig.chatId,
				sessionId: this.sessionConfig.sessionId,
				jobId: job.id,
				outboundMessageCount: outboundMessages.length,
				durationMs: Date.now() - startedAtMs,
			});
		} catch (error: unknown) {
			const message =
				error instanceof Error ? error.message : String(error);
			appendCronRunLog({
				chatId: this.sessionConfig.chatId,
				jobId: job.id,
				status: "error",
				error: message,
				startedAt,
				finishedAt: new Date().toISOString(),
			});
			log.error("cron.job.failed", {
				chatId: this.sessionConfig.chatId,
				sessionId: this.sessionConfig.sessionId,
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
	sessionConfigs: ResolvedCronSessionServiceConfig[];
	routes: ServiceRoutes;
	dependencies?: CronServiceDependencies;
}): Promise<RunningCronService> {
	const dependencies =
		params.dependencies ??
		({
			dispatchTrigger: async (chatId: string, input: CronInput) =>
				await params.routes.dispatchCron(chatId, input),
		} satisfies CronServiceDependencies);
	const schedulers = new Map<string, SessionCronScheduler>();
	log.info("cron.service.starting", {
		sessionCount: params.sessionConfigs.length,
	});
	const unregisterHandlers: Array<() => void> = [];
	let stopped = false;
	let resolveDone: (() => void) | undefined;
	const done = new Promise<void>((resolve) => {
		resolveDone = resolve;
	});

	for (const sessionConfig of params.sessionConfigs) {
		const scheduler = new SessionCronScheduler(sessionConfig, dependencies);
		await scheduler.start();
		schedulers.set(sessionConfig.sessionId, scheduler);
		unregisterHandlers.push(
			params.reloadRegistry.register(sessionConfig.chatId, {
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
		sessionCount: params.sessionConfigs.length,
	});

	return {
		done,
		async stop(): Promise<void> {
			if (stopped) {
				return;
			}
			stopped = true;
			log.info("cron.service.stopping", {
				sessionCount: params.sessionConfigs.length,
			});
			for (const unregister of unregisterHandlers) {
				unregister();
			}
			for (const scheduler of schedulers.values()) {
				scheduler.stop();
			}
			resolveDone?.();
			log.info("cron.service.stopped", {
				sessionCount: params.sessionConfigs.length,
			});
		},
	};
}
