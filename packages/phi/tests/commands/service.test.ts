import { describe, expect, it } from "bun:test";

import type { AgentSession } from "@mariozechner/pi-coding-agent";

import {
	runServiceCommand,
	type ServiceCommandDependencies,
} from "@phi/commands/service";
import type {
	PhiConfig,
	ResolvedCronChatServiceConfig,
	ResolvedFeishuSessionServiceConfig,
	ResolvedTelegramSessionServiceConfig,
} from "@phi/core/config";
import type { SessionRuntime } from "@phi/core/runtime";
import { ServiceRoutes } from "@phi/services/routes";

const fakeRuntime: SessionRuntime<AgentSession> = {
	async getOrCreateSession(): Promise<AgentSession> {
		return {
			systemPrompt: "test-system-prompt",
		} as unknown as AgentSession;
	},
	disposeSession(): boolean {
		return false;
	},
};

function createTelegramSessionConfig(
	overrides?: Partial<ResolvedTelegramSessionServiceConfig>
): ResolvedTelegramSessionServiceConfig {
	return {
		sessionId: "2026-03-19T00-00-00-000Z_alice-telegram",
		configSessionId: "alice-telegram",
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

function createFeishuSessionConfig(
	overrides?: Partial<ResolvedFeishuSessionServiceConfig>
): ResolvedFeishuSessionServiceConfig {
	return {
		sessionId: "alice-feishu",
		chatId: "user-alice",
		workspace: "~/phi/workspaces/alice",
		feishuChatId: "oc_1001",
		appId: "cli_app_1",
		appSecret: "secret-1",
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
	it("starts grouped telegram endpoints from session routes", async () => {
		const startedEndpointConfigs: Array<{
			token: string;
			chatRoutes: Record<
				string,
				{ sessionId: string; chatId: string; workspace: string }
			>;
		}> = [];
		const createdSessions: string[] = [];
		const dependencies: Partial<ServiceCommandDependencies> = {
			resolveTelegramSessions(): ResolvedTelegramSessionServiceConfig[] {
				return [
					createTelegramSessionConfig({
						sessionId: "alice-telegram",
						chatId: "user-alice",
						telegramChatId: "1001",
						token: "t1",
					}),
					createTelegramSessionConfig({
						sessionId: "bob-telegram",
						chatId: "user-bob",
						workspace: "~/phi/workspaces/bob",
						telegramChatId: "1002",
						token: "t1",
					}),
					createTelegramSessionConfig({
						sessionId: "carol-telegram",
						chatId: "user-carol",
						workspace: "~/phi/workspaces/carol",
						telegramChatId: "2001",
						token: "t2",
					}),
				];
			},
			resolveFeishuSessions(): ResolvedFeishuSessionServiceConfig[] {
				return [];
			},
			resolveTelegramWildcardRoutes() {
				return [];
			},
			resolveCronSessions(): ResolvedCronChatServiceConfig[] {
				return [createCronChatConfig()];
			},
			createRoutes(): ServiceRoutes {
				return new ServiceRoutes();
			},
			createSession({ sessionId }) {
				createdSessions.push(sessionId);
				return {
					async submitInteractive() {},
					async submitCron() {
						return [];
					},
					async validateReload() {
						return [];
					},
					invalidate() {},
					dispose() {},
				};
			},
			async startCronRuntime() {
				return createRunningServiceStub();
			},
			async startTelegramEndpoint(_routes, config) {
				startedEndpointConfigs.push(config);
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
		expect(createdSessions).toEqual([
			"alice-telegram",
			"bob-telegram",
			"carol-telegram",
		]);
		expect(startedEndpointConfigs).toEqual([
			{
				token: "t1",
				chatRoutes: {
					"1001": {
						sessionId: "alice-telegram",
						chatId: "user-alice",
						workspace: "~/phi/workspaces/alice",
					},
					"1002": {
						sessionId: "bob-telegram",
						chatId: "user-bob",
						workspace: "~/phi/workspaces/bob",
					},
				},
			},
			{
				token: "t2",
				chatRoutes: {
					"2001": {
						sessionId: "carol-telegram",
						chatId: "user-carol",
						workspace: "~/phi/workspaces/carol",
					},
				},
			},
		]);
	});

	it("fails fast when duplicate telegram route exists under same token", async () => {
		const dependencies: Partial<ServiceCommandDependencies> = {
			resolveTelegramSessions(): ResolvedTelegramSessionServiceConfig[] {
				return [
					createTelegramSessionConfig({
						sessionId: "alice-telegram",
						telegramChatId: "1001",
						token: "t1",
					}),
					createTelegramSessionConfig({
						sessionId: "bob-telegram",
						chatId: "user-bob",
						telegramChatId: "1001",
						token: "t1",
					}),
				];
			},
			resolveFeishuSessions(): ResolvedFeishuSessionServiceConfig[] {
				return [];
			},
			resolveTelegramWildcardRoutes() {
				return [];
			},
			resolveCronSessions(): ResolvedCronChatServiceConfig[] {
				return [];
			},
			createRoutes(): ServiceRoutes {
				return new ServiceRoutes();
			},
			createSession() {
				return {
					async submitInteractive() {},
					async submitCron() {
						return [];
					},
					async validateReload() {
						return [];
					},
					invalidate() {},
					dispose() {},
				};
			},
			async startCronRuntime() {
				return createRunningServiceStub();
			},
			async startTelegramEndpoint() {
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

	it("starts grouped feishu endpoints from session routes", async () => {
		const startedEndpointConfigs: Array<{
			appId: string;
			appSecret: string;
			chatRoutes: Record<
				string,
				{ sessionId: string; chatId: string; workspace: string }
			>;
		}> = [];
		const dependencies: Partial<ServiceCommandDependencies> = {
			resolveTelegramSessions(): ResolvedTelegramSessionServiceConfig[] {
				return [];
			},
			resolveFeishuSessions(): ResolvedFeishuSessionServiceConfig[] {
				return [
					createFeishuSessionConfig({
						sessionId: "alice-feishu",
						chatId: "user-alice",
						feishuChatId: "oc_1001",
						appId: "cli_app_1",
						appSecret: "secret-1",
					}),
					createFeishuSessionConfig({
						sessionId: "bob-feishu",
						chatId: "user-bob",
						workspace: "~/phi/workspaces/bob",
						feishuChatId: "oc_1002",
						appId: "cli_app_1",
						appSecret: "secret-1",
					}),
					createFeishuSessionConfig({
						sessionId: "carol-feishu",
						chatId: "user-carol",
						workspace: "~/phi/workspaces/carol",
						feishuChatId: "oc_2001",
						appId: "cli_app_2",
						appSecret: "secret-2",
					}),
				];
			},
			resolveTelegramWildcardRoutes() {
				return [];
			},
			resolveCronSessions(): ResolvedCronChatServiceConfig[] {
				return [];
			},
			createRoutes(): ServiceRoutes {
				return new ServiceRoutes();
			},
			createSession() {
				return {
					async submitInteractive() {},
					async submitCron() {
						return [];
					},
					async validateReload() {
						return [];
					},
					invalidate() {},
					dispose() {},
				};
			},
			async startCronRuntime() {
				return createRunningServiceStub();
			},
			async startFeishuEndpoint(_routes, config) {
				startedEndpointConfigs.push(config);
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
		expect(startedEndpointConfigs).toEqual([
			{
				appId: "cli_app_1",
				appSecret: "secret-1",
				chatRoutes: {
					oc_1001: {
						sessionId: "alice-feishu",
						chatId: "user-alice",
						workspace: "~/phi/workspaces/alice",
					},
					oc_1002: {
						sessionId: "bob-feishu",
						chatId: "user-bob",
						workspace: "~/phi/workspaces/bob",
					},
				},
			},
			{
				appId: "cli_app_2",
				appSecret: "secret-2",
				chatRoutes: {
					oc_2001: {
						sessionId: "carol-feishu",
						chatId: "user-carol",
						workspace: "~/phi/workspaces/carol",
					},
				},
			},
		]);
	});

	it("fails fast when duplicate feishu route exists under same app", async () => {
		const dependencies: Partial<ServiceCommandDependencies> = {
			resolveTelegramSessions(): ResolvedTelegramSessionServiceConfig[] {
				return [];
			},
			resolveFeishuSessions(): ResolvedFeishuSessionServiceConfig[] {
				return [
					createFeishuSessionConfig({
						sessionId: "alice-feishu",
						feishuChatId: "oc_1001",
						appId: "cli_app_1",
						appSecret: "secret-1",
					}),
					createFeishuSessionConfig({
						sessionId: "bob-feishu",
						chatId: "user-bob",
						feishuChatId: "oc_1001",
						appId: "cli_app_1",
						appSecret: "secret-1",
					}),
				];
			},
			resolveTelegramWildcardRoutes() {
				return [];
			},
			resolveCronSessions(): ResolvedCronChatServiceConfig[] {
				return [];
			},
			createRoutes(): ServiceRoutes {
				return new ServiceRoutes();
			},
			createSession() {
				return {
					async submitInteractive() {},
					async submitCron() {
						return [];
					},
					async validateReload() {
						return [];
					},
					invalidate() {},
					dispose() {},
				};
			},
			async startCronRuntime() {
				return createRunningServiceStub();
			},
			async startFeishuEndpoint() {
				throw new Error(
					"Should not start any feishu client when config is invalid."
				);
			},
		};

		await expect(
			runServiceCommand(fakeRuntime, {} satisfies PhiConfig, dependencies)
		).rejects.toThrow(
			"Duplicate feishu route for app cli_app_1 and chat id oc_1001"
		);
	});
});
