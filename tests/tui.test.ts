import { describe, expect, it } from "bun:test";

import { tui } from "@phi/tui";

describe("tui", () => {
	it("runs tui command when no subcommand is provided", async () => {
		let runTuiCalls = 0;
		const app = tui({
			runTui: async () => {
				runTuiCalls += 1;
			},
		});

		app.parse(["bun", "phi"], { run: false });
		await app.runMatchedCommand();

		expect(runTuiCalls).toBe(1);
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
