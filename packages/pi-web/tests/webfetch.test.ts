import { existsSync, readFileSync, rmSync } from "node:fs";
import { dirname } from "node:path";

import { describe, expect, it } from "bun:test";

import { setCachedWebText } from "../src/cache.ts";
import { createWebfetchTool, executeWebfetch } from "../src/webfetch.ts";

describe("executeWebfetch", () => {
	it("prefers cached exa text", async () => {
		setCachedWebText("https://example.com/article", "cached text");

		const result = await executeWebfetch({
			url: "https://example.com/article#part",
		});

		expect(result).toBe("cached text");
	});

	it("returns markdown directly", async () => {
		const result = await executeWebfetch(
			{ url: "https://example.com/doc" },
			{
				fetchImpl: async () =>
					new Response("# Title", {
						status: 200,
						headers: {
							"content-type": "text/markdown; charset=utf-8",
						},
					}),
			}
		);

		expect(result).toBe("# Title");
	});

	it("saves binary content to a temp file", async () => {
		const result = await executeWebfetch(
			{ url: "https://example.com/file.pdf" },
			{
				fetchImpl: async () =>
					new Response(new Uint8Array([1, 2, 3]), {
						status: 200,
						headers: {
							"content-type": "application/pdf",
						},
					}),
			}
		);

		expect(result).toContain("Content-Type is: application/pdf, saved to ");
		const savedPath = result.split(", saved to ")[1];
		if (!savedPath) {
			throw new Error("Missing saved path");
		}
		try {
			expect(existsSync(savedPath)).toBe(true);
			expect([...readFileSync(savedPath)]).toEqual([1, 2, 3]);
		} finally {
			rmSync(dirname(savedPath), { force: true, recursive: true });
		}
	});

	it("falls back to html when readability returns empty", async () => {
		const result = await executeWebfetch(
			{ url: "https://example.com/page" },
			{
				fetchImpl: async () =>
					new Response("<html><body></body></html>", {
						status: 200,
						headers: { "content-type": "text/html; charset=utf-8" },
					}),
			}
		);

		expect(result).toContain("<html>");
	});

	it("throws when readability fails", async () => {
		await expect(
			executeWebfetch(
				{ url: "https://example.com/page" },
				{
					fetchImpl: async () =>
						new Response("<html><body>broken</body></html>", {
							status: 200,
							headers: {
								"content-type": "text/html; charset=utf-8",
							},
						}),
					extractReadableTextImpl: async () => {
						throw new Error("missing dependency");
					},
				}
			)
		).rejects.toThrow("missing dependency");
	});
});

describe("createWebfetchTool", () => {
	it("reports progress and returns content only", async () => {
		const updates: string[] = [];
		const tool = createWebfetchTool({
			async execute() {
				return "body";
			},
		});

		const result = await tool.execute(
			"call-1",
			{ url: "https://example.com" },
			undefined,
			(update) => {
				const text = update.content[0];
				if (text?.type === "text") {
					updates.push(text.text);
				}
			},
			{} as never
		);

		expect(updates).toEqual(["Fetching URL..."]);
		expect(result).toEqual({
			content: [{ type: "text", text: "body" }],
			details: {},
		});
	});
});
