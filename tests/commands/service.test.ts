import { describe, expect, it } from "bun:test";

import type { AgentSession } from "@mariozechner/pi-coding-agent";

import {
	runServiceCommand,
	type ServiceCommandDependencies,
} from "@phi/commands/service";
import type {
	PhiConfig,
	ResolvedTelegramChatServiceConfig,
} from "@phi/core/config";
import type { AgentConversationRuntime } from "@phi/core/runtime";

const fakeRuntime: AgentConversationRuntime<AgentSession> = {
	async getOrCreateSession(): Promise<AgentSession> {
		throw new Error(
			"Session should not be created in service command unit tests."
		);
	},
	disposeSession(): boolean {
		return false;
	},
	disposeAllSessions(): void {},
};

function createChatConfig(
	overrides?: Partial<ResolvedTelegramChatServiceConfig>
): ResolvedTelegramChatServiceConfig {
	return {
		chatId: "1001",
		agentId: "main",
		token: "token-1",
		...overrides,
	};
}

describe("service command", () => {
	it("starts grouped telegram bots from chat config", async () => {
		const startedBotConfigs: Array<{
			token: string;
			chatAgentRoutes: Record<string, string>;
		}> = [];
		const dependencies: ServiceCommandDependencies = {
			resolveTelegramChats(): ResolvedTelegramChatServiceConfig[] {
				return [
					createChatConfig({
						chatId: "1001",
						agentId: "main",
						token: "t1",
					}),
					createChatConfig({
						chatId: "1002",
						agentId: "support",
						token: "t1",
					}),
					createChatConfig({
						chatId: "2001",
						agentId: "sales",
						token: "t2",
					}),
				];
			},
			async startTelegramBot(_runtime, config) {
				startedBotConfigs.push(config);
				return {
					done: Promise.resolve(),
					async stop(): Promise<void> {},
				};
			},
		};

		await runServiceCommand(
			fakeRuntime,
			{} satisfies PhiConfig,
			dependencies
		);
		expect(startedBotConfigs).toEqual([
			{
				token: "t1",
				chatAgentRoutes: {
					"1001": "main",
					"1002": "support",
				},
			},
			{
				token: "t2",
				chatAgentRoutes: {
					"2001": "sales",
				},
			},
		]);
	});

	it("stops already started bots when one bot fails to start", async () => {
		let stopCalls = 0;
		const dependencies: ServiceCommandDependencies = {
			resolveTelegramChats(): ResolvedTelegramChatServiceConfig[] {
				return [
					createChatConfig({ chatId: "1001", token: "t1" }),
					createChatConfig({ chatId: "2001", token: "t2" }),
				];
			},
			async startTelegramBot(_runtime, config) {
				if (config.token === "t2") {
					throw new Error("startup failed");
				}
				return {
					done: new Promise(() => {
						// Keep pending to simulate long-running polling.
					}),
					async stop(): Promise<void> {
						stopCalls += 1;
					},
				};
			},
		};

		await expect(
			runServiceCommand(fakeRuntime, {} satisfies PhiConfig, dependencies)
		).rejects.toThrow("startup failed");
		expect(stopCalls).toBe(1);
	});
});
