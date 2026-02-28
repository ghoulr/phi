import { describe, expect, it } from "bun:test";

import { tui } from "@phi/tui";

import { DEFAULT_AGENT_ID } from "@phi/core/runtime";

describe("tui", () => {
	it("runs tui command when no subcommand is provided", async () => {
		const runAgents: string[] = [];
		const app = tui({
			runTui: async (agentId: string) => {
				runAgents.push(agentId);
			},
		});

		app.parse(["bun", "phi"], { run: false });
		await app.runMatchedCommand();

		expect(runAgents).toEqual([DEFAULT_AGENT_ID]);
	});

	it("supports --agent for tui command", async () => {
		const runAgents: string[] = [];
		const app = tui({
			runTui: async (agentId: string) => {
				runAgents.push(agentId);
			},
		});

		app.parse(["bun", "phi", "tui", "--agent", "support"], {
			run: false,
		});
		await app.runMatchedCommand();

		expect(runAgents).toEqual(["support"]);
	});

	it("fails fast on unknown command", async () => {
		const app = tui({
			runTui: async () => {
				throw new Error("Tui should not run for unknown command.");
			},
		});

		app.parse(["bun", "phi", "telegram"], { run: false });

		await expect(app.runMatchedCommand()).rejects.toThrow(
			"Unknown command: telegram"
		);
	});
});
