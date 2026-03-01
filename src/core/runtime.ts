import { existsSync } from "node:fs";
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
	AgentPool,
	type AgentSessionFactory,
	type DisposableSession,
} from "@phi/core/agent-pool";
import { resolveAgentRuntimeConfig, type PhiConfig } from "@phi/core/config";

export {
	AgentPool,
	ConversationRuntime,
	type AgentConversationRuntime,
	type AgentSessionFactory,
	type DisposableSession,
	type SessionFactory,
} from "@phi/core/agent-pool";

const AGENT_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;

function encodeConversationKey(conversationKey: string): string {
	if (conversationKey.length === 0) {
		throw new Error("Conversation key must not be empty.");
	}
	return Buffer.from(conversationKey, "utf-8").toString("base64url");
}

function getConversationSessionsDir(
	sessionsDir: string,
	conversationKey: string
): string {
	return join(sessionsDir, encodeConversationKey(conversationKey));
}

export interface AgentWorkspace {
	agentId: string;
	phiDir: string;
	phiConfigFilePath: string;
	agentRootDir: string;
	piAgentDir: string;
	sessionsDir: string;
	sharedAuthFilePath: string;
}

export interface AgentResourceProvider {
	resolveAgentWorkspace(
		agentId: string,
		cwd?: string,
		userHomeDir?: string
	): AgentWorkspace;
}

export class PhiRuntime<
	TSession extends DisposableSession,
> extends AgentPool<TSession> {}

function assertValidAgentId(agentId: string): void {
	if (!AGENT_ID_PATTERN.test(agentId)) {
		throw new Error(`Invalid agent id: ${agentId}`);
	}
}

function getPhiHomeDir(userHomeDir: string = homedir()): string {
	return join(userHomeDir, ".phi");
}

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

export class FileSystemResourceProvider implements AgentResourceProvider {
	public resolveAgentWorkspace(
		agentId: string,
		_cwd: string = process.cwd(),
		userHomeDir: string = homedir()
	): AgentWorkspace {
		assertValidAgentId(agentId);

		const phiDir = getPhiHomeDir(userHomeDir);
		const phiConfigFilePath = join(phiDir, "phi.yaml");
		if (!existsSync(phiConfigFilePath)) {
			throw new Error(`Missing phi config file: ${phiConfigFilePath}`);
		}

		const agentRootDir = join(phiDir, "agents", agentId);
		if (!existsSync(agentRootDir)) {
			throw new Error(`Unknown agent workspace: ${agentRootDir}`);
		}

		const piAgentDir = join(agentRootDir, "pi");
		if (!existsSync(piAgentDir)) {
			throw new Error(`Missing pi workspace directory: ${piAgentDir}`);
		}

		return {
			agentId,
			phiDir,
			phiConfigFilePath,
			agentRootDir,
			piAgentDir,
			sessionsDir: join(agentRootDir, "sessions"),
			sharedAuthFilePath: join(phiDir, "auth", "auth.json"),
		};
	}
}

async function createPhiResourceLoader(
	agentId: string,
	resourceProvider: AgentResourceProvider,
	cwd: string = process.cwd(),
	userHomeDir: string = homedir()
): Promise<DefaultResourceLoader> {
	const workspace = resourceProvider.resolveAgentWorkspace(
		agentId,
		cwd,
		userHomeDir
	);
	const resourceLoader = new DefaultResourceLoader({
		cwd,
		agentDir: workspace.piAgentDir,
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
	agentId: string,
	conversationKey: string,
	phiConfig: PhiConfig
): Promise<AgentSession> {
	const cwd = process.cwd();
	const userHomeDir = homedir();
	const resourceProvider = new FileSystemResourceProvider();
	const workspace = resourceProvider.resolveAgentWorkspace(
		agentId,
		cwd,
		userHomeDir
	);

	const agentConfig = resolveAgentRuntimeConfig(phiConfig, agentId);
	const authStorage = AuthStorage.create(workspace.sharedAuthFilePath);
	const modelRegistry = new ModelRegistry(
		authStorage,
		join(workspace.piAgentDir, "models.json")
	);
	const model = modelRegistry.find(agentConfig.provider, agentConfig.model);
	if (!model) {
		throw new Error(
			`Unknown model for agent ${agentId}: ${agentConfig.provider}/${agentConfig.model}`
		);
	}

	const conversationSessionsDir = getConversationSessionsDir(
		workspace.sessionsDir,
		conversationKey
	);

	const { session } = await createAgentSession({
		cwd,
		agentDir: workspace.piAgentDir,
		authStorage,
		modelRegistry,
		model,
		thinkingLevel: agentConfig.thinkingLevel,
		sessionManager: SessionManager.continueRecent(
			cwd,
			conversationSessionsDir
		),
		resourceLoader: await createPhiResourceLoader(
			agentId,
			resourceProvider,
			cwd,
			userHomeDir
		),
	});
	return session;
}

export function createPhiRuntime(
	phiConfig: PhiConfig,
	sessionFactory: AgentSessionFactory<AgentSession> = (
		agentId: string,
		conversationKey: string
	) => createDefaultAgentSession(agentId, conversationKey, phiConfig)
): PhiRuntime<AgentSession> {
	return new PhiRuntime<AgentSession>(sessionFactory);
}
