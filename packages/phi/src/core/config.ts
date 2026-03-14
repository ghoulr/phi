import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";

import { parse } from "yaml";

import { resolveChatWorkspaceDirectory } from "@phi/core/chat-workspace";
import { getPhiConfigFilePath } from "@phi/core/paths";
import { isRecord } from "@phi/core/type-guards";

export type PhiThinkingLevel =
	| "off"
	| "minimal"
	| "low"
	| "medium"
	| "high"
	| "xhigh";

export interface PhiAgentConfig {
	enabled?: boolean;
	provider?: string;
	model?: string;
	thinkingLevel?: PhiThinkingLevel;
}

export interface TelegramSessionRouteConfig {
	enabled?: boolean;
	id: number | string;
	token: string;
}

export interface FeishuSessionRouteConfig {
	enabled?: boolean;
	id: string;
	appId: string;
	appSecret: string;
}

export interface PhiSessionRoutesConfig {
	telegram?: TelegramSessionRouteConfig;
	feishu?: FeishuSessionRouteConfig;
}

export interface PhiChatConfig {
	workspace: string;
}

export interface PhiSessionConfig {
	chat: string;
	agent: string;
	routes?: PhiSessionRoutesConfig;
	cron?: boolean;
}

export interface PhiConfig {
	agents?: Record<string, PhiAgentConfig>;
	chats?: Record<string, PhiChatConfig>;
	sessions?: Record<string, PhiSessionConfig>;
}

export interface ResolvedTelegramSessionServiceConfig {
	sessionId: string;
	chatId: string;
	workspace: string;
	telegramChatId: string;
	token: string;
}

export interface ResolvedFeishuSessionServiceConfig {
	sessionId: string;
	chatId: string;
	workspace: string;
	feishuChatId: string;
	appId: string;
	appSecret: string;
}

export interface ResolvedCronSessionServiceConfig {
	sessionId: string;
	chatId: string;
	workspace: string;
}

export interface ResolvedAgentRuntimeConfig {
	agentId: string;
	provider: string;
	model: string;
	thinkingLevel: PhiThinkingLevel;
}

export interface ResolvedChatRuntimeConfig {
	chatId: string;
	workspace: string;
}

export interface ResolvedSessionRuntimeConfig {
	sessionId: string;
	chatId: string;
	workspace: string;
	agentId: string;
}

const THINKING_LEVEL_SET = new Set<PhiThinkingLevel>([
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
]);

function toNonEmptyString(value: unknown, errorMessage: string): string {
	if (typeof value !== "string" || value.length === 0) {
		throw new Error(errorMessage);
	}
	return value;
}

function toTelegramChatId(value: unknown, errorMessage: string): string {
	if (typeof value === "number") {
		return String(value);
	}
	if (typeof value === "string" && value.length > 0) {
		return value;
	}
	throw new Error(errorMessage);
}

function resolveChatRuntimeConfigFromEntry(
	chatId: string,
	chatConfig: PhiChatConfig
): ResolvedChatRuntimeConfig {
	return {
		chatId,
		workspace: toNonEmptyString(
			chatConfig.workspace,
			`Invalid chat configuration for ${chatId}: missing workspace`
		),
	};
}

function resolveSessionRuntimeConfigFromEntry(params: {
	phiConfig: PhiConfig;
	sessionId: string;
	sessionConfig: PhiSessionConfig;
}): ResolvedSessionRuntimeConfig {
	const chatId = toNonEmptyString(
		params.sessionConfig.chat,
		`Invalid session configuration for ${params.sessionId}: missing chat`
	);
	const chatConfig = params.phiConfig.chats?.[chatId];
	if (!chatConfig) {
		throw new Error(
			`Missing chat configuration for session ${params.sessionId}: ${chatId}`
		);
	}
	const resolvedChat = resolveChatRuntimeConfigFromEntry(chatId, chatConfig);
	return {
		sessionId: params.sessionId,
		chatId,
		workspace: resolvedChat.workspace,
		agentId: toNonEmptyString(
			params.sessionConfig.agent,
			`Invalid session configuration for ${params.sessionId}: missing agent`
		),
	};
}

export function getDefaultPhiConfigFilePath(
	userHomeDir: string = homedir()
): string {
	return getPhiConfigFilePath(userHomeDir);
}

export function loadPhiConfig(configFilePath: string): PhiConfig {
	if (!existsSync(configFilePath)) {
		throw new Error(`Missing phi config file: ${configFilePath}`);
	}

	const fileContent = readFileSync(configFilePath, "utf-8");
	const rawConfig = parse(fileContent);
	if (rawConfig === undefined || rawConfig === null) {
		return {};
	}
	if (!isRecord(rawConfig)) {
		throw new Error(
			`Invalid phi config format: root must be a mapping (${configFilePath})`
		);
	}

	return rawConfig as PhiConfig;
}

export function assertUniqueChatWorkspaces(
	phiConfig: PhiConfig,
	userHomeDir: string = homedir()
): void {
	const chats = phiConfig.chats;
	if (!chats) {
		throw new Error("Missing chats configuration in phi config.");
	}

	const workspaceOwners = new Map<string, string>();
	for (const [chatId, chatConfig] of Object.entries(chats)) {
		const resolvedChat = resolveChatRuntimeConfigFromEntry(
			chatId,
			chatConfig
		);
		const resolvedWorkspace = resolveChatWorkspaceDirectory(
			resolvedChat.workspace,
			userHomeDir
		);
		const existingChatId = workspaceOwners.get(resolvedWorkspace);
		if (existingChatId) {
			throw new Error(
				`Chats ${existingChatId} and ${chatId} resolve to the same workspace: ${resolvedWorkspace}`
			);
		}
		workspaceOwners.set(resolvedWorkspace, chatId);
	}
}

export function collectTelegramSessionServiceConfigs(
	phiConfig: PhiConfig
): ResolvedTelegramSessionServiceConfig[] {
	assertUniqueChatWorkspaces(phiConfig);

	const sessions = phiConfig.sessions;
	if (!sessions) {
		throw new Error("Missing sessions configuration in phi config.");
	}

	const entries: ResolvedTelegramSessionServiceConfig[] = [];
	for (const [sessionId, sessionConfig] of Object.entries(sessions)) {
		const telegramRoute = sessionConfig.routes?.telegram;
		if (!telegramRoute || telegramRoute.enabled === false) {
			continue;
		}

		const resolvedSession = resolveSessionRuntimeConfigFromEntry({
			phiConfig,
			sessionId,
			sessionConfig,
		});
		entries.push({
			sessionId,
			chatId: resolvedSession.chatId,
			workspace: resolvedSession.workspace,
			telegramChatId: toTelegramChatId(
				telegramRoute.id,
				`Invalid telegram route for session ${sessionId}: missing id`
			),
			token: toNonEmptyString(
				telegramRoute.token,
				`Invalid telegram route for session ${sessionId}: missing token`
			),
		});
	}

	return entries;
}

export function collectFeishuSessionServiceConfigs(
	phiConfig: PhiConfig
): ResolvedFeishuSessionServiceConfig[] {
	assertUniqueChatWorkspaces(phiConfig);

	const sessions = phiConfig.sessions;
	if (!sessions) {
		throw new Error("Missing sessions configuration in phi config.");
	}

	const entries: ResolvedFeishuSessionServiceConfig[] = [];
	for (const [sessionId, sessionConfig] of Object.entries(sessions)) {
		const feishuRoute = sessionConfig.routes?.feishu;
		if (!feishuRoute || feishuRoute.enabled === false) {
			continue;
		}

		const resolvedSession = resolveSessionRuntimeConfigFromEntry({
			phiConfig,
			sessionId,
			sessionConfig,
		});
		entries.push({
			sessionId,
			chatId: resolvedSession.chatId,
			workspace: resolvedSession.workspace,
			feishuChatId: toNonEmptyString(
				feishuRoute.id,
				`Invalid feishu route for session ${sessionId}: missing id`
			),
			appId: toNonEmptyString(
				feishuRoute.appId,
				`Invalid feishu route for session ${sessionId}: missing appId`
			),
			appSecret: toNonEmptyString(
				feishuRoute.appSecret,
				`Invalid feishu route for session ${sessionId}: missing appSecret`
			),
		});
	}

	return entries;
}

export function resolveCronSessionServiceConfigs(
	phiConfig: PhiConfig
): ResolvedCronSessionServiceConfig[] {
	assertUniqueChatWorkspaces(phiConfig);

	const sessions = phiConfig.sessions;
	if (!sessions) {
		throw new Error("Missing sessions configuration in phi config.");
	}

	const entries: ResolvedCronSessionServiceConfig[] = [];
	const chatOwners = new Map<string, string>();
	for (const [sessionId, sessionConfig] of Object.entries(sessions)) {
		if (sessionConfig.cron !== true) {
			continue;
		}
		const resolvedSession = resolveSessionRuntimeConfigFromEntry({
			phiConfig,
			sessionId,
			sessionConfig,
		});
		const existingSessionId = chatOwners.get(resolvedSession.chatId);
		if (existingSessionId) {
			throw new Error(
				`Duplicate cron session for chat ${resolvedSession.chatId}: ${existingSessionId} and ${sessionId}`
			);
		}
		chatOwners.set(resolvedSession.chatId, sessionId);
		entries.push({
			sessionId,
			chatId: resolvedSession.chatId,
			workspace: resolvedSession.workspace,
		});
	}
	return entries;
}

export function resolveEnabledSessionRouteKeys(
	phiConfig: PhiConfig,
	sessionId: string
): string[] {
	const sessionConfig = phiConfig.sessions?.[sessionId];
	if (!sessionConfig) {
		throw new Error(
			`Missing session configuration for session id: ${sessionId}`
		);
	}
	const routes = sessionConfig.routes;
	if (!routes || !isRecord(routes)) {
		return [];
	}
	return Object.entries(routes)
		.filter(([, routeConfig]) => {
			if (!isRecord(routeConfig)) {
				return false;
			}
			return routeConfig.enabled !== false;
		})
		.map(([routeKey]) => routeKey);
}

export function resolveChatRuntimeConfig(
	phiConfig: PhiConfig,
	chatId: string
): ResolvedChatRuntimeConfig {
	assertUniqueChatWorkspaces(phiConfig);

	const chats = phiConfig.chats;
	if (!chats) {
		throw new Error("Missing chats configuration in phi config.");
	}

	const chatConfig = chats[chatId];
	if (!chatConfig) {
		throw new Error(`Missing chat configuration for chat id: ${chatId}`);
	}

	return resolveChatRuntimeConfigFromEntry(chatId, chatConfig);
}

export function resolveSessionRuntimeConfig(
	phiConfig: PhiConfig,
	sessionId: string
): ResolvedSessionRuntimeConfig {
	assertUniqueChatWorkspaces(phiConfig);

	const sessions = phiConfig.sessions;
	if (!sessions) {
		throw new Error("Missing sessions configuration in phi config.");
	}

	const sessionConfig = sessions[sessionId];
	if (!sessionConfig) {
		throw new Error(
			`Missing session configuration for session id: ${sessionId}`
		);
	}

	return resolveSessionRuntimeConfigFromEntry({
		phiConfig,
		sessionId,
		sessionConfig,
	});
}

export function resolveAgentRuntimeConfig(
	phiConfig: PhiConfig,
	agentId: string
): ResolvedAgentRuntimeConfig {
	const agents = phiConfig.agents;
	if (!agents) {
		throw new Error("Missing agents configuration in phi config.");
	}

	const agentConfig = agents[agentId];
	if (!agentConfig) {
		throw new Error(`Missing agent configuration for agent id: ${agentId}`);
	}
	if (agentConfig.enabled === false) {
		throw new Error(`Agent is disabled in phi config: ${agentId}`);
	}
	if (!agentConfig.provider) {
		throw new Error(
			`Invalid agent configuration for ${agentId}: missing provider`
		);
	}
	if (!agentConfig.model) {
		throw new Error(
			`Invalid agent configuration for ${agentId}: missing model`
		);
	}

	const thinkingLevel = agentConfig.thinkingLevel ?? "medium";
	if (!THINKING_LEVEL_SET.has(thinkingLevel)) {
		throw new Error(
			`Invalid agent configuration for ${agentId}: invalid thinkingLevel ${thinkingLevel}`
		);
	}

	return {
		agentId,
		provider: agentConfig.provider,
		model: agentConfig.model,
		thinkingLevel,
	};
}
