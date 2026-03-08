import { describe, expect, it } from "bun:test";

import { ChatReloadRegistry } from "@phi/core/reload";

describe("ChatReloadRegistry", () => {
	it("reloads a registered chat", async () => {
		const registry = new ChatReloadRegistry();
		registry.register("alice", async () => ["cron"]);

		await expect(registry.reload("alice")).resolves.toEqual({
			chatId: "alice",
			reloaded: ["cron"],
		});
	});

	it("fails when reload handler is missing", async () => {
		const registry = new ChatReloadRegistry();
		await expect(registry.reload("alice")).rejects.toThrow(
			"Reload is not available for chat alice"
		);
	});
});
