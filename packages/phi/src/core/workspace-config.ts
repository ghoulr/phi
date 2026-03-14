import { existsSync, readFileSync } from "node:fs";

import { parse } from "yaml";

import workspaceConfigTemplateText from "@phi/templates/workspace-config.template.yaml" with {
	type: "text",
};
import type { CronJobDefinition } from "@phi/cron/types";
import { isRecord } from "@phi/core/type-guards";

export interface PhiWorkspaceChatConfig {
	timezone?: string;
}

export interface PhiWorkspaceCronConfig {
	enabled?: boolean;
	destination?: string;
	jobs?: CronJobDefinition[];
}

export interface PhiWorkspaceSkillEntryConfig {
	env?: Record<string, string>;
}

export interface PhiWorkspaceSkillsConfig {
	entries?: Record<string, PhiWorkspaceSkillEntryConfig>;
}

export interface PhiWorkspaceConfig {
	version?: number;
	chat?: PhiWorkspaceChatConfig;
	cron?: PhiWorkspaceCronConfig;
	skills?: PhiWorkspaceSkillsConfig;
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

function resolveOptionalNonEmptyString(
	value: unknown,
	path: string,
	configFilePath: string
): string | undefined {
	if (value === undefined) {
		return undefined;
	}
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new Error(
			`Invalid workspace config: ${path} must be a non-empty string (${configFilePath})`
		);
	}
	return value.trim();
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
	requireOptionalRecord(rawConfig.skills, "skills", configFilePath);
	return rawConfig as PhiWorkspaceConfig;
}

export function resolveWorkspaceTimezone(
	workspaceConfig: PhiWorkspaceConfig,
	configFilePath: string
): string | undefined {
	return resolveOptionalNonEmptyString(
		workspaceConfig.chat?.timezone,
		"chat.timezone",
		configFilePath
	);
}

export function resolveWorkspaceCronDestination(
	workspaceConfig: PhiWorkspaceConfig,
	configFilePath: string
): string | undefined {
	const cronConfig = workspaceConfig.cron;
	if (!cronConfig || cronConfig.enabled === false) {
		return undefined;
	}
	return resolveOptionalNonEmptyString(
		cronConfig.destination,
		"cron.destination",
		configFilePath
	);
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

export function resolveWorkspaceSkillEnvOverrides(
	workspaceConfig: PhiWorkspaceConfig,
	configFilePath: string
): Record<string, Record<string, string>> {
	const skillsConfig = workspaceConfig.skills;
	if (!skillsConfig) {
		return {};
	}

	const entries = skillsConfig.entries;
	if (entries === undefined) {
		return {};
	}
	if (!isRecord(entries)) {
		throw new Error(
			`Invalid workspace config: skills.entries must be a mapping (${configFilePath})`
		);
	}

	const resolved: Record<string, Record<string, string>> = {};
	for (const [skillName, rawEntry] of Object.entries(entries)) {
		if (!isRecord(rawEntry)) {
			throw new Error(
				`Invalid workspace config: skills.entries.${skillName} must be a mapping (${configFilePath})`
			);
		}
		const rawEnv = rawEntry.env;
		if (rawEnv === undefined) {
			continue;
		}
		if (!isRecord(rawEnv)) {
			throw new Error(
				`Invalid workspace config: skills.entries.${skillName}.env must be a mapping (${configFilePath})`
			);
		}

		const env: Record<string, string> = {};
		for (const [rawEnvKey, rawEnvValue] of Object.entries(rawEnv)) {
			const envKey = rawEnvKey.trim();
			if (!envKey) {
				throw new Error(
					`Invalid workspace config: skills.entries.${skillName}.env contains an empty key (${configFilePath})`
				);
			}
			if (typeof rawEnvValue !== "string") {
				throw new Error(
					`Invalid workspace config: skills.entries.${skillName}.env.${envKey} must be a string (${configFilePath})`
				);
			}
			env[envKey] = rawEnvValue;
		}
		resolved[skillName] = env;
	}
	return resolved;
}
