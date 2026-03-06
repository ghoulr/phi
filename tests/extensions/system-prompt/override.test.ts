import { describe, expect, it } from "bun:test";

import { applyPhiSystemPromptOverride } from "@phi/extensions/system-prompt";

describe("applyPhiSystemPromptOverride", () => {
	it("pins the rebuilt prompt to phi prompt text", () => {
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
});
