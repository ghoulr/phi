import type { AgentSession } from "@mariozechner/pi-coding-agent";

import {
	buildPhiSystemPrompt,
	type BuildPhiSystemPromptParams,
	type PhiSystemPromptTool,
} from "./prompt";
import { applyPhiSystemPromptOverride } from "./override";

interface PhiToolPromptMaps {
	_toolPromptSnippets?: Map<string, string>;
	_toolPromptGuidelines?: Map<string, string[]>;
}

export interface InstallPhiSystemPromptParams
	extends Omit<BuildPhiSystemPromptParams, "tools"> {
	session: AgentSession;
}

function resolvePromptTools(
	session: AgentSession,
	toolNames: string[]
): PhiSystemPromptTool[] {
	const promptMaps = session as unknown as PhiToolPromptMaps;
	return toolNames.map((name) => ({
		name,
		promptSnippet: promptMaps._toolPromptSnippets?.get(name),
		promptGuidelines: promptMaps._toolPromptGuidelines?.get(name),
	}));
}

export function installPhiSystemPrompt(
	params: InstallPhiSystemPromptParams
): string {
	const buildPrompt = (toolNames: string[]): string =>
		buildPhiSystemPrompt({
			assistantName: params.assistantName,
			workspacePath: params.workspacePath,
			skills: params.skills,
			memoryFilePath: params.memoryFilePath,
			tools: resolvePromptTools(params.session, toolNames),
			includeWorkspaceConfigGuidance:
				params.includeWorkspaceConfigGuidance,
		});
	const systemPrompt = buildPrompt(params.session.getActiveToolNames());
	applyPhiSystemPromptOverride(params.session, buildPrompt);
	return systemPrompt;
}
