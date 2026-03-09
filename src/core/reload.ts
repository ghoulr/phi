export interface ChatReloadResult {
	chatId: string;
	reloaded: string[];
}

export type ChatReloadHandler = () => Promise<string[]>;

export class ChatReloadRegistry {
	private readonly handlers = new Map<string, Set<ChatReloadHandler>>();

	public register(chatId: string, handler: ChatReloadHandler): () => void {
		const handlers =
			this.handlers.get(chatId) ?? new Set<ChatReloadHandler>();
		handlers.add(handler);
		this.handlers.set(chatId, handlers);
		return () => {
			const currentHandlers = this.handlers.get(chatId);
			if (!currentHandlers) {
				return;
			}
			currentHandlers.delete(handler);
			if (currentHandlers.size === 0) {
				this.handlers.delete(chatId);
			}
		};
	}

	public async reload(chatId: string): Promise<ChatReloadResult> {
		const handlers = this.handlers.get(chatId);
		if (!handlers || handlers.size === 0) {
			throw new Error(`Reload is not available for chat ${chatId}`);
		}

		const reloaded = (
			await Promise.all(
				Array.from(handlers).map(async (handler) => await handler())
			)
		).flat();
		return {
			chatId,
			reloaded,
		};
	}
}
