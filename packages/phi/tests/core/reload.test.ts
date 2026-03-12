import { describe, expect, it } from "bun:test";

import { ChatReloadRegistry } from "@phi/core/reload";

describe("ChatReloadRegistry", () => {
	it("reloads all handlers for a registered chat", async () => {
		const registry = new ChatReloadRegistry();
		registry.register("alice", async () => ["session"]);
		registry.register("alice", async () => ["cron"]);

		await expect(registry.reload("alice")).resolves.toEqual({
			chatId: "alice",
			reloaded: ["session", "cron"],
		});
	});

	it("fails when reload handler is missing", async () => {
		const registry = new ChatReloadRegistry();
		await expect(registry.reload("alice")).rejects.toThrow(
			"Reload is not available for chat alice"
		);
	});
});
