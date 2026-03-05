import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "bun:test";

import {
	getChatScopedSkillsDir,
	getPhiGlobalSkillsDir,
	resolveChatScopedSkillPaths,
	resolvePhiGlobalSkillPaths,
	resolvePhiSkillPaths,
} from "@phi/core/skills";

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
});
