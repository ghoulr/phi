import { homedir } from "node:os";
import { join } from "node:path";

import {
	AuthStorage,
	createAgentSession,
	DefaultResourceLoader,
	InteractiveMode,
	ModelRegistry,
	SessionManager,
	type AgentSession,
} from "@mariozechner/pi-coding-agent";

import { ensureChatWorkspaceLayout } from "@phi/core/chat-workspace";
import { getPhiSharedAuthFilePath } from "@phi/core/paths";
import { resolveExistingPhiPiAgentDir } from "@phi/core/pi-agent-dir";
import { resolvePhiSkillPaths } from "@phi/core/skills";
import { createPhiMemoryMaintenanceExtension } from "@phi/core/memory-maintenance";
import { applyPhiSystemPromptOverride } from "@phi/core/system-prompt-override";
import { buildPhiSystemPrompt } from "@phi/core/system-prompt";

export type TuiModeRunner = (session: AgentSession) => Promise<void>;
export type TuiSessionFactory = () => Promise<AgentSession>;

const DEFAULT_PROMPT_TOOL_NAMES = ["read", "bash", "edit", "write"];

function getTuiSessionsDir(agentDir: string): string {
	return join(agentDir, "sessions");
}

export async function createDefaultTuiSession(
	cwd: string = process.cwd(),
	userHomeDir: string = homedir()
): Promise<AgentSession> {
	const workspaceLayout = ensureChatWorkspaceLayout(cwd);
	const agentDir = resolveExistingPhiPiAgentDir(userHomeDir);
	const authStorage = AuthStorage.create(
		getPhiSharedAuthFilePath(userHomeDir)
	);
	const modelRegistry = new ModelRegistry(
		authStorage,
		join(agentDir, "models.json")
	);
	const resourceLoader = new DefaultResourceLoader({
		cwd,
		agentDir,
		noSkills: true,
		additionalSkillPaths: resolvePhiSkillPaths({
			workspaceDir: cwd,
			userHomeDir,
		}),
		extensionFactories: [createPhiMemoryMaintenanceExtension()],
		agentsFilesOverride: () => ({ agentsFiles: [] }),
	});
	await resourceLoader.reload();

	const { session } = await createAgentSession({
		cwd,
		agentDir,
		authStorage,
		modelRegistry,
		sessionManager: SessionManager.continueRecent(
			cwd,
			getTuiSessionsDir(agentDir)
		),
		resourceLoader,
	});
	applyPhiSystemPromptOverride(
		session,
		buildPhiSystemPrompt({
			assistantName: "Phi",
			workspacePath: cwd,
			skills: resourceLoader.getSkills().skills,
			memoryFilePath: workspaceLayout.memoryFilePath,
			toolNames: DEFAULT_PROMPT_TOOL_NAMES,
		})
	);
	return session;
}

export async function runInteractiveTui(session: AgentSession): Promise<void> {
	const mode = new InteractiveMode(session);
	await mode.run();
}

export async function runTuiCommand(
	createSession: TuiSessionFactory = () => createDefaultTuiSession(),
	runMode: TuiModeRunner = runInteractiveTui
): Promise<void> {
	const session = await createSession();
	try {
		await runMode(session);
	} finally {
		session.dispose();
	}
}
