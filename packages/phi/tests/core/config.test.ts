import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "bun:test";

import {
	assertUniqueChatWorkspaces,
	collectTelegramSessionServiceConfigs,
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
					"        id: -10001",
					"        token: bot-token",
				].join("\n"),
				"utf-8"
			);

			const config = loadPhiConfig(configPath);
			expect(collectTelegramSessionServiceConfigs(config)).toEqual([
				{
					sessionId: "alice-telegram",
					chatId: "user-alice",
					workspace: "~/phi/workspaces/alice",
					telegramChatId: "-10001",
					token: "bot-token",
				},
			]);
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});

	it("skips sessions without telegram route", () => {
		expect(
			collectTelegramSessionServiceConfigs({
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
								id: "1002",
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
				telegramChatId: "1002",
				token: "token",
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
			collectTelegramSessionServiceConfigs({
				chats: {
					alice: { workspace: "~/alice" },
				},
			})
		).toThrow("Missing sessions configuration in phi config.");
	});

	it("fails when telegram route token is missing", () => {
		expect(() =>
			collectTelegramSessionServiceConfigs({
				chats: {
					alice: { workspace: "~/alice" },
				},
				sessions: {
					"alice-main": {
						chat: "alice",
						agent: "main",
						routes: {
							telegram: {
								id: "1001",
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
