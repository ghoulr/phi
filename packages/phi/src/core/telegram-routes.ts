import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { homedir } from "node:os";

import { parse, stringify } from "yaml";

import {
	collectTelegramSessionRouteTemplates,
	type PhiConfig,
	type ResolvedTelegramSessionServiceConfig,
	type ResolvedTelegramSessionTemplateConfig,
} from "@phi/core/config";
import { getPhiTelegramRoutesFilePath } from "@phi/core/paths";
import { isRecord } from "@phi/core/type-guards";

export interface ResolvedTelegramWildcardRouteConfig {
	configSessionId: string;
	chatId: string;
	workspace: string;
	token: string;
}

interface TelegramRoutesChatRecord {
	sessionId: string;
	configSessionId: string;
}

interface TelegramRoutesAccountRecord {
	chats: Record<string, TelegramRoutesChatRecord>;
}

interface TelegramRoutesFile {
	accounts: Record<string, TelegramRoutesAccountRecord>;
}

interface ResolvedTelegramAccountTemplates {
	explicitByChatId: Map<string, ResolvedTelegramSessionTemplateConfig>;
	wildcardTemplate?: ResolvedTelegramSessionTemplateConfig;
}

function createEmptyTelegramRoutesFile(): TelegramRoutesFile {
	return { accounts: {} };
}

function hashTelegramToken(token: string): string {
	return createHash("sha256").update(token).digest("hex").slice(0, 12);
}

function createTelegramSessionId(now: Date = new Date()): string {
	const timestamp = now.toISOString().replace(/[:.]/g, "-");
	return `${timestamp}_${randomUUID()}`;
}

function isTelegramRoutesChatRecord(
	value: unknown
): value is TelegramRoutesChatRecord {
	if (!isRecord(value)) {
		return false;
	}
	return (
		typeof value.sessionId === "string" &&
		value.sessionId.length > 0 &&
		typeof value.configSessionId === "string" &&
		value.configSessionId.length > 0
	);
}

function isTelegramRoutesAccountRecord(
	value: unknown
): value is TelegramRoutesAccountRecord {
	if (!isRecord(value) || !isRecord(value.chats)) {
		return false;
	}
	return Object.values(value.chats).every((entry) =>
		isTelegramRoutesChatRecord(entry)
	);
}

function loadTelegramRoutesFile(filePath: string): TelegramRoutesFile {
	if (!existsSync(filePath)) {
		return createEmptyTelegramRoutesFile();
	}
	const raw = parse(readFileSync(filePath, "utf-8")) as unknown;
	if (raw == null) {
		return createEmptyTelegramRoutesFile();
	}
	if (!isRecord(raw) || !isRecord(raw.accounts)) {
		throw new Error(`Invalid telegram routes file: ${filePath}`);
	}
	const accounts = raw.accounts;
	if (
		!Object.values(accounts).every((account) =>
			isTelegramRoutesAccountRecord(account)
		)
	) {
		throw new Error(`Invalid telegram routes file: ${filePath}`);
	}
	const normalizedAccounts = Object.fromEntries(
		Object.entries(accounts).map(([accountId, account]) => {
			const typedAccount = account as TelegramRoutesAccountRecord;
			return [
				accountId,
				{
					chats: Object.fromEntries(
						Object.entries(typedAccount.chats).map(
							([chatId, chatRecord]) => [
								chatId,
								{ ...chatRecord },
							]
						)
					),
				},
			];
		})
	);
	return {
		accounts: normalizedAccounts,
	};
}

function writeTelegramRoutesFile(
	filePath: string,
	routesFile: TelegramRoutesFile
): void {
	mkdirSync(dirname(filePath), { recursive: true });
	writeFileSync(filePath, stringify(routesFile), "utf-8");
}

function buildTelegramAccountTemplates(
	templates: ResolvedTelegramSessionTemplateConfig[]
): Map<string, ResolvedTelegramAccountTemplates> {
	const accounts = new Map<string, ResolvedTelegramAccountTemplates>();
	for (const template of templates) {
		let account = accounts.get(template.token);
		if (!account) {
			account = {
				explicitByChatId: new Map<
					string,
					ResolvedTelegramSessionTemplateConfig
				>(),
			};
			accounts.set(template.token, account);
		}
		for (const chatId of template.telegramChatIds) {
			if (chatId === "*") {
				if (account.wildcardTemplate) {
					throw new Error(
						`Duplicate telegram allowList entry for token ${hashTelegramToken(template.token)} and chat id *: ${account.wildcardTemplate.sessionId} and ${template.sessionId}`
					);
				}
				account.wildcardTemplate = template;
				continue;
			}
			const existingTemplate = account.explicitByChatId.get(chatId);
			if (existingTemplate) {
				throw new Error(
					`Duplicate telegram allowList entry for token ${hashTelegramToken(template.token)} and chat id ${chatId}: ${existingTemplate.sessionId} and ${template.sessionId}`
				);
			}
			account.explicitByChatId.set(chatId, template);
		}
	}
	return accounts;
}

function ensureAccountRecord(
	routesFile: TelegramRoutesFile,
	accountId: string
): TelegramRoutesAccountRecord {
	let account = routesFile.accounts[accountId];
	if (!account) {
		account = { chats: {} };
		routesFile.accounts[accountId] = account;
	}
	return account;
}

function ensureChatRecord(params: {
	routesFile: TelegramRoutesFile;
	accountId: string;
	chatId: string;
	configSessionId: string;
}): { record: TelegramRoutesChatRecord; changed: boolean } {
	const account = ensureAccountRecord(params.routesFile, params.accountId);
	const existingRecord = account.chats[params.chatId];
	if (
		existingRecord &&
		existingRecord.configSessionId === params.configSessionId
	) {
		return { record: existingRecord, changed: false };
	}
	const record = {
		sessionId: createTelegramSessionId(),
		configSessionId: params.configSessionId,
	};
	account.chats[params.chatId] = record;
	return { record, changed: true };
}

function toServiceConfig(
	template: ResolvedTelegramSessionTemplateConfig,
	chatId: string,
	record: TelegramRoutesChatRecord
): ResolvedTelegramSessionServiceConfig {
	return {
		sessionId: record.sessionId,
		configSessionId: template.sessionId,
		chatId: template.chatId,
		workspace: template.workspace,
		telegramChatId: chatId,
		token: template.token,
	};
}

function resolveTelegramTemplates(
	phiConfig: PhiConfig
): Map<string, ResolvedTelegramAccountTemplates> {
	return buildTelegramAccountTemplates(
		collectTelegramSessionRouteTemplates(phiConfig)
	);
}

export class TelegramRouteRegistry {
	private readonly templatesByToken: Map<
		string,
		ResolvedTelegramAccountTemplates
	>;
	private readonly filePath: string;
	private readonly routesFile: TelegramRoutesFile;

	constructor(phiConfig: PhiConfig, userHomeDir: string = homedir()) {
		this.templatesByToken = resolveTelegramTemplates(phiConfig);
		this.filePath = getPhiTelegramRoutesFilePath(userHomeDir);
		this.routesFile = loadTelegramRoutesFile(this.filePath);
	}

	public resolveSessionServiceConfigs(): ResolvedTelegramSessionServiceConfig[] {
		let changed = false;
		const entries: ResolvedTelegramSessionServiceConfig[] = [];

		for (const [
			token,
			accountTemplates,
		] of this.templatesByToken.entries()) {
			const accountId = hashTelegramToken(token);
			const explicitChatIds = new Set<string>();
			for (const [
				chatId,
				template,
			] of accountTemplates.explicitByChatId.entries()) {
				explicitChatIds.add(chatId);
				const { record, changed: recordChanged } = ensureChatRecord({
					routesFile: this.routesFile,
					accountId,
					chatId,
					configSessionId: template.sessionId,
				});
				changed ||= recordChanged;
				entries.push(toServiceConfig(template, chatId, record));
			}

			const wildcardTemplate = accountTemplates.wildcardTemplate;
			if (!wildcardTemplate) {
				continue;
			}
			const account = ensureAccountRecord(this.routesFile, accountId);
			for (const [chatId, record] of Object.entries(account.chats)) {
				if (explicitChatIds.has(chatId)) {
					continue;
				}
				if (record.configSessionId !== wildcardTemplate.sessionId) {
					continue;
				}
				entries.push(toServiceConfig(wildcardTemplate, chatId, record));
			}
		}

		if (changed) {
			this.writeRoutesFile();
		}
		return entries;
	}

	public resolveWildcardRouteConfigs(): ResolvedTelegramWildcardRouteConfig[] {
		const entries: ResolvedTelegramWildcardRouteConfig[] = [];
		for (const [
			token,
			accountTemplates,
		] of this.templatesByToken.entries()) {
			const wildcardTemplate = accountTemplates.wildcardTemplate;
			if (!wildcardTemplate) {
				continue;
			}
			entries.push({
				configSessionId: wildcardTemplate.sessionId,
				chatId: wildcardTemplate.chatId,
				workspace: wildcardTemplate.workspace,
				token,
			});
		}
		return entries;
	}

	public bindChatRoute(
		token: string,
		chatId: string
	): ResolvedTelegramSessionServiceConfig | undefined {
		const accountTemplates = this.templatesByToken.get(token);
		if (!accountTemplates) {
			return undefined;
		}
		const template =
			accountTemplates.explicitByChatId.get(chatId) ??
			accountTemplates.wildcardTemplate;
		if (!template) {
			return undefined;
		}
		const accountId = hashTelegramToken(token);
		const { record, changed } = ensureChatRecord({
			routesFile: this.routesFile,
			accountId,
			chatId,
			configSessionId: template.sessionId,
		});
		if (changed) {
			this.writeRoutesFile();
		}
		return toServiceConfig(template, chatId, record);
	}

	private writeRoutesFile(): void {
		writeTelegramRoutesFile(this.filePath, this.routesFile);
	}
}

export function createTelegramRouteRegistry(
	phiConfig: PhiConfig,
	userHomeDir: string = homedir()
): TelegramRouteRegistry {
	return new TelegramRouteRegistry(phiConfig, userHomeDir);
}

export function resolveTelegramSessionServiceConfigs(
	phiConfig: PhiConfig,
	userHomeDir: string = homedir()
): ResolvedTelegramSessionServiceConfig[] {
	return createTelegramRouteRegistry(
		phiConfig,
		userHomeDir
	).resolveSessionServiceConfigs();
}

export function resolveTelegramWildcardRouteConfigs(
	phiConfig: PhiConfig,
	userHomeDir: string = homedir()
): ResolvedTelegramWildcardRouteConfig[] {
	return createTelegramRouteRegistry(
		phiConfig,
		userHomeDir
	).resolveWildcardRouteConfigs();
}

export function bindTelegramChatRoute(params: {
	phiConfig: PhiConfig;
	token: string;
	chatId: string;
	userHomeDir?: string;
	registry?: TelegramRouteRegistry;
}): ResolvedTelegramSessionServiceConfig | undefined {
	const registry =
		params.registry ??
		createTelegramRouteRegistry(params.phiConfig, params.userHomeDir);
	return registry.bindChatRoute(params.token, params.chatId);
}

export const __test__ = {
	createTelegramSessionId,
	hashTelegramToken,
	loadTelegramRoutesFile,
};
