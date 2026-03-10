import type { AgentSession } from "@mariozechner/pi-coding-agent";
import {
	resolvePhiTurnOutput,
	type ResolvePhiTurnOutputParams,
} from "@phi/messaging/resolve-turn-output";
import type { PhiTurnContext } from "@phi/messaging/turn-context";
import type { PhiMessage } from "@phi/messaging/types";

export class PhiMessagingSessionState {
	private deferredMessage: PhiMessage | undefined;
	private readonly turnContexts: PhiTurnContext[] = [];

	public startTurn(context: PhiTurnContext | undefined): void {
		this.turnContexts.push(context ?? {});
	}

	public discardLastTurn(): void {
		if (this.turnContexts.length === 0) {
			return;
		}
		this.turnContexts.pop();
		if (this.turnContexts.length === 0) {
			this.deferredMessage = undefined;
		}
	}

	public getTurnContext(): PhiTurnContext | undefined {
		return this.turnContexts.at(-1);
	}

	public setDeferredMessage(message: PhiMessage): void {
		if (this.deferredMessage) {
			throw new Error("Only one deferred send is allowed per turn.");
		}
		this.deferredMessage = message;
	}

	public consumeResolvedTurnOutput(
		params: Omit<ResolvePhiTurnOutputParams, "deferredMessage">
	): PhiMessage[] {
		const deferredMessage = this.deferredMessage;
		this.deferredMessage = undefined;
		this.turnContexts.length = 0;
		return resolvePhiTurnOutput({
			...params,
			deferredMessage,
		});
	}

	public hasPendingOutput(): boolean {
		return (
			this.turnContexts.length > 0 || this.deferredMessage !== undefined
		);
	}
}

const sessionStateRegistry = new WeakMap<
	AgentSession,
	PhiMessagingSessionState
>();

export function registerPhiMessagingSessionState(
	session: AgentSession,
	state: PhiMessagingSessionState
): void {
	sessionStateRegistry.set(session, state);
}

export function getPhiMessagingSessionState(
	session: AgentSession
): PhiMessagingSessionState | undefined {
	return sessionStateRegistry.get(session);
}

export function resolvePhiSessionTurnOutput(
	session: AgentSession,
	assistantText: string | undefined
): PhiMessage[] {
	const state = sessionStateRegistry.get(session);
	if (!state) {
		return resolvePhiTurnOutput({ assistantText });
	}
	return state.consumeResolvedTurnOutput({ assistantText });
}
