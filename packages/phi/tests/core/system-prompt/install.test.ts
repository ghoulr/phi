import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "bun:test";

import { installPhiSystemPrompt } from "@phi/core/system-prompt";

function createMemoryFile(content: string): { dir: string; filePath: string } {
	const dir = mkdtempSync(join(tmpdir(), "phi-system-prompt-install-"));
	const filePath = join(dir, "MEMORY.md");
	writeFileSync(filePath, content, "utf-8");
	return { dir, filePath };
}

describe("installPhiSystemPrompt", () => {
	it("reads prompt metadata from session tool maps on rebuild", () => {
		const { dir, filePath } = createMemoryFile("# MEMORY\n");
		const calls: string[] = [];
		const toolPromptSnippets = new Map<string, string>();
		const toolPromptGuidelines = new Map<string, string[]>();
		const session = {
			agent: {
				setSystemPrompt(prompt: string) {
					calls.push(prompt);
				},
			},
			getActiveToolNames() {
				return ["read"];
			},
			_toolPromptSnippets: toolPromptSnippets,
			_toolPromptGuidelines: toolPromptGuidelines,
		} as never;

		try {
			const prompt = installPhiSystemPrompt({
				session,
				assistantName: "Phi",
				workspacePath: "/workspace/alice",
				skills: [],
				memoryFilePath: filePath,
			});

			expect(prompt.includes("- read: Read file contents")).toBe(true);
			expect(calls).toEqual([prompt]);

			toolPromptSnippets.set(
				"websearch",
				"Search the web for relevant pages, summaries, and highlights"
			);
			toolPromptGuidelines.set("websearch", [
				"Use websearch to discover relevant pages before choosing which URL to read in full.",
			]);

			const rebuiltPrompt = (
				session as {
					_rebuildSystemPrompt: (toolNames: string[]) => string;
				}
			)._rebuildSystemPrompt(["read", "websearch"]);

			expect(
				rebuiltPrompt.includes(
					"- websearch: Search the web for relevant pages, summaries, and highlights"
				)
			).toBe(true);
			expect(
				rebuiltPrompt.includes(
					"Use websearch to discover relevant pages before choosing which URL to read in full."
				)
			).toBe(true);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
