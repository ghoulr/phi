import {
	mkdirSync,
	mkdtempSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "bun:test";

import type { ResourceDiagnostic, Skill } from "@mariozechner/pi-coding-agent";

import {
	createPhiSkillsOverride,
	getChatScopedSkillsDir,
	getPhiGlobalSkillsDir,
	limitSkillsForPrompt,
	resolveChatScopedSkillPaths,
	resolvePhiGlobalSkillPaths,
	resolvePhiSkillPaths,
} from "@phi/core/skills";

function createSkill(path: string): Skill {
	return {
		name: path.split("/").at(-2) ?? "skill",
		description: "test skill",
		filePath: path,
		baseDir: path.slice(0, path.lastIndexOf("/")),
		source: "path",
		disableModelInvocation: false,
	};
}

describe("phi skills", () => {
	it("resolves global skills directory under ~/.phi/pi/skills", () => {
		expect(getPhiGlobalSkillsDir("/tmp/custom-home")).toBe(
			"/tmp/custom-home/.phi/pi/skills"
		);
	});

	it("resolves chat-scoped skills directory under {workspace}/.phi/skills", () => {
		expect(getChatScopedSkillsDir("/tmp/workspace/alice")).toBe(
			"/tmp/workspace/alice/.phi/skills"
		);
	});

	it("returns empty list when global skills directory does not exist", () => {
		const root = mkdtempSync(join(tmpdir(), "phi-skills-"));

		try {
			expect(resolvePhiGlobalSkillPaths(root)).toEqual([]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("returns empty list when global skills path exists as file", () => {
		const root = mkdtempSync(join(tmpdir(), "phi-skills-"));
		const phiDir = join(root, ".phi", "pi");
		const skillsPath = join(phiDir, "skills");

		try {
			mkdirSync(phiDir, { recursive: true });
			writeFileSync(skillsPath, "not-a-directory", "utf-8");

			expect(resolvePhiGlobalSkillPaths(root)).toEqual([]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("returns global skills directory when it exists", () => {
		const root = mkdtempSync(join(tmpdir(), "phi-skills-"));
		const skillsDir = join(root, ".phi", "pi", "skills");

		try {
			mkdirSync(skillsDir, { recursive: true });
			expect(resolvePhiGlobalSkillPaths(root)).toEqual([skillsDir]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("returns empty list when chat-scoped skills directory does not exist", () => {
		const workspaceDir = mkdtempSync(
			join(tmpdir(), "phi-skills-workspace-")
		);

		try {
			expect(resolveChatScopedSkillPaths(workspaceDir)).toEqual([]);
		} finally {
			rmSync(workspaceDir, { recursive: true, force: true });
		}
	});

	it("returns empty list when chat-scoped skills path exists as file", () => {
		const workspaceDir = mkdtempSync(
			join(tmpdir(), "phi-skills-workspace-")
		);
		const phiDir = join(workspaceDir, ".phi");
		const skillsPath = join(phiDir, "skills");

		try {
			mkdirSync(phiDir, { recursive: true });
			writeFileSync(skillsPath, "not-a-directory", "utf-8");

			expect(resolveChatScopedSkillPaths(workspaceDir)).toEqual([]);
		} finally {
			rmSync(workspaceDir, { recursive: true, force: true });
		}
	});

	it("returns chat-scoped skills directory when it exists", () => {
		const workspaceDir = mkdtempSync(
			join(tmpdir(), "phi-skills-workspace-")
		);
		const skillsDir = join(workspaceDir, ".phi", "skills");

		try {
			mkdirSync(skillsDir, { recursive: true });
			expect(resolveChatScopedSkillPaths(workspaceDir)).toEqual([
				skillsDir,
			]);
		} finally {
			rmSync(workspaceDir, { recursive: true, force: true });
		}
	});

	it("returns chat-scoped then global skill paths when both exist", () => {
		const root = mkdtempSync(join(tmpdir(), "phi-skills-"));
		const userHomeDir = join(root, "home");
		const workspaceDir = join(root, "workspace");
		const globalSkillsDir = join(userHomeDir, ".phi", "pi", "skills");
		const chatSkillsDir = join(workspaceDir, ".phi", "skills");

		try {
			mkdirSync(globalSkillsDir, { recursive: true });
			mkdirSync(chatSkillsDir, { recursive: true });

			expect(
				resolvePhiSkillPaths({
					workspaceDir,
					userHomeDir,
				})
			).toEqual([chatSkillsDir, globalSkillsDir]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("skips skills that resolve outside the configured roots", () => {
		const root = mkdtempSync(join(tmpdir(), "phi-skills-"));
		const allowedRoot = join(root, "allowed");
		const outsideRoot = join(root, "outside");
		const linkedRoot = join(root, "linked");
		const outsideSkillDir = join(outsideRoot, "escape-skill");
		const outsideSkillFilePath = join(outsideSkillDir, "SKILL.md");

		try {
			mkdirSync(outsideSkillDir, { recursive: true });
			mkdirSync(allowedRoot, { recursive: true });
			writeFileSync(outsideSkillFilePath, "# skill\n", "utf-8");
			symlinkSync(outsideSkillDir, linkedRoot, "dir");

			const override = createPhiSkillsOverride({ roots: [allowedRoot] });
			const result = override({
				skills: [createSkill(join(linkedRoot, "SKILL.md"))],
				diagnostics: [] as ResourceDiagnostic[],
			});

			expect(result.skills).toEqual([]);
			expect(
				result.diagnostics.some((diagnostic) =>
					diagnostic.message.includes("outside the configured roots")
				)
			).toBe(true);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("skips oversized skills but keeps them available for explicit review via diagnostics", () => {
		const root = mkdtempSync(join(tmpdir(), "phi-skills-"));
		const skillsRoot = join(root, "skills");
		const skillDir = join(skillsRoot, "huge-skill");
		const skillFilePath = join(skillDir, "SKILL.md");

		try {
			mkdirSync(skillDir, { recursive: true });
			writeFileSync(skillFilePath, "x".repeat(256), "utf-8");

			const override = createPhiSkillsOverride({
				roots: [skillsRoot],
				maxSkillFileBytes: 32,
			});
			const result = override({
				skills: [createSkill(skillFilePath)],
				diagnostics: [] as ResourceDiagnostic[],
			});

			expect(result.skills).toEqual([]);
			expect(
				result.diagnostics.some((diagnostic) =>
					diagnostic.message.includes("oversized skill file")
				)
			).toBe(true);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("limits prompt-visible skills without removing later skills from the loader", () => {
		const visible = limitSkillsForPrompt(
			[
				{
					name: "alpha",
					description: "a".repeat(400),
					filePath: "/tmp/alpha/SKILL.md",
					baseDir: "/tmp/alpha",
					source: "path",
					disableModelInvocation: false,
				},
				{
					name: "beta",
					description: "b".repeat(400),
					filePath: "/tmp/beta/SKILL.md",
					baseDir: "/tmp/beta",
					source: "path",
					disableModelInvocation: false,
				},
			],
			900
		);

		expect(visible.map((skill) => skill.name)).toEqual(["alpha"]);
	});
});
