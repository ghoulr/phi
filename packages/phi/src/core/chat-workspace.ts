import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

import {
	createDefaultPhiWorkspaceConfigFileContent,
	renderPhiWorkspaceConfigTemplate,
} from "@phi/core/workspace-config";
import { createDefaultPhiCronConfigFileContent } from "@phi/cron/config";

const DOT_PHI_DIR = ".phi";
const SESSIONS_DIR = "sessions";
const MEMORY_DIR = "memory";
const SKILLS_DIR = "skills";
const CRON_DIR = "cron";
const CRON_JOBS_DIR = "jobs";
const CRON_CONFIG_FILE_NAME = "cron.yaml";
const INBOX_DIR = "inbox";
const CONFIG_FILE_NAME = "config.yaml";
const CONFIG_TEMPLATE_FILE_NAME = "config.template.yaml";
const MEMORY_FILE_NAME = "MEMORY.md";
const DEFAULT_MEMORY_FILE_CONTENT = "# MEMORY\n";

export interface ChatWorkspaceLayout {
	workspaceDir: string;
	phiDir: string;
	configFilePath: string;
	configTemplateFilePath: string;
	sessionsDir: string;
	memoryDir: string;
	skillsDir: string;
	inboxDir: string;
	cronDir: string;
	cronJobsDir: string;
	cronConfigFilePath: string;
	memoryFilePath: string;
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

export function getChatInboxDirectoryPath(workspaceDir: string): string {
	return join(workspaceDir, DOT_PHI_DIR, INBOX_DIR);
}

export function ensureChatWorkspaceLayout(
	workspaceDir: string
): ChatWorkspaceLayout {
	mkdirSync(workspaceDir, { recursive: true });

	const phiDir = join(workspaceDir, DOT_PHI_DIR);
	const configFilePath = join(phiDir, CONFIG_FILE_NAME);
	const configTemplateFilePath = join(phiDir, CONFIG_TEMPLATE_FILE_NAME);
	const sessionsDir = join(phiDir, SESSIONS_DIR);
	const memoryDir = join(phiDir, MEMORY_DIR);
	const skillsDir = join(phiDir, SKILLS_DIR);
	const inboxDir = join(phiDir, INBOX_DIR);
	const cronDir = join(phiDir, CRON_DIR);
	const cronJobsDir = join(cronDir, CRON_JOBS_DIR);
	const cronConfigFilePath = join(cronDir, CRON_CONFIG_FILE_NAME);
	const memoryFilePath = join(memoryDir, MEMORY_FILE_NAME);

	mkdirSync(sessionsDir, { recursive: true });
	mkdirSync(memoryDir, { recursive: true });
	mkdirSync(skillsDir, { recursive: true });
	mkdirSync(inboxDir, { recursive: true });
	mkdirSync(cronDir, { recursive: true });
	mkdirSync(cronJobsDir, { recursive: true });

	if (!existsSync(configFilePath)) {
		writeFileSync(
			configFilePath,
			createDefaultPhiWorkspaceConfigFileContent(),
			"utf-8"
		);
	}
	if (!existsSync(configTemplateFilePath)) {
		writeFileSync(
			configTemplateFilePath,
			renderPhiWorkspaceConfigTemplate(),
			"utf-8"
		);
	}
	if (!existsSync(cronConfigFilePath)) {
		writeFileSync(
			cronConfigFilePath,
			createDefaultPhiCronConfigFileContent(),
			"utf-8"
		);
	}
	if (!existsSync(memoryFilePath)) {
		writeFileSync(memoryFilePath, DEFAULT_MEMORY_FILE_CONTENT, "utf-8");
	}

	return {
		workspaceDir,
		phiDir,
		configFilePath,
		configTemplateFilePath,
		sessionsDir,
		memoryDir,
		skillsDir,
		inboxDir,
		cronDir,
		cronJobsDir,
		cronConfigFilePath,
		memoryFilePath,
	};
}
