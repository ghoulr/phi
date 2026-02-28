import cac, { type CAC } from "cac";

import { DEFAULT_AGENT_ID } from "@phi/core/runtime";

export interface TuiDependencies {
	runTui(agentId: string): Promise<void>;
}

interface TuiCommandOptions {
	agent?: string;
}

function getAgentId(options: TuiCommandOptions): string {
	return options.agent ?? DEFAULT_AGENT_ID;
}

export function tui(dependencies: TuiDependencies): CAC {
	const app = cac("phi");

	app.command("tui", "Start phi in TUI mode")
		.option("--agent <agentId>", "Run with a specific phi agent", {
			default: DEFAULT_AGENT_ID,
		})
		.action(async (options: TuiCommandOptions) => {
			await dependencies.runTui(getAgentId(options));
		});

	app.command("[...args]", "Run default command").action(
		async (args: string[]) => {
			if (args.length === 0) {
				await dependencies.runTui(DEFAULT_AGENT_ID);
				return;
			}
			throw new Error(`Unknown command: ${args[0]}`);
		}
	);

	app.help();

	return app;
}
