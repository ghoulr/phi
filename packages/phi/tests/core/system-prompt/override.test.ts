import { describe, expect, it } from "bun:test";

import { applyPhiSystemPromptOverride } from "@phi/core/system-prompt";

describe("applyPhiSystemPromptOverride", () => {
	it("pins string prompts to phi prompt text", () => {
		const calls: string[] = [];
		const session = {
			agent: {
				setSystemPrompt(prompt: string) {
					calls.push(prompt);
				},
			},
			_baseSystemPrompt: "old",
			_rebuildSystemPrompt(toolNames: string[]) {
				return toolNames.join(",");
			},
		} as never;

		applyPhiSystemPromptOverride(session, "phi prompt");

		expect(calls).toEqual(["phi prompt"]);
		expect(
			(session as { _baseSystemPrompt?: string })._baseSystemPrompt
		).toBe("phi prompt");
		expect(
			(
				session as {
					_rebuildSystemPrompt: (toolNames: string[]) => string;
				}
			)._rebuildSystemPrompt(["read"])
		).toBe("phi prompt");
	});

	it("rebuilds prompts dynamically from the active tool set", () => {
		const calls: string[] = [];
		const session = {
			agent: {
				setSystemPrompt(prompt: string) {
					calls.push(prompt);
				},
			},
			getActiveToolNames() {
				return ["read", "send"];
			},
		} as never;

		applyPhiSystemPromptOverride(
			session,
			(toolNames) => `tools:${toolNames.join(",")}`
		);

		expect(calls).toEqual(["tools:read,send"]);
		expect(
			(session as { _baseSystemPrompt?: string })._baseSystemPrompt
		).toBe("tools:read,send");
		expect(
			(
				session as {
					_rebuildSystemPrompt: (toolNames: string[]) => string;
				}
			)._rebuildSystemPrompt(["read", "websearch"])
		).toBe("tools:read,websearch");
		expect(
			(session as { _baseSystemPrompt?: string })._baseSystemPrompt
		).toBe("tools:read,websearch");
	});
});
