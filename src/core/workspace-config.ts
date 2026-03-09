import { existsSync, readFileSync } from "node:fs";

import { parse } from "yaml";

import workspaceConfigTemplateText from "@phi/templates/workspace-config.template.yaml" with {
	type: "text",
};
import type { CronJobDefinition } from "@phi/cron/types";

export interface PhiWorkspaceChatConfig {
	timezone?: string;
}

export interface PhiWorkspaceCronConfig {
	enabled?: boolean;
	jobs?: CronJobDefinition[];
}

export interface PhiWorkspaceConfig {
	version?: number;
	chat?: PhiWorkspaceChatConfig;
	cron?: PhiWorkspaceCronConfig;
}

export const PHI_WORKSPACE_CONFIG_VERSION = 1;

const WORKSPACE_CONFIG_VERSION_PLACEHOLDER = "__PHI_WORKSPACE_CONFIG_VERSION__";

export function createDefaultPhiWorkspaceConfigFileContent(): string {
	return `version: ${String(PHI_WORKSPACE_CONFIG_VERSION)}\n`;
}

export function renderPhiWorkspaceConfigTemplate(): string {
	return workspaceConfigTemplateText.replaceAll(
		WORKSPACE_CONFIG_VERSION_PLACEHOLDER,
		String(PHI_WORKSPACE_CONFIG_VERSION)
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireOptionalRecord(
	value: unknown,
	path: string,
	configFilePath: string
): Record<string, unknown> | undefined {
	if (value === undefined) {
		return undefined;
	}
	if (!isRecord(value)) {
		throw new Error(
			`Invalid workspace config: ${path} must be a mapping (${configFilePath})`
		);
	}
	return value;
}

export function loadPhiWorkspaceConfig(
	configFilePath: string
): PhiWorkspaceConfig {
	if (!existsSync(configFilePath)) {
		return {};
	}

	const fileContent = readFileSync(configFilePath, "utf-8");
	const rawConfig = parse(fileContent);
	if (rawConfig === undefined || rawConfig === null) {
		return {};
	}
	if (!isRecord(rawConfig)) {
		throw new Error(
			`Invalid workspace config format: root must be a mapping (${configFilePath})`
		);
	}

	requireOptionalRecord(rawConfig.chat, "chat", configFilePath);
	requireOptionalRecord(rawConfig.cron, "cron", configFilePath);
	return rawConfig as PhiWorkspaceConfig;
}

export function resolveWorkspaceTimezone(
	workspaceConfig: PhiWorkspaceConfig,
	configFilePath: string
): string | undefined {
	const timezone = workspaceConfig.chat?.timezone;
	if (timezone === undefined) {
		return undefined;
	}
	if (typeof timezone !== "string" || timezone.trim().length === 0) {
		throw new Error(
			`Invalid workspace config: chat.timezone must be a non-empty string (${configFilePath})`
		);
	}
	return timezone.trim();
}

export function resolveWorkspaceCronJobDefinitions(
	workspaceConfig: PhiWorkspaceConfig,
	configFilePath: string
): CronJobDefinition[] {
	const cronConfig = workspaceConfig.cron;
	if (!cronConfig || cronConfig.enabled === false) {
		return [];
	}

	const jobs = cronConfig.jobs;
	if (jobs === undefined) {
		return [];
	}
	if (!Array.isArray(jobs)) {
		throw new Error(
			`Invalid workspace config: cron.jobs must be a list (${configFilePath})`
		);
	}
	return jobs as CronJobDefinition[];
}
