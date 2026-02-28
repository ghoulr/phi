import { runServiceCommand } from "@phi/commands/service";
import { runTuiCommand } from "@phi/commands/tui";
import { getDefaultPhiConfigFilePath, loadPhiConfig } from "@phi/core/config";
import { createPhiRuntime } from "@phi/core/runtime";
import { tui } from "@phi/tui";

const phiConfig = loadPhiConfig(getDefaultPhiConfigFilePath());
const runtime = createPhiRuntime(phiConfig);

const app = tui({
	runTui: async (agentId: string) => {
		await runTuiCommand(runtime, agentId);
	},
	runService: async () => {
		await runServiceCommand(runtime, phiConfig);
	},
});

app.parse(process.argv, { run: false });
await app.runMatchedCommand();
