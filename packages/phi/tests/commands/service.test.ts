import { describe, expect, it } from "bun:test";

import type { AgentSession } from "@mariozechner/pi-coding-agent";

import {
	runServiceCommand,
	type ServiceCommandDependencies,
} from "@phi/commands/service";
import type {
	PhiConfig,
	ResolvedCronSessionServiceConfig,
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
		sessionId: "alice-telegram",
		chatId: "user-alice",
		workspace: "~/phi/workspaces/alice",
		telegramChatId: "1001",
		token: "token-1",
		...overrides,
	};
}

function createCronSessionConfig(
	overrides?: Partial<ResolvedCronSessionServiceConfig>
): ResolvedCronSessionServiceConfig {
	return {
		sessionId: "alice-cron",
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
			resolveCronSessions(): ResolvedCronSessionServiceConfig[] {
				return [createCronSessionConfig()];
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
			"alice-cron",
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
			resolveCronSessions(): ResolvedCronSessionServiceConfig[] {
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
});
