import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "bun:test";
import { parse } from "yaml";

import {
	bindTelegramChatRoute,
	resolveTelegramSessionServiceConfigs,
	resolveTelegramWildcardRouteConfigs,
} from "@phi/core/telegram-routes";
import { getPhiTelegramRoutesFilePath } from "@phi/core/paths";

const directories: string[] = [];

afterEach(() => {
	for (const directory of directories) {
		rmSync(directory, { recursive: true, force: true });
	}
	directories.length = 0;
});

describe("telegram routes", () => {
	it("creates runtime bindings for explicit telegram allowList entries", () => {
		const homeDir = mkdtempSync(join(tmpdir(), "phi-telegram-routes-"));
		directories.push(homeDir);

		const entries = resolveTelegramSessionServiceConfigs(
			{
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
								token: "token-1",
							},
						},
					},
				},
			},
			homeDir
		);

		expect(entries).toHaveLength(2);
		expect(entries[0]?.configSessionId).toBe("alice-main");
		expect(entries[1]?.configSessionId).toBe("alice-main");
		expect(entries[0]?.sessionId).not.toBe(entries[1]?.sessionId);

		const routesFile = parse(
			readFileSync(getPhiTelegramRoutesFilePath(homeDir), "utf-8")
		) as {
			accounts: Record<
				string,
				{
					chats: Record<
						string,
						{ sessionId: string; configSessionId: string }
					>;
				}
			>;
		};
		const accounts = Object.values(routesFile.accounts);
		expect(accounts).toHaveLength(1);
		expect(accounts[0]?.chats["1001"]?.sessionId).toBe(
			entries[0]?.sessionId
		);
		expect(accounts[0]?.chats["1001"]?.configSessionId).toBe("alice-main");
		expect(accounts[0]?.chats["1002"]?.sessionId).toBe(
			entries[1]?.sessionId
		);
	});

	it("reuses persisted telegram route bindings", () => {
		const homeDir = mkdtempSync(join(tmpdir(), "phi-telegram-routes-"));
		directories.push(homeDir);

		const first = resolveTelegramSessionServiceConfigs(
			{
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
								token: "token-1",
							},
						},
					},
				},
			},
			homeDir
		);
		const second = resolveTelegramSessionServiceConfigs(
			{
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
								token: "token-1",
							},
						},
					},
				},
			},
			homeDir
		);

		expect(second).toEqual(first);
	});

	it("restores wildcard bindings from persisted routes", () => {
		const homeDir = mkdtempSync(join(tmpdir(), "phi-telegram-routes-"));
		directories.push(homeDir);

		const first = bindTelegramChatRoute({
			phiConfig: {
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
								token: "token-1",
							},
						},
					},
				},
			},
			token: "token-1",
			chatId: "2001",
			userHomeDir: homeDir,
		});

		const entries = resolveTelegramSessionServiceConfigs(
			{
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
								token: "token-1",
							},
						},
					},
				},
			},
			homeDir
		);

		if (!first) {
			throw new Error("Expected wildcard binding to create a session.");
		}
		expect(entries).toEqual([first]);
	});

	it("binds unknown chats through wildcard routes", () => {
		const homeDir = mkdtempSync(join(tmpdir(), "phi-telegram-routes-"));
		directories.push(homeDir);

		const entry = bindTelegramChatRoute({
			phiConfig: {
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
								token: "token-1",
							},
						},
					},
				},
			},
			token: "token-1",
			chatId: "2001",
			userHomeDir: homeDir,
		});

		expect(entry?.telegramChatId).toBe("2001");
		expect(entry?.configSessionId).toBe("alice-main");
	});

	it("prefers explicit matches over wildcard matches", () => {
		const homeDir = mkdtempSync(join(tmpdir(), "phi-telegram-routes-"));
		directories.push(homeDir);

		const entry = bindTelegramChatRoute({
			phiConfig: {
				chats: {
					alice: { workspace: "~/alice" },
					bob: { workspace: "~/bob" },
				},
				sessions: {
					"alice-main": {
						chat: "alice",
						agent: "main",
						routes: {
							telegram: {
								allowList: ["1001"],
								token: "token-1",
							},
						},
					},
					"bob-main": {
						chat: "bob",
						agent: "main",
						routes: {
							telegram: {
								allowList: ["*"],
								token: "token-1",
							},
						},
					},
				},
			},
			token: "token-1",
			chatId: "1001",
			userHomeDir: homeDir,
		});

		expect(entry?.configSessionId).toBe("alice-main");
		expect(entry?.chatId).toBe("alice");
	});

	it("reports wildcard configs per token", () => {
		expect(
			resolveTelegramWildcardRouteConfigs({
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
								token: "token-1",
							},
						},
					},
				},
			})
		).toEqual([
			{
				configSessionId: "alice-main",
				chatId: "alice",
				workspace: "~/alice",
				token: "token-1",
			},
		]);
	});

	it("fails fast on duplicate telegram allowList entries under the same token", () => {
		const homeDir = mkdtempSync(join(tmpdir(), "phi-telegram-routes-"));
		directories.push(homeDir);

		expect(() =>
			resolveTelegramSessionServiceConfigs(
				{
					chats: {
						alice: { workspace: "~/alice" },
						bob: { workspace: "~/bob" },
					},
					sessions: {
						"alice-main": {
							chat: "alice",
							agent: "main",
							routes: {
								telegram: {
									allowList: ["1001"],
									token: "token-1",
								},
							},
						},
						"bob-main": {
							chat: "bob",
							agent: "main",
							routes: {
								telegram: {
									allowList: ["1001"],
									token: "token-1",
								},
							},
						},
					},
				},
				homeDir
			)
		).toThrow("Duplicate telegram allowList entry");
	});
});
