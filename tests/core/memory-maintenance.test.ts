import { describe, expect, it } from "bun:test";

import {
	buildPhiMemoryMaintenanceContent,
	createPhiMemoryMaintenanceExtension,
} from "@phi/core/memory-maintenance";

describe("buildPhiMemoryMaintenanceContent", () => {
	it("builds switch maintenance instructions", () => {
		const content = buildPhiMemoryMaintenanceContent("switch");

		expect(content).toContain("session switch is about to happen");
		expect(content).toContain(".phi/memory/MEMORY.md");
	});

	it("builds compaction maintenance instructions", () => {
		const content = buildPhiMemoryMaintenanceContent("compaction");

		expect(content).toContain("Compaction is about to happen.");
		expect(content).toContain("survive compaction");
		expect(content).toContain(".phi/memory/YYYY-MM-DD.md");
	});
});

describe("createPhiMemoryMaintenanceExtension", () => {
	it("runs transient maintenance before session switch", async () => {
		const handlers = new Map<
			string,
			(event: unknown, ctx: unknown) => Promise<void>
		>();
		const calls: Array<{ prompt: string; snapshot: unknown }> = [];
		const extension = createPhiMemoryMaintenanceExtension({
			async runTransientTurn(params) {
				calls.push(params);
				return { assistantText: undefined };
			},
		});

		extension({
			on(
				name: string,
				handler: (event: unknown, ctx: unknown) => Promise<void>
			) {
				handlers.set(name, handler);
			},
			getThinkingLevel() {
				return "off";
			},
			getActiveTools() {
				return ["read", "bash"];
			},
		} as never);

		await handlers.get("session_before_switch")?.(
			{ reason: "new" },
			{
				cwd: "/workspace/alice",
				modelRegistry: {},
				model: { id: "test-model" },
				getSystemPrompt() {
					return "system prompt";
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
			}
		);

		expect(calls).toHaveLength(1);
		expect(calls[0]?.prompt).toContain("session switch is about to happen");
		expect(calls[0]?.snapshot).toMatchObject({
			cwd: "/workspace/alice",
			systemPrompt: "system prompt",
			activeToolNames: ["read", "bash"],
		});
	});

	it("runs transient maintenance before compaction", async () => {
		const handlers = new Map<
			string,
			(event: unknown, ctx: unknown) => Promise<void>
		>();
		const calls: Array<{ prompt: string; snapshot: unknown }> = [];
		const extension = createPhiMemoryMaintenanceExtension({
			async runTransientTurn(params) {
				calls.push(params);
				return { assistantText: undefined };
			},
		});

		extension({
			on(
				name: string,
				handler: (event: unknown, ctx: unknown) => Promise<void>
			) {
				handlers.set(name, handler);
			},
			getThinkingLevel() {
				return "off";
			},
			getActiveTools() {
				return ["read", "write"];
			},
		} as never);

		await handlers.get("session_before_compact")?.(
			{},
			{
				cwd: "/workspace/alice",
				modelRegistry: {},
				model: { id: "test-model" },
				getSystemPrompt() {
					return "system prompt";
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
			}
		);

		expect(calls).toHaveLength(1);
		expect(calls[0]?.prompt).toContain("Compaction is about to happen.");
		expect(calls[0]?.snapshot).toMatchObject({
			activeToolNames: ["read", "write"],
		});
	});

	it("skips maintenance when the current session is empty", async () => {
		const handlers = new Map<
			string,
			(event: unknown, ctx: unknown) => Promise<void>
		>();
		const calls: Array<{ prompt: string; snapshot: unknown }> = [];
		const extension = createPhiMemoryMaintenanceExtension({
			async runTransientTurn(params) {
				calls.push(params);
				return { assistantText: undefined };
			},
		});

		extension({
			on(
				name: string,
				handler: (event: unknown, ctx: unknown) => Promise<void>
			) {
				handlers.set(name, handler);
			},
			getThinkingLevel() {
				return "off";
			},
			getActiveTools() {
				return ["read"];
			},
		} as never);

		await handlers.get("session_before_switch")?.(
			{ reason: "resume" },
			{
				sessionManager: {
					getLeafEntry() {
						return null;
					},
				},
			}
		);

		expect(calls).toHaveLength(0);
	});
});
