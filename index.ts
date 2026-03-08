import { runServiceCommand } from "@phi/commands/service";
import { runTuiCommand } from "@phi/commands/tui";
import { getDefaultPhiConfigFilePath, loadPhiConfig } from "@phi/core/config";
import { disablePiVersionCheck } from "@phi/core/pi";
import { ChatReloadRegistry } from "@phi/core/reload";
import { createReloadTool } from "@phi/core/reload-tool";
import { createPhiRuntime } from "@phi/core/runtime";
import { tui } from "@phi/tui";

disablePiVersionCheck();

const app = tui({
	runTui: async () => {
		await runTuiCommand();
	},
	runService: async () => {
		const phiConfig = loadPhiConfig(getDefaultPhiConfigFilePath());
		const reloadRegistry = new ChatReloadRegistry();
		const runtime = createPhiRuntime(phiConfig, {
			getCustomTools: (chatId: string) => [
				createReloadTool(chatId, reloadRegistry),
			],
		});
		await runServiceCommand(runtime, phiConfig, {
			createReloadRegistry(): ChatReloadRegistry {
				return reloadRegistry;
			},
		});
	},
});

app.parse(process.argv, { run: false });
await app.runMatchedCommand();
