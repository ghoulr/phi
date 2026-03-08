import type { AgentSession } from "@mariozechner/pi-coding-agent";
import {
	applyPhiTurnContext,
	resolvePhiTurnOutput,
	type ResolvePhiTurnOutputParams,
} from "@phi/messaging/resolve-turn-output";
import type { PhiTurnContext } from "@phi/messaging/turn-context";
import type { PhiMessage } from "@phi/messaging/types";

export class PhiMessagingSessionState {
	private deferredMessage: PhiMessage | undefined;
	private turnContext: PhiTurnContext | undefined;

	public resetTurn(): void {
		this.deferredMessage = undefined;
		this.turnContext = undefined;
	}

	public startTurn(context: PhiTurnContext | undefined): void {
		this.deferredMessage = undefined;
		this.turnContext = context;
	}

	public prepareMessage(message: PhiMessage): PhiMessage {
		return applyPhiTurnContext(message, this.turnContext);
	}

	public getTurnContext(): PhiTurnContext | undefined {
		return this.turnContext;
	}

	public setDeferredMessage(message: PhiMessage): void {
		if (this.deferredMessage) {
			throw new Error("Only one deferred send is allowed per turn.");
		}
		this.deferredMessage = this.prepareMessage(message);
	}

	public consumeResolvedTurnOutput(
		params: Omit<ResolvePhiTurnOutputParams, "deferredMessage">
	): PhiMessage[] {
		const deferredMessage = this.deferredMessage;
		this.deferredMessage = undefined;
		const turnContext = this.turnContext;
		this.turnContext = undefined;
		return resolvePhiTurnOutput({
			...params,
			deferredMessage,
			turnContext,
		});
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
