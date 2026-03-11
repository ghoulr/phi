import { describe, expect, it } from "bun:test";

import { resolveSenderMentionFromCurrentTurn } from "@phi/extensions/messaging/sender";

function createContext(text: string) {
	return {
		sessionManager: {
			getBranch() {
				return [
					{
						type: "message",
						message: {
							role: "user",
							content: [{ type: "text", text }],
						},
					},
				];
			},
		},
	} as never;
}

describe("resolveSenderMentionFromCurrentTurn", () => {
	it("extracts sender fields from system reminder", () => {
		const mention = resolveSenderMentionFromCurrentTurn(
			createContext(
				[
					"hello",
					"<system-reminder>",
					"current_message:",
					"  from:",
					"    id: 100",
					"    username: alice",
					"    first_name: Alice",
					"    last_name: Doe",
					"</system-reminder>",
				].join("\n")
			)
		);

		expect(mention).toEqual({
			userId: "100",
			username: "alice",
			displayName: "Alice Doe",
		});
	});

	it("returns undefined without sender metadata", () => {
		const mention = resolveSenderMentionFromCurrentTurn(
			createContext("hello")
		);

		expect(mention).toBeUndefined();
	});

	it("returns undefined for malformed reminder blocks", () => {
		const mention = resolveSenderMentionFromCurrentTurn(
			createContext(
				[
					"hello",
					"<system-reminder>",
					"current_message:",
					"  from:",
					"    id: 100",
				].join("\n")
			)
		);

		expect(mention).toBeUndefined();
	});
});
