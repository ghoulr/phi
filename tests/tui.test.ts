import { describe, expect, it } from "bun:test";

import { tui, type TuiChatRouteOptions } from "@phi/tui";

describe("tui", () => {
	it("runs tui command when no subcommand is provided", async () => {
		const receivedRoutes: Array<TuiChatRouteOptions | undefined> = [];
		const app = tui({
			runTui: async (route?: TuiChatRouteOptions) => {
				receivedRoutes.push(route);
			},
			runService: async () => {
				throw new Error(
					"Service should not run in default command test."
				);
			},
		});

		app.parse(["bun", "phi"], { run: false });
		await app.runMatchedCommand();

		expect(receivedRoutes).toEqual([undefined]);
	});

	it("passes --channel and --chat to tui subcommand", async () => {
		const receivedRoutes: Array<TuiChatRouteOptions | undefined> = [];
		const app = tui({
			runTui: async (route?: TuiChatRouteOptions) => {
				receivedRoutes.push(route);
			},
			runService: async () => {
				throw new Error("Service should not run in tui command test.");
			},
		});

		app.parse(
			["bun", "phi", "tui", "--channel", "telegram", "--chat=-10001"],
			{
				run: false,
			}
		);
		await app.runMatchedCommand();

		expect(receivedRoutes).toEqual([
			{ channel: "telegram", chatId: "-10001" },
		]);
	});

	it("passes --channel and --chat to default command", async () => {
		const receivedRoutes: Array<TuiChatRouteOptions | undefined> = [];
		const app = tui({
			runTui: async (route?: TuiChatRouteOptions) => {
				receivedRoutes.push(route);
			},
			runService: async () => {
				throw new Error(
					"Service should not run in default command test."
				);
			},
		});

		app.parse(["bun", "phi", "--channel", "telegram", "--chat", "42"], {
			run: false,
		});
		await app.runMatchedCommand();

		expect(receivedRoutes).toEqual([{ channel: "telegram", chatId: "42" }]);
	});

	it("fails when --chat is provided without --channel", async () => {
		const app = tui({
			runTui: async () => {
				throw new Error("Tui should not run on invalid options.");
			},
			runService: async () => {
				throw new Error("Service should not run on invalid options.");
			},
		});

		app.parse(["bun", "phi", "tui", "--chat", "42"], { run: false });
		await expect(app.runMatchedCommand()).rejects.toThrow(
			"TUI chat override requires --channel when --chat is provided."
		);
	});

	it("fails when --channel is provided without --chat", async () => {
		const app = tui({
			runTui: async () => {
				throw new Error("Tui should not run on invalid options.");
			},
			runService: async () => {
				throw new Error("Service should not run on invalid options.");
			},
		});

		app.parse(["bun", "phi", "tui", "--channel", "telegram"], {
			run: false,
		});
		await expect(app.runMatchedCommand()).rejects.toThrow(
			"TUI chat override requires --chat when --channel is provided."
		);
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
