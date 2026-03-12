import { describe, expect, it } from "bun:test";

import type { AgentSession } from "@mariozechner/pi-coding-agent";

import {
	runServiceCommand,
	type ServiceCommandDependencies,
} from "@phi/commands/service";
import type {
	PhiConfig,
	ResolvedCronChatServiceConfig,
	ResolvedTelegramChatServiceConfig,
} from "@phi/core/config";
import type { ChatSessionRuntime } from "@phi/core/runtime";
import { ServiceRoutes } from "@phi/services/routes";

const fakeRuntime: ChatSessionRuntime<AgentSession> = {
	async getOrCreateSession(): Promise<AgentSession> {
		return {
			systemPrompt: "test-system-prompt",
		} as unknown as AgentSession;
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

function createCronChatConfig(
	overrides?: Partial<ResolvedCronChatServiceConfig>
): ResolvedCronChatServiceConfig {
	return {
		chatId: "user-alice",
		workspace: "~/phi/workspaces/alice",
		...overrides,
	};
}

function createRunningServiceStub(stopCalls?: { value: number }) {
	let resolveDone: (() => void) | undefined;
	const done = new Promise<void>((resolve) => {
		resolveDone = resolve;
	});

	return {
		done,
		async stop(): Promise<void> {
			if (stopCalls) {
				stopCalls.value += 1;
			}
			resolveDone?.();
		},
	};
}

describe("service command", () => {
	it("starts grouped telegram bots from chat routes", async () => {
		const startedBotConfigs: Array<{
			token: string;
			chatRoutes: Record<string, { chatId: string; workspace: string }>;
		}> = [];
		const createdHandlers: string[] = [];
		const dependencies: Partial<ServiceCommandDependencies> = {
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
			resolveCronChats(): ResolvedCronChatServiceConfig[] {
				return [createCronChatConfig()];
			},
			createRoutes(): ServiceRoutes {
				return new ServiceRoutes();
			},
			createChatHandler({ chatId }) {
				createdHandlers.push(chatId);
				return {
					async submitInteractive() {},
					async submitCron() {
						return [];
					},
					invalidate() {},
					dispose() {},
				};
			},
			async startCronRuntime() {
				return createRunningServiceStub();
			},
			async startTelegramBot(_routes, config) {
				startedBotConfigs.push(config);
				return createRunningServiceStub();
			},
		};

		const service = runServiceCommand(
			fakeRuntime,
			{} satisfies PhiConfig,
			dependencies
		);
		await Bun.sleep(0);
		process.emit("SIGTERM");
		await service;
		expect(createdHandlers).toEqual([
			"user-alice",
			"user-bob",
			"user-carol",
		]);
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

	it("creates chat handlers for telegram-only chats without depending on cron resolution", async () => {
		const createdHandlers: string[] = [];
		const dependencies: Partial<ServiceCommandDependencies> = {
			resolveTelegramChats(): ResolvedTelegramChatServiceConfig[] {
				return [
					createChatConfig({
						chatId: "user-bob",
						workspace: "~/phi/workspaces/bob",
						telegramChatId: "1002",
						token: "t1",
					}),
				];
			},
			resolveCronChats(): ResolvedCronChatServiceConfig[] {
				return [];
			},
			createRoutes(): ServiceRoutes {
				return new ServiceRoutes();
			},
			createChatHandler({ chatId }) {
				createdHandlers.push(chatId);
				return {
					async submitInteractive() {},
					async submitCron() {
						return [];
					},
					invalidate() {},
					dispose() {},
				};
			},
			async startCronRuntime() {
				return createRunningServiceStub();
			},
			async startTelegramBot() {
				return createRunningServiceStub();
			},
		};

		const service = runServiceCommand(
			fakeRuntime,
			{} satisfies PhiConfig,
			dependencies
		);
		await Bun.sleep(0);
		process.emit("SIGTERM");
		await service;
		expect(createdHandlers).toEqual(["user-bob"]);
	});

	it("fails fast when duplicate telegram route exists under same token", async () => {
		const dependencies: Partial<ServiceCommandDependencies> = {
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
			resolveCronChats(): ResolvedCronChatServiceConfig[] {
				return [createCronChatConfig()];
			},
			createRoutes(): ServiceRoutes {
				return new ServiceRoutes();
			},
			createChatHandler() {
				return {
					async submitInteractive() {},
					async submitCron() {
						return [];
					},
					invalidate() {},
					dispose() {},
				};
			},
			async startCronRuntime() {
				return createRunningServiceStub();
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

	it("stops already started services and disposes chat handlers when startup fails", async () => {
		const stopCalls = { value: 0 };
		const disposedHandlers: string[] = [];
		const dependencies: Partial<ServiceCommandDependencies> = {
			resolveTelegramChats(): ResolvedTelegramChatServiceConfig[] {
				return [
					createChatConfig({ telegramChatId: "1001", token: "t1" }),
					createChatConfig({ telegramChatId: "2001", token: "t2" }),
				];
			},
			resolveCronChats(): ResolvedCronChatServiceConfig[] {
				return [createCronChatConfig()];
			},
			createRoutes(): ServiceRoutes {
				return new ServiceRoutes();
			},
			createChatHandler({ chatId }) {
				return {
					async submitInteractive() {},
					async submitCron() {
						return [];
					},
					invalidate() {},
					dispose() {
						disposedHandlers.push(chatId);
					},
				};
			},
			async startCronRuntime() {
				return createRunningServiceStub(stopCalls);
			},
			async startTelegramBot(_routes, config) {
				if (config.token === "t2") {
					throw new Error("startup failed");
				}
				return createRunningServiceStub(stopCalls);
			},
		};

		await expect(
			runServiceCommand(fakeRuntime, {} satisfies PhiConfig, dependencies)
		).rejects.toThrow("startup failed");
		expect(stopCalls.value).toBe(1);
		expect(disposedHandlers).toEqual(["user-alice"]);
	});
});
