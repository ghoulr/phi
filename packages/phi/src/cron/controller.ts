import type { CronReloadResult } from "@phi/cron/types";

export interface ChatCronController {
	reload(): Promise<CronReloadResult>;
}

export class CronControllerRegistry {
	private readonly controllers = new Map<string, ChatCronController>();

	public register(
		chatId: string,
		controller: ChatCronController
	): () => void {
		const existing = this.controllers.get(chatId);
		if (existing && existing !== controller) {
			throw new Error(`Duplicate cron controller for chat ${chatId}`);
		}
		this.controllers.set(chatId, controller);
		return () => {
			if (this.controllers.get(chatId) === controller) {
				this.controllers.delete(chatId);
			}
		};
	}

	public require(chatId: string): ChatCronController {
		const controller = this.controllers.get(chatId);
		if (!controller) {
			throw new Error(
				`Cron controller is not available for chat ${chatId}`
			);
		}
		return controller;
	}
}
