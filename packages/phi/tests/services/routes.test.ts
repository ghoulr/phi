import { describe, expect, it } from "bun:test";

import type { PhiMessage } from "@phi/messaging/types";
import type { ChatHandler } from "@phi/services/chat-handler";
import { ServiceRoutes } from "@phi/services/routes";

function createChatHandler(overrides: Partial<ChatHandler> = {}): ChatHandler {
	return {
		async submitInteractive(): Promise<void> {},
		async submitCron(): Promise<PhiMessage[]> {
			return [];
		},
		async validateReload(): Promise<string[]> {
			return [];
		},
		invalidate(): void {},
		dispose(): void {},
		...overrides,
	};
}

describe("service routes", () => {
	it("dispatches interactive messages to the configured chat handler", async () => {
		const routes = new ServiceRoutes();
		const submissions: unknown[] = [];
		routes.registerChatHandler(
			"alice",
			createChatHandler({
				async submitInteractive(params): Promise<void> {
					submissions.push(params);
				},
			})
		);
		routes.registerInteractiveRoute("telegram:bot-1", "42", "alice");

		await routes.dispatchInteractive("telegram:bot-1", "42", {
			text: "hello",
			attachments: [],
			outboundDestination: "telegram",
			sendTyping: async () => ({ ok: true }),
		});

		expect(submissions).toEqual([
			{
				text: "hello",
				attachments: [],
				outboundDestination: "telegram",
				sendTyping: expect.any(Function),
			},
		]);
	});

	it("dispatches cron triggers to the registered chat handler", async () => {
		const routes = new ServiceRoutes();
		routes.registerChatHandler(
			"alice",
			createChatHandler({
				async submitCron(input): Promise<PhiMessage[]> {
					return [{ text: input.text, attachments: [] }];
				},
			})
		);

		expect(
			await routes.dispatchCron("alice", {
				text: "cron prompt",
				outboundDestination: "telegram",
			})
		).toEqual([{ text: "cron prompt", attachments: [] }]);
	});

	it("delivers outbound messages to the requested destination", async () => {
		const routes = new ServiceRoutes();
		const delivered: string[] = [];
		routes.registerOutboundRoute("alice", "telegram", {
			async deliver(message): Promise<void> {
				delivered.push(`telegram:${message.text}`);
			},
		});
		routes.registerOutboundRoute("alice", "feishu", {
			async deliver(message): Promise<void> {
				delivered.push(`feishu:${message.text}`);
			},
		});

		await routes.deliverOutbound(
			"alice",
			{
				text: "done",
				attachments: [],
			},
			"telegram"
		);

		expect(delivered).toEqual(["telegram:done"]);
	});

	it("fails when the requested destination does not exist", async () => {
		const routes = new ServiceRoutes();
		routes.registerOutboundRoute("alice", "telegram", {
			async deliver(): Promise<void> {},
		});

		await expect(
			routes.deliverOutbound(
				"alice",
				{ text: "done", attachments: [] },
				"feishu"
			)
		).rejects.toThrow(
			"No outbound route configured for chat alice and destination feishu"
		);
	});

	it("fails fast when duplicate outbound destination is registered", () => {
		const routes = new ServiceRoutes();
		routes.registerOutboundRoute("alice", "telegram", {
			async deliver(): Promise<void> {},
		});

		expect(() =>
			routes.registerOutboundRoute("alice", "telegram", {
				async deliver(): Promise<void> {},
			})
		).toThrow(
			"Duplicate outbound route for chat alice and destination telegram"
		);
	});

	it("fails fast when the same outbound delivery is registered twice", () => {
		const routes = new ServiceRoutes();
		const delivery = {
			async deliver(): Promise<void> {},
		};
		routes.registerOutboundRoute("alice", "telegram", delivery);

		expect(() =>
			routes.registerOutboundRoute("alice", "telegram", delivery)
		).toThrow(
			"Duplicate outbound route for chat alice and destination telegram"
		);
	});
});
