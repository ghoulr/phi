import { describe, expect, it } from "bun:test";

import {
	createPhiMemoryMaintenanceExtension,
	PHI_MEMORY_MAINTENANCE_ENTRY_TYPE,
} from "@phi/extensions/memory-maintenance";

function getExpectedDailyMemoryFilePath(): string {
	const now = new Date();
	const year = now.getFullYear();
	const month = `${now.getMonth() + 1}`.padStart(2, "0");
	const day = `${now.getDate()}`.padStart(2, "0");
	return `.phi/memory/${year}-${month}-${day}.md`;
}

interface ExtensionHarness {
	handlers: Map<string, (event: unknown, ctx: unknown) => Promise<void>>;
	notifications: string[];
	entries: Array<{ customType: string; data: unknown }>;
	pi: {
		on(
			name: string,
			handler: (event: unknown, ctx: unknown) => Promise<void>
		): void;
		appendEntry(customType: string, data?: unknown): void;
		getThinkingLevel(): "off";
		getActiveTools(): string[];
	};
	ctx: {
		cwd: string;
		modelRegistry: object;
		model: { id: string };
		getSystemPrompt(): string;
		ui: {
			notify(message: string): void;
		};
		sessionManager: {
			getLeafEntry(): { id: string } | null;
			getLeafId(): string;
			getEntries(): Array<{
				type: string;
				id: string;
				parentId: null;
				timestamp: string;
				message: {
					role: string;
					content: Array<{ type: string; text: string }>;
					timestamp: number;
				};
			}>;
		};
	};
}

function createExtensionHarness(): ExtensionHarness {
	const handlers = new Map<
		string,
		(event: unknown, ctx: unknown) => Promise<void>
	>();
	const notifications: string[] = [];
	const entries: Array<{ customType: string; data: unknown }> = [];
	return {
		handlers,
		notifications,
		entries,
		pi: {
			on(
				name: string,
				handler: (event: unknown, ctx: unknown) => Promise<void>
			) {
				handlers.set(name, handler);
			},
			appendEntry(customType: string, data?: unknown) {
				entries.push({ customType, data });
			},
			getThinkingLevel() {
				return "off";
			},
			getActiveTools() {
				return ["read", "bash"];
			},
		},
		ctx: {
			cwd: "/workspace/alice",
			modelRegistry: {},
			model: { id: "test-model" },
			getSystemPrompt() {
				return "system prompt";
			},
			ui: {
				notify(message: string) {
					notifications.push(message);
				},
			},
			sessionManager: {
				getLeafEntry() {
					return { id: "leaf" };
				},
				getLeafId() {
					return "leaf";
				},
				getEntries() {
					return [
						{
							type: "message",
							id: "leaf",
							parentId: null,
							timestamp: "2026-03-06T00:00:00.000Z",
							message: {
								role: "user",
								content: [{ type: "text", text: "hello" }],
								timestamp: Date.now(),
							},
						},
					];
				},
			},
		},
	};
}

describe("createPhiMemoryMaintenanceExtension", () => {
	it("runs transient maintenance before session switch and records observability", async () => {
		const harness = createExtensionHarness();
		const expectedDailyMemoryFilePath = getExpectedDailyMemoryFilePath();
		const calls: Array<{ prompt: string; snapshot: unknown }> = [];
		const extension = createPhiMemoryMaintenanceExtension({
			async runTransientTurn(params) {
				calls.push(params);
				return { assistantText: "maintenance complete" };
			},
		});

		extension(harness.pi as never);

		await harness.handlers.get("session_before_switch")?.(
			{ reason: "new" },
			harness.ctx as never
		);

		expect(calls).toHaveLength(1);
		expect(calls[0]?.prompt).toContain("session switch is about to happen");
		expect(calls[0]?.snapshot).toMatchObject({
			cwd: "/workspace/alice",
			systemPrompt: "system prompt",
			activeToolNames: ["read", "bash"],
		});
		expect(harness.notifications).toEqual([
			"Memory maintenance started before switch.",
			"Memory maintenance completed before switch.",
		]);
		expect(harness.entries).toHaveLength(2);
		expect(harness.entries[0]?.customType).toBe(
			PHI_MEMORY_MAINTENANCE_ENTRY_TYPE
		);
		expect(harness.entries[0]?.data).toMatchObject({
			reason: "switch",
			status: "started",
			message: "Memory maintenance started before switch.",
			prompt: calls[0]?.prompt,
			dailyMemoryFilePath: expectedDailyMemoryFilePath,
		});
		expect(harness.entries[1]?.data).toMatchObject({
			reason: "switch",
			status: "completed",
			message: "Memory maintenance completed before switch.",
			prompt: calls[0]?.prompt,
			assistantText: "maintenance complete",
			dailyMemoryFilePath: expectedDailyMemoryFilePath,
		});
	});

	it("runs transient maintenance before compaction and records observability", async () => {
		const harness = createExtensionHarness();
		const expectedDailyMemoryFilePath = getExpectedDailyMemoryFilePath();
		harness.pi.getActiveTools = () => ["read", "write"];
		const calls: Array<{ prompt: string; snapshot: unknown }> = [];
		const extension = createPhiMemoryMaintenanceExtension({
			async runTransientTurn(params) {
				calls.push(params);
				return { assistantText: "maintenance complete" };
			},
		});

		extension(harness.pi as never);

		await harness.handlers.get("session_before_compact")?.(
			{},
			harness.ctx as never
		);

		expect(calls).toHaveLength(1);
		expect(calls[0]?.prompt).toContain("Compaction is about to happen.");
		expect(calls[0]?.snapshot).toMatchObject({
			activeToolNames: ["read", "write"],
		});
		expect(harness.notifications).toEqual([
			"Memory maintenance started before compaction.",
			"Memory maintenance completed before compaction.",
		]);
		expect(harness.entries.map((entry) => entry.data)).toMatchObject([
			{
				reason: "compaction",
				status: "started",
				message: "Memory maintenance started before compaction.",
				prompt: calls[0]?.prompt,
				dailyMemoryFilePath: expectedDailyMemoryFilePath,
			},
			{
				reason: "compaction",
				status: "completed",
				message: "Memory maintenance completed before compaction.",
				prompt: calls[0]?.prompt,
				assistantText: "maintenance complete",
				dailyMemoryFilePath: expectedDailyMemoryFilePath,
			},
		]);
	});

	it("records skip when the current session is empty", async () => {
		const harness = createExtensionHarness();
		const expectedDailyMemoryFilePath = getExpectedDailyMemoryFilePath();
		harness.ctx.sessionManager.getLeafEntry = () => null;
		const calls: Array<{ prompt: string; snapshot: unknown }> = [];
		const extension = createPhiMemoryMaintenanceExtension({
			async runTransientTurn(params) {
				calls.push(params);
				return { assistantText: undefined };
			},
		});

		extension(harness.pi as never);

		await harness.handlers.get("session_before_switch")?.(
			{ reason: "resume" },
			harness.ctx as never
		);

		expect(calls).toHaveLength(0);
		expect(harness.notifications).toEqual([
			"Memory maintenance skipped before switch: empty session.",
		]);
		expect(harness.entries).toHaveLength(1);
		expect(harness.entries[0]?.customType).toBe(
			PHI_MEMORY_MAINTENANCE_ENTRY_TYPE
		);
		expect(harness.entries[0]?.data).toMatchObject({
			reason: "switch",
			status: "skipped_empty_session",
			message: "Memory maintenance skipped before switch: empty session.",
			prompt: expect.any(String),
			dailyMemoryFilePath: expectedDailyMemoryFilePath,
		});
	});

	it("uses a concrete global daily memory path for tui-style memory", async () => {
		const harness = createExtensionHarness();
		const calls: Array<{ prompt: string; snapshot: unknown }> = [];
		const extension = createPhiMemoryMaintenanceExtension({
			memoryFilePath: "/home/tester/.phi/pi/memory/MEMORY.md",
			async runTransientTurn(params) {
				calls.push(params);
				return { assistantText: "maintenance complete" };
			},
		});

		extension(harness.pi as never);

		await harness.handlers.get("session_before_compact")?.(
			{},
			harness.ctx as never
		);

		expect(calls).toHaveLength(1);
		expect(calls[0]?.prompt).toContain("/home/tester/.phi/pi/memory/");
		expect(calls[0]?.prompt).not.toContain("YYYY-MM-DD.md");
		expect(calls[0]?.prompt).toMatch(
			/\/home\/tester\/.phi\/pi\/memory\/\d{4}-\d{2}-\d{2}\.md/
		);
		expect(harness.entries[1]?.data).toMatchObject({
			reason: "compaction",
			status: "completed",
			assistantText: "maintenance complete",
			dailyMemoryFilePath: expect.stringMatching(
				/\/home\/tester\/.phi\/pi\/memory\/\d{4}-\d{2}-\d{2}\.md/
			),
		});
	});
});
