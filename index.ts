import { runPiCommand, shouldRunPiCommandDirectly } from "@phi/commands/pi";
import { runServiceCommand } from "@phi/commands/service";
import { runTuiCommand } from "@phi/commands/tui";
import { getDefaultPhiConfigFilePath, loadPhiConfig } from "@phi/core/config";
import { disablePiVersionCheck } from "@phi/core/pi";
import { ChatReloadRegistry } from "@phi/core/reload";
import { createReloadTool } from "@phi/core/reload-tool";
import { createPhiAgentSession, createPhiRuntime } from "@phi/core/runtime";
import { createServiceSessionExtensionFactories } from "@phi/services/chat-handler";
import { ServiceRoutes } from "@phi/services/routes";
import { tui } from "@phi/tui";

disablePiVersionCheck();

const cliArgs = process.argv.slice(2);

if (shouldRunPiCommandDirectly(cliArgs)) {
	await runPiCommand(cliArgs.slice(1));
} else {
	const app = tui({
		runTui: async () => {
			await runTuiCommand();
		},
		runService: async (options) => {
			const phiConfig = loadPhiConfig(getDefaultPhiConfigFilePath());
			const reloadRegistry = new ChatReloadRegistry();
			const routes = new ServiceRoutes();
			const runtime = createPhiRuntime(
				phiConfig,
				{},
				async (chatId: string) => {
					const customTools = [
						createReloadTool(chatId, reloadRegistry),
					];
					return await createPhiAgentSession(chatId, phiConfig, {
						customTools,
						printSystemPrompt: options.printSystemPrompt === true,
						extensionFactories:
							createServiceSessionExtensionFactories(
								chatId,
								routes
							),
					});
				}
			);
			if (options.printSystemPrompt === true) {
				for (const chatId of Object.keys(phiConfig.chats ?? {})) {
					await runtime.getOrCreateSession(chatId);
				}
			}
			await runServiceCommand(runtime, phiConfig, {
				createReloadRegistry(): ChatReloadRegistry {
					return reloadRegistry;
				},
				createRoutes(): ServiceRoutes {
					return routes;
				},
			});
		},
	});

	app.parse(process.argv, { run: false });
	await app.runMatchedCommand();
}
