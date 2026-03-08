import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { resolve, sep } from "node:path";

import { parse } from "yaml";

import type { ChatWorkspaceLayout } from "@phi/core/chat-workspace";
import type {
	CronJobDefinition,
	CronJobsFile,
	CronRunLogEntry,
	LoadedCronJob,
} from "@phi/cron/types";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toNonEmptyString(value: unknown, errorMessage: string): string {
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new Error(errorMessage);
	}
	return value.trim();
}

function parseJobsFile(filePath: string): CronJobsFile {
	if (!existsSync(filePath)) {
		return { jobs: [] };
	}

	const raw = parse(readFileSync(filePath, "utf-8"));
	if (raw === undefined || raw === null) {
		return { jobs: [] };
	}
	if (!isRecord(raw)) {
		throw new Error(
			`Invalid cron jobs file: root must be a mapping (${filePath})`
		);
	}

	const jobs = raw.jobs;
	if (jobs === undefined) {
		return { jobs: [] };
	}
	if (!Array.isArray(jobs)) {
		throw new Error(
			`Invalid cron jobs file: jobs must be a list (${filePath})`
		);
	}

	return {
		jobs: jobs as CronJobDefinition[],
	};
}

function resolvePromptFilePath(
	layout: ChatWorkspaceLayout,
	prompt: string,
	jobId: string
): string {
	const resolvedPath = resolve(layout.cronDir, prompt);
	const allowedPrefix = `${layout.cronDir}${sep}`;
	if (
		resolvedPath !== layout.cronDir &&
		!resolvedPath.startsWith(allowedPrefix)
	) {
		throw new Error(`Invalid prompt path for cron job ${jobId}: ${prompt}`);
	}
	return resolvedPath;
}

export function loadCronJobs(params: {
	layout: ChatWorkspaceLayout;
}): LoadedCronJob[] {
	const parsed = parseJobsFile(params.layout.cronJobsFilePath);
	const jobs = parsed.jobs ?? [];
	const loadedJobs: LoadedCronJob[] = [];
	const seenIds = new Set<string>();

	for (const [index, rawJob] of jobs.entries()) {
		if (!isRecord(rawJob)) {
			throw new Error(
				`Invalid cron job at index ${index}: job must be a mapping`
			);
		}

		const id = toNonEmptyString(
			rawJob.id,
			`Invalid cron job at index ${index}: missing id`
		);
		if (seenIds.has(id)) {
			throw new Error(`Duplicate cron job id: ${id}`);
		}
		seenIds.add(id);

		const prompt = toNonEmptyString(
			rawJob.prompt,
			`Invalid cron job ${id}: missing prompt`
		);
		const cron =
			typeof rawJob.cron === "string" && rawJob.cron.trim().length > 0
				? rawJob.cron.trim()
				: undefined;
		const at =
			typeof rawJob.at === "string" && rawJob.at.trim().length > 0
				? rawJob.at.trim()
				: undefined;
		if ((cron ? 1 : 0) + (at ? 1 : 0) !== 1) {
			throw new Error(
				`Invalid cron job ${id}: exactly one of cron or at must be set`
			);
		}

		const promptFilePath = resolvePromptFilePath(params.layout, prompt, id);
		if (!existsSync(promptFilePath)) {
			throw new Error(
				`Missing prompt file for cron job ${id}: ${prompt}`
			);
		}

		const promptText = readFileSync(promptFilePath, "utf-8").trim();
		if (promptText.length === 0) {
			throw new Error(
				`Prompt file is empty for cron job ${id}: ${prompt}`
			);
		}

		loadedJobs.push({
			id,
			enabled: rawJob.enabled !== false,
			prompt,
			promptFilePath,
			promptText,
			cron,
			at,
		});
	}

	return loadedJobs;
}

export function appendCronRunLog(
	filePath: string,
	entry: CronRunLogEntry
): void {
	appendFileSync(filePath, `${JSON.stringify(entry)}\n`, "utf-8");
}
