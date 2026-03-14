export interface ChatReloadResult {
	chatId: string;
	reloaded: string[];
}

export interface ChatReloadParticipant {
	validate?(): Promise<string[]>;
	apply(): Promise<string[]>;
}

export class ChatReloadRegistry {
	private readonly participants = new Map<
		string,
		Set<ChatReloadParticipant>
	>();
	private readonly pendingChatIds = new Set<string>();

	public register(
		chatId: string,
		participant: ChatReloadParticipant
	): () => void {
		const participants =
			this.participants.get(chatId) ?? new Set<ChatReloadParticipant>();
		participants.add(participant);
		this.participants.set(chatId, participants);
		return () => {
			const currentParticipants = this.participants.get(chatId);
			if (!currentParticipants) {
				return;
			}
			currentParticipants.delete(participant);
			if (currentParticipants.size === 0) {
				this.participants.delete(chatId);
				this.pendingChatIds.delete(chatId);
			}
		};
	}

	public async validate(chatId: string): Promise<ChatReloadResult> {
		return await this.collect(chatId, async (participant) => {
			return await (participant.validate ?? participant.apply)();
		});
	}

	public async request(chatId: string): Promise<ChatReloadResult> {
		const result = await this.validate(chatId);
		this.pendingChatIds.add(chatId);
		return result;
	}

	public clearPending(chatId: string): boolean {
		return this.pendingChatIds.delete(chatId);
	}

	public async applyPending(
		chatId: string
	): Promise<ChatReloadResult | undefined> {
		if (!this.pendingChatIds.has(chatId)) {
			return undefined;
		}
		this.pendingChatIds.delete(chatId);
		return await this.collect(chatId, async (participant) => {
			return await participant.apply();
		});
	}

	private requireParticipants(chatId: string): Set<ChatReloadParticipant> {
		const participants = this.participants.get(chatId);
		if (!participants || participants.size === 0) {
			throw new Error(`Reload is not available for chat ${chatId}`);
		}
		return participants;
	}

	private async collect(
		chatId: string,
		collectParticipant: (
			participant: ChatReloadParticipant
		) => Promise<string[]>
	): Promise<ChatReloadResult> {
		const participants = this.requireParticipants(chatId);
		const reloaded = (
			await Promise.all(
				Array.from(participants).map(async (participant) => {
					return await collectParticipant(participant);
				})
			)
		).flat();
		return {
			chatId,
			reloaded,
		};
	}
}
