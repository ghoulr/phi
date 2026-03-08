import { describe, expect, it } from "bun:test";

import { resolvePhiTurnOutput } from "@phi/messaging/resolve-turn-output";

describe("resolvePhiTurnOutput", () => {
	it("suppresses delivery for exact NO_REPLY without deferred content", () => {
		expect(
			resolvePhiTurnOutput({
				assistantText: "NO_REPLY",
			})
		).toEqual([]);
	});

	it("combines final reply with deferred text and attachments", () => {
		expect(
			resolvePhiTurnOutput({
				assistantText: "done",
				deferredMessage: {
					text: "see attachment",
					attachments: [
						{ path: "/tmp/report.txt", name: "report.txt" },
					],
				},
			})
		).toEqual([
			{
				text: "done\n\nsee attachment",
				attachments: [{ path: "/tmp/report.txt", name: "report.txt" }],
			},
		]);
	});

	it("delivers deferred content alone when final reply is NO_REPLY", () => {
		expect(
			resolvePhiTurnOutput({
				assistantText: "NO_REPLY",
				deferredMessage: {
					text: "report attached",
					attachments: [
						{ path: "/tmp/report.txt", name: "report.txt" },
					],
				},
			})
		).toEqual([
			{
				text: "report attached",
				attachments: [{ path: "/tmp/report.txt", name: "report.txt" }],
			},
		]);
	});

	it("applies the current reply target to turn output", () => {
		expect(
			resolvePhiTurnOutput({
				assistantText: "done",
				turnContext: {
					replyToMessageId: "42",
				},
			})
		).toEqual([
			{
				text: "done",
				attachments: [],
				replyToMessageId: "42",
			},
		]);
	});
});
