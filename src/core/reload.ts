export interface ChatReloadResult {
	chatId: string;
	reloaded: string[];
}

export type ChatReloadHandler = () => Promise<string[]>;

export class ChatReloadRegistry {
	private readonly handlers = new Map<string, ChatReloadHandler>();

	public register(chatId: string, handler: ChatReloadHandler): () => void {
		this.handlers.set(chatId, handler);
		return () => {
			if (this.handlers.get(chatId) === handler) {
				this.handlers.delete(chatId);
			}
		};
	}

	public async reload(chatId: string): Promise<ChatReloadResult> {
		const handler = this.handlers.get(chatId);
		if (!handler) {
			throw new Error(`Reload is not available for chat ${chatId}`);
		}

		return {
			chatId,
			reloaded: await handler(),
		};
	}
}
