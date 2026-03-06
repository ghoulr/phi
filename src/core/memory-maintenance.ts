import type {
	ExtensionContext,
	ExtensionFactory,
	ExtensionAPI,
} from "@mariozechner/pi-coding-agent";

import {
	createPhiTransientTurnSnapshot,
	runPhiTransientTurn,
	type PhiTransientTurnRunner,
} from "./transient-turn";

export type PhiMemoryMaintenanceReason = "switch" | "compaction";

interface CreatePhiMemoryMaintenanceExtensionDependencies {
	runTransientTurn?: PhiTransientTurnRunner;
}

export function buildPhiMemoryMaintenanceContent(
	reason: PhiMemoryMaintenanceReason
): string {
	if (reason === "switch") {
		return [
			"Phi memory maintenance.",
			"A session switch is about to happen.",
			"Review recent context before the current session is left.",
			"If the user explicitly said to remember something, store it in .phi/memory/MEMORY.md.",
			"Use .phi/memory/YYYY-MM-DD.md for raw daily notes when useful.",
			"Do not mention this maintenance step unless the user asks.",
		].join(" ");
	}

	return [
		"Phi memory maintenance.",
		"Compaction is about to happen.",
		"Preserve any durable facts that should survive compaction.",
		"If the user explicitly said to remember something, store it in .phi/memory/MEMORY.md.",
		"Use .phi/memory/YYYY-MM-DD.md for raw daily notes when useful.",
		"Do not mention this maintenance step unless the user asks.",
	].join(" ");
}

function shouldRunPhiMemoryMaintenance(ctx: ExtensionContext): boolean {
	return ctx.sessionManager.getLeafEntry() !== null;
}

async function runPhiMemoryMaintenance(params: {
	ctx: ExtensionContext;
	pi: Pick<ExtensionAPI, "getActiveTools" | "getThinkingLevel">;
	runTransientTurn: PhiTransientTurnRunner;
	reason: PhiMemoryMaintenanceReason;
}): Promise<void> {
	if (!shouldRunPhiMemoryMaintenance(params.ctx)) {
		return;
	}
	await params.runTransientTurn({
		snapshot: createPhiTransientTurnSnapshot({
			ctx: params.ctx,
			pi: params.pi,
		}),
		prompt: buildPhiMemoryMaintenanceContent(params.reason),
	});
}

export function createPhiMemoryMaintenanceExtension(
	dependencies: CreatePhiMemoryMaintenanceExtensionDependencies = {}
): ExtensionFactory {
	const runTransientTurn =
		dependencies.runTransientTurn ?? runPhiTransientTurn;

	return (pi) => {
		pi.on("session_before_switch", async (_event, ctx) => {
			await runPhiMemoryMaintenance({
				ctx,
				pi,
				runTransientTurn,
				reason: "switch",
			});
		});

		pi.on("session_before_compact", async (_event, ctx) => {
			await runPhiMemoryMaintenance({
				ctx,
				pi,
				runTransientTurn,
				reason: "compaction",
			});
		});
	};
}
