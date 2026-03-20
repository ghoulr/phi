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
				tools: [
					{ name: "read" },
					{ name: "edit" },
					{ name: "write" },
					{ name: "bash" },
				],
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
			const guidelinesIndex = prompt.indexOf("## Guidelines");
			const messageFormatIndex = prompt.indexOf("## Message Format");

			expect(workspaceIndex).toBeGreaterThanOrEqual(0);
			expect(skillsIndex).toBeGreaterThan(workspaceIndex);
			expect(memoryIndex).toBeGreaterThan(skillsIndex);
			expect(toolsIndex).toBeGreaterThan(memoryIndex);
			expect(guidelinesIndex).toBeGreaterThan(toolsIndex);
			expect(messageFormatIndex).toBeGreaterThan(guidelinesIndex);
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
				tools: [{ name: "read" }],
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
				tools: [{ name: "read" }],
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
				tools: [{ name: "read" }],
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
				tools: [
					{ name: "read" },
					{
						name: "reload",
						promptSnippet:
							"Validate workspace changes and schedule them to apply after the current reply ends",
					},
				],
			});

			expect(
				prompt.includes(
					"Phi config file is `.phi/config.yaml`, read `.phi/config.template.yaml`"
				)
			).toBe(true);
			expect(prompt.includes("- timezone")).toBe(true);
			expect(prompt.includes("- skills env")).toBe(true);
			expect(prompt.includes("- cron")).toBe(false);
			expect(prompt.includes(".phi/cron/cron.yaml")).toBe(false);
			expect(prompt.includes(".phi/cron/jobs/")).toBe(false);
			expect(prompt.includes("docs/concepts")).toBe(false);
			expect(
				prompt.includes(
					"After workspace config changes, call `reload` to validate them and schedule apply after your current reply ends."
				)
			).toBe(true);
			expect(
				prompt.includes(
					"- reload: Validate workspace changes and schedule them to apply after the current reply ends"
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
				tools: [{ name: "read" }],
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

	it("includes cron tool snippets and guidelines when provided", () => {
		const { dir, filePath } = createMemoryFile("# MEMORY\n");

		try {
			const prompt = buildPhiSystemPrompt({
				assistantName: "Phi",
				workspacePath: "/workspace/alice",
				skills: [],
				memoryFilePath: filePath,
				tools: [
					{
						name: "createCron",
						promptSnippet: "Create a cron job",
						promptGuidelines: [
							"prompt in cron should describe what to do when the job fires, NOT what user asks",
						],
					},
					{
						name: "listCron",
						promptSnippet: "List existing cron jobs",
					},
					{
						name: "fireCron",
						promptSnippet: "Fire a cron job now",
					},
				],
			});

			expect(prompt.includes("- createCron: Create a cron job")).toBe(
				true
			);
			expect(prompt.includes("- listCron: List existing cron jobs")).toBe(
				true
			);
			expect(prompt.includes("- fireCron: Fire a cron job now")).toBe(
				true
			);
			expect(
				prompt.includes(
					"prompt in cron should describe what to do when the job fires, NOT what user asks"
				)
			).toBe(true);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("includes custom tool snippets and guidelines when provided", () => {
		const { dir, filePath } = createMemoryFile("# MEMORY\n");

		try {
			const prompt = buildPhiSystemPrompt({
				assistantName: "Phi",
				workspacePath: "/workspace/alice",
				skills: [],
				memoryFilePath: filePath,
				tools: [
					{
						name: "websearch",
						promptSnippet:
							"Search the web for relevant pages, summaries, and highlights",
						promptGuidelines: [
							"Use websearch to discover relevant pages before choosing which URL to read in full.",
						],
					},
					{
						name: "webfetch",
						promptSnippet:
							"Fetch the content of a specific URL when you already know where to read",
					},
				],
			});

			expect(
				prompt.includes(
					"- websearch: Search the web for relevant pages, summaries, and highlights"
				)
			).toBe(true);
			expect(
				prompt.includes(
					"- webfetch: Fetch the content of a specific URL when you already know where to read"
				)
			).toBe(true);
			expect(
				prompt.includes(
					"Use websearch to discover relevant pages before choosing which URL to read in full."
				)
			).toBe(true);
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
				tools: [
					{ name: "read" },
					{
						name: "send",
						promptSnippet:
							"Send a user-visible message immediately or stage one deferred message for agent run end",
						promptGuidelines: [
							"Use send for attachments, mentions, or explicit user-visible delivery.",
							"Use send(instant: true) to send a separate message immediately.",
							"Without instant: true, send stages one deferred message for agent run end.",
						],
					},
				],
			});

			expect(
				prompt.includes(
					"- send: Send a user-visible message immediately or stage one deferred message for agent run end"
				)
			).toBe(true);
			expect(prompt.includes("## Guidelines")).toBe(true);
			expect(prompt.includes("Tool guidance:")).toBe(false);
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

	it("prefers explicit tool metadata over builtin fallback snippets", () => {
		const { dir, filePath } = createMemoryFile("# MEMORY\n");

		try {
			const prompt = buildPhiSystemPrompt({
				assistantName: "Phi",
				workspacePath: "/workspace/alice",
				skills: [],
				memoryFilePath: filePath,
				tools: [
					{
						name: "read",
						promptSnippet:
							"Inspect files through a custom read wrapper",
						promptGuidelines: [
							"Use the custom read wrapper when you need audit logs.",
						],
					},
				],
			});

			expect(
				prompt.includes(
					"- read: Inspect files through a custom read wrapper"
				)
			).toBe(true);
			expect(prompt.includes("- read: Read file contents")).toBe(false);
			expect(
				prompt.includes(
					"Use the custom read wrapper when you need audit logs."
				)
			).toBe(true);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
