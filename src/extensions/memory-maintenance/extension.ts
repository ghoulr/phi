import type {
	ExtensionContext,
	ExtensionFactory,
	ExtensionAPI,
} from "@mariozechner/pi-coding-agent";

import { getPhiDailyMemoryFilePathForDate } from "@phi/core/memory-paths";
import {
	createPhiTransientTurnSnapshot,
	runPhiTransientTurn,
	type PhiTransientTurnRunner,
} from "@phi/core/transient-turn";

import {
	buildPhiMemoryMaintenanceContent,
	type PhiMemoryMaintenanceReason,
} from "./prompt";

export interface CreatePhiMemoryMaintenanceExtensionDependencies {
	runTransientTurn?: PhiTransientTurnRunner;
	memoryFilePath?: string;
}

export const PHI_MEMORY_MAINTENANCE_ENTRY_TYPE = "phi-memory-maintenance";

export interface PhiMemoryMaintenanceEntry {
	reason: PhiMemoryMaintenanceReason;
	status: "started" | "completed" | "skipped_empty_session";
	message: string;
	prompt: string;
	assistantText?: string;
	dailyMemoryFilePath: string;
	timestamp: number;
}

function shouldRunPhiMemoryMaintenance(ctx: ExtensionContext): boolean {
	return ctx.sessionManager.getLeafEntry() !== null;
}

function buildPhiMemoryMaintenanceStatusMessage(
	reason: PhiMemoryMaintenanceReason,
	status: PhiMemoryMaintenanceEntry["status"]
): string {
	if (status === "started") {
		return `Memory maintenance started before ${reason}.`;
	}
	if (status === "completed") {
		return `Memory maintenance completed before ${reason}.`;
	}
	return `Memory maintenance skipped before ${reason}: empty session.`;
}

function appendPhiMemoryMaintenanceEntry(
	pi: Pick<ExtensionAPI, "appendEntry">,
	entry: PhiMemoryMaintenanceEntry
): void {
	pi.appendEntry(PHI_MEMORY_MAINTENANCE_ENTRY_TYPE, entry);
}

function notifyPhiMemoryMaintenance(
	ctx: ExtensionContext,
	message: string
): void {
	ctx.ui.notify(message, "info");
}

async function runPhiMemoryMaintenance(params: {
	ctx: ExtensionContext;
	pi: Pick<
		ExtensionAPI,
		"appendEntry" | "getActiveTools" | "getThinkingLevel"
	>;
	runTransientTurn: PhiTransientTurnRunner;
	reason: PhiMemoryMaintenanceReason;
	dailyMemoryFilePath: string;
}): Promise<void> {
	const prompt = buildPhiMemoryMaintenanceContent(params.reason, {
		dailyMemoryFilePath: params.dailyMemoryFilePath,
	});
	if (!shouldRunPhiMemoryMaintenance(params.ctx)) {
		const message = buildPhiMemoryMaintenanceStatusMessage(
			params.reason,
			"skipped_empty_session"
		);
		appendPhiMemoryMaintenanceEntry(params.pi, {
			reason: params.reason,
			status: "skipped_empty_session",
			message,
			prompt,
			dailyMemoryFilePath: params.dailyMemoryFilePath,
			timestamp: Date.now(),
		});
		notifyPhiMemoryMaintenance(params.ctx, message);
		return;
	}
	const startedMessage = buildPhiMemoryMaintenanceStatusMessage(
		params.reason,
		"started"
	);
	appendPhiMemoryMaintenanceEntry(params.pi, {
		reason: params.reason,
		status: "started",
		message: startedMessage,
		prompt,
		dailyMemoryFilePath: params.dailyMemoryFilePath,
		timestamp: Date.now(),
	});
	notifyPhiMemoryMaintenance(params.ctx, startedMessage);
	const result = await params.runTransientTurn({
		snapshot: createPhiTransientTurnSnapshot({
			ctx: params.ctx,
			pi: params.pi,
		}),
		prompt,
	});
	const completedMessage = buildPhiMemoryMaintenanceStatusMessage(
		params.reason,
		"completed"
	);
	appendPhiMemoryMaintenanceEntry(params.pi, {
		reason: params.reason,
		status: "completed",
		message: completedMessage,
		prompt,
		assistantText: result.assistantText,
		dailyMemoryFilePath: params.dailyMemoryFilePath,
		timestamp: Date.now(),
	});
	notifyPhiMemoryMaintenance(params.ctx, completedMessage);
}

export function createPhiMemoryMaintenanceExtension(
	dependencies: CreatePhiMemoryMaintenanceExtensionDependencies = {}
): ExtensionFactory {
	const runTransientTurn =
		dependencies.runTransientTurn ?? runPhiTransientTurn;
	const memoryFilePath =
		dependencies.memoryFilePath ?? ".phi/memory/MEMORY.md";

	return (pi) => {
		pi.on("session_before_switch", async (_event, ctx) => {
			await runPhiMemoryMaintenance({
				ctx,
				pi,
				runTransientTurn,
				reason: "switch",
				dailyMemoryFilePath: getPhiDailyMemoryFilePathForDate(
					memoryFilePath,
					new Date()
				),
			});
		});

		pi.on("session_before_compact", async (_event, ctx) => {
			await runPhiMemoryMaintenance({
				ctx,
				pi,
				runTransientTurn,
				reason: "compaction",
				dailyMemoryFilePath: getPhiDailyMemoryFilePathForDate(
					memoryFilePath,
					new Date()
				),
			});
		});
	};
}
