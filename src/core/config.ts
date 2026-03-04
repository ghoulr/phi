import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";

import { parse } from "yaml";

import { getPhiConfigFilePath } from "@phi/core/paths";

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
	enabled?: boolean;
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

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

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
	if (chatConfig.enabled === false) {
		throw new Error(`Chat is disabled in phi config: ${chatId}`);
	}

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

export function resolveTelegramChatServiceConfigs(
	phiConfig: PhiConfig
): ResolvedTelegramChatServiceConfig[] {
	const chats = phiConfig.chats;
	if (!chats) {
		throw new Error("Missing chats configuration in phi config.");
	}

	const entries: ResolvedTelegramChatServiceConfig[] = [];
	for (const [chatId, chatConfig] of Object.entries(chats)) {
		if (chatConfig.enabled === false) {
			continue;
		}

		const telegramRoute = chatConfig.routes?.telegram;
		if (!telegramRoute || telegramRoute.enabled === false) {
			continue;
		}

		const resolvedChat = resolveChatRuntimeConfigFromEntry(
			chatId,
			chatConfig
		);
		const telegramChatId = toTelegramChatId(
			telegramRoute.id,
			`Invalid telegram route for chat ${chatId}: missing id`
		);
		const token = toNonEmptyString(
			telegramRoute.token,
			`Invalid telegram route for chat ${chatId}: missing token`
		);

		entries.push({
			chatId,
			workspace: resolvedChat.workspace,
			telegramChatId,
			token,
		});
	}

	if (entries.length === 0) {
		throw new Error(
			"No enabled telegram routes found in chats configuration."
		);
	}

	return entries;
}

export function resolveChatRuntimeConfig(
	phiConfig: PhiConfig,
	chatId: string
): ResolvedChatRuntimeConfig {
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
