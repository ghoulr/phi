import { describe, expect, it } from "bun:test";

import {
	resolveOutboundDestinationFromCurrentTurn,
	resolveSenderMentionFromCurrentTurn,
} from "@phi/extensions/messaging/sender";

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

describe("resolveOutboundDestinationFromCurrentTurn", () => {
	it("extracts outbound destination from system reminder", () => {
		const outboundDestination = resolveOutboundDestinationFromCurrentTurn(
			createContext(
				[
					"hello",
					"<system-reminder>",
					"phi:",
					"  outboundDestination: telegram",
					"</system-reminder>",
				].join("\n")
			)
		);

		expect(outboundDestination).toBe("telegram");
	});

	it("returns undefined when outbound destination is missing", () => {
		const outboundDestination = resolveOutboundDestinationFromCurrentTurn(
			createContext(
				[
					"hello",
					"<system-reminder>",
					"phi:",
					"</system-reminder>",
				].join("\n")
			)
		);

		expect(outboundDestination).toBeUndefined();
	});

	it("returns undefined for malformed reminder blocks", () => {
		const outboundDestination = resolveOutboundDestinationFromCurrentTurn(
			createContext(
				[
					"hello",
					"<system-reminder>",
					"phi:",
					"  outboundDestination: telegram",
				].join("\n")
			)
		);

		expect(outboundDestination).toBeUndefined();
	});
});
