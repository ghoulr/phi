import type { PhiMessage } from "@phi/messaging/types";

export interface PhiRouteDelivery {
	deliver(message: PhiMessage): Promise<void>;
}

export class PhiRouteDeliveryRegistry {
	private readonly routes = new Map<string, PhiRouteDelivery>();

	public register(chatId: string, delivery: PhiRouteDelivery): () => void {
		this.routes.set(chatId, delivery);
		return () => {
			if (this.routes.get(chatId) === delivery) {
				this.routes.delete(chatId);
			}
		};
	}

	public get(chatId: string): PhiRouteDelivery | undefined {
		return this.routes.get(chatId);
	}

	public require(chatId: string): PhiRouteDelivery {
		const delivery = this.routes.get(chatId);
		if (!delivery) {
			throw new Error(`No outbound route registered for chat ${chatId}`);
		}
		return delivery;
	}
}
