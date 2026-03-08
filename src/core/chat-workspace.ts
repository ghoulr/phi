import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

const DOT_PHI_DIR = ".phi";
const SESSIONS_DIR = "sessions";
const MEMORY_DIR = "memory";
const LOGS_DIR = "logs";
const SKILLS_DIR = "skills";
const CRON_DIR = "cron";
const CRON_JOBS_DIR = "jobs";
const INBOX_DIR = "inbox";
const LOGS_FILE_NAME = "logs.jsonl";
const MEMORY_FILE_NAME = "MEMORY.md";
const CRON_JOBS_FILE_NAME = "jobs.yaml";
const CRON_RUNS_FILE_NAME = "runs.jsonl";
const DEFAULT_MEMORY_FILE_CONTENT = "# MEMORY\n";

export interface ChatWorkspaceLayout {
	workspaceDir: string;
	phiDir: string;
	sessionsDir: string;
	memoryDir: string;
	logsDir: string;
	skillsDir: string;
	inboxDir: string;
	cronDir: string;
	cronJobsDir: string;
	memoryFilePath: string;
	cronJobsFilePath: string;
	cronRunsFilePath: string;
}

export function resolveChatWorkspaceDirectory(
	workspace: string,
	userHomeDir: string = homedir()
): string {
	if (workspace === "~") {
		return userHomeDir;
	}
	if (workspace.startsWith("~/")) {
		return join(userHomeDir, workspace.slice(2));
	}
	if (isAbsolute(workspace)) {
		return workspace;
	}
	return resolve(workspace);
}

export function getChatLogsFilePath(workspaceDir: string): string {
	return join(workspaceDir, DOT_PHI_DIR, LOGS_DIR, LOGS_FILE_NAME);
}

export function getChatCronDirectoryPath(workspaceDir: string): string {
	return join(workspaceDir, DOT_PHI_DIR, CRON_DIR);
}

export function getChatInboxDirectoryPath(workspaceDir: string): string {
	return join(workspaceDir, DOT_PHI_DIR, INBOX_DIR);
}

export function getChatCronJobsDirectoryPath(workspaceDir: string): string {
	return join(getChatCronDirectoryPath(workspaceDir), CRON_JOBS_DIR);
}

export function getChatCronJobsFilePath(workspaceDir: string): string {
	return join(getChatCronDirectoryPath(workspaceDir), CRON_JOBS_FILE_NAME);
}

export function getChatCronRunsFilePath(workspaceDir: string): string {
	return join(getChatCronDirectoryPath(workspaceDir), CRON_RUNS_FILE_NAME);
}

export function ensureChatWorkspaceLayout(
	workspaceDir: string
): ChatWorkspaceLayout {
	mkdirSync(workspaceDir, { recursive: true });

	const phiDir = join(workspaceDir, DOT_PHI_DIR);
	const sessionsDir = join(phiDir, SESSIONS_DIR);
	const memoryDir = join(phiDir, MEMORY_DIR);
	const logsDir = join(phiDir, LOGS_DIR);
	const skillsDir = join(phiDir, SKILLS_DIR);
	const inboxDir = join(phiDir, INBOX_DIR);
	const cronDir = join(phiDir, CRON_DIR);
	const cronJobsDir = join(cronDir, CRON_JOBS_DIR);
	const memoryFilePath = join(memoryDir, MEMORY_FILE_NAME);
	const cronJobsFilePath = join(cronDir, CRON_JOBS_FILE_NAME);
	const cronRunsFilePath = join(cronDir, CRON_RUNS_FILE_NAME);

	mkdirSync(sessionsDir, { recursive: true });
	mkdirSync(memoryDir, { recursive: true });
	mkdirSync(logsDir, { recursive: true });
	mkdirSync(skillsDir, { recursive: true });
	mkdirSync(inboxDir, { recursive: true });
	mkdirSync(cronDir, { recursive: true });
	mkdirSync(cronJobsDir, { recursive: true });

	if (!existsSync(memoryFilePath)) {
		writeFileSync(memoryFilePath, DEFAULT_MEMORY_FILE_CONTENT, "utf-8");
	}

	return {
		workspaceDir,
		phiDir,
		sessionsDir,
		memoryDir,
		logsDir,
		skillsDir,
		inboxDir,
		cronDir,
		cronJobsDir,
		memoryFilePath,
		cronJobsFilePath,
		cronRunsFilePath,
	};
}
