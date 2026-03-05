import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { getPhiPiAgentDir } from "@phi/core/paths";

function resolveSkillDirectoryIfExists(path: string): string[] {
	if (!existsSync(path)) {
		return [];
	}
	if (!statSync(path).isDirectory()) {
		return [];
	}
	return [path];
}

export function getPhiGlobalSkillsDir(userHomeDir: string = homedir()): string {
	return join(getPhiPiAgentDir(userHomeDir), "skills");
}

export function getChatScopedSkillsDir(workspaceDir: string): string {
	return join(workspaceDir, ".phi", "skills");
}

export function resolvePhiGlobalSkillPaths(
	userHomeDir: string = homedir()
): string[] {
	return resolveSkillDirectoryIfExists(getPhiGlobalSkillsDir(userHomeDir));
}

export function resolveChatScopedSkillPaths(workspaceDir: string): string[] {
	return resolveSkillDirectoryIfExists(getChatScopedSkillsDir(workspaceDir));
}

export function resolvePhiSkillPaths(params: {
	workspaceDir: string;
	userHomeDir?: string;
}): string[] {
	const userHomeDir = params.userHomeDir ?? homedir();
	return [
		...resolveChatScopedSkillPaths(params.workspaceDir),
		...resolvePhiGlobalSkillPaths(userHomeDir),
	];
}
