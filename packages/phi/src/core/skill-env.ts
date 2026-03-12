import type { Skill } from "@mariozechner/pi-coding-agent";

import {
	resolveWorkspaceSkillEnvOverrides,
	type PhiWorkspaceConfig,
} from "@phi/core/workspace-config";

type ActiveEnvOverride = {
	baseline: string | undefined;
	value: string;
	count: number;
};

const activeEnvOverrides = new Map<string, ActiveEnvOverride>();

export function resolveLoadedSkillEnvOverrides(params: {
	skills: Skill[];
	workspaceConfig: PhiWorkspaceConfig;
	configFilePath: string;
	processEnv?: Record<string, string | undefined>;
}): Record<string, string> {
	const processEnv = params.processEnv ?? process.env;
	const configuredEnv = resolveWorkspaceSkillEnvOverrides(
		params.workspaceConfig,
		params.configFilePath
	);
	const resolved: Record<string, string> = {};

	for (const skill of params.skills) {
		const envEntry = configuredEnv[skill.name];
		if (!envEntry) {
			continue;
		}

		for (const [envKey, envValue] of Object.entries(envEntry)) {
			if (
				processEnv[envKey] !== undefined &&
				!activeEnvOverrides.has(envKey)
			) {
				continue;
			}
			const existingValue = resolved[envKey];
			if (existingValue !== undefined && existingValue !== envValue) {
				throw new Error(
					`Conflicting skill env override for ${envKey}: ${skill.name}`
				);
			}
			resolved[envKey] = envValue;
		}
	}

	return resolved;
}

function acquireEnvOverride(envKey: string, envValue: string): void {
	const active = activeEnvOverrides.get(envKey);
	if (active) {
		if (active.value !== envValue) {
			throw new Error(
				`Conflicting active skill env override for ${envKey}`
			);
		}
		active.count += 1;
		process.env[envKey] = active.value;
		return;
	}

	activeEnvOverrides.set(envKey, {
		baseline: process.env[envKey],
		value: envValue,
		count: 1,
	});
	process.env[envKey] = envValue;
}

function releaseEnvOverride(envKey: string): void {
	const active = activeEnvOverrides.get(envKey);
	if (!active) {
		return;
	}
	active.count -= 1;
	if (active.count > 0) {
		process.env[envKey] = active.value;
		return;
	}
	activeEnvOverrides.delete(envKey);
	if (active.baseline === undefined) {
		delete process.env[envKey];
		return;
	}
	process.env[envKey] = active.baseline;
}

export function applySkillEnvOverrides(
	overrides: Record<string, string>
): () => void {
	const appliedKeys: string[] = [];
	try {
		for (const [envKey, envValue] of Object.entries(overrides)) {
			acquireEnvOverride(envKey, envValue);
			appliedKeys.push(envKey);
		}
	} catch (error) {
		for (const envKey of appliedKeys.reverse()) {
			releaseEnvOverride(envKey);
		}
		throw error;
	}

	return () => {
		for (const envKey of appliedKeys.reverse()) {
			releaseEnvOverride(envKey);
		}
	};
}
