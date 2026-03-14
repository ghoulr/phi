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

export interface TelegramChatRouteConfig {
	enabled?: boolean;
	id: number | string;
	token: string;
}

export interface PhiChatRoutesConfig {
	telegram?: TelegramChatRouteConfig;
}

export interface PhiChatConfig {
	workspace: string;
	agent: string;
	routes?: PhiChatRoutesConfig;
}

export interface PhiConfig {
	agents?: Record<string, PhiAgentConfig>;
	chats?: Record<string, PhiChatConfig>;
}

export interface ResolvedTelegramChatServiceConfig {
	chatId: string;
	workspace: string;
	telegramChatId: string;
	token: string;
}

export interface ResolvedCronChatServiceConfig {
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
		agentId: toNonEmptyString(
			chatConfig.agent,
			`Invalid chat configuration for ${chatId}: missing agent`
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

export function collectTelegramChatServiceConfigs(
	phiConfig: PhiConfig
): ResolvedTelegramChatServiceConfig[] {
	assertUniqueChatWorkspaces(phiConfig);

	const chats = phiConfig.chats;
	if (!chats) {
		throw new Error("Missing chats configuration in phi config.");
	}

	const entries: ResolvedTelegramChatServiceConfig[] = [];
	for (const [chatId, chatConfig] of Object.entries(chats)) {
		const telegramRoute = chatConfig.routes?.telegram;
		if (!telegramRoute || telegramRoute.enabled === false) {
			continue;
		}

		const resolvedChat = resolveChatRuntimeConfigFromEntry(
			chatId,
			chatConfig
		);
		entries.push({
			chatId,
			workspace: resolvedChat.workspace,
			telegramChatId: toTelegramChatId(
				telegramRoute.id,
				`Invalid telegram route for chat ${chatId}: missing id`
			),
			token: toNonEmptyString(
				telegramRoute.token,
				`Invalid telegram route for chat ${chatId}: missing token`
			),
		});
	}

	return entries;
}

export function resolveCronChatServiceConfigs(
	phiConfig: PhiConfig
): ResolvedCronChatServiceConfig[] {
	assertUniqueChatWorkspaces(phiConfig);

	const chats = phiConfig.chats;
	if (!chats) {
		throw new Error("Missing chats configuration in phi config.");
	}

	return Object.entries(chats).map(([chatId, chatConfig]) => {
		const resolvedChat = resolveChatRuntimeConfigFromEntry(
			chatId,
			chatConfig
		);
		return {
			chatId: resolvedChat.chatId,
			workspace: resolvedChat.workspace,
		};
	});
}

export function resolveEnabledChatRouteKeys(
	phiConfig: PhiConfig,
	chatId: string
): string[] {
	const chatConfig = phiConfig.chats?.[chatId];
	if (!chatConfig) {
		throw new Error(`Missing chat configuration for chat id: ${chatId}`);
	}
	const routes = chatConfig.routes;
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
