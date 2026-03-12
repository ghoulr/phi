import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";

import { getPhiPiAgentDir } from "@phi/core/paths";

export function ensurePhiPiAgentDir(userHomeDir: string = homedir()): string {
	const agentDir = getPhiPiAgentDir(userHomeDir);
	mkdirSync(agentDir, { recursive: true });
	return agentDir;
}

export function resolveExistingPhiPiAgentDir(
	userHomeDir: string = homedir()
): string {
	const agentDir = getPhiPiAgentDir(userHomeDir);
	if (!existsSync(agentDir)) {
		throw new Error(`Missing shared pi workspace directory: ${agentDir}`);
	}
	return agentDir;
}
