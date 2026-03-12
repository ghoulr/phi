import { describe, expect, it } from "bun:test";

import { resolvePhiMessagingOutput } from "@phi/extensions/messaging/resolve-output";

describe("resolvePhiMessagingOutput", () => {
	it("suppresses delivery for exact NO_REPLY without deferred content", () => {
		expect(
			resolvePhiMessagingOutput({
				assistantText: "NO_REPLY",
			})
		).toEqual([]);
	});

	it("combines final reply with deferred text and attachments", () => {
		expect(
			resolvePhiMessagingOutput({
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
			resolvePhiMessagingOutput({
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

	it("delivers assistant text without deferred metadata", () => {
		expect(
			resolvePhiMessagingOutput({
				assistantText: "done",
			})
		).toEqual([
			{
				text: "done",
				attachments: [],
			},
		]);
	});
});
