import {
	InteractiveMode,
	type AgentSession,
} from "@mariozechner/pi-coding-agent";

import type { ConversationRuntime } from "@phi/core/runtime";

export const TUI_CONVERSATION_KEY = "tui:default";

export type TuiModeRunner = (session: AgentSession) => Promise<void>;

export async function runInteractiveTui(session: AgentSession): Promise<void> {
	const mode = new InteractiveMode(session);
	await mode.run();
}

export async function runTuiCommand(
	runtime: ConversationRuntime<AgentSession>,
	runMode: TuiModeRunner = runInteractiveTui
): Promise<void> {
	const session = await runtime.getOrCreateSession(TUI_CONVERSATION_KEY);
	try {
		await runMode(session);
	} finally {
		runtime.disposeSession(TUI_CONVERSATION_KEY);
	}
}
