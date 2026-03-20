import type { AgentSession } from "@mariozechner/pi-coding-agent";

export type PhiSystemPromptBuilder = (toolNames: string[]) => string;

export function applyPhiSystemPromptOverride(
	session: AgentSession,
	systemPrompt: string | PhiSystemPromptBuilder
): void {
	const buildPrompt =
		typeof systemPrompt === "string" ? () => systemPrompt : systemPrompt;
	const prompt = buildPrompt(
		typeof systemPrompt === "string" ? [] : session.getActiveToolNames()
	).trim();
	session.agent.setSystemPrompt(prompt);
	const mutableSession = session as unknown as {
		_baseSystemPrompt?: string;
		_rebuildSystemPrompt?: PhiSystemPromptBuilder;
	};
	mutableSession._baseSystemPrompt = prompt;
	mutableSession._rebuildSystemPrompt = (toolNames: string[]) => {
		const nextPrompt = buildPrompt(toolNames).trim();
		mutableSession._baseSystemPrompt = nextPrompt;
		return nextPrompt;
	};
}
