import {
	InteractiveMode,
	type AgentSession,
} from "@mariozechner/pi-coding-agent";

import type { AgentConversationRuntime } from "@phi/core/runtime";

export const TUI_CONVERSATION_KEY = "tui:default";

export type TuiModeRunner = (session: AgentSession) => Promise<void>;

export async function runInteractiveTui(session: AgentSession): Promise<void> {
	const mode = new InteractiveMode(session);
	await mode.run();
}

export async function runTuiCommand(
	runtime: AgentConversationRuntime<AgentSession>,
	agentId: string,
	runMode: TuiModeRunner = runInteractiveTui,
	conversationKey: string = TUI_CONVERSATION_KEY
): Promise<void> {
	const session = await runtime.getOrCreateSession(agentId, conversationKey);
	try {
		await runMode(session);
	} finally {
		runtime.disposeSession(agentId, conversationKey);
	}
}
