import { homedir } from "node:os";
import { join } from "node:path";

import {
	AuthStorage,
	createAgentSession,
	DefaultResourceLoader,
	ModelRegistry,
	type AgentSession,
	SessionManager,
} from "@mariozechner/pi-coding-agent";

import {
	ChatSessionPool,
	type ChatSessionFactory,
	type DisposableSession,
} from "@phi/core/chat-pool";
import {
	ensureChatWorkspaceLayout,
	resolveChatWorkspaceDirectory,
} from "@phi/core/chat-workspace";
import {
	resolveAgentRuntimeConfig,
	resolveChatRuntimeConfig,
	type PhiConfig,
} from "@phi/core/config";
import { getPhiSharedAuthFilePath } from "@phi/core/paths";
import { resolveExistingPhiPiAgentDir } from "@phi/core/pi-agent-dir";
import { resolvePhiSkillPaths } from "@phi/core/skills";
import { createPhiMemoryMaintenanceExtension } from "@phi/extensions/memory-maintenance";
import { installPhiSystemPrompt } from "@phi/extensions/system-prompt";

export {
	ChatSessionPool,
	type ChatSessionFactory,
	type ChatSessionRuntime,
	type DisposableSession,
} from "@phi/core/chat-pool";

const DEFAULT_PROMPT_TOOL_NAMES = ["read", "bash", "edit", "write"];

async function createPhiResourceLoader(params: {
	cwd: string;
	agentDir: string;
	userHomeDir?: string;
}): Promise<DefaultResourceLoader> {
	const userHomeDir = params.userHomeDir ?? homedir();
	const resourceLoader = new DefaultResourceLoader({
		cwd: params.cwd,
		agentDir: params.agentDir,
		noSkills: true,
		additionalSkillPaths: resolvePhiSkillPaths({
			workspaceDir: params.cwd,
			userHomeDir,
		}),
		extensionFactories: [
			createPhiMemoryMaintenanceExtension({
				memoryFilePath: ".phi/memory/MEMORY.md",
			}),
		],
		agentsFilesOverride: () => ({ agentsFiles: [] }),
	});
	await resourceLoader.reload();
	return resourceLoader;
}

async function createDefaultAgentSession(
	chatId: string,
	phiConfig: PhiConfig
): Promise<AgentSession> {
	const userHomeDir = homedir();
	const chatConfig = resolveChatRuntimeConfig(phiConfig, chatId);
	const chatWorkspaceDir = resolveChatWorkspaceDirectory(
		chatConfig.workspace,
		userHomeDir
	);
	const chatWorkspaceLayout = ensureChatWorkspaceLayout(chatWorkspaceDir);

	const agentDir = resolveExistingPhiPiAgentDir(userHomeDir);
	const agentConfig = resolveAgentRuntimeConfig(
		phiConfig,
		chatConfig.agentId
	);
	const authStorage = AuthStorage.create(
		getPhiSharedAuthFilePath(userHomeDir)
	);
	const modelRegistry = new ModelRegistry(
		authStorage,
		join(agentDir, "models.json")
	);
	const model = modelRegistry.find(agentConfig.provider, agentConfig.model);
	if (!model) {
		throw new Error(
			`Unknown model for agent ${chatConfig.agentId}: ${agentConfig.provider}/${agentConfig.model}`
		);
	}

	const resourceLoader = await createPhiResourceLoader({
		cwd: chatWorkspaceDir,
		agentDir,
		userHomeDir,
	});

	const { session } = await createAgentSession({
		cwd: chatWorkspaceDir,
		agentDir,
		authStorage,
		modelRegistry,
		model,
		thinkingLevel: agentConfig.thinkingLevel,
		sessionManager: SessionManager.continueRecent(
			chatWorkspaceDir,
			chatWorkspaceLayout.sessionsDir
		),
		resourceLoader,
	});

	installPhiSystemPrompt({
		session,
		assistantName: "Phi",
		workspacePath: chatWorkspaceDir,
		skills: resourceLoader.getSkills().skills,
		memoryFilePath: chatWorkspaceLayout.memoryFilePath,
		toolNames: DEFAULT_PROMPT_TOOL_NAMES,
	});
	return session;
}

export class PhiRuntime<
	TSession extends DisposableSession,
> extends ChatSessionPool<TSession> {}

export function createPhiRuntime(
	phiConfig: PhiConfig,
	sessionFactory: ChatSessionFactory<AgentSession> = (chatId: string) =>
		createDefaultAgentSession(chatId, phiConfig)
): PhiRuntime<AgentSession> {
	return new PhiRuntime<AgentSession>(sessionFactory);
}
