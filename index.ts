import { runServiceCommand } from "@phi/commands/service";
import { runTuiCommand } from "@phi/commands/tui";
import { createPhiAgentSession, createPhiRuntime } from "@phi/core/runtime";
import { getDefaultPhiConfigFilePath, loadPhiConfig } from "@phi/core/config";
import { disablePiVersionCheck } from "@phi/core/pi";
import { ChatReloadRegistry } from "@phi/core/reload";
import { createReloadTool } from "@phi/core/reload-tool";
import {
	buildPhiMessagingEventText,
	createPhiMessagingExtension,
} from "@phi/extensions/messaging";
import { PhiRouteDeliveryRegistry } from "@phi/messaging/route-delivery";
import { PhiMessagingSessionState } from "@phi/messaging/session-state";
import { startCronService } from "@phi/cron/service";
import { startTelegramPollingBot } from "@phi/services/telegram";
import { tui } from "@phi/tui";

disablePiVersionCheck();

const app = tui({
	runTui: async () => {
		await runTuiCommand();
	},
	runService: async (options) => {
		const phiConfig = loadPhiConfig(getDefaultPhiConfigFilePath());
		const reloadRegistry = new ChatReloadRegistry();
		const deliveryRegistry = new PhiRouteDeliveryRegistry();
		const routedChatIds = new Set(
			Object.entries(phiConfig.chats ?? {})
				.filter(
					([, chatConfig]) =>
						chatConfig.routes?.telegram &&
						chatConfig.routes.telegram.enabled !== false
				)
				.map(([chatId]) => chatId)
		);
		const runtime = createPhiRuntime(
			phiConfig,
			{},
			async (chatId: string) => {
				const customTools = [createReloadTool(chatId, reloadRegistry)];
				if (!routedChatIds.has(chatId)) {
					return await createPhiAgentSession(chatId, phiConfig, {
						customTools,
						printSystemPrompt: options.printSystemPrompt === true,
					});
				}

				const messagingState = new PhiMessagingSessionState();
				return await createPhiAgentSession(chatId, phiConfig, {
					customTools,
					messagingState,
					printSystemPrompt: options.printSystemPrompt === true,
					extensionFactories: [
						createPhiMessagingExtension({
							state: messagingState,
							deliverMessage: async (message) => {
								await deliveryRegistry
									.require(chatId)
									.deliver(message);
							},
						}),
					],
					additionalPromptToolNames: ["send"],
					eventText: buildPhiMessagingEventText(),
				});
			}
		);
		for (const chatId of Object.keys(phiConfig.chats ?? {})) {
			reloadRegistry.register(chatId, async () => {
				runtime.invalidateSession(chatId);
				return ["session"];
			});
		}
		if (options.printSystemPrompt === true) {
			for (const chatId of Object.keys(phiConfig.chats ?? {})) {
				await runtime.getOrCreateSession(chatId);
			}
		}
		await runServiceCommand(runtime, phiConfig, {
			createReloadRegistry(): ChatReloadRegistry {
				return reloadRegistry;
			},
			startTelegramBot(runtime, config) {
				return startTelegramPollingBot(
					runtime,
					config,
					undefined,
					deliveryRegistry
				);
			},
			startCronRuntime(
				runtime,
				phiConfig,
				chatConfigs,
				chatExecutor,
				reloadRegistry
			) {
				return startCronService({
					runtime,
					phiConfig,
					chatConfigs,
					chatExecutor,
					reloadRegistry,
					deliveryRegistry,
				});
			},
		});
	},
});

app.parse(process.argv, { run: false });
await app.runMatchedCommand();
