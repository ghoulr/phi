import { existsSync } from "node:fs";
import { homedir } from "node:os";

import { getPhiPiAgentDir } from "@phi/core/paths";

export function resolveExistingPhiPiAgentDir(
	userHomeDir: string = homedir()
): string {
	const agentDir = getPhiPiAgentDir(userHomeDir);
	if (!existsSync(agentDir)) {
		throw new Error(`Missing shared pi workspace directory: ${agentDir}`);
	}
	return agentDir;
}
