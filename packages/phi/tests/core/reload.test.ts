import { describe, expect, it } from "bun:test";

import { ChatReloadRegistry } from "@phi/core/reload";

describe("ChatReloadRegistry", () => {
	it("validates first and applies pending reload later", async () => {
		const registry = new ChatReloadRegistry();
		const calls: string[] = [];
		registry.register("alice", {
			validate: async () => {
				calls.push("validate:session");
				return ["session"];
			},
			apply: async () => {
				calls.push("apply:session");
				return ["session"];
			},
		});
		registry.register("alice", {
			validate: async () => {
				calls.push("validate:cron");
				return ["cron"];
			},
			apply: async () => {
				calls.push("apply:cron");
				return ["cron"];
			},
		});

		await expect(registry.request("alice")).resolves.toEqual({
			chatId: "alice",
			reloaded: ["session", "cron"],
		});
		expect(calls).toEqual(["validate:session", "validate:cron"]);

		await expect(registry.applyPending("alice")).resolves.toEqual({
			chatId: "alice",
			reloaded: ["session", "cron"],
		});
		expect(calls).toEqual([
			"validate:session",
			"validate:cron",
			"apply:session",
			"apply:cron",
		]);
		await expect(registry.applyPending("alice")).resolves.toBeUndefined();
	});

	it("fails when reload participant is missing", async () => {
		const registry = new ChatReloadRegistry();
		await expect(registry.request("alice")).rejects.toThrow(
			"Reload is not available for chat alice"
		);
	});
});
