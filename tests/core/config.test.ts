import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "bun:test";

import {
	loadPhiConfig,
	resolveAgentRuntimeConfig,
	resolveTelegramChatServiceConfigs,
} from "@phi/core/config";

describe("phi config", () => {
	it("fails fast when phi config file is missing", () => {
		expect(() =>
			loadPhiConfig("/tmp/phi-config-does-not-exist.yaml")
		).toThrow("Missing phi config file");
	});

	it("resolves telegram chat service config from phi config", () => {
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
					"    thinkingLevel: medium",
					"channels:",
					"  telegram:",
					"    chats:",
					'      "-10001":',
					"        enabled: true",
					"        agent: main",
					"        token: bot-token",
				].join("\n"),
				"utf-8"
			);

			const config = loadPhiConfig(configPath);
			expect(resolveTelegramChatServiceConfigs(config)).toEqual([
				{
					chatId: "-10001",
					agentId: "main",
					token: "bot-token",
				},
			]);
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});

	it("skips disabled telegram chat config", () => {
		expect(
			resolveTelegramChatServiceConfigs({
				channels: {
					telegram: {
						chats: {
							"1": {
								enabled: false,
								agent: "main",
								token: "token",
							},
							"2": {
								enabled: true,
								agent: "support",
								token: "token",
							},
						},
					},
				},
			})
		).toEqual([
			{
				chatId: "2",
				agentId: "support",
				token: "token",
			},
		]);
	});

	it("fails when telegram chats mapping is missing", () => {
		expect(() =>
			resolveTelegramChatServiceConfigs({ channels: {} })
		).toThrow(
			"Missing channels.telegram.chats configuration in phi config."
		);
	});

	it("fails when token is missing", () => {
		const directory = mkdtempSync(join(tmpdir(), "phi-config-"));
		const configPath = join(directory, "phi.yaml");

		try {
			writeFileSync(
				configPath,
				[
					"channels:",
					"  telegram:",
					"    chats:",
					'      "1001":',
					"        agent: main",
				].join("\n"),
				"utf-8"
			);

			const config = loadPhiConfig(configPath);
			expect(() => resolveTelegramChatServiceConfigs(config)).toThrow(
				"Invalid telegram chat mapping for chat id 1001: missing token"
			);
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
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
