import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";

import { afterEach, describe, expect, it } from "bun:test";

import { ensureChatWorkspaceLayout } from "@phi/core/chat-workspace";
import {
	resetPhiLoggerForTest,
	setPhiLoggerSettingsForTest,
} from "@phi/core/logger";
import { ChatReloadRegistry } from "@phi/core/reload";
import type { ChatHandler } from "@phi/services/chat-handler";
import { ServiceRoutes } from "@phi/services/routes";
import { startCronService } from "@phi/cron/service";
import type { PhiMessage } from "@phi/messaging/types";

const createdRoots: string[] = [];
let logOutput = "";
let logCaptureConfigured = false;

function ensureLogCapture(): void {
	if (logCaptureConfigured) {
		return;
	}
	const stream = new Writable({
		write(chunk, _encoding, callback) {
			logOutput += chunk.toString();
			callback();
		},
	});
	setPhiLoggerSettingsForTest({
		level: "debug",
		format: "json",
		stream,
	});
	logCaptureConfigured = true;
}

function readCapturedLogs(): string {
	return logOutput;
}

function createWorkspace(): string {
	ensureLogCapture();
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

function createChatHandler(overrides: Partial<ChatHandler> = {}): ChatHandler {
	return {
		async submitInteractive(): Promise<void> {},
		async submitCron(): Promise<PhiMessage[]> {
			return [];
		},
		async validateReload(): Promise<string[]> {
			return [];
		},
		invalidate(): void {},
		dispose(): void {},
		...overrides,
	};
}

afterEach(() => {
	resetPhiLoggerForTest();
	logOutput = "";
	logCaptureConfigured = false;
	for (const root of createdRoots) {
		rmSync(root, { recursive: true, force: true });
	}
	createdRoots.length = 0;
});

describe("startCronService", () => {
	it("runs one-shot jobs through routes and writes run logs", async () => {
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
			layout.configFilePath,
			[
				"version: 1",
				"chat:",
				`  timezone: ${timezone}`,
				"cron:",
				"  enabled: true",
				"  jobs:",
				"    - id: daily",
				"      prompt: jobs/daily.md",
				`      at: "${at}"`,
			].join("\n"),
			"utf-8"
		);
		const routes = new ServiceRoutes();
		const prompts: string[] = [];
		routes.registerChatHandler(
			"alice",
			createChatHandler({
				async submitCron(input): Promise<PhiMessage[]> {
					prompts.push(input.text);
					return [{ text: "done", attachments: [] }];
				},
			})
		);

		const service = await startCronService({
			phiConfig: {
				chats: {
					alice: {
						workspace,
						agent: "main",
					},
				},
			},
			chatConfigs: [{ chatId: "alice", workspace }],
			reloadRegistry: new ChatReloadRegistry(),
			routes,
		});

		await Bun.sleep(2600);
		await service.stop();

		expect(prompts).toEqual(["Summarize status."]);
		expect(readCapturedLogs()).toContain('"event":"cron.run"');
		expect(readCapturedLogs()).toContain('"status":"ok"');
	});

	it("keeps the previous valid schedule when reload fails", async () => {
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
			layout.configFilePath,
			[
				"version: 1",
				"chat:",
				`  timezone: ${timezone}`,
				"cron:",
				"  enabled: true",
				"  jobs:",
				"    - id: daily",
				"      prompt: jobs/daily.md",
				`      at: "${at}"`,
			].join("\n"),
			"utf-8"
		);
		const routes = new ServiceRoutes();
		let runCalls = 0;
		routes.registerChatHandler(
			"alice",
			createChatHandler({
				async submitCron(): Promise<PhiMessage[]> {
					runCalls += 1;
					return [{ text: "done", attachments: [] }];
				},
			})
		);
		const reloadRegistry = new ChatReloadRegistry();

		const service = await startCronService({
			phiConfig: {
				chats: {
					alice: {
						workspace,
						agent: "main",
					},
				},
			},
			chatConfigs: [{ chatId: "alice", workspace }],
			reloadRegistry,
			routes,
		});

		writeFileSync(
			layout.configFilePath,
			[
				"version: 1",
				"chat:",
				`  timezone: ${timezone}`,
				"cron:",
				"  enabled: true",
				"  jobs:",
				"    - id: broken",
				"      prompt: jobs/missing.md",
				`      at: "${at}"`,
			].join("\n"),
			"utf-8"
		);

		await expect(reloadRegistry.validate("alice")).rejects.toThrow(
			"Missing prompt file for cron job broken"
		);
		await Bun.sleep(2600);
		await service.stop();

		expect(runCalls).toBe(1);
	});
});
