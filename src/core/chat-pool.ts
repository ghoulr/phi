export interface DisposableSession {
	dispose(): void;
}

export type ChatSessionFactory<TSession extends DisposableSession> = (
	chatId: string
) => Promise<TSession>;

export interface ChatSessionRuntime<TSession extends DisposableSession> {
	getOrCreateSession(chatId: string): Promise<TSession>;
	disposeSession(chatId: string): boolean;
}

export class ChatSessionPool<TSession extends DisposableSession>
	implements ChatSessionRuntime<TSession>
{
	private readonly sessions = new Map<string, TSession>();
	private readonly creatingSessions = new Map<string, Promise<TSession>>();
	private readonly invalidatedSessions = new Set<string>();

	public constructor(
		private readonly sessionFactory: ChatSessionFactory<TSession>
	) {}

	public async getOrCreateSession(chatId: string): Promise<TSession> {
		const existingSession = this.sessions.get(chatId);
		if (existingSession && !this.invalidatedSessions.has(chatId)) {
			return existingSession;
		}
		if (existingSession) {
			existingSession.dispose();
			this.sessions.delete(chatId);
			this.invalidatedSessions.delete(chatId);
		}

		const creatingSession = this.creatingSessions.get(chatId);
		if (creatingSession) {
			return creatingSession;
		}
		this.invalidatedSessions.delete(chatId);

		const createdSession = this.sessionFactory(chatId).then(
			(session) => {
				this.sessions.set(chatId, session);
				this.creatingSessions.delete(chatId);
				return session;
			},
			(error: unknown) => {
				this.creatingSessions.delete(chatId);
				throw error;
			}
		);

		this.creatingSessions.set(chatId, createdSession);
		return createdSession;
	}

	public invalidateSession(chatId: string): void {
		this.invalidatedSessions.add(chatId);
	}

	public disposeSession(chatId: string): boolean {
		const session = this.sessions.get(chatId);
		if (!session) {
			return false;
		}
		session.dispose();
		this.sessions.delete(chatId);
		this.invalidatedSessions.delete(chatId);
		return true;
	}
}
