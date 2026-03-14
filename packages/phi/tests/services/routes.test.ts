import { describe, expect, it } from "bun:test";

import type { PhiMessage } from "@phi/messaging/types";
import type { Session } from "@phi/services/session";
import { ServiceRoutes } from "@phi/services/routes";

function createSession(overrides: Partial<Session> = {}): Session {
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
	it("dispatches interactive messages to the configured session", async () => {
		const routes = new ServiceRoutes();
		const submissions: unknown[] = [];
		routes.registerSession(
			"alice-telegram",
			createSession({
				async submitInteractive(params): Promise<void> {
					submissions.push(params);
				},
			})
		);
		routes.registerInteractiveRoute(
			"telegram:bot-1",
			"42",
			"alice-telegram"
		);

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

	it("dispatches cron triggers to the configured session", async () => {
		const routes = new ServiceRoutes();
		routes.registerSession(
			"alice-cron",
			createSession({
				async submitCron(input): Promise<PhiMessage[]> {
					return [{ text: input.text, attachments: [] }];
				},
			})
		);
		routes.registerCronRoute("alice", "alice-cron");

		expect(
			await routes.dispatchCron("alice", {
				text: "cron prompt",
			})
		).toEqual([{ text: "cron prompt", attachments: [] }]);
	});

	it("delivers outbound messages to the configured session route", async () => {
		const routes = new ServiceRoutes();
		const delivered: string[] = [];
		routes.registerOutboundRoute("alice-telegram", {
			async deliver(message): Promise<void> {
				delivered.push(`telegram:${message.text}`);
			},
		});

		await routes.deliverOutbound("alice-telegram", {
			text: "done",
			attachments: [],
		});

		expect(delivered).toEqual(["telegram:done"]);
	});

	it("fails when the outbound route does not exist", async () => {
		const routes = new ServiceRoutes();

		await expect(
			routes.deliverOutbound("alice-missing", {
				text: "done",
				attachments: [],
			})
		).rejects.toThrow(
			"No outbound route configured for session alice-missing"
		);
	});

	it("fails fast when duplicate outbound route is registered", () => {
		const routes = new ServiceRoutes();
		routes.registerOutboundRoute("alice-telegram", {
			async deliver(): Promise<void> {},
		});

		expect(() =>
			routes.registerOutboundRoute("alice-telegram", {
				async deliver(): Promise<void> {},
			})
		).toThrow("Duplicate outbound route for session alice-telegram");
	});
});
