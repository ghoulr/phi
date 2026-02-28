import { runTuiCommand } from "@phi/commands/tui";
import { createPhiRuntime } from "@phi/core/runtime";
import { tui } from "@phi/tui";

const runtime = createPhiRuntime();

const app = tui({
	runTui: async (agentId: string) => {
		await runTuiCommand(runtime, agentId);
	},
});

app.parse(process.argv, { run: false });
await app.runMatchedCommand();
