import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";

import {
	AuthStorage,
	createAgentSession,
	DefaultResourceLoader,
	type AgentSession,
	SessionManager,
} from "@mariozechner/pi-coding-agent";

export const DEFAULT_AGENT_ID = "main";

const AGENT_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;

export interface DisposableSession {
	dispose(): void;
}

export type SessionFactory<TSession extends DisposableSession> =
	() => Promise<TSession>;

export type AgentSessionFactory<TSession extends DisposableSession> = (
	agentId: string
) => Promise<TSession>;

export interface AgentConversationRuntime<TSession extends DisposableSession> {
	getOrCreateSession(agentId: string, key: string): Promise<TSession>;
	disposeSession(agentId: string, key: string): boolean;
	disposeAllSessions(agentId?: string): void;
}

export interface AgentWorkspace {
	agentId: string;
	phiDir: string;
	phiConfigFilePath: string;
	agentRootDir: string;
	piAgentDir: string;
	sessionsDir: string;
	sharedAuthFilePath: string;
}

export interface AgentResourceProvider {
	resolveAgentWorkspace(
		agentId: string,
		cwd?: string,
		userHomeDir?: string
	): AgentWorkspace;
}

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

export class PhiRuntime<TSession extends DisposableSession>
	implements AgentConversationRuntime<TSession>
{
	private readonly agentRuntimes = new Map<
		string,
		ConversationRuntime<TSession>
	>();

	public constructor(
		private readonly agentSessionFactory: AgentSessionFactory<TSession>
	) {}

	public async getOrCreateSession(
		agentId: string,
		key: string
	): Promise<TSession> {
		const runtime = this.getOrCreateAgentRuntime(agentId);
		return runtime.getOrCreateSession(key);
	}

	public disposeSession(agentId: string, key: string): boolean {
		const runtime = this.agentRuntimes.get(agentId);
		if (!runtime) {
			return false;
		}
		return runtime.disposeSession(key);
	}

	public disposeAllSessions(agentId?: string): void {
		if (agentId) {
			const runtime = this.agentRuntimes.get(agentId);
			if (!runtime) {
				return;
			}
			runtime.disposeAllSessions();
			return;
		}

		for (const runtime of this.agentRuntimes.values()) {
			runtime.disposeAllSessions();
		}
	}

	private getOrCreateAgentRuntime(
		agentId: string
	): ConversationRuntime<TSession> {
		const existingRuntime = this.agentRuntimes.get(agentId);
		if (existingRuntime) {
			return existingRuntime;
		}
		const runtime = new ConversationRuntime<TSession>(() =>
			this.agentSessionFactory(agentId)
		);
		this.agentRuntimes.set(agentId, runtime);
		return runtime;
	}
}

function assertValidAgentId(agentId: string): void {
	if (!AGENT_ID_PATTERN.test(agentId)) {
		throw new Error(`Invalid agent id: ${agentId}`);
	}
}

function getPhiHomeDir(userHomeDir: string = homedir()): string {
	return join(userHomeDir, ".phi");
}

function getLegacyAgentsSkillsDir(userHomeDir: string = homedir()): string {
	return join(userHomeDir, ".agents", "skills");
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

export class FileSystemResourceProvider implements AgentResourceProvider {
	public resolveAgentWorkspace(
		agentId: string,
		_cwd: string = process.cwd(),
		userHomeDir: string = homedir()
	): AgentWorkspace {
		assertValidAgentId(agentId);

		const phiDir = getPhiHomeDir(userHomeDir);
		const phiConfigFilePath = join(phiDir, "phi.yaml");
		if (!existsSync(phiConfigFilePath)) {
			throw new Error(`Missing phi config file: ${phiConfigFilePath}`);
		}

		const agentRootDir = join(phiDir, "agents", agentId);
		if (!existsSync(agentRootDir)) {
			throw new Error(`Unknown agent workspace: ${agentRootDir}`);
		}

		const piAgentDir = join(agentRootDir, "pi");
		if (!existsSync(piAgentDir)) {
			throw new Error(`Missing pi workspace directory: ${piAgentDir}`);
		}

		return {
			agentId,
			phiDir,
			phiConfigFilePath,
			agentRootDir,
			piAgentDir,
			sessionsDir: join(agentRootDir, "sessions"),
			sharedAuthFilePath: join(phiDir, "auth", "auth.json"),
		};
	}
}

async function createPhiResourceLoader(
	agentId: string,
	resourceProvider: AgentResourceProvider,
	cwd: string = process.cwd(),
	userHomeDir: string = homedir()
): Promise<DefaultResourceLoader> {
	const workspace = resourceProvider.resolveAgentWorkspace(
		agentId,
		cwd,
		userHomeDir
	);
	const resourceLoader = new DefaultResourceLoader({
		cwd,
		agentDir: workspace.piAgentDir,
		skillsOverride: (base) => ({
			skills: base.skills.filter(
				(skill) =>
					!isSkillFromLegacyAgentsDir(skill.filePath, userHomeDir)
			),
			diagnostics: base.diagnostics,
		}),
		agentsFilesOverride: () => ({ agentsFiles: [] }),
	});
	await resourceLoader.reload();
	return resourceLoader;
}

async function createDefaultAgentSession(
	agentId: string
): Promise<AgentSession> {
	const cwd = process.cwd();
	const userHomeDir = homedir();
	const resourceProvider = new FileSystemResourceProvider();
	const workspace = resourceProvider.resolveAgentWorkspace(
		agentId,
		cwd,
		userHomeDir
	);

	const { session } = await createAgentSession({
		cwd,
		agentDir: workspace.piAgentDir,
		authStorage: AuthStorage.create(workspace.sharedAuthFilePath),
		sessionManager: SessionManager.create(cwd, workspace.sessionsDir),
		resourceLoader: await createPhiResourceLoader(
			agentId,
			resourceProvider,
			cwd,
			userHomeDir
		),
	});
	return session;
}

export function createPhiRuntime(
	sessionFactory: AgentSessionFactory<AgentSession> = createDefaultAgentSession
): PhiRuntime<AgentSession> {
	return new PhiRuntime<AgentSession>(sessionFactory);
}
