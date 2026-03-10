import type { AgentSession } from "@mariozechner/pi-coding-agent";

import {
	buildPhiSystemPrompt,
	type BuildPhiSystemPromptParams,
} from "./prompt";
import { applyPhiSystemPromptOverride } from "./override";

export interface InstallPhiSystemPromptParams
	extends BuildPhiSystemPromptParams {
	session: AgentSession;
}

export function installPhiSystemPrompt(
	params: InstallPhiSystemPromptParams
): string {
	const systemPrompt = buildPhiSystemPrompt(params);
	applyPhiSystemPromptOverride(params.session, systemPrompt);
	return systemPrompt;
}
