import type { AgentMessage, ThinkingLevel } from "@mariozechner/pi-agent-core";
import type { Api, Model } from "@mariozechner/pi-ai";
import {
	buildSessionContext,
	createAgentSession,
	createCodingTools,
	DefaultResourceLoader,
	type ExtensionAPI,
	type ExtensionContext,
	type ModelRegistry,
	SessionManager,
	SettingsManager,
} from "@mariozechner/pi-coding-agent";

import { applyPhiSystemPromptOverride } from "@phi/extensions/system-prompt";

export interface PhiTransientTurnSnapshot {
	cwd: string;
	modelRegistry: ModelRegistry;
	model: Model<Api> | undefined;
	thinkingLevel: ThinkingLevel;
	systemPrompt: string;
	messages: AgentMessage[];
	activeToolNames: string[];
}

export interface RunPhiTransientTurnParams {
	snapshot: PhiTransientTurnSnapshot;
	prompt: string;
}

export interface RunPhiTransientTurnResult {
	assistantText: string | undefined;
}

export type PhiTransientTurnRunner = (
	params: RunPhiTransientTurnParams
) => Promise<RunPhiTransientTurnResult>;

function resolveTransientTools(snapshot: PhiTransientTurnSnapshot) {
	const builtInTools = createCodingTools(snapshot.cwd);
	const availableTools = new Map(
		builtInTools.map((tool) => [tool.name, tool])
	);
	const tools = snapshot.activeToolNames
		.map((toolName) => availableTools.get(toolName))
		.filter(
			(tool): tool is (typeof builtInTools)[number] => tool !== undefined
		);
	if (tools.length > 0) {
		return tools;
	}
	return builtInTools;
}

export function createPhiTransientTurnSnapshot(params: {
	ctx: ExtensionContext;
	pi: Pick<ExtensionAPI, "getActiveTools" | "getThinkingLevel">;
}): PhiTransientTurnSnapshot {
	const sessionContext = buildSessionContext(
		params.ctx.sessionManager.getEntries(),
		params.ctx.sessionManager.getLeafId()
	);
	return {
		cwd: params.ctx.cwd,
		modelRegistry: params.ctx.modelRegistry,
		model: params.ctx.model,
		thinkingLevel: params.pi.getThinkingLevel(),
		systemPrompt: params.ctx.getSystemPrompt(),
		messages: sessionContext.messages,
		activeToolNames: params.pi.getActiveTools(),
	};
}

export async function runPhiTransientTurn(
	params: RunPhiTransientTurnParams
): Promise<RunPhiTransientTurnResult> {
	const { snapshot } = params;
	if (!snapshot.model) {
		throw new Error("Transient turn requires an active model.");
	}

	const settingsManager = SettingsManager.inMemory({
		compaction: { enabled: false },
	});
	const resourceLoader = new DefaultResourceLoader({
		cwd: snapshot.cwd,
		settingsManager,
		noExtensions: true,
		noSkills: true,
		noPromptTemplates: true,
		noThemes: true,
		agentsFilesOverride: () => ({ agentsFiles: [] }),
		systemPromptOverride: () => snapshot.systemPrompt,
		appendSystemPromptOverride: () => [],
	});
	await resourceLoader.reload();

	const { session } = await createAgentSession({
		cwd: snapshot.cwd,
		model: snapshot.model,
		modelRegistry: snapshot.modelRegistry,
		thinkingLevel: snapshot.thinkingLevel,
		tools: resolveTransientTools(snapshot),
		resourceLoader,
		sessionManager: SessionManager.inMemory(snapshot.cwd),
		settingsManager,
	});
	applyPhiSystemPromptOverride(session, snapshot.systemPrompt);

	try {
		session.agent.replaceMessages(snapshot.messages);
		await session.sendUserMessage(params.prompt);
		return { assistantText: session.getLastAssistantText() };
	} finally {
		session.dispose();
	}
}
