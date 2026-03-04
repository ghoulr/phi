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
import type { ChatSessionRuntime } from "@phi/core/runtime";

const fakeRuntime: ChatSessionRuntime<AgentSession> = {
	async getOrCreateSession(): Promise<AgentSession> {
		throw new Error(
			"Session should not be created in service command unit tests."
		);
	},
	disposeSession(): boolean {
		return false;
	},
};

function createChatConfig(
	overrides?: Partial<ResolvedTelegramChatServiceConfig>
): ResolvedTelegramChatServiceConfig {
	return {
		chatId: "user-alice",
		workspace: "~/phi/workspaces/alice",
		telegramChatId: "1001",
		token: "token-1",
		...overrides,
	};
}

describe("service command", () => {
	it("starts grouped telegram bots from chat routes", async () => {
		const startedBotConfigs: Array<{
			token: string;
			chatRoutes: Record<string, { chatId: string; workspace: string }>;
		}> = [];
		const dependencies: ServiceCommandDependencies = {
			resolveTelegramChats(): ResolvedTelegramChatServiceConfig[] {
				return [
					createChatConfig({
						chatId: "user-alice",
						telegramChatId: "1001",
						token: "t1",
					}),
					createChatConfig({
						chatId: "user-bob",
						workspace: "~/phi/workspaces/bob",
						telegramChatId: "1002",
						token: "t1",
					}),
					createChatConfig({
						chatId: "user-carol",
						workspace: "~/phi/workspaces/carol",
						telegramChatId: "2001",
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
				chatRoutes: {
					"1001": {
						chatId: "user-alice",
						workspace: "~/phi/workspaces/alice",
					},
					"1002": {
						chatId: "user-bob",
						workspace: "~/phi/workspaces/bob",
					},
				},
			},
			{
				token: "t2",
				chatRoutes: {
					"2001": {
						chatId: "user-carol",
						workspace: "~/phi/workspaces/carol",
					},
				},
			},
		]);
	});

	it("fails fast when duplicate telegram route exists under same token", async () => {
		const dependencies: ServiceCommandDependencies = {
			resolveTelegramChats(): ResolvedTelegramChatServiceConfig[] {
				return [
					createChatConfig({
						chatId: "user-alice",
						telegramChatId: "1001",
						token: "t1",
					}),
					createChatConfig({
						chatId: "user-bob",
						telegramChatId: "1001",
						token: "t1",
					}),
				];
			},
			async startTelegramBot() {
				throw new Error(
					"Should not start any bot when config is invalid."
				);
			},
		};

		await expect(
			runServiceCommand(fakeRuntime, {} satisfies PhiConfig, dependencies)
		).rejects.toThrow(
			"Duplicate telegram route for token t1 and chat id 1001"
		);
	});

	it("stops already started bots when one bot fails to start", async () => {
		let stopCalls = 0;
		const dependencies: ServiceCommandDependencies = {
			resolveTelegramChats(): ResolvedTelegramChatServiceConfig[] {
				return [
					createChatConfig({ telegramChatId: "1001", token: "t1" }),
					createChatConfig({ telegramChatId: "2001", token: "t2" }),
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
