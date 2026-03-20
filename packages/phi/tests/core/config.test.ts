import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "bun:test";

import {
	assertUniqueChatWorkspaces,
	collectFeishuSessionServiceConfigs,
	collectTelegramSessionRouteTemplates,
	loadPhiConfig,
	resolveAgentRuntimeConfig,
	resolveChatRuntimeConfig,
	resolveCronSessionServiceConfigs,
	resolveSessionRuntimeConfig,
} from "@phi/core/config";

describe("phi config", () => {
	it("fails fast when phi config file is missing", () => {
		expect(() =>
			loadPhiConfig("/tmp/phi-config-does-not-exist.yaml")
		).toThrow("Missing phi config file");
	});

	it("collects telegram routes from sessions", () => {
		const directory = mkdtempSync(join(tmpdir(), "phi-config-"));
		const configPath = join(directory, "phi.yaml");

		try {
			writeFileSync(
				configPath,
				[
					"agents:",
					"  main:",
					"    provider: opencode",
					"    model: big-pickle",
					"chats:",
					"  user-alice:",
					"    workspace: ~/phi/workspaces/alice",
					"sessions:",
					"  alice-telegram:",
					"    chat: user-alice",
					"    agent: main",
					"    routes:",
					"      telegram:",
					"        allowList:",
					"          - -10001",
					"        token: bot-token",
				].join("\n"),
				"utf-8"
			);

			const config = loadPhiConfig(configPath);
			expect(collectTelegramSessionRouteTemplates(config)).toEqual([
				{
					sessionId: "alice-telegram",
					chatId: "user-alice",
					workspace: "~/phi/workspaces/alice",
					agentId: "main",
					telegramChatIds: ["-10001"],
					token: "bot-token",
				},
			]);
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});

	it("skips sessions without telegram route", () => {
		expect(
			collectTelegramSessionRouteTemplates({
				chats: {
					shared: {
						workspace: "~/active",
					},
				},
				sessions: {
					"session-no-telegram": {
						chat: "shared",
						agent: "main",
					},
					"session-active": {
						chat: "shared",
						agent: "support",
						routes: {
							telegram: {
								allowList: ["1002"],
								token: "token",
							},
						},
					},
				},
			})
		).toEqual([
			{
				sessionId: "session-active",
				chatId: "shared",
				workspace: "~/active",
				agentId: "support",
				telegramChatIds: ["1002"],
				token: "token",
			},
		]);
	});

	it("collects feishu routes from sessions", () => {
		expect(
			collectFeishuSessionServiceConfigs({
				chats: {
					shared: {
						workspace: "~/active",
					},
				},
				sessions: {
					"session-no-feishu": {
						chat: "shared",
						agent: "main",
					},
					"session-active": {
						chat: "shared",
						agent: "support",
						routes: {
							feishu: {
								id: "oc_1002",
								appId: "cli_app_1",
								appSecret: "secret-1",
							},
						},
					},
				},
			})
		).toEqual([
			{
				sessionId: "session-active",
				chatId: "shared",
				workspace: "~/active",
				feishuChatId: "oc_1002",
				appId: "cli_app_1",
				appSecret: "secret-1",
			},
		]);
	});

	it("collects cron sessions", () => {
		expect(
			resolveCronSessionServiceConfigs({
				chats: {
					alice: { workspace: "~/phi/workspaces/alice" },
					bob: { workspace: "~/phi/workspaces/bob" },
				},
				sessions: {
					"alice-main": {
						chat: "alice",
						agent: "main",
						cron: true,
					},
					"bob-main": {
						chat: "bob",
						agent: "support",
						cron: true,
					},
				},
			})
		).toEqual([
			{
				sessionId: "alice-main",
				chatId: "alice",
				workspace: "~/phi/workspaces/alice",
			},
			{
				sessionId: "bob-main",
				chatId: "bob",
				workspace: "~/phi/workspaces/bob",
			},
		]);
	});

	it("fails when two cron sessions point to the same chat", () => {
		expect(() =>
			resolveCronSessionServiceConfigs({
				chats: {
					alice: { workspace: "~/phi/workspaces/alice" },
				},
				sessions: {
					"alice-main": {
						chat: "alice",
						agent: "main",
						cron: true,
					},
					"alice-support": {
						chat: "alice",
						agent: "support",
						cron: true,
					},
				},
			})
		).toThrow(
			"Duplicate cron session for chat alice: alice-main and alice-support"
		);
	});

	it("fails when sessions mapping is missing", () => {
		expect(() =>
			collectTelegramSessionRouteTemplates({
				chats: {
					alice: { workspace: "~/alice" },
				},
			})
		).toThrow("Missing sessions configuration in phi config.");
	});

	it("fails when telegram route token is missing", () => {
		expect(() =>
			collectTelegramSessionRouteTemplates({
				chats: {
					alice: { workspace: "~/alice" },
				},
				sessions: {
					"alice-main": {
						chat: "alice",
						agent: "main",
						routes: {
							telegram: {
								allowList: ["1001"],
								token: "",
							},
						},
					},
				},
			})
		).toThrow(
			"Invalid telegram route for session alice-main: missing token"
		);
	});

	it("collects multiple telegram allowList entries", () => {
		expect(
			collectTelegramSessionRouteTemplates({
				chats: {
					alice: { workspace: "~/alice" },
				},
				sessions: {
					"alice-main": {
						chat: "alice",
						agent: "main",
						routes: {
							telegram: {
								allowList: ["1001", "1002"],
								token: "token",
							},
						},
					},
				},
			})
		).toEqual([
			{
				sessionId: "alice-main",
				chatId: "alice",
				workspace: "~/alice",
				agentId: "main",
				telegramChatIds: ["1001", "1002"],
				token: "token",
			},
		]);
	});

	it("fails when telegram allowList is missing", () => {
		expect(() =>
			collectTelegramSessionRouteTemplates({
				chats: {
					alice: { workspace: "~/alice" },
				},
				sessions: {
					"alice-main": {
						chat: "alice",
						agent: "main",
						routes: {
							telegram: {
								allowList: [],
								token: "token",
							},
						},
					},
				},
			})
		).toThrow(
			"Invalid telegram route for session alice-main: missing allowList"
		);
	});

	it("collects telegram wildcard allowList entries", () => {
		expect(
			collectTelegramSessionRouteTemplates({
				chats: {
					alice: { workspace: "~/alice" },
				},
				sessions: {
					"alice-main": {
						chat: "alice",
						agent: "main",
						routes: {
							telegram: {
								allowList: ["*"],
								token: "token",
							},
						},
					},
				},
			})
		).toEqual([
			{
				sessionId: "alice-main",
				chatId: "alice",
				workspace: "~/alice",
				agentId: "main",
				telegramChatIds: ["*"],
				token: "token",
			},
		]);
	});

	it("fails when telegram allowList has duplicates", () => {
		expect(() =>
			collectTelegramSessionRouteTemplates({
				chats: {
					alice: { workspace: "~/alice" },
				},
				sessions: {
					"alice-main": {
						chat: "alice",
						agent: "main",
						routes: {
							telegram: {
								allowList: ["1001", "1001"],
								token: "token",
							},
						},
					},
				},
			})
		).toThrow(
			"Invalid telegram route for session alice-main: duplicate allowList entry 1001"
		);
	});

	it("fails when feishu route app secret is missing", () => {
		expect(() =>
			collectFeishuSessionServiceConfigs({
				chats: {
					alice: { workspace: "~/alice" },
				},
				sessions: {
					"alice-main": {
						chat: "alice",
						agent: "main",
						routes: {
							feishu: {
								id: "oc_1001",
								appId: "cli_app_1",
								appSecret: "",
							},
						},
					},
				},
			})
		).toThrow(
			"Invalid feishu route for session alice-main: missing appSecret"
		);
	});

	it("fails when chats resolve to the same workspace", () => {
		expect(() =>
			assertUniqueChatWorkspaces(
				{
					chats: {
						"user-alice": {
							workspace: "~/phi/shared",
						},
						"user-bob": {
							workspace: "~/phi/shared",
						},
					},
				},
				"/home/tester"
			)
		).toThrow(
			"Chats user-alice and user-bob resolve to the same workspace: /home/tester/phi/shared"
		);
	});

	it("resolves chat runtime config", () => {
		expect(
			resolveChatRuntimeConfig(
				{
					chats: {
						"user-alice": {
							workspace: "~/phi/workspaces/alice",
						},
					},
				},
				"user-alice"
			)
		).toEqual({
			chatId: "user-alice",
			workspace: "~/phi/workspaces/alice",
		});
	});

	it("resolves session runtime config", () => {
		expect(
			resolveSessionRuntimeConfig(
				{
					chats: {
						"user-alice": {
							workspace: "~/phi/workspaces/alice",
						},
					},
					sessions: {
						"alice-main": {
							chat: "user-alice",
							agent: "main",
						},
					},
				},
				"alice-main"
			)
		).toEqual({
			sessionId: "alice-main",
			chatId: "user-alice",
			workspace: "~/phi/workspaces/alice",
			agentId: "main",
		});
	});

	it("resolves agent runtime config from phi config", () => {
		expect(
			resolveAgentRuntimeConfig(
				{
					agents: {
						main: {
							provider: "opencode",
							model: "big-pickle",
							thinkingLevel: "medium",
						},
					},
				},
				"main"
			)
		).toEqual({
			agentId: "main",
			provider: "opencode",
			model: "big-pickle",
			thinkingLevel: "medium",
		});
	});
});
