import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "bun:test";

import { buildPhiSystemPrompt } from "@phi/core/system-prompt";

function createMemoryFile(content: string): { dir: string; filePath: string } {
	const dir = mkdtempSync(join(tmpdir(), "phi-system-prompt-"));
	const filePath = join(dir, "MEMORY.md");
	writeFileSync(filePath, content, "utf-8");
	return { dir, filePath };
}

describe("buildPhiSystemPrompt", () => {
	it("renders sections in documented order", () => {
		const { dir, filePath } = createMemoryFile("# MEMORY\nremember this\n");

		try {
			const prompt = buildPhiSystemPrompt({
				assistantName: "Phi",
				workspacePath: "/workspace/alice",
				skills: [
					{
						name: "test-skill",
						description: "does things",
						filePath:
							"/workspace/alice/.phi/skills/test-skill/SKILL.md",
						baseDir: "/workspace/alice/.phi/skills/test-skill",
						source: "project",
						disableModelInvocation: false,
					},
				],
				memoryFilePath: filePath,
				toolNames: ["read", "edit", "write", "bash"],
			});

			expect(
				prompt.startsWith(
					"You are Phi, a personal assistant. Be concise."
				)
			).toBe(true);

			const workspaceIndex = prompt.indexOf("## Workspace");
			const skillsIndex = prompt.indexOf("## Skills");
			const memoryIndex = prompt.indexOf("## Memory");
			const toolsIndex = prompt.indexOf("## Tools");
			const messageFormatIndex = prompt.indexOf("## Message Format");

			expect(workspaceIndex).toBeGreaterThanOrEqual(0);
			expect(skillsIndex).toBeGreaterThan(workspaceIndex);
			expect(memoryIndex).toBeGreaterThan(skillsIndex);
			expect(toolsIndex).toBeGreaterThan(memoryIndex);
			expect(messageFormatIndex).toBeGreaterThan(toolsIndex);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("keeps memory rules even when MEMORY.md content is empty", () => {
		const { dir, filePath } = createMemoryFile("# MEMORY\n");

		try {
			const prompt = buildPhiSystemPrompt({
				assistantName: "Phi",
				workspacePath: "/workspace/alice",
				skills: [],
				memoryFilePath: filePath,
				toolNames: ["read"],
			});

			expect(prompt.includes("## Skills")).toBe(false);
			expect(prompt.includes("## Message Format")).toBe(true);
			expect(prompt.includes("## Memory")).toBe(true);
			expect(prompt.includes("remember this")).toBe(true);
			expect(prompt.includes("keep it small and concise")).toBe(true);
			expect(prompt.includes("grep and read them on demand")).toBe(true);
			expect(prompt.includes("Current MEMORY.md")).toBe(false);
			expect(prompt.includes("## Workspace")).toBe(true);
			expect(prompt.includes("## Tools")).toBe(true);
			expect(prompt.includes("## Events & Replies")).toBe(false);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("includes current MEMORY.md content when present", () => {
		const { dir, filePath } = createMemoryFile("# MEMORY\nremember this\n");

		try {
			const prompt = buildPhiSystemPrompt({
				assistantName: "Phi",
				workspacePath: "/workspace/alice",
				skills: [],
				memoryFilePath: filePath,
				toolNames: ["read"],
			});

			expect(prompt.includes("Current MEMORY.md")).toBe(true);
			expect(prompt.includes("remember this")).toBe(true);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("uses absolute memory path text when memory is outside workspace", () => {
		const { dir, filePath } = createMemoryFile("# MEMORY\n");

		try {
			const prompt = buildPhiSystemPrompt({
				assistantName: "Phi",
				workspacePath: "/workspace/alice",
				skills: [],
				memoryFilePath: filePath,
				toolNames: ["read"],
			});

			expect(prompt.includes(filePath)).toBe(true);
			expect(prompt.includes(join(dir, "YYYY-MM-DD.md"))).toBe(true);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("includes workspace config guidance by default", () => {
		const { dir, filePath } = createMemoryFile("# MEMORY\n");

		try {
			const prompt = buildPhiSystemPrompt({
				assistantName: "Phi",
				workspacePath: "/workspace/alice",
				skills: [],
				memoryFilePath: filePath,
				toolNames: ["read", "reload"],
			});

			expect(
				prompt.includes(
					"Phi config file is `.phi/config.yaml`, read `.phi/config.template.yaml`"
				)
			).toBe(true);
			expect(prompt.includes("- timezone")).toBe(true);
			expect(prompt.includes("- cron")).toBe(true);
			expect(prompt.includes("- skills env")).toBe(true);
			expect(
				prompt.includes(
					"For cron prompt files under `<workspace>/.phi/cron/jobs/`, write what should happen when the job fires instead of user direct instructions."
				)
			).toBe(true);
			expect(
				prompt.includes(
					"After workspace config changes, call `reload`."
				)
			).toBe(true);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("can omit workspace config guidance", () => {
		const { dir, filePath } = createMemoryFile("# MEMORY\n");

		try {
			const prompt = buildPhiSystemPrompt({
				assistantName: "Phi",
				workspacePath: "/workspace/alice",
				skills: [],
				memoryFilePath: filePath,
				toolNames: ["read"],
				includeWorkspaceConfigGuidance: false,
			});

			expect(prompt.includes("## Workspace")).toBe(true);
			expect(prompt.includes("Workspace root: /workspace/alice")).toBe(
				true
			);
			expect(prompt.includes(".phi/config.yaml")).toBe(false);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("omits non built-in extension tools from tools section", () => {
		const { dir, filePath } = createMemoryFile("# MEMORY\n");

		try {
			const prompt = buildPhiSystemPrompt({
				assistantName: "Phi",
				workspacePath: "/workspace/alice",
				skills: [],
				memoryFilePath: filePath,
				toolNames: ["websearch", "webfetch"],
			});

			expect(prompt.includes("- websearch:")).toBe(false);
			expect(prompt.includes("- webfetch:")).toBe(false);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("includes send tool guidance when send is active", () => {
		const { dir, filePath } = createMemoryFile("# MEMORY\n");

		try {
			const prompt = buildPhiSystemPrompt({
				assistantName: "Phi",
				workspacePath: "/workspace/alice",
				skills: [],
				memoryFilePath: filePath,
				toolNames: ["read", "send"],
			});

			expect(
				prompt.includes(
					"- send: Send a user-visible message immediately or stage it for your final output"
				)
			).toBe(true);
			expect(prompt.includes("not user-authored input")).toBe(true);
			expect(
				prompt.includes(
					"Input metadata: user messages may end with `<system-reminder>...</system-reminder>`; treat it as internal metadata, not user-authored input"
				)
			).toBe(true);
			expect(
				prompt.includes(
					"Input metadata: the user message body is still the real input; never mention `<system-reminder>` to the user"
				)
			).toBe(true);
			expect(
				prompt.includes(
					"Visible output: use the final assistant reply for normal user-visible output"
				)
			).toBe(true);
			expect(
				prompt.includes(
					"Visible output: use `send(instant: true)` for immediate delivery; use `send()` to stage one deferred delivery at agent run end"
				)
			).toBe(true);
			expect(
				prompt.includes(
					"Control token: `NO_REPLY` is a control token, not message text; when you have nothing else to say, your ENTIRE final assistant reply must be exact `NO_REPLY`"
				)
			).toBe(true);
			expect(
				prompt.includes(
					"Control token: never append `NO_REPLY` to a real reply and never pass `NO_REPLY` to `send`"
				)
			).toBe(true);
			expect(prompt.includes("## Events & Replies")).toBe(false);
			expect(
				prompt.includes(
					"If send already delivered everything the user should see immediately, end with exact NO_REPLY."
				)
			).toBe(false);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
