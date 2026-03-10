import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "bun:test";

import {
	buildPhiMessagingEventText,
	createPhiMessagingExtension,
} from "@phi/extensions/messaging";
import { PhiMessagingSessionState } from "@phi/messaging/session-state";
import type { PhiMessage } from "@phi/messaging/types";

const createdDirs: string[] = [];

function createWorkspace(): string {
	const dir = mkdtempSync(join(tmpdir(), "phi-messaging-extension-"));
	createdDirs.push(dir);
	return dir;
}

afterEach(() => {
	for (const dir of createdDirs) {
		rmSync(dir, { recursive: true, force: true });
	}
	createdDirs.length = 0;
});

interface ExtensionHarness {
	handlers: Map<string, () => Promise<void>>;
	tool?: {
		execute: (
			toolCallId: string,
			params: Record<string, unknown>,
			signal?: AbortSignal,
			onUpdate?: unknown,
			ctx?: unknown
		) => Promise<unknown>;
	};
	deliveries: PhiMessage[];
	ctx: { cwd: string };
	state: PhiMessagingSessionState;
}

function createHarness(workspace: string): ExtensionHarness {
	const handlers = new Map<string, () => Promise<void>>();
	const deliveries: PhiMessage[] = [];
	const state = new PhiMessagingSessionState();
	const extension = createPhiMessagingExtension({
		state,
		async deliverMessage(message) {
			deliveries.push(message);
		},
	});

	const harness: ExtensionHarness = {
		handlers,
		deliveries,
		ctx: { cwd: workspace },
		state,
	};

	extension({
		on(
			name: string,
			handler: (event: unknown, ctx: unknown) => Promise<void>
		) {
			handlers.set(name, async () => {
				await handler({} as never, harness.ctx as never);
			});
		},
		registerTool(definition: NonNullable<ExtensionHarness["tool"]>) {
			harness.tool = definition;
		},
	} as never);

	return harness;
}

describe("createPhiMessagingExtension", () => {
	it("delivers instant messages immediately", async () => {
		const workspace = createWorkspace();
		const attachmentPath = join(workspace, "report.txt");
		writeFileSync(attachmentPath, "hello", "utf-8");
		const harness = createHarness(workspace);

		await harness.tool?.execute(
			"call-1",
			{
				text: "done",
				attachments: [{ path: "report.txt" }],
				instant: true,
			},
			undefined,
			undefined,
			harness.ctx
		);

		expect(harness.deliveries).toEqual([
			{
				text: "done",
				attachments: [{ path: attachmentPath, name: "report.txt" }],
			},
		]);
	});

	it("mentions the current sender when requested", async () => {
		const workspace = createWorkspace();
		const harness = createHarness(workspace);
		harness.state.startTurn({
			sender: {
				userId: "100",
				username: "alice",
				displayName: "Alice",
			},
		});
		await harness.tool?.execute(
			"call-1",
			{
				text: "done",
				instant: true,
				mentionSender: true,
			},
			undefined,
			undefined,
			harness.ctx
		);

		expect(harness.deliveries).toEqual([
			{
				text: "done",
				attachments: [],
				mentions: [
					{
						userId: "100",
						username: "alice",
						displayName: "Alice",
					},
				],
			},
		]);
	});

	it("fails when a turn stages more than one deferred message", async () => {
		const workspace = createWorkspace();
		writeFileSync(join(workspace, "report.txt"), "hello", "utf-8");
		const harness = createHarness(workspace);

		await harness.tool?.execute(
			"call-1",
			{ attachments: [{ path: "report.txt" }] },
			undefined,
			undefined,
			harness.ctx
		);

		await expect(
			harness.tool?.execute(
				"call-2",
				{ text: "again" },
				undefined,
				undefined,
				harness.ctx
			)
		).rejects.toThrow("Only one deferred send is allowed per turn.");
	});

	it("keeps deferred message until NO_REPLY resolves it", async () => {
		const workspace = createWorkspace();
		writeFileSync(join(workspace, "report.txt"), "hello", "utf-8");
		const harness = createHarness(workspace);
		harness.state.startTurn(undefined);

		await harness.tool?.execute(
			"call-1",
			{
				text: "report attached",
				attachments: [{ path: "report.txt" }],
			},
			undefined,
			undefined,
			harness.ctx
		);

		expect(
			harness.state.consumeResolvedTurnOutput({
				assistantText: "NO_REPLY",
			})
		).toEqual([
			{
				text: "report attached",
				attachments: [
					{
						path: join(workspace, "report.txt"),
						name: "report.txt",
					},
				],
			},
		]);
	});

	it("exposes control token guidance for the system prompt", () => {
		expect(buildPhiMessagingEventText()).toContain("NO_REPLY");
		expect(buildPhiMessagingEventText()).toContain("End with exact");
	});
});
