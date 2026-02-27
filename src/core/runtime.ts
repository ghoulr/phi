import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";

import {
	createAgentSession,
	DefaultResourceLoader,
	type AgentSession,
} from "@mariozechner/pi-coding-agent";

export interface DisposableSession {
	dispose(): void;
}

export type SessionFactory<TSession extends DisposableSession> =
	() => Promise<TSession>;

export class ConversationRuntime<TSession extends DisposableSession> {
	private readonly sessions = new Map<string, TSession>();
	private readonly creatingSessions = new Map<string, Promise<TSession>>();

	public constructor(
		private readonly sessionFactory: SessionFactory<TSession>
	) {}

	public async getOrCreateSession(key: string): Promise<TSession> {
		const existingSession = this.sessions.get(key);
		if (existingSession) {
			return existingSession;
		}

		const creatingSession = this.creatingSessions.get(key);
		if (creatingSession) {
			return creatingSession;
		}

		const createdSession = this.sessionFactory().then(
			(session) => {
				this.sessions.set(key, session);
				this.creatingSessions.delete(key);
				return session;
			},
			(error: unknown) => {
				this.creatingSessions.delete(key);
				throw error;
			}
		);

		this.creatingSessions.set(key, createdSession);
		return createdSession;
	}

	public disposeSession(key: string): boolean {
		const session = this.sessions.get(key);
		if (!session) {
			return false;
		}
		session.dispose();
		this.sessions.delete(key);
		return true;
	}

	public disposeAllSessions(): void {
		for (const session of this.sessions.values()) {
			session.dispose();
		}
		this.sessions.clear();
	}
}

function getPhiHomeDir(userHomeDir: string = homedir()): string {
	return join(userHomeDir, ".phi");
}

function getPhiPiAgentDir(userHomeDir: string = homedir()): string {
	return join(getPhiHomeDir(userHomeDir), "pi");
}

function getLegacyAgentsSkillsDir(userHomeDir: string = homedir()): string {
	return join(userHomeDir, ".agents", "skills");
}

function getPhiContextDirs(
	cwd: string = process.cwd(),
	userHomeDir: string = homedir()
): string[] {
	return [
		join(getPhiHomeDir(userHomeDir), "context"),
		join(cwd, ".phi", "context"),
	];
}

function isPathInsideDirectory(path: string, directory: string): boolean {
	const relativePath = relative(resolve(directory), resolve(path));
	return (
		relativePath === "" ||
		(!relativePath.startsWith("..") && !isAbsolute(relativePath))
	);
}

function isSkillFromLegacyAgentsDir(
	skillFilePath: string,
	userHomeDir: string = homedir()
): boolean {
	return isPathInsideDirectory(
		skillFilePath,
		getLegacyAgentsSkillsDir(userHomeDir)
	);
}

function listMarkdownFilesRecursively(directory: string): string[] {
	if (!existsSync(directory)) {
		return [];
	}

	const entries = readdirSync(directory, { withFileTypes: true }).sort(
		(a, b) => a.name.localeCompare(b.name)
	);
	const files: string[] = [];
	for (const entry of entries) {
		const fullPath = join(directory, entry.name);
		if (entry.isDirectory()) {
			files.push(...listMarkdownFilesRecursively(fullPath));
			continue;
		}
		if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
			files.push(fullPath);
		}
	}
	return files;
}

function loadPhiContextFiles(
	cwd: string = process.cwd(),
	userHomeDir: string = homedir()
): Array<{ path: string; content: string }> {
	return getPhiContextDirs(cwd, userHomeDir).flatMap((directory) =>
		listMarkdownFilesRecursively(directory).map((filePath) => ({
			path: filePath,
			content: readFileSync(filePath, "utf-8"),
		}))
	);
}

async function createPhiResourceLoader(
	cwd: string = process.cwd(),
	userHomeDir: string = homedir()
): Promise<DefaultResourceLoader> {
	const agentDir = getPhiPiAgentDir(userHomeDir);
	const resourceLoader = new DefaultResourceLoader({
		cwd,
		agentDir,
		skillsOverride: (base) => ({
			skills: base.skills.filter(
				(skill) =>
					!isSkillFromLegacyAgentsDir(skill.filePath, userHomeDir)
			),
			diagnostics: base.diagnostics,
		}),
		agentsFilesOverride: () => ({
			agentsFiles: loadPhiContextFiles(cwd, userHomeDir),
		}),
	});
	await resourceLoader.reload();
	return resourceLoader;
}

async function createDefaultAgentSession(): Promise<AgentSession> {
	const cwd = process.cwd();
	const userHomeDir = homedir();
	const { session } = await createAgentSession({
		cwd,
		agentDir: getPhiPiAgentDir(userHomeDir),
		resourceLoader: await createPhiResourceLoader(cwd, userHomeDir),
	});
	return session;
}

export function createPhiRuntime(
	sessionFactory: SessionFactory<AgentSession> = createDefaultAgentSession
): ConversationRuntime<AgentSession> {
	return new ConversationRuntime<AgentSession>(sessionFactory);
}
