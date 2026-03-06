import { describe, expect, it } from "bun:test";

import { applyPhiSystemPromptOverride } from "@phi/core/system-prompt-override";
import { type DisposableSession, PhiRuntime } from "@phi/core/runtime";

type FakeSession = DisposableSession & {
	id: string;
	disposeCalls: number;
};

function createFakeSession(id: string): FakeSession {
	return {
		id,
		disposeCalls: 0,
		dispose() {
			this.disposeCalls += 1;
		},
	};
}

describe("PhiRuntime", () => {
	it("isolates session creation by chat id", async () => {
		const createCalls: string[] = [];
		const runtime = new PhiRuntime<FakeSession>(async (chatId: string) => {
			createCalls.push(chatId);
			return createFakeSession(chatId);
		});

		const aliceSession = await runtime.getOrCreateSession("user-alice");
		const bobSession = await runtime.getOrCreateSession("user-bob");

		expect(aliceSession.id).toBe("user-alice");
		expect(bobSession.id).toBe("user-bob");
		expect(createCalls).toEqual(["user-alice", "user-bob"]);
	});

	it("returns false when disposing unknown chat runtime", () => {
		const runtime = new PhiRuntime<FakeSession>(async (_chatId: string) =>
			createFakeSession("unused")
		);
		expect(runtime.disposeSession("unknown")).toBe(false);
	});
});

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
