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

export class AgentPool<TSession extends DisposableSession>
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
