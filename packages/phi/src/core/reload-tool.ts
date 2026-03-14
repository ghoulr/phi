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
			"Validate workspace changes and schedule them to apply after the current reply ends.",
		parameters: Type.Object({}),
		execute: async () => {
			const result = await reloadRegistry.request(chatId);
			return {
				content: [
					{
						type: "text" as const,
						text: `Reload scheduled for chat ${result.chatId}: ${result.reloaded.join(", ")}. Changes apply after this reply ends.`,
					},
				],
				details: result,
			};
		},
	};
}
