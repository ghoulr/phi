import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "bun:test";
import type {
	ExtensionContext,
	ToolDefinition,
} from "@mariozechner/pi-coding-agent";

import { ensureChatWorkspaceLayout } from "@phi/core/chat-workspace";
import { loadPhiCronConfig } from "@phi/cron/config";
import { CronControllerRegistry } from "@phi/cron/controller";
import { loadCronJobs } from "@phi/cron/store";
import { createCronTools } from "@phi/cron/tools";
import type { PhiMessage } from "@phi/messaging/types";
import { ServiceRoutes } from "@phi/services/routes";
import type { Session } from "@phi/services/session";

function createSession(overrides: Partial<Session> = {}): Session {
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

async function executeTool(
	tool: ToolDefinition,
	params: Record<string, unknown>
) {
	return await tool.execute("call-1", params, undefined, undefined, {
		cwd: "/tmp",
	} as unknown as ExtensionContext);
}

function requireTool(tools: ToolDefinition[], name: string): ToolDefinition {
	const tool = tools.find((entry) => entry.name === name);
	if (!tool) {
		throw new Error(`Missing tool: ${name}`);
	}
	return tool;
}

describe("cron tools", () => {
	it("creates a cron job bound to the current endpoint chat", async () => {
		const root = mkdtempSync(join(tmpdir(), "phi-cron-tools-"));

		try {
			const layout = ensureChatWorkspaceLayout(root);
			writeFileSync(
				layout.configFilePath,
				"version: 1\nchat:\n  timezone: Asia/Shanghai\n",
				"utf-8"
			);
			const routes = new ServiceRoutes();
			routes.registerInteractiveRoute(
				"telegram:bot-1",
				"42",
				"alice-main"
			);
			routes.registerOutboundRoute("alice-main", "42", {
				async deliver(): Promise<void> {},
			});
			const controllerRegistry = new CronControllerRegistry();
			let reloadCalls = 0;
			controllerRegistry.register("alice", {
				async reload() {
					reloadCalls += 1;
					return { jobCount: 1, nextRunAtMs: undefined };
				},
			});
			const tools = createCronTools({
				chatId: "alice",
				sessionId: "alice-main",
				workspaceDir: root,
				routes,
				controllerRegistry,
			});

			await executeTool(requireTool(tools, "createCron"), {
				id: "daily-summary",
				prompt: "Send the summary now.",
				cron: "0 9 * * *",
			});

			const cronConfig = loadPhiCronConfig(layout.cronConfigFilePath);
			expect(loadCronJobs({ layout, cronConfig })).toEqual([
				{
					id: "daily-summary",
					enabled: true,
					sessionId: "alice-main",
					endpointChatId: "42",
					prompt: "jobs/daily-summary.md",
					promptFilePath: join(
						layout.cronJobsDir,
						"daily-summary.md"
					),
					promptText: "Send the summary now.",
					cron: "0 9 * * *",
					at: undefined,
				},
			]);
			expect(reloadCalls).toBe(1);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("fires a cron job through its stored session and endpoint chat", async () => {
		const root = mkdtempSync(join(tmpdir(), "phi-cron-tools-"));

		try {
			const layout = ensureChatWorkspaceLayout(root);
			writeFileSync(
				layout.configFilePath,
				"version: 1\nchat:\n  timezone: Asia/Shanghai\n",
				"utf-8"
			);
			writeFileSync(
				join(layout.cronJobsDir, "daily.md"),
				"Send the report now.\n",
				"utf-8"
			);
			writeFileSync(
				layout.cronConfigFilePath,
				[
					"jobs:",
					"  - id: daily",
					"    sessionId: alice-target",
					"    endpointChatId: 99",
					"    prompt: jobs/daily.md",
					'    cron: "0 9 * * *"',
				].join("\n"),
				"utf-8"
			);
			const routes = new ServiceRoutes();
			routes.registerInteractiveRoute(
				"telegram:bot-1",
				"42",
				"alice-main"
			);
			let firedSessionId = "";
			let firedEndpointChatId = "";
			routes.registerSession(
				"alice-target",
				createSession({
					async submitCron(input): Promise<PhiMessage[]> {
						firedSessionId = "alice-target";
						firedEndpointChatId = input.endpointChatId;
						return [{ text: input.text, attachments: [] }];
					},
				})
			);
			const controllerRegistry = new CronControllerRegistry();
			controllerRegistry.register("alice", {
				async reload() {
					return { jobCount: 1, nextRunAtMs: undefined };
				},
			});
			const tools = createCronTools({
				chatId: "alice",
				sessionId: "alice-main",
				workspaceDir: root,
				routes,
				controllerRegistry,
			});

			await executeTool(requireTool(tools, "fireCron"), {
				id: "daily",
			});

			expect(firedSessionId).toBe("alice-target");
			expect(firedEndpointChatId).toBe("99");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("rolls back file changes when reload fails", async () => {
		const root = mkdtempSync(join(tmpdir(), "phi-cron-tools-"));

		try {
			const layout = ensureChatWorkspaceLayout(root);
			const routes = new ServiceRoutes();
			routes.registerInteractiveRoute(
				"telegram:bot-1",
				"42",
				"alice-main"
			);
			routes.registerOutboundRoute("alice-main", "42", {
				async deliver(): Promise<void> {},
			});
			const controllerRegistry = new CronControllerRegistry();
			controllerRegistry.register("alice", {
				async reload() {
					throw new Error("Broken cron config");
				},
			});
			const tools = createCronTools({
				chatId: "alice",
				sessionId: "alice-main",
				workspaceDir: root,
				routes,
				controllerRegistry,
			});

			await expect(
				executeTool(requireTool(tools, "createCron"), {
					id: "daily",
					prompt: "Send it now.",
					cron: "0 9 * * *",
				})
			).rejects.toThrow("Broken cron config");
			expect(existsSync(join(layout.cronJobsDir, "daily.md"))).toBe(
				false
			);
			expect(loadPhiCronConfig(layout.cronConfigFilePath)).toEqual({
				jobs: [],
			});
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
