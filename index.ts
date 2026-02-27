import { runTuiCommand } from "@phi/commands/tui";
import { createPhiRuntime } from "@phi/core/runtime";
import { tui } from "@phi/tui";

const runtime = createPhiRuntime();

const app = tui({
	runTui: async () => {
		await runTuiCommand(runtime);
	},
});

app.parse(process.argv, { run: false });
await app.runMatchedCommand();
