import { existsSync, readFileSync, writeFileSync } from "node:fs";

import { parse, stringify } from "yaml";

import type { CronJobDefinition } from "@phi/cron/types";
import { isRecord } from "@phi/core/type-guards";

export interface PhiCronConfig {
	jobs?: CronJobDefinition[];
}

export function createDefaultPhiCronConfigFileContent(): string {
	return "jobs: []\n";
}

export function loadPhiCronConfig(configFilePath: string): PhiCronConfig {
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
			`Invalid cron config format: root must be a mapping (${configFilePath})`
		);
	}
	if (rawConfig.jobs !== undefined && !Array.isArray(rawConfig.jobs)) {
		throw new Error(
			`Invalid cron config: jobs must be a list (${configFilePath})`
		);
	}
	return rawConfig as PhiCronConfig;
}

export function resolveCronJobDefinitions(
	config: PhiCronConfig,
	configFilePath: string
): CronJobDefinition[] {
	const jobs = config.jobs;
	if (jobs === undefined) {
		return [];
	}
	if (!Array.isArray(jobs)) {
		throw new Error(
			`Invalid cron config: jobs must be a list (${configFilePath})`
		);
	}
	return jobs as CronJobDefinition[];
}

export function writePhiCronConfig(
	configFilePath: string,
	config: PhiCronConfig
): void {
	writeFileSync(
		configFilePath,
		stringify({
			jobs: config.jobs ?? [],
		}),
		"utf-8"
	);
}
