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
			sendTyping: async () => ({ ok: true }),
		});

		expect(submissions).toEqual([
			{
				text: "hello",
				attachments: [],
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
			await routes.dispatchCron("alice", { text: "cron prompt" })
		).toEqual([{ text: "cron prompt", attachments: [] }]);
	});

	it("delivers outbound messages to every configured sink", async () => {
		const routes = new ServiceRoutes();
		const delivered: string[] = [];
		routes.registerOutboundRoute("alice", {
			async deliver(message): Promise<void> {
				delivered.push(`one:${message.text}`);
			},
		});
		routes.registerOutboundRoute("alice", {
			async deliver(message): Promise<void> {
				delivered.push(`two:${message.text}`);
			},
		});

		await routes.deliverOutbound("alice", {
			text: "done",
			attachments: [],
		});

		expect(delivered.sort()).toEqual(["one:done", "two:done"]);
	});

	it("keeps successful sinks committed when one outbound sink fails", async () => {
		const routes = new ServiceRoutes();
		const delivered: string[] = [];
		routes.registerOutboundRoute("alice", {
			async deliver(message): Promise<void> {
				delivered.push(`one:${message.text}`);
			},
		});
		routes.registerOutboundRoute("alice", {
			async deliver(): Promise<void> {
				throw new Error("sink failed");
			},
		});

		await expect(
			routes.deliverOutbound("alice", {
				text: "done",
				attachments: [],
			})
		).resolves.toBeUndefined();
		expect(delivered).toEqual(["one:done"]);
	});

	it("fails when every outbound sink fails", async () => {
		const routes = new ServiceRoutes();
		routes.registerOutboundRoute("alice", {
			async deliver(): Promise<void> {
				throw new Error("sink one failed");
			},
		});
		routes.registerOutboundRoute("alice", {
			async deliver(): Promise<void> {
				throw new Error("sink two failed");
			},
		});

		await expect(
			routes.deliverOutbound("alice", { text: "done", attachments: [] })
		).rejects.toThrow("All outbound routes failed for chat alice");
	});

	it("allows chats without outbound sinks", async () => {
		const routes = new ServiceRoutes();

		await expect(
			routes.deliverOutbound("alice", { text: "done", attachments: [] })
		).resolves.toBeUndefined();
	});
});
