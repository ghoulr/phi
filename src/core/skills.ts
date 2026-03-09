import { existsSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, sep } from "node:path";

import {
	formatSkillsForPrompt,
	type ResourceDiagnostic,
	type Skill,
} from "@mariozechner/pi-coding-agent";

import { getPhiPiAgentDir } from "@phi/core/paths";

const DEFAULT_MAX_SKILL_FILE_BYTES = 128 * 1024;
const DEFAULT_MAX_SKILLS_PROMPT_CHARS = 24_000;

function resolveSkillDirectoryIfExists(path: string): string[] {
	if (!existsSync(path)) {
		return [];
	}
	if (!statSync(path).isDirectory()) {
		return [];
	}
	return [path];
}

function tryRealpath(path: string): string | undefined {
	try {
		return realpathSync(path);
	} catch {
		return undefined;
	}
}

function isPathInside(root: string, target: string): boolean {
	return target === root || target.startsWith(`${root}${sep}`);
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

export function createPhiSkillsOverride(params: {
	roots: string[];
	maxSkillFileBytes?: number;
}): (base: { skills: Skill[]; diagnostics: ResourceDiagnostic[] }) => {
	skills: Skill[];
	diagnostics: ResourceDiagnostic[];
} {
	const maxSkillFileBytes =
		params.maxSkillFileBytes ?? DEFAULT_MAX_SKILL_FILE_BYTES;
	const allowedRoots = params.roots
		.map((root) => tryRealpath(root))
		.filter((root): root is string => root !== undefined);

	return (base) => {
		const diagnostics = [...base.diagnostics];
		const skills: Skill[] = [];

		for (const skill of base.skills) {
			const fileRealPath = tryRealpath(skill.filePath);
			const baseRealPath = tryRealpath(skill.baseDir);
			if (!fileRealPath || !baseRealPath) {
				diagnostics.push({
					type: "warning",
					message: "Skipping skill with unreadable path.",
					path: skill.filePath,
				});
				continue;
			}

			const insideAllowedRoot = allowedRoots.some(
				(root) =>
					isPathInside(root, fileRealPath) &&
					isPathInside(root, baseRealPath)
			);
			if (!insideAllowedRoot) {
				diagnostics.push({
					type: "warning",
					message:
						"Skipping skill that resolves outside the configured roots.",
					path: skill.filePath,
				});
				continue;
			}

			const size = statSync(fileRealPath).size;
			if (size > maxSkillFileBytes) {
				diagnostics.push({
					type: "warning",
					message: `Skipping oversized skill file (${String(size)} bytes).`,
					path: skill.filePath,
				});
				continue;
			}

			skills.push(skill);
		}

		return { skills, diagnostics };
	};
}

export function limitSkillsForPrompt(
	skills: Skill[],
	maxChars: number = DEFAULT_MAX_SKILLS_PROMPT_CHARS
): Skill[] {
	if (maxChars <= 0) {
		return [];
	}

	const visibleSkills: Skill[] = [];
	for (const skill of skills) {
		const candidate = [...visibleSkills, skill];
		const prompt = formatSkillsForPrompt(candidate).trim();
		if (prompt.length > maxChars) {
			break;
		}
		visibleSkills.push(skill);
	}
	return visibleSkills;
}
