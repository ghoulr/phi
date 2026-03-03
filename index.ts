import { runServiceCommand } from "@phi/commands/service";
import { runTuiCommand } from "@phi/commands/tui";
import { getDefaultPhiConfigFilePath, loadPhiConfig } from "@phi/core/config";
import { disablePiVersionCheck } from "@phi/core/pi";
import { createPhiRuntime } from "@phi/core/runtime";
import { tui } from "@phi/tui";

disablePiVersionCheck();

const app = tui({
	runTui: async () => {
		await runTuiCommand();
	},
	runService: async () => {
		const phiConfig = loadPhiConfig(getDefaultPhiConfigFilePath());
		const runtime = createPhiRuntime(phiConfig);
		await runServiceCommand(runtime, phiConfig);
	},
});

app.parse(process.argv, { run: false });
await app.runMatchedCommand();
