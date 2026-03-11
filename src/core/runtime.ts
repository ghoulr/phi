import { homedir } from "node:os";
import { join } from "node:path";

import {
	AuthStorage,
	createAgentSession,
	DefaultResourceLoader,
	type ExtensionFactory,
	ModelRegistry,
	type AgentSession,
	SessionManager,
	type ToolDefinition,
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
import {
	createEnabledPhiOwnedExtensionFactories,
	PHI_MEMORY_MAINTENANCE_EXTENSION_ID,
} from "@phi/core/phi-extensions";
import {
	loadPhiWorkspaceConfig,
	resolveWorkspaceDisabledExtensionIds,
} from "@phi/core/workspace-config";
import { installPhiSystemPrompt } from "@phi/core/system-prompt";
import { createPhiMemoryMaintenanceExtension } from "@phi/extensions/memory-maintenance";

export {
	ChatSessionPool,
	type ChatSessionFactory,
	type ChatSessionRuntime,
	type DisposableSession,
} from "@phi/core/chat-pool";

const log = getPhiLogger("runtime");

export interface CreatePhiAgentSessionOptions {
	sessionManager?: SessionManager;
	customTools?: ToolDefinition[];
	extensionFactories?: ExtensionFactory[];
	printSystemPrompt?: boolean;
}

export interface PhiRuntimeDependencies {
	getCustomTools?(chatId: string): ToolDefinition[];
	getExtensionFactories?(chatId: string): ExtensionFactory[];
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
}

async function createPhiResourceLoader(params: {
	cwd: string;
	agentDir: string;
	userHomeDir?: string;
	disabledExtensionIds: readonly string[];
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
		...createEnabledPhiOwnedExtensionFactories({
			disabledExtensionIds: params.disabledExtensionIds,
			definitions: [
				{
					id: PHI_MEMORY_MAINTENANCE_EXTENSION_ID,
					create: () =>
						createPhiMemoryMaintenanceExtension({
							memoryFilePath: ".phi/memory/MEMORY.md",
						}),
				},
			],
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
	chatId: string,
	phiConfig: PhiConfig,
	options: Pick<CreatePhiAgentSessionOptions, "extensionFactories">
): Promise<ResolvedPhiSessionContext> {
	const userHomeDir = homedir();
	const chatConfig = resolveChatRuntimeConfig(phiConfig, chatId);
	const chatWorkspaceDir = resolveChatWorkspaceDirectory(
		chatConfig.workspace,
		userHomeDir
	);
	const chatWorkspaceLayout = ensureChatWorkspaceLayout(chatWorkspaceDir);
	const workspaceConfig = loadPhiWorkspaceConfig(
		chatWorkspaceLayout.configFilePath
	);
	const disabledExtensionIds = resolveWorkspaceDisabledExtensionIds(
		workspaceConfig,
		chatWorkspaceLayout.configFilePath
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

	const resourceLoader = await createPhiResourceLoader({
		cwd: chatWorkspaceDir,
		agentDir,
		userHomeDir,
		disabledExtensionIds,
		extensionFactories: options.extensionFactories,
	});
	log.info("runtime.session_context.resolved", {
		chatId,
		workspaceDir: chatWorkspaceDir,
		agentId: chatConfig.agentId,
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
	};
}

function getSessionToolNames(session: AgentSession): string[] {
	return session.getAllTools().map((tool) => tool.name);
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
	chatId: string,
	phiConfig: PhiConfig,
	options: CreatePhiAgentSessionOptions = {}
): Promise<AgentSession> {
	log.info("runtime.session.creating", {
		chatId,
		customToolCount: options.customTools?.length ?? 0,
		extensionFactoryCount: options.extensionFactories?.length ?? 0,
	});
	const context = await resolvePhiSessionContext(chatId, phiConfig, {
		extensionFactories: options.extensionFactories,
	});

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
				options.sessionManager ??
				SessionManager.continueRecent(
					context.chatWorkspaceDir,
					context.chatWorkspaceLayout.sessionsDir
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
		chatId,
		workspaceDir: context.chatWorkspaceDir,
		provider: context.agentConfig.provider,
		model: context.agentConfig.model,
	});
	return session;
}

async function createDefaultAgentSession(
	chatId: string,
	phiConfig: PhiConfig,
	dependencies: PhiRuntimeDependencies = {}
): Promise<AgentSession> {
	return await createPhiAgentSession(chatId, phiConfig, {
		customTools: dependencies.getCustomTools?.(chatId) ?? [],
		extensionFactories: dependencies.getExtensionFactories?.(chatId) ?? [],
	});
}

export class PhiRuntime<
	TSession extends DisposableSession,
> extends ChatSessionPool<TSession> {}

export function createPhiRuntime(
	phiConfig: PhiConfig,
	dependencies: PhiRuntimeDependencies = {},
	sessionFactory: ChatSessionFactory<AgentSession> = (chatId: string) =>
		createDefaultAgentSession(chatId, phiConfig, dependencies)
): PhiRuntime<AgentSession> {
	return new PhiRuntime<AgentSession>(sessionFactory);
}
