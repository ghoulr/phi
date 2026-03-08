import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "bun:test";

import type { AgentSession } from "@mariozechner/pi-coding-agent";
import type { AssistantMessage } from "@mariozechner/pi-ai";

import { InMemoryChatExecutor } from "@phi/core/chat-executor";
import { ensureChatWorkspaceLayout } from "@phi/core/chat-workspace";
import { ChatReloadRegistry } from "@phi/core/reload";
import type { ChatSessionRuntime } from "@phi/core/runtime";
import { startCronService } from "@phi/cron/service";

const createdRoots: string[] = [];

function createWorkspace(): string {
	const root = mkdtempSync(join(tmpdir(), "phi-cron-service-"));
	createdRoots.push(root);
	return root;
}

function formatLocalDateTime(timestampMs: number, timezone: string): string {
	const formatter = new Intl.DateTimeFormat("en-CA", {
		timeZone: timezone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
		hour12: false,
	});
	const parts = Object.fromEntries(
		formatter
			.formatToParts(new Date(timestampMs))
			.filter((part) => part.type !== "literal")
			.map((part) => [part.type, part.value])
	);
	return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

function createAssistantMessage(text: string): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: "openai-responses",
		provider: "openai",
		model: "gpt-5.2",
		usage: {
			input: 1,
			output: 1,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 2,
			cost: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				total: 0,
			},
		},
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

afterEach(() => {
	for (const root of createdRoots) {
		rmSync(root, { recursive: true, force: true });
	}
	createdRoots.length = 0;
});

describe("startCronService", () => {
	it("runs one-shot jobs and writes run logs", async () => {
		const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
		const workspace = createWorkspace();
		const layout = ensureChatWorkspaceLayout(workspace);
		const at = formatLocalDateTime(Date.now() + 2000, timezone);
		writeFileSync(
			join(layout.cronJobsDir, "daily.md"),
			"Summarize status.",
			"utf-8"
		);
		writeFileSync(
			layout.cronJobsFilePath,
			[
				"jobs:",
				"  - id: daily",
				"    prompt: jobs/daily.md",
				`    at: "${at}"`,
			].join("\n"),
			"utf-8"
		);

		let publishCalls = 0;
		const runtime: ChatSessionRuntime<AgentSession> = {
			async getOrCreateSession(): Promise<AgentSession> {
				throw new Error("publishResult stub should handle publishing");
			},
			disposeSession(): boolean {
				return false;
			},
		};

		const service = await startCronService({
			runtime,
			phiConfig: {
				chats: {
					alice: {
						workspace,
						agent: "main",
						timezone,
					},
				},
			},
			chatConfigs: [{ chatId: "alice", workspace, timezone }],
			chatExecutor: new InMemoryChatExecutor(),
			reloadRegistry: new ChatReloadRegistry(),
			dependencies: {
				async runJob() {
					return {
						assistantMessage: createAssistantMessage("done"),
						assistantText: "done",
						outboundMessages: [{ text: "done", attachments: [] }],
					};
				},
				async publishResult() {
					publishCalls += 1;
				},
			},
		});

		await Bun.sleep(2600);
		await service.stop();

		expect(publishCalls).toBe(1);
		expect(readFileSync(layout.cronRunsFilePath, "utf-8")).toContain(
			'"status":"ok"'
		);
	});

	it("keeps the previous valid state when reload fails", async () => {
		const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
		const workspace = createWorkspace();
		const layout = ensureChatWorkspaceLayout(workspace);
		const at = formatLocalDateTime(Date.now() + 2000, timezone);
		writeFileSync(
			join(layout.cronJobsDir, "daily.md"),
			"Summarize status.",
			"utf-8"
		);
		writeFileSync(
			layout.cronJobsFilePath,
			[
				"jobs:",
				"  - id: daily",
				"    prompt: jobs/daily.md",
				`    at: "${at}"`,
			].join("\n"),
			"utf-8"
		);

		let runCalls = 0;
		const reloadRegistry = new ChatReloadRegistry();
		const service = await startCronService({
			runtime: {
				async getOrCreateSession(): Promise<AgentSession> {
					throw new Error(
						"publishResult stub should handle publishing"
					);
				},
				disposeSession(): boolean {
					return false;
				},
			},
			phiConfig: {
				chats: {
					alice: {
						workspace,
						agent: "main",
						timezone,
					},
				},
			},
			chatConfigs: [{ chatId: "alice", workspace, timezone }],
			chatExecutor: new InMemoryChatExecutor(),
			reloadRegistry,
			dependencies: {
				async runJob() {
					runCalls += 1;
					return {
						assistantMessage: createAssistantMessage("done"),
						assistantText: "done",
						outboundMessages: [{ text: "done", attachments: [] }],
					};
				},
				async publishResult() {},
			},
		});

		writeFileSync(
			layout.cronJobsFilePath,
			[
				"jobs:",
				"  - id: broken",
				"    prompt: jobs/missing.md",
				`    at: "${at}"`,
			].join("\n"),
			"utf-8"
		);

		await expect(reloadRegistry.reload("alice")).rejects.toThrow(
			"Missing prompt file for cron job broken"
		);
		await Bun.sleep(2600);
		await service.stop();

		expect(runCalls).toBe(1);
	});
});
