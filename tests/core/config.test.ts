import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "bun:test";

import {
	assertUniqueChatWorkspaces,
	loadPhiConfig,
	resolveAgentRuntimeConfig,
	resolveChatRuntimeConfig,
	resolveTelegramChatServiceConfigs,
} from "@phi/core/config";

describe("phi config", () => {
	it("fails fast when phi config file is missing", () => {
		expect(() =>
			loadPhiConfig("/tmp/phi-config-does-not-exist.yaml")
		).toThrow("Missing phi config file");
	});

	it("resolves telegram routes from chats", () => {
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
					"    agent: main",
					"    routes:",
					"      telegram:",
					"        id: -10001",
					"        token: bot-token",
				].join("\n"),
				"utf-8"
			);

			const config = loadPhiConfig(configPath);
			expect(resolveTelegramChatServiceConfigs(config)).toEqual([
				{
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

	it("skips disabled chat and chat without telegram route", () => {
		expect(
			resolveTelegramChatServiceConfigs({
				chats: {
					"user-disabled": {
						enabled: false,
						workspace: "~/disabled",
						agent: "main",
						routes: {
							telegram: {
								id: "1001",
								token: "token",
							},
						},
					},
					"user-no-telegram": {
						workspace: "~/no-telegram",
						agent: "main",
					},
					"user-active": {
						workspace: "~/active",
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
				chatId: "user-active",
				workspace: "~/active",
				telegramChatId: "1002",
				token: "token",
			},
		]);
	});

	it("fails when chats mapping is missing", () => {
		expect(() => resolveTelegramChatServiceConfigs({})).toThrow(
			"Missing chats configuration in phi config."
		);
	});

	it("fails when telegram route token is missing", () => {
		expect(() =>
			resolveTelegramChatServiceConfigs({
				chats: {
					"user-alice": {
						workspace: "~/alice",
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
		).toThrow("Invalid telegram route for chat user-alice: missing token");
	});

	it("fails when chat workspace is missing", () => {
		expect(() =>
			resolveTelegramChatServiceConfigs({
				chats: {
					"user-alice": {
						workspace: "",
						agent: "main",
						routes: {
							telegram: {
								id: "1001",
								token: "token",
							},
						},
					},
				},
			})
		).toThrow(
			"Invalid chat configuration for user-alice: missing workspace"
		);
	});

	it("fails when there is no enabled telegram route", () => {
		expect(() =>
			resolveTelegramChatServiceConfigs({
				chats: {
					"user-alice": {
						enabled: false,
						workspace: "~/alice",
						agent: "main",
						routes: {
							telegram: {
								id: "1001",
								token: "token",
							},
						},
					},
				},
			})
		).toThrow("No enabled telegram routes found in chats configuration.");
	});

	it("fails when enabled chats resolve to the same workspace", () => {
		expect(() =>
			assertUniqueChatWorkspaces(
				{
					chats: {
						"user-alice": {
							workspace: "~/phi/shared",
							agent: "main",
						},
						"user-bob": {
							workspace: "~/phi/shared",
							agent: "support",
						},
					},
				},
				"/home/tester"
			)
		).toThrow(
			"Chats user-alice and user-bob resolve to the same workspace: /home/tester/phi/shared"
		);
	});

	it("ignores disabled chats when checking unique workspaces", () => {
		expect(() =>
			assertUniqueChatWorkspaces(
				{
					chats: {
						"user-alice": {
							workspace: "~/phi/shared",
							agent: "main",
						},
						"user-bob": {
							enabled: false,
							workspace: "~/phi/shared",
							agent: "support",
						},
					},
				},
				"/home/tester"
			)
		).not.toThrow();
	});

	it("fails resolving telegram routes when workspaces collide", () => {
		expect(() =>
			resolveTelegramChatServiceConfigs({
				chats: {
					"user-alice": {
						workspace: "~/phi/shared",
						agent: "main",
						routes: {
							telegram: {
								id: "1001",
								token: "token",
							},
						},
					},
					"user-bob": {
						workspace: "~/phi/shared",
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
		).toThrow("resolve to the same workspace");
	});

	it("resolves chat runtime config from phi config", () => {
		expect(
			resolveChatRuntimeConfig(
				{
					chats: {
						"user-alice": {
							workspace: "~/phi/workspaces/alice",
							agent: "main",
						},
					},
				},
				"user-alice"
			)
		).toEqual({
			chatId: "user-alice",
			workspace: "~/phi/workspaces/alice",
			agentId: "main",
		});
	});

	it("fails when chat runtime config is disabled", () => {
		expect(() =>
			resolveChatRuntimeConfig(
				{
					chats: {
						"user-alice": {
							enabled: false,
							workspace: "~/phi/workspaces/alice",
							agent: "main",
						},
					},
				},
				"user-alice"
			)
		).toThrow("Chat is disabled in phi config: user-alice");
	});

	it("fails resolving chat runtime config when workspaces collide", () => {
		expect(() =>
			resolveChatRuntimeConfig(
				{
					chats: {
						"user-alice": {
							workspace: "~/phi/shared",
							agent: "main",
						},
						"user-bob": {
							workspace: "~/phi/shared",
							agent: "support",
						},
					},
				},
				"user-alice"
			)
		).toThrow("resolve to the same workspace");
	});

	it("fails when chat runtime workspace is missing", () => {
		expect(() =>
			resolveChatRuntimeConfig(
				{
					chats: {
						"user-alice": {
							workspace: "",
							agent: "main",
						},
					},
				},
				"user-alice"
			)
		).toThrow(
			"Invalid chat configuration for user-alice: missing workspace"
		);
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

	it("fails when agent runtime provider is missing", () => {
		expect(() =>
			resolveAgentRuntimeConfig(
				{
					agents: {
						main: {
							model: "big-pickle",
						},
					},
				},
				"main"
			)
		).toThrow("Invalid agent configuration for main: missing provider");
	});
});
