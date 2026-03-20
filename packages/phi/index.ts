import { runPiCommand, shouldRunPiCommandDirectly } from "@phi/commands/pi";
import { runServiceCommand } from "@phi/commands/service";
import { runTuiCommand } from "@phi/commands/tui";
import {
	getDefaultPhiConfigFilePath,
	loadPhiConfig,
	resolveSessionRuntimeConfig,
} from "@phi/core/config";
import { disablePiVersionCheck } from "@phi/core/pi";
import { ChatReloadRegistry } from "@phi/core/reload";
import { createReloadTool } from "@phi/core/reload-tool";
import { createPhiAgentSession, createPhiRuntime } from "@phi/core/runtime";
import { createCronTools } from "@phi/cron/tools";
import { CronControllerRegistry } from "@phi/cron/controller";
import { startCronService } from "@phi/cron/service";
import { resolveChatWorkspaceDirectory } from "@phi/core/chat-workspace";
import { createServiceSessionExtensionFactories } from "@phi/services/session";
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
			const cronControllerRegistry = new CronControllerRegistry();
			const runtime = createPhiRuntime(
				phiConfig,
				{},
				async (sessionId: string) => {
					const sessionConfig = resolveSessionRuntimeConfig(
						phiConfig,
						sessionId
					);
					const customTools = [
						createReloadTool(sessionConfig.chatId, reloadRegistry),
					];
					customTools.push(
						...createCronTools({
							chatId: sessionConfig.chatId,
							sessionId,
							workspaceDir: resolveChatWorkspaceDirectory(
								sessionConfig.workspace
							),
							routes,
							controllerRegistry: cronControllerRegistry,
						})
					);
					return await createPhiAgentSession(sessionId, phiConfig, {
						customTools,
						printSystemPrompt: options.printSystemPrompt === true,
						extensionFactories:
							createServiceSessionExtensionFactories(
								sessionId,
								routes
							),
					});
				}
			);
			if (options.printSystemPrompt === true) {
				for (const sessionId of Object.keys(phiConfig.sessions ?? {})) {
					await runtime.getOrCreateSession(sessionId);
				}
			}
			await runServiceCommand(runtime, phiConfig, {
				createReloadRegistry(): ChatReloadRegistry {
					return reloadRegistry;
				},
				createRoutes(): ServiceRoutes {
					return routes;
				},
				async startCronRuntime(
					chatConfigs,
					startReloadRegistry,
					startRoutes
				) {
					return await startCronService({
						chatConfigs,
						reloadRegistry: startReloadRegistry,
						routes: startRoutes,
						controllerRegistry: cronControllerRegistry,
					});
				},
			});
		},
	});

	app.parse(process.argv, { run: false });
	await app.runMatchedCommand();
}
