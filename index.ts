import { createTelegramConversationKey } from "@phi/commands/telegram";
import { runServiceCommand } from "@phi/commands/service";
import { runInteractiveTui, runTuiCommand } from "@phi/commands/tui";
import {
	getDefaultPhiConfigFilePath,
	loadPhiConfig,
	resolveTuiAgentId,
} from "@phi/core/config";
import { createPhiRuntime } from "@phi/core/runtime";
import { tui, type TuiChatRouteOptions } from "@phi/tui";

const phiConfig = loadPhiConfig(getDefaultPhiConfigFilePath());
const runtime = createPhiRuntime(phiConfig);

const app = tui({
	runTui: async (route?: TuiChatRouteOptions) => {
		const agentId = resolveTuiAgentId(phiConfig, route);
		const conversationKey = route
			? createTelegramConversationKey(route.chatId)
			: undefined;
		await runTuiCommand(
			runtime,
			agentId,
			runInteractiveTui,
			conversationKey
		);
	},
	runService: async () => {
		await runServiceCommand(runtime, phiConfig);
	},
});

app.parse(process.argv, { run: false });
await app.runMatchedCommand();
