import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";

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
	ensureChatSessionStorageDir,
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

export {
	ChatSessionPool,
	type ChatSessionFactory,
	type ChatSessionRuntime,
	type DisposableSession,
} from "@phi/core/chat-pool";

function getLegacyAgentsSkillsDir(userHomeDir: string = homedir()): string {
	return join(userHomeDir, ".agents", "skills");
}

function isPathInsideDirectory(path: string, directory: string): boolean {
	const relativePath = relative(resolve(directory), resolve(path));
	return (
		relativePath === "" ||
		(!relativePath.startsWith("..") && !isAbsolute(relativePath))
	);
}

function isSkillFromLegacyAgentsDir(
	skillFilePath: string,
	userHomeDir: string = homedir()
): boolean {
	return isPathInsideDirectory(
		skillFilePath,
		getLegacyAgentsSkillsDir(userHomeDir)
	);
}

async function createPhiResourceLoader(
	cwd: string,
	agentDir: string,
	userHomeDir: string = homedir()
): Promise<DefaultResourceLoader> {
	const resourceLoader = new DefaultResourceLoader({
		cwd,
		agentDir,
		skillsOverride: (base) => ({
			skills: base.skills.filter(
				(skill) =>
					!isSkillFromLegacyAgentsDir(skill.filePath, userHomeDir)
			),
			diagnostics: base.diagnostics,
		}),
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
	const chatSessionStorageDir = ensureChatSessionStorageDir(
		chatWorkspaceLayout.sessionsDir,
		chatId
	);

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

	const { session } = await createAgentSession({
		cwd: chatWorkspaceDir,
		agentDir,
		authStorage,
		modelRegistry,
		model,
		thinkingLevel: agentConfig.thinkingLevel,
		sessionManager: SessionManager.continueRecent(
			chatWorkspaceDir,
			chatSessionStorageDir
		),
		resourceLoader: await createPhiResourceLoader(
			chatWorkspaceDir,
			agentDir,
			userHomeDir
		),
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
