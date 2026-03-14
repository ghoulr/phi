export interface DisposableSession {
	dispose(): void;
}

export type SessionFactory<TSession extends DisposableSession> = (
	sessionId: string
) => Promise<TSession>;

export interface SessionRuntime<TSession extends DisposableSession> {
	getOrCreateSession(sessionId: string): Promise<TSession>;
	disposeSession(sessionId: string): boolean;
}

export class SessionPool<TSession extends DisposableSession>
	implements SessionRuntime<TSession>
{
	private readonly sessions = new Map<string, TSession>();
	private readonly creatingSessions = new Map<string, Promise<TSession>>();
	private readonly invalidatedSessions = new Set<string>();

	public constructor(
		private readonly sessionFactory: SessionFactory<TSession>
	) {}

	public async getOrCreateSession(sessionId: string): Promise<TSession> {
		const existingSession = this.sessions.get(sessionId);
		if (existingSession && !this.invalidatedSessions.has(sessionId)) {
			return existingSession;
		}
		if (existingSession) {
			existingSession.dispose();
			this.sessions.delete(sessionId);
			this.invalidatedSessions.delete(sessionId);
		}

		const creatingSession = this.creatingSessions.get(sessionId);
		if (creatingSession) {
			return creatingSession;
		}
		this.invalidatedSessions.delete(sessionId);

		const createdSession = this.sessionFactory(sessionId).then(
			(session) => {
				this.sessions.set(sessionId, session);
				this.creatingSessions.delete(sessionId);
				return session;
			},
			(error: unknown) => {
				this.creatingSessions.delete(sessionId);
				throw error;
			}
		);

		this.creatingSessions.set(sessionId, createdSession);
		return createdSession;
	}

	public invalidateSession(sessionId: string): void {
		this.invalidatedSessions.add(sessionId);
	}

	public disposeSession(sessionId: string): boolean {
		const session = this.sessions.get(sessionId);
		if (!session) {
			return false;
		}
		session.dispose();
		this.sessions.delete(sessionId);
		this.invalidatedSessions.delete(sessionId);
		return true;
	}
}
