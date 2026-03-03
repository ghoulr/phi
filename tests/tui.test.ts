import { describe, expect, it } from "bun:test";

import { tui } from "@phi/tui";

describe("tui", () => {
	it("runs tui command when no subcommand is provided", async () => {
		let runTuiCalls = 0;
		const app = tui({
			runTui: async () => {
				runTuiCalls += 1;
			},
			runService: async () => {
				throw new Error(
					"Service should not run in default command test."
				);
			},
		});

		app.parse(["bun", "phi"], { run: false });
		await app.runMatchedCommand();

		expect(runTuiCalls).toBe(1);
	});

	it("runs tui subcommand", async () => {
		let runTuiCalls = 0;
		const app = tui({
			runTui: async () => {
				runTuiCalls += 1;
			},
			runService: async () => {
				throw new Error("Service should not run in tui command test.");
			},
		});

		app.parse(["bun", "phi", "tui"], {
			run: false,
		});
		await app.runMatchedCommand();

		expect(runTuiCalls).toBe(1);
	});

	it("runs service command", async () => {
		let runServiceCalls = 0;
		const app = tui({
			runTui: async () => {
				throw new Error("Tui should not run in service command test.");
			},
			runService: async () => {
				runServiceCalls += 1;
			},
		});

		app.parse(["bun", "phi", "service"], {
			run: false,
		});
		await app.runMatchedCommand();

		expect(runServiceCalls).toBe(1);
	});

	it("fails fast on unknown command", async () => {
		const app = tui({
			runTui: async () => {
				throw new Error("Tui should not run for unknown command.");
			},
			runService: async () => {
				throw new Error("Service should not run for unknown command.");
			},
		});

		app.parse(["bun", "phi", "unknown"], { run: false });

		await expect(app.runMatchedCommand()).rejects.toThrow(
			"Unknown command: unknown"
		);
	});
});
