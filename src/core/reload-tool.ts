import { Type } from "@mariozechner/pi-ai";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";

import type { ChatReloadRegistry } from "@phi/core/reload";

export function createReloadTool(
	chatId: string,
	reloadRegistry: ChatReloadRegistry
): ToolDefinition {
	return {
		name: "reload",
		label: "Reload",
		description:
			"Reload all hot-reloadable phi state for the current chat after config or file changes.",
		parameters: Type.Object({}),
		execute: async () => {
			const result = await reloadRegistry.reload(chatId);
			return {
				content: [
					{
						type: "text" as const,
						text: `Reloaded chat ${result.chatId}: ${result.reloaded.join(", ")}`,
					},
				],
				details: result,
			};
		},
	};
}
