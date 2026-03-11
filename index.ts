import { runServiceCommand } from "@phi/commands/service";
import { runTuiCommand } from "@phi/commands/tui";
import {
	ensureChatWorkspaceLayout,
	resolveChatWorkspaceDirectory,
} from "@phi/core/chat-workspace";
import {
	getDefaultPhiConfigFilePath,
	loadPhiConfig,
	resolveChatRuntimeConfig,
} from "@phi/core/config";
import {
	createEnabledPhiOwnedExtensionFactories,
	PHI_MESSAGING_EXTENSION_ID,
} from "@phi/core/phi-extensions";
import { disablePiVersionCheck } from "@phi/core/pi";
import { ChatReloadRegistry } from "@phi/core/reload";
import { createReloadTool } from "@phi/core/reload-tool";
import { createPhiAgentSession, createPhiRuntime } from "@phi/core/runtime";
import {
	loadPhiWorkspaceConfig,
	resolveWorkspaceDisabledExtensionIds,
} from "@phi/core/workspace-config";
import { createPhiMessagingExtension } from "@phi/extensions/messaging";
import { PhiRouteDeliveryRegistry } from "@phi/messaging/route-delivery";
import { startCronService } from "@phi/cron/service";
import { startTelegramPollingBot } from "@phi/services/telegram";
import { tui } from "@phi/tui";

disablePiVersionCheck();

function createMessagingExtensionFactories(params: {
	chatId: string;
	phiConfig: ReturnType<typeof loadPhiConfig>;
	deliveryRegistry: PhiRouteDeliveryRegistry;
}) {
	const chatConfig = resolveChatRuntimeConfig(
		params.phiConfig,
		params.chatId
	);
	const workspaceDir = resolveChatWorkspaceDirectory(chatConfig.workspace);
	const workspaceLayout = ensureChatWorkspaceLayout(workspaceDir);
	const workspaceConfig = loadPhiWorkspaceConfig(
		workspaceLayout.configFilePath
	);
	const disabledExtensionIds = resolveWorkspaceDisabledExtensionIds(
		workspaceConfig,
		workspaceLayout.configFilePath
	);
	return createEnabledPhiOwnedExtensionFactories({
		disabledExtensionIds,
		definitions: [
			{
				id: PHI_MESSAGING_EXTENSION_ID,
				create: () =>
					createPhiMessagingExtension({
						deliverMessage: async (message) => {
							await params.deliveryRegistry
								.require(params.chatId)
								.deliver(message);
						},
					}),
			},
		],
	});
}

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

				return await createPhiAgentSession(chatId, phiConfig, {
					customTools,
					printSystemPrompt: options.printSystemPrompt === true,
					extensionFactories: createMessagingExtensionFactories({
						chatId,
						phiConfig,
						deliveryRegistry,
					}),
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
