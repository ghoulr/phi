import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { SessionManager } from "@mariozechner/pi-coding-agent";

import type { ChatWorkspaceLayout } from "@phi/core/chat-workspace";
import { isRecord } from "@phi/core/type-guards";

export interface ChatSessionIndexEntry {
	sessionId: string;
	agentId: string;
	createdAt: string;
	updatedAt: string;
	archived?: boolean;
}

interface ChatSessionIndexFile {
	sessions: ChatSessionIndexEntry[];
}

function createEmptyIndex(): ChatSessionIndexFile {
	return { sessions: [] };
}

function isSessionIndexEntry(value: unknown): value is ChatSessionIndexEntry {
	if (!isRecord(value)) {
		return false;
	}
	return (
		typeof value.sessionId === "string" &&
		value.sessionId.length > 0 &&
		typeof value.agentId === "string" &&
		value.agentId.length > 0 &&
		typeof value.createdAt === "string" &&
		value.createdAt.length > 0 &&
		typeof value.updatedAt === "string" &&
		value.updatedAt.length > 0 &&
		(value.archived === undefined || typeof value.archived === "boolean")
	);
}

function loadIndexFile(indexFilePath: string): ChatSessionIndexFile {
	if (!existsSync(indexFilePath)) {
		return createEmptyIndex();
	}
	const parsed = JSON.parse(readFileSync(indexFilePath, "utf-8")) as unknown;
	if (!isRecord(parsed) || !Array.isArray(parsed.sessions)) {
		throw new Error(`Invalid session index file: ${indexFilePath}`);
	}
	const sessions = parsed.sessions;
	if (!sessions.every((entry) => isSessionIndexEntry(entry))) {
		throw new Error(`Invalid session index file: ${indexFilePath}`);
	}
	return { sessions };
}

function writeIndexFile(
	indexFilePath: string,
	indexFile: ChatSessionIndexFile
): void {
	writeFileSync(
		indexFilePath,
		`${JSON.stringify(indexFile, null, "\t")}
`,
		"utf-8"
	);
}

export class ChatSessionManager {
	private readonly indexFilePath: string;

	public constructor(private readonly layout: ChatWorkspaceLayout) {
		this.indexFilePath = join(layout.sessionsDir, "index.json");
	}

	public listSessions(): ChatSessionIndexEntry[] {
		return loadIndexFile(this.indexFilePath).sessions;
	}

	public ensureSession(
		sessionId: string,
		agentId: string
	): ChatSessionIndexEntry {
		const now = new Date().toISOString();
		const indexFile = loadIndexFile(this.indexFilePath);
		const existingEntry = indexFile.sessions.find(
			(entry) => entry.sessionId === sessionId
		);
		if (existingEntry) {
			if (existingEntry.agentId !== agentId) {
				throw new Error(
					`Session ${sessionId} is already bound to agent ${existingEntry.agentId}`
				);
			}
			const updatedEntry = {
				...existingEntry,
				updatedAt: now,
			};
			writeIndexFile(this.indexFilePath, {
				sessions: indexFile.sessions.map((entry) =>
					entry.sessionId === sessionId ? updatedEntry : entry
				),
			});
			return updatedEntry;
		}
		const createdEntry: ChatSessionIndexEntry = {
			sessionId,
			agentId,
			createdAt: now,
			updatedAt: now,
			archived: false,
		};
		writeIndexFile(this.indexFilePath, {
			sessions: [...indexFile.sessions, createdEntry],
		});
		return createdEntry;
	}

	public archiveSession(sessionId: string): void {
		const indexFile = loadIndexFile(this.indexFilePath);
		const existingEntry = indexFile.sessions.find(
			(entry) => entry.sessionId === sessionId
		);
		if (!existingEntry) {
			throw new Error(`Missing session in index: ${sessionId}`);
		}
		writeIndexFile(this.indexFilePath, {
			sessions: indexFile.sessions.map((entry) =>
				entry.sessionId === sessionId
					? {
							...entry,
							archived: true,
							updatedAt: new Date().toISOString(),
						}
					: entry
			),
		});
	}

	public resolveSessionFile(sessionId: string): string {
		return join(this.layout.sessionsDir, `${sessionId}.jsonl`);
	}

	public openPiSession(sessionId: string, agentId: string): SessionManager {
		this.ensureSession(sessionId, agentId);
		return SessionManager.open(
			this.resolveSessionFile(sessionId),
			this.layout.sessionsDir
		);
	}
}
