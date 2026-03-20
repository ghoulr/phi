import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { Type } from "@sinclair/typebox";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";

import {
	loadPhiCronConfig,
	resolveCronJobDefinitions,
	writePhiCronConfig,
} from "@phi/cron/config";
import type { CronJobDefinition, LoadedCronJob } from "@phi/cron/types";
import { computeCronJobNextRunAtMs } from "@phi/cron/schedule";
import { loadCronJobs } from "@phi/cron/store";
import type { CronControllerRegistry } from "@phi/cron/controller";
import { ensureChatWorkspaceLayout } from "@phi/core/chat-workspace";
import {
	loadPhiWorkspaceConfig,
	resolveWorkspaceTimezone,
} from "@phi/core/workspace-config";
import type { ServiceRoutes } from "@phi/services/routes";

const CreateCronSchema = Type.Object({
	id: Type.String({
		description: "Stable cron job id, for example daily-summary.",
	}),
	prompt: Type.String({
		description: "Prompt text for what should happen when the job fires.",
	}),
	cron: Type.Optional(
		Type.String({ description: "Cron expression for recurring jobs." })
	),
	at: Type.Optional(
		Type.String({
			description: "One-shot local datetime in YYYY-MM-DD HH:mm format.",
		})
	),
	enabled: Type.Optional(
		Type.Boolean({
			description: "Whether the job is enabled. Defaults to true.",
		})
	),
});

const UpdateCronSchema = Type.Object({
	id: Type.String({ description: "Existing cron job id." }),
	prompt: Type.Optional(
		Type.String({
			description: "New prompt text. Leave unset to keep current.",
		})
	),
	cron: Type.Optional(
		Type.String({
			description:
				"New cron expression. When set, replaces any existing one-shot schedule.",
		})
	),
	at: Type.Optional(
		Type.String({
			description:
				"New one-shot local datetime. When set, replaces any existing cron expression.",
		})
	),
	enabled: Type.Optional(
		Type.Boolean({ description: "Whether the job is enabled." })
	),
});

const DeleteCronSchema = Type.Object({
	id: Type.String({ description: "Cron job id to delete." }),
});

const FireCronSchema = Type.Object({
	id: Type.String({ description: "Cron job id to fire now." }),
});

interface FileSnapshot {
	existed: boolean;
	content?: string;
}

interface CronJobView {
	id: string;
	enabled: boolean;
	promptText: string;
	cron?: string;
	at?: string;
	nextRunAt?: string;
}

const CRON_PROMPT_GUIDELINE =
	"prompt in cron should describe what to do when the job fires, NOT what user asks";

function snapshotFile(filePath: string): FileSnapshot {
	if (!existsSync(filePath)) {
		return { existed: false };
	}
	return {
		existed: true,
		content: readFileSync(filePath, "utf-8"),
	};
}

function restoreFile(filePath: string, snapshot: FileSnapshot): void {
	if (!snapshot.existed) {
		if (existsSync(filePath)) {
			unlinkSync(filePath);
		}
		return;
	}
	writeFileSync(filePath, snapshot.content ?? "", "utf-8");
}

function normalizeCronJobId(id: string): string {
	const normalized = id.trim();
	if (!/^[a-z0-9][a-z0-9-_]*$/.test(normalized)) {
		throw new Error(
			`Invalid cron job id: ${id}. Use lowercase letters, digits, hyphen, or underscore.`
		);
	}
	return normalized;
}

function normalizePromptText(prompt: string): string {
	const normalized = prompt.trim();
	if (!normalized) {
		throw new Error("Cron prompt must not be empty.");
	}
	return normalized;
}

function resolveCreateSchedule(input: { cron?: string; at?: string }): {
	cron?: string;
	at?: string;
} {
	const cron = input.cron?.trim() || undefined;
	const at = input.at?.trim() || undefined;
	if ((cron ? 1 : 0) + (at ? 1 : 0) !== 1) {
		throw new Error("Create cron requires exactly one of cron or at.");
	}
	return { cron, at };
}

function resolveUpdatedSchedule(
	existing: LoadedCronJob,
	input: {
		cron?: string;
		at?: string;
	}
): { cron?: string; at?: string } {
	const cron = input.cron?.trim() || undefined;
	const at = input.at?.trim() || undefined;
	if (cron && at) {
		throw new Error("Update cron accepts only one of cron or at.");
	}
	if (cron) {
		return { cron, at: undefined };
	}
	if (at) {
		return { cron: undefined, at };
	}
	return {
		cron: existing.cron,
		at: existing.at,
	};
}

function resolvePromptLocation(
	layout: ReturnType<typeof ensureChatWorkspaceLayout>,
	id: string
): { prompt: string; promptFilePath: string } {
	return {
		prompt: `jobs/${id}.md`,
		promptFilePath: join(layout.cronJobsDir, `${id}.md`),
	};
}

function writePromptFile(filePath: string, promptText: string): void {
	writeFileSync(filePath, `${promptText}\n`, "utf-8");
}

function loadCurrentCronJobs(
	layout: ReturnType<typeof ensureChatWorkspaceLayout>
): { definitions: CronJobDefinition[]; jobs: LoadedCronJob[] } {
	const cronConfig = loadPhiCronConfig(layout.cronConfigFilePath);
	return {
		definitions: resolveCronJobDefinitions(
			cronConfig,
			layout.cronConfigFilePath
		),
		jobs: loadCronJobs({ layout, cronConfig }),
	};
}

function requireLoadedJob(jobs: LoadedCronJob[], id: string): LoadedCronJob {
	const job = jobs.find((entry) => entry.id === id);
	if (!job) {
		throw new Error(`Cron job not found: ${id}`);
	}
	return job;
}

function buildCronJobView(
	layout: ReturnType<typeof ensureChatWorkspaceLayout>,
	job: LoadedCronJob
): CronJobView {
	const workspaceConfig = loadPhiWorkspaceConfig(layout.configFilePath);
	const timezone = resolveWorkspaceTimezone(
		workspaceConfig,
		layout.configFilePath
	);
	const nextRunAtMs =
		job.enabled && timezone
			? computeCronJobNextRunAtMs(job, timezone, Date.now())
			: undefined;
	return {
		id: job.id,
		enabled: job.enabled,
		promptText: job.promptText,
		cron: job.cron,
		at: job.at,
		nextRunAt:
			typeof nextRunAtMs === "number"
				? new Date(nextRunAtMs).toISOString()
				: undefined,
	};
}

function formatJobView(job: CronJobView): string {
	const schedule = job.cron ? `cron=${job.cron}` : `at=${job.at ?? ""}`;
	const nextRun = job.nextRunAt ? ` next=${job.nextRunAt}` : "";
	return [
		`- ${job.id} (${job.enabled ? "enabled" : "disabled"}) ${schedule}${nextRun}`,
		"  prompt:",
		"  ```text",
		...job.promptText.split("\n").map((line) => `  ${line}`),
		"  ```",
	].join("\n");
}

function buildListText(jobs: CronJobView[]): string {
	if (jobs.length === 0) {
		return "No cron jobs configured.";
	}
	return ["Cron jobs:", ...jobs.map((job) => formatJobView(job))].join(
		"\n\n"
	);
}

function buildToolResult(text: string, details: unknown) {
	return {
		content: [{ type: "text" as const, text }],
		details,
	};
}

async function reloadCronController(
	registry: CronControllerRegistry,
	chatId: string
): Promise<void> {
	await registry.require(chatId).reload();
}

export function createCronTools(params: {
	chatId: string;
	sessionId: string;
	workspaceDir: string;
	routes: ServiceRoutes;
	controllerRegistry: CronControllerRegistry;
}): ToolDefinition[] {
	const layout = ensureChatWorkspaceLayout(params.workspaceDir);

	const listCron: ToolDefinition = {
		name: "listCron",
		label: "listCron",
		description: "List existing cron jobs.",
		promptSnippet: "List existing cron jobs",
		parameters: Type.Object({}),
		execute: async () => {
			const views = loadCurrentCronJobs(layout).jobs.map((job) =>
				buildCronJobView(layout, job)
			);
			return buildToolResult(buildListText(views), { jobs: views });
		},
	};

	const createCron: ToolDefinition<typeof CreateCronSchema> = {
		name: "createCron",
		label: "createCron",
		description: "Create a cron job.",
		promptSnippet: "Create a cron job",
		promptGuidelines: [CRON_PROMPT_GUIDELINE],
		parameters: CreateCronSchema,
		execute: async (_toolCallId, input) => {
			const id = normalizeCronJobId(input.id);
			const promptText = normalizePromptText(input.prompt);
			const schedule = resolveCreateSchedule(input);
			const endpointChatId = params.routes.resolveEndpointChatId(
				params.sessionId
			);
			const { definitions, jobs } = loadCurrentCronJobs(layout);
			if (jobs.some((job) => job.id === id)) {
				throw new Error(`Duplicate cron job id: ${id}`);
			}
			const { prompt, promptFilePath } = resolvePromptLocation(
				layout,
				id
			);
			if (existsSync(promptFilePath)) {
				throw new Error(`Cron prompt file already exists: ${prompt}`);
			}

			const nextDefinitions = [
				...definitions,
				{
					id,
					enabled: input.enabled ?? true,
					sessionId: params.sessionId,
					endpointChatId,
					prompt,
					cron: schedule.cron,
					at: schedule.at,
				},
			];
			const cronSnapshot = snapshotFile(layout.cronConfigFilePath);
			const promptSnapshot = snapshotFile(promptFilePath);
			try {
				writePromptFile(promptFilePath, promptText);
				writePhiCronConfig(layout.cronConfigFilePath, {
					jobs: nextDefinitions,
				});
				await reloadCronController(
					params.controllerRegistry,
					params.chatId
				);
			} catch (error: unknown) {
				restoreFile(layout.cronConfigFilePath, cronSnapshot);
				restoreFile(promptFilePath, promptSnapshot);
				throw error;
			}

			const job = requireLoadedJob(loadCurrentCronJobs(layout).jobs, id);
			return buildToolResult(`Created cron job ${id}.`, {
				job: buildCronJobView(layout, job),
			});
		},
	};

	const updateCron: ToolDefinition<typeof UpdateCronSchema> = {
		name: "updateCron",
		label: "updateCron",
		description: "Update an existing cron job.",
		promptSnippet: "Update an existing cron job",
		promptGuidelines: [CRON_PROMPT_GUIDELINE],
		parameters: UpdateCronSchema,
		execute: async (_toolCallId, input) => {
			const id = normalizeCronJobId(input.id);
			const { definitions, jobs } = loadCurrentCronJobs(layout);
			const existing = requireLoadedJob(jobs, id);
			const definitionIndex = definitions.findIndex(
				(job) => job.id === id
			);
			if (definitionIndex === -1) {
				throw new Error(`Cron job not found: ${id}`);
			}
			const schedule = resolveUpdatedSchedule(existing, input);
			const promptText =
				input.prompt === undefined
					? existing.promptText
					: normalizePromptText(input.prompt);
			const nextDefinitions = definitions.slice();
			nextDefinitions[definitionIndex] = {
				id,
				enabled: input.enabled ?? existing.enabled,
				sessionId: existing.sessionId,
				endpointChatId: existing.endpointChatId,
				prompt: existing.prompt,
				cron: schedule.cron,
				at: schedule.at,
			};
			const cronSnapshot = snapshotFile(layout.cronConfigFilePath);
			const promptSnapshot = snapshotFile(existing.promptFilePath);
			try {
				writePromptFile(existing.promptFilePath, promptText);
				writePhiCronConfig(layout.cronConfigFilePath, {
					jobs: nextDefinitions,
				});
				await reloadCronController(
					params.controllerRegistry,
					params.chatId
				);
			} catch (error: unknown) {
				restoreFile(layout.cronConfigFilePath, cronSnapshot);
				restoreFile(existing.promptFilePath, promptSnapshot);
				throw error;
			}

			const job = requireLoadedJob(loadCurrentCronJobs(layout).jobs, id);
			return buildToolResult(`Updated cron job ${id}.`, {
				job: buildCronJobView(layout, job),
			});
		},
	};

	const deleteCron: ToolDefinition<typeof DeleteCronSchema> = {
		name: "deleteCron",
		label: "deleteCron",
		description: "Delete a cron job.",
		promptSnippet: "Delete a cron job",
		parameters: DeleteCronSchema,
		execute: async (_toolCallId, input) => {
			const id = normalizeCronJobId(input.id);
			const { definitions, jobs } = loadCurrentCronJobs(layout);
			const existing = requireLoadedJob(jobs, id);
			const nextDefinitions = definitions.filter((job) => job.id !== id);
			const cronSnapshot = snapshotFile(layout.cronConfigFilePath);
			const promptSnapshot = snapshotFile(existing.promptFilePath);
			try {
				if (existsSync(existing.promptFilePath)) {
					unlinkSync(existing.promptFilePath);
				}
				writePhiCronConfig(layout.cronConfigFilePath, {
					jobs: nextDefinitions,
				});
				await reloadCronController(
					params.controllerRegistry,
					params.chatId
				);
			} catch (error: unknown) {
				restoreFile(layout.cronConfigFilePath, cronSnapshot);
				restoreFile(existing.promptFilePath, promptSnapshot);
				throw error;
			}
			return buildToolResult(`Deleted cron job ${id}.`, {
				deletedId: id,
			});
		},
	};

	const fireCron: ToolDefinition<typeof FireCronSchema> = {
		name: "fireCron",
		label: "fireCron",
		description: "Fire a cron job now.",
		promptSnippet: "Fire a cron job now",
		parameters: FireCronSchema,
		execute: async (_toolCallId, input) => {
			const id = normalizeCronJobId(input.id);
			const job = requireLoadedJob(loadCurrentCronJobs(layout).jobs, id);
			const outboundMessages = await params.routes.dispatchCron(
				job.sessionId,
				{
					text: job.promptText,
					endpointChatId: job.endpointChatId,
				}
			);
			return buildToolResult(`Fired cron job ${id}.`, {
				job: buildCronJobView(layout, job),
				outboundMessageCount: outboundMessages.length,
			});
		},
	};

	return [
		createCron,
		listCron,
		updateCron,
		deleteCron,
		fireCron,
	] as ToolDefinition[];
}
