import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { parse } from "yaml";

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

export interface TelegramChatChannelConfig {
	enabled?: boolean;
	agent: string;
	token: string;
}

export interface TelegramChannelConfig {
	chats: Record<string, TelegramChatChannelConfig>;
}

export interface TuiChannelConfig {
	agent: string;
}

export interface PhiChannelsConfig {
	telegram?: TelegramChannelConfig;
	tui?: TuiChannelConfig;
}

export interface PhiConfig {
	agents?: Record<string, PhiAgentConfig>;
	channels?: PhiChannelsConfig;
}

export interface ResolvedTelegramChatServiceConfig {
	chatId: string;
	agentId: string;
	token: string;
}

export interface ResolvedAgentRuntimeConfig {
	agentId: string;
	provider: string;
	model: string;
	thinkingLevel: PhiThinkingLevel;
}

export interface TuiChatOverride {
	channel: string;
	chatId: string;
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

export function getDefaultPhiConfigFilePath(
	userHomeDir: string = homedir()
): string {
	return join(userHomeDir, ".phi", "phi.yaml");
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
	const chats = phiConfig.channels?.telegram?.chats;
	if (!chats) {
		throw new Error(
			"Missing channels.telegram.chats configuration in phi config."
		);
	}

	const entries = Object.entries(chats)
		.filter(([, mapping]) => mapping.enabled ?? true)
		.map(([chatId, mapping]) => {
			if (!mapping.agent) {
				throw new Error(
					`Invalid telegram chat mapping for chat id ${chatId}: missing agent`
				);
			}
			if (!mapping.token) {
				throw new Error(
					`Invalid telegram chat mapping for chat id ${chatId}: missing token`
				);
			}

			return {
				chatId,
				agentId: mapping.agent,
				token: mapping.token,
			};
		});

	if (entries.length === 0) {
		throw new Error("channels.telegram.chats has no enabled chat.");
	}

	return entries;
}

function resolveTelegramChatAgentId(
	phiConfig: PhiConfig,
	chatId: string
): string {
	const chats = phiConfig.channels?.telegram?.chats;
	if (!chats) {
		throw new Error(
			"Missing channels.telegram.chats configuration in phi config."
		);
	}

	const chatConfig = chats[chatId];
	if (!chatConfig) {
		throw new Error(`Unknown telegram chat mapping for chat id: ${chatId}`);
	}
	if (chatConfig.enabled === false) {
		throw new Error(`Telegram chat is disabled: ${chatId}`);
	}
	if (!chatConfig.agent) {
		throw new Error(
			`Invalid telegram chat mapping for chat id ${chatId}: missing agent`
		);
	}
	return chatConfig.agent;
}

function resolveChannelChatAgentId(
	phiConfig: PhiConfig,
	override: TuiChatOverride
): string {
	if (override.channel.length === 0) {
		throw new Error("Invalid tui chat override: empty channel");
	}
	if (override.chatId.length === 0) {
		throw new Error("Invalid tui chat override: empty chat id");
	}
	if (override.channel === "telegram") {
		return resolveTelegramChatAgentId(phiConfig, override.chatId);
	}
	throw new Error(
		`Unsupported tui chat override channel: ${override.channel}`
	);
}

export function resolveTuiAgentId(
	phiConfig: PhiConfig,
	override?: TuiChatOverride
): string {
	if (override) {
		return resolveChannelChatAgentId(phiConfig, override);
	}

	const tuiConfig = phiConfig.channels?.tui;
	if (!tuiConfig) {
		throw new Error("Missing channels.tui configuration in phi config.");
	}
	if (!tuiConfig.agent) {
		throw new Error("Invalid channels.tui configuration: missing agent");
	}
	return tuiConfig.agent;
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
