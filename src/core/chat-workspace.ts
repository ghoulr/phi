import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

const DOT_PHI_DIR = ".phi";
const SESSIONS_DIR = "sessions";
const MEMORY_DIR = "memory";
const LOGS_DIR = "logs";
const LOGS_FILE_NAME = "logs.jsonl";
const MEMORY_FILE_NAME = "MEMORY.md";
const DEFAULT_MEMORY_FILE_CONTENT = "# MEMORY\n";

export interface ChatWorkspaceLayout {
	workspaceDir: string;
	phiDir: string;
	sessionsDir: string;
	memoryDir: string;
	logsDir: string;
	memoryFilePath: string;
}

function encodeChatId(chatId: string): string {
	if (chatId.length === 0) {
		throw new Error("Chat id must not be empty.");
	}
	return Buffer.from(chatId, "utf-8").toString("base64url");
}

export function resolveChatWorkspaceDirectory(
	workspace: string,
	userHomeDir: string = homedir()
): string {
	if (workspace === "~") {
		return userHomeDir;
	}
	if (workspace.startsWith("~/")) {
		return join(userHomeDir, workspace.slice(2));
	}
	if (isAbsolute(workspace)) {
		return workspace;
	}
	return resolve(workspace);
}

export function getChatLogsFilePath(workspaceDir: string): string {
	return join(workspaceDir, DOT_PHI_DIR, LOGS_DIR, LOGS_FILE_NAME);
}

export function ensureChatWorkspaceLayout(
	workspaceDir: string
): ChatWorkspaceLayout {
	mkdirSync(workspaceDir, { recursive: true });

	const phiDir = join(workspaceDir, DOT_PHI_DIR);
	const sessionsDir = join(phiDir, SESSIONS_DIR);
	const memoryDir = join(phiDir, MEMORY_DIR);
	const logsDir = join(phiDir, LOGS_DIR);
	const memoryFilePath = join(memoryDir, MEMORY_FILE_NAME);

	mkdirSync(sessionsDir, { recursive: true });
	mkdirSync(memoryDir, { recursive: true });
	mkdirSync(logsDir, { recursive: true });

	if (!existsSync(memoryFilePath)) {
		writeFileSync(memoryFilePath, DEFAULT_MEMORY_FILE_CONTENT, "utf-8");
	}

	return {
		workspaceDir,
		phiDir,
		sessionsDir,
		memoryDir,
		logsDir,
		memoryFilePath,
	};
}

export function ensureChatSessionStorageDir(
	sessionsDir: string,
	chatId: string
): string {
	const chatSessionDir = join(sessionsDir, encodeChatId(chatId));
	mkdirSync(chatSessionDir, { recursive: true });
	return chatSessionDir;
}
