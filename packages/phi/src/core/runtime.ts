import { homedir } from "node:os";
import { join } from "node:path";

import {
	AuthStorage,
	createAgentSession,
	DefaultResourceLoader,
	type ExtensionFactory,
	ModelRegistry,
	SessionManager,
	type AgentSession,
	type ToolDefinition,
} from "@mariozechner/pi-coding-agent";

import {
	SessionPool,
	type SessionFactory,
	type DisposableSession,
} from "@phi/core/session-pool";
import {
	ensureChatWorkspaceLayout,
	resolveChatWorkspaceDirectory,
} from "@phi/core/chat-workspace";
import { ChatSessionManager } from "@phi/core/session-manager";
import {
	resolveAgentRuntimeConfig,
	resolveSessionRuntimeConfig,
	type PhiConfig,
} from "@phi/core/config";
import { getPhiLogger } from "@phi/core/logger";
import { applyInlineExtensionLabels } from "@phi/core/inline-extension-labels";
import {
	applySkillEnvOverrides,
	resolveLoadedSkillEnvOverrides,
} from "@phi/core/skill-env";
import { getPhiSharedAuthFilePath } from "@phi/core/paths";
import { resolveExistingPhiPiAgentDir } from "@phi/core/pi-agent-dir";
import {
	createPhiSkillsOverride,
	resolvePhiSkillPaths,
} from "@phi/core/skills";
import { loadPhiWorkspaceConfig } from "@phi/core/workspace-config";
import { installPhiSystemPrompt } from "@phi/core/system-prompt";
import { createPhiMemoryMaintenanceExtension } from "@phi/extensions/memory-maintenance";

export {
	SessionPool,
	type SessionFactory,
	type SessionRuntime,
	type DisposableSession,
} from "@phi/core/session-pool";

const log = getPhiLogger("runtime");

export interface CreatePhiAgentSessionOptions {
	customTools?: ToolDefinition[];
	extensionFactories?: ExtensionFactory[];
	printSystemPrompt?: boolean;
	persistSession?: boolean;
	sessionConfigId?: string;
}

export interface PhiRuntimeDependencies {
	getCustomTools?(sessionId: string): ToolDefinition[];
	getExtensionFactories?(sessionId: string): ExtensionFactory[];
}

interface ResolvedPhiSessionContext {
	agentDir: string;
	agentConfig: ReturnType<typeof resolveAgentRuntimeConfig>;
	authStorage: AuthStorage;
	modelRegistry: ModelRegistry;
	model: NonNullable<AgentSession["model"]>;
	chatWorkspaceDir: string;
	chatWorkspaceLayout: ReturnType<typeof ensureChatWorkspaceLayout>;
	workspaceConfig: ReturnType<typeof loadPhiWorkspaceConfig>;
	resourceLoader: DefaultResourceLoader;
	chatSessionManager: ChatSessionManager;
	sessionId: string;
}

async function createPhiResourceLoader(params: {
	cwd: string;
	agentDir: string;
	userHomeDir?: string;
	extensionFactories?: ExtensionFactory[];
}): Promise<DefaultResourceLoader> {
	const userHomeDir = params.userHomeDir ?? homedir();
	log.debug("runtime.resource_loader.reloading", {
		workspaceDir: params.cwd,
		agentDir: params.agentDir,
		extensionFactoryCount: params.extensionFactories?.length ?? 0,
	});
	const skillPaths = resolvePhiSkillPaths({
		workspaceDir: params.cwd,
		userHomeDir,
	});
	const extensionFactories = [
		createPhiMemoryMaintenanceExtension({
			memoryFilePath: ".phi/memory/MEMORY.md",
		}),
		...(params.extensionFactories ?? []),
	];
	const resourceLoader = new DefaultResourceLoader({
		cwd: params.cwd,
		agentDir: params.agentDir,
		noSkills: true,
		additionalSkillPaths: skillPaths,
		skillsOverride: createPhiSkillsOverride({
			roots: skillPaths,
		}),
		extensionFactories,
		extensionsOverride: (base) =>
			applyInlineExtensionLabels({
				extensionFactories,
				result: base,
			}),
		agentsFilesOverride: () => ({ agentsFiles: [] }),
	});
	await resourceLoader.reload();
	log.debug("runtime.resource_loader.reloaded", {
		workspaceDir: params.cwd,
		agentDir: params.agentDir,
		skillCount: resourceLoader.getSkills().skills.length,
	});
	return resourceLoader;
}

async function resolvePhiSessionContext(
	sessionId: string,
	phiConfig: PhiConfig,
	chatSessionManagers: Map<string, ChatSessionManager>,
	options: Pick<
		CreatePhiAgentSessionOptions,
		"extensionFactories" | "sessionConfigId"
	>
): Promise<ResolvedPhiSessionContext> {
	const userHomeDir = homedir();
	const sessionConfig = resolveSessionRuntimeConfig(
		phiConfig,
		options.sessionConfigId ?? sessionId
	);
	const chatWorkspaceDir = resolveChatWorkspaceDirectory(
		sessionConfig.workspace,
		userHomeDir
	);
	const chatWorkspaceLayout = ensureChatWorkspaceLayout(chatWorkspaceDir);
	const workspaceConfig = loadPhiWorkspaceConfig(
		chatWorkspaceLayout.configFilePath
	);
	let chatSessionManager = chatSessionManagers.get(sessionConfig.chatId);
	if (!chatSessionManager) {
		chatSessionManager = new ChatSessionManager(chatWorkspaceLayout);
		chatSessionManagers.set(sessionConfig.chatId, chatSessionManager);
	}

	const agentDir = resolveExistingPhiPiAgentDir(userHomeDir);
	const agentConfig = resolveAgentRuntimeConfig(
		phiConfig,
		sessionConfig.agentId
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
			`Unknown model for agent ${sessionConfig.agentId}: ${agentConfig.provider}/${agentConfig.model}`
		);
	}

	const resourceLoader = await createPhiResourceLoader({
		cwd: chatWorkspaceDir,
		agentDir,
		userHomeDir,
		extensionFactories: options.extensionFactories,
	});
	log.info("runtime.session_context.resolved", {
		sessionId,
		chatId: sessionConfig.chatId,
		workspaceDir: chatWorkspaceDir,
		agentId: sessionConfig.agentId,
		provider: agentConfig.provider,
		model: agentConfig.model,
	});

	return {
		agentDir,
		agentConfig,
		authStorage,
		modelRegistry,
		model,
		chatWorkspaceDir,
		chatWorkspaceLayout,
		workspaceConfig,
		resourceLoader,
		chatSessionManager,
		sessionId,
	};
}

function getSessionToolNames(session: AgentSession): string[] {
	return session.getActiveToolNames();
}

function printInjectedSystemPrompt(systemPrompt: string): void {
	console.log(
		[
			"=== PHI SYSTEM PROMPT START ===",
			systemPrompt,
			"=== PHI SYSTEM PROMPT END ===",
		].join("\n")
	);
}

export async function createPhiAgentSession(
	sessionId: string,
	phiConfig: PhiConfig,
	options: CreatePhiAgentSessionOptions = {},
	chatSessionManagers: Map<string, ChatSessionManager> = new Map()
): Promise<AgentSession> {
	log.info("runtime.session.creating", {
		sessionId,
		customToolCount: options.customTools?.length ?? 0,
		extensionFactoryCount: options.extensionFactories?.length ?? 0,
		persistSession: options.persistSession !== false,
	});
	const context = await resolvePhiSessionContext(
		sessionId,
		phiConfig,
		chatSessionManagers,
		{
			extensionFactories: options.extensionFactories,
		}
	);

	const envOverrides = resolveLoadedSkillEnvOverrides({
		skills: context.resourceLoader.getSkills().skills,
		workspaceConfig: context.workspaceConfig,
		configFilePath: context.chatWorkspaceLayout.configFilePath,
	});
	const restoreSkillEnv = applySkillEnvOverrides(envOverrides);

	let session: AgentSession;
	try {
		const created = await createAgentSession({
			cwd: context.chatWorkspaceDir,
			agentDir: context.agentDir,
			authStorage: context.authStorage,
			modelRegistry: context.modelRegistry,
			model: context.model,
			thinkingLevel: context.agentConfig.thinkingLevel,
			sessionManager:
				options.persistSession === false
					? SessionManager.inMemory(context.chatWorkspaceDir)
					: context.chatSessionManager.openPiSession(
							context.sessionId,
							context.agentConfig.agentId
						),
			resourceLoader: context.resourceLoader,
			customTools: options.customTools,
		});
		session = created.session;
	} catch (error) {
		restoreSkillEnv();
		throw error;
	}

	const originalDispose = session.dispose.bind(session);
	session.dispose = (): void => {
		try {
			restoreSkillEnv();
		} finally {
			originalDispose();
		}
	};

	const systemPrompt = installPhiSystemPrompt({
		session,
		assistantName: "Phi",
		workspacePath: context.chatWorkspaceDir,
		skills: context.resourceLoader.getSkills().skills,
		memoryFilePath: context.chatWorkspaceLayout.memoryFilePath,
		toolNames: getSessionToolNames(session),
	});
	if (options.printSystemPrompt) {
		printInjectedSystemPrompt(systemPrompt);
	}
	log.info("runtime.session.created", {
		sessionId,
		workspaceDir: context.chatWorkspaceDir,
		provider: context.agentConfig.provider,
		model: context.agentConfig.model,
	});
	return session;
}

async function createDefaultAgentSession(
	sessionId: string,
	phiConfig: PhiConfig,
	chatSessionManagers: Map<string, ChatSessionManager>,
	dependencies: PhiRuntimeDependencies = {}
): Promise<AgentSession> {
	return await createPhiAgentSession(
		sessionId,
		phiConfig,
		{
			customTools: dependencies.getCustomTools?.(sessionId) ?? [],
			extensionFactories:
				dependencies.getExtensionFactories?.(sessionId) ?? [],
		},
		chatSessionManagers
	);
}

export class PhiRuntime<
	TSession extends DisposableSession,
> extends SessionPool<TSession> {}

export function createPhiRuntime(
	phiConfig: PhiConfig,
	dependencies: PhiRuntimeDependencies = {},
	sessionFactory?: SessionFactory<AgentSession>
): PhiRuntime<AgentSession> {
	const chatSessionManagers = new Map<string, ChatSessionManager>();
	return new PhiRuntime<AgentSession>(
		sessionFactory ??
			((sessionId: string) =>
				createDefaultAgentSession(
					sessionId,
					phiConfig,
					chatSessionManagers,
					dependencies
				))
	);
}
