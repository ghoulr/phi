import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "bun:test";

import { createPhiMessagingExtension } from "@phi/extensions/messaging";
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
	handlers: Map<string, (event: unknown) => Promise<void>>;
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
	ctx: {
		cwd: string;
		sessionManager: {
			getBranch(): Array<{
				type: "message";
				message: {
					role: "user" | "assistant";
					content:
						| string
						| Array<
								| { type: "text"; text: string }
								| { type: "image" }
						  >;
				};
			}>;
		};
	};
}

function createHarness(params: {
	workspace: string;
	branchContent?: string | (() => string);
}): ExtensionHarness {
	const handlers = new Map<string, (event: unknown) => Promise<void>>();
	const deliveries: PhiMessage[] = [];
	const extension = createPhiMessagingExtension({
		async deliverMessage(message) {
			deliveries.push(message);
		},
	});
	const harness: ExtensionHarness = {
		handlers,
		deliveries,
		ctx: {
			cwd: params.workspace,
			sessionManager: {
				getBranch() {
					const branchContent =
						typeof params.branchContent === "function"
							? params.branchContent()
							: params.branchContent;
					return [
						{
							type: "message",
							message: {
								role: "user",
								content: branchContent
									? [{ type: "text", text: branchContent }]
									: [{ type: "text", text: "hello" }],
							},
						},
					];
				},
			},
		},
	};

	extension({
		on(
			name: string,
			handler: (event: unknown, ctx: unknown) => Promise<void>
		) {
			handlers.set(name, async (event: unknown) => {
				await handler(event, harness.ctx as never);
			});
		},
		registerTool(definition: NonNullable<ExtensionHarness["tool"]>) {
			harness.tool = definition;
		},
	} as never);

	return harness;
}

function buildReminderText(params: {
	id: string;
	username?: string;
	firstName?: string;
	lastName?: string;
}): string {
	const lines = [
		"hello",
		"<system-reminder>",
		"current_message:",
		"  from:",
		`    id: ${params.id}`,
	];
	if (params.username) {
		lines.push(`    username: ${params.username}`);
	}
	if (params.firstName) {
		lines.push(`    first_name: ${params.firstName}`);
	}
	if (params.lastName) {
		lines.push(`    last_name: ${params.lastName}`);
	}
	lines.push("</system-reminder>");
	return lines.join("\n");
}

function createAgentEndEvent(text: string) {
	return {
		type: "agent_end",
		messages: [
			{
				role: "assistant",
				content: [{ type: "text", text }],
			},
		],
		message: {
			role: "assistant",
			content: [{ type: "text", text }],
		},
	};
}

describe("createPhiMessagingExtension", () => {
	it("delivers the final assistant reply on agent end", async () => {
		const harness = createHarness({ workspace: createWorkspace() });

		await harness.handlers.get("agent_start")?.({ type: "agent_start" });
		await harness.handlers.get("agent_end")?.(createAgentEndEvent("done"));

		expect(harness.deliveries).toEqual([{ text: "done", attachments: [] }]);
	});

	it("delivers instant messages immediately and suppresses the final NO_REPLY", async () => {
		const workspace = createWorkspace();
		const attachmentPath = join(workspace, "report.txt");
		writeFileSync(attachmentPath, "hello", "utf-8");
		const harness = createHarness({ workspace });

		await harness.handlers.get("agent_start")?.({ type: "agent_start" });
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
		await harness.handlers.get("agent_end")?.(
			createAgentEndEvent("NO_REPLY")
		);

		expect(harness.deliveries).toEqual([
			{
				text: "done",
				attachments: [{ path: attachmentPath, name: "report.txt" }],
			},
		]);
	});

	it("merges deferred content with the final assistant reply", async () => {
		const workspace = createWorkspace();
		const attachmentPath = join(workspace, "report.txt");
		writeFileSync(attachmentPath, "hello", "utf-8");
		const harness = createHarness({ workspace });

		await harness.handlers.get("agent_start")?.({ type: "agent_start" });
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
		await harness.handlers.get("agent_end")?.(createAgentEndEvent("done"));

		expect(harness.deliveries).toEqual([
			{
				text: "done\n\nreport attached",
				attachments: [{ path: attachmentPath, name: "report.txt" }],
			},
		]);
	});

	it("delivers deferred content alone when final reply is NO_REPLY", async () => {
		const workspace = createWorkspace();
		const attachmentPath = join(workspace, "report.txt");
		writeFileSync(attachmentPath, "hello", "utf-8");
		const harness = createHarness({ workspace });

		await harness.handlers.get("agent_start")?.({ type: "agent_start" });
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
		await harness.handlers.get("agent_end")?.(
			createAgentEndEvent("NO_REPLY")
		);

		expect(harness.deliveries).toEqual([
			{
				text: "report attached",
				attachments: [{ path: attachmentPath, name: "report.txt" }],
			},
		]);
	});

	it("mentions the current sender from the system reminder", async () => {
		const harness = createHarness({
			workspace: createWorkspace(),
			branchContent: buildReminderText({
				id: "100",
				username: "alice",
				firstName: "Alice",
			}),
		});

		await harness.handlers.get("agent_start")?.({ type: "agent_start" });
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
		const harness = createHarness({ workspace });

		await harness.handlers.get("agent_start")?.({ type: "agent_start" });
		await harness.tool?.execute(
			"call-1",
			{ text: "first" },
			undefined,
			undefined,
			harness.ctx
		);

		await expect(
			harness.tool?.execute(
				"call-2",
				{ text: "second" },
				undefined,
				undefined,
				harness.ctx
			)
		).rejects.toThrow("Only one deferred send is allowed per turn.");
	});

	it("keeps mentionSender bound to the active turn", async () => {
		let branchContent = buildReminderText({
			id: "100",
			username: "alice",
			firstName: "Alice",
		});
		const harness = createHarness({
			workspace: createWorkspace(),
			branchContent: () => branchContent,
		});

		await harness.handlers.get("agent_start")?.({ type: "agent_start" });
		branchContent = buildReminderText({
			id: "200",
			username: "bob",
			firstName: "Bob",
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

	it("fails when mentionSender is requested without sender metadata", async () => {
		const harness = createHarness({
			workspace: createWorkspace(),
			branchContent: "hello",
		});

		await harness.handlers.get("agent_start")?.({ type: "agent_start" });
		await expect(
			harness.tool?.execute(
				"call-1",
				{
					text: "done",
					instant: true,
					mentionSender: true,
				},
				undefined,
				undefined,
				harness.ctx
			)
		).rejects.toThrow("Current turn has no sender to mention.");
	});
});
