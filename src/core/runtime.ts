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
import { getPhiSharedAuthFilePath } from "@phi/core/paths";
import { resolveExistingPhiPiAgentDir } from "@phi/core/pi-agent-dir";
import { resolvePhiSkillPaths } from "@phi/core/skills";
import { createPhiMemoryMaintenanceExtension } from "@phi/extensions/memory-maintenance";
import { installPhiSystemPrompt } from "@phi/extensions/system-prompt";
import {
	registerPhiMessagingSessionState,
	type PhiMessagingSessionState,
} from "@phi/messaging/session-state";

export {
	ChatSessionPool,
	type ChatSessionFactory,
	type ChatSessionRuntime,
	type DisposableSession,
} from "@phi/core/chat-pool";

const DEFAULT_PROMPT_TOOL_NAMES = ["read", "bash", "edit", "write"];

export interface CreatePhiAgentSessionOptions {
	sessionManager?: SessionManager;
	customTools?: ToolDefinition[];
	extensionFactories?: ExtensionFactory[];
	additionalPromptToolNames?: string[];
	eventText?: string;
	messagingState?: PhiMessagingSessionState;
}

export interface PhiRuntimeDependencies {
	getCustomTools?(chatId: string): ToolDefinition[];
	getExtensionFactories?(chatId: string): ExtensionFactory[];
	getAdditionalPromptToolNames?(chatId: string): string[];
	getEventText?(chatId: string): string | undefined;
}

interface ResolvedPhiSessionContext {
	agentDir: string;
	agentConfig: ReturnType<typeof resolveAgentRuntimeConfig>;
	authStorage: AuthStorage;
	modelRegistry: ModelRegistry;
	model: NonNullable<AgentSession["model"]>;
	chatWorkspaceDir: string;
	chatWorkspaceLayout: ReturnType<typeof ensureChatWorkspaceLayout>;
	resourceLoader: DefaultResourceLoader;
}

async function createPhiResourceLoader(params: {
	cwd: string;
	agentDir: string;
	userHomeDir?: string;
	extensionFactories?: ExtensionFactory[];
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
			...(params.extensionFactories ?? []),
		],
		agentsFilesOverride: () => ({ agentsFiles: [] }),
	});
	await resourceLoader.reload();
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
		extensionFactories: options.extensionFactories,
	});

	return {
		agentDir,
		agentConfig,
		authStorage,
		modelRegistry,
		model,
		chatWorkspaceDir,
		chatWorkspaceLayout,
		resourceLoader,
	};
}

function buildPromptToolNames(
	customTools: ToolDefinition[] | undefined,
	additionalToolNames: string[] | undefined
): string[] {
	return Array.from(
		new Set([
			...DEFAULT_PROMPT_TOOL_NAMES,
			...(customTools ?? []).map((tool) => tool.name),
			...(additionalToolNames ?? []),
		])
	);
}

export async function createPhiAgentSession(
	chatId: string,
	phiConfig: PhiConfig,
	options: CreatePhiAgentSessionOptions = {}
): Promise<AgentSession> {
	const context = await resolvePhiSessionContext(chatId, phiConfig, {
		extensionFactories: options.extensionFactories,
	});

	const { session } = await createAgentSession({
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

	installPhiSystemPrompt({
		session,
		assistantName: "Phi",
		workspacePath: context.chatWorkspaceDir,
		skills: context.resourceLoader.getSkills().skills,
		memoryFilePath: context.chatWorkspaceLayout.memoryFilePath,
		toolNames: buildPromptToolNames(
			options.customTools,
			options.additionalPromptToolNames
		),
		eventText: options.eventText,
	});
	if (options.messagingState) {
		registerPhiMessagingSessionState(session, options.messagingState);
	}
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
		additionalPromptToolNames:
			dependencies.getAdditionalPromptToolNames?.(chatId) ?? [],
		eventText: dependencies.getEventText?.(chatId),
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
