import { describe, expect, it } from "bun:test";

import {
	createWebsearchTool,
	executeExaWebsearch,
	parseMcpToolCallResponse,
	resolveExaMcpUrl,
} from "../src/websearch.ts";

describe("resolveExaMcpUrl", () => {
	it("uses default url without api key", () => {
		expect(resolveExaMcpUrl({} as NodeJS.ProcessEnv)).toBe(
			"https://mcp.exa.ai/mcp"
		);
	});

	it("appends api key when present", () => {
		expect(
			resolveExaMcpUrl({ EXA_API_KEY: "secret" } as NodeJS.ProcessEnv)
		).toBe("https://mcp.exa.ai/mcp?exaApiKey=secret");
	});
});

describe("parseMcpToolCallResponse", () => {
	it("parses advanced search payload from sse", () => {
		const parsed = parseMcpToolCallResponse(
			[
				"event: message",
				'data: {"result":{"content":[{"type":"text","text":"{\\"results\\":[{\\"title\\":\\"Example\\",\\"url\\":\\"https://example.com\\",\\"text\\":\\"Body\\",\\"summary\\":\\"Summary\\",\\"highlights\\":[\\"H1\\"]}]}"}]}}',
			].join("\n")
		);

		expect(parsed.results[0]?.url).toBe("https://example.com");
		expect(parsed.results[0]?.summary).toBe("Summary");
	});

	it("fails fast on mcp error", () => {
		expect(() =>
			parseMcpToolCallResponse(
				JSON.stringify({ error: { message: "boom" } })
			)
		).toThrow("boom");
	});
});

describe("executeExaWebsearch", () => {
	it("returns formatted search results and caches full text", async () => {
		let body = "";
		const result = await executeExaWebsearch(
			{ query: "phi" },
			{
				exaMcpUrl: "https://example.com/mcp",
				fetchImpl: async (_input, init) => {
					body = String(init?.body ?? "");
					return new Response(
						'data: {"result":{"content":[{"type":"text","text":"{\\"results\\":[{\\"title\\":\\"Example\\",\\"url\\":\\"https://example.com\\",\\"text\\":\\"Body\\",\\"summary\\":\\"Summary\\",\\"highlights\\":[\\"H1\\",\\"H2\\"]}]}"}]}}',
						{ status: 200 }
					);
				},
			}
		);

		expect(body).toContain('"name":"web_search_advanced_exa"');
		expect(result.items).toEqual([
			{
				title: "Example",
				url: "https://example.com",
				summary: "Summary",
				highlights: ["H1", "H2"],
			},
		]);
		expect(result.text).toContain("URL: https://example.com");
	});
});

describe("createWebsearchTool", () => {
	it("reports progress and returns structured details", async () => {
		const updates: string[] = [];
		const tool = createWebsearchTool({
			async execute() {
				return {
					text: "answer",
					items: [
						{
							title: "Example",
							url: "https://example.com",
							summary: "Summary",
							highlights: ["H1"],
						},
					],
				};
			},
		});

		const result = await tool.execute(
			"call-1",
			{ query: "phi" },
			undefined,
			(update) => {
				const text = update.content[0];
				if (text?.type === "text") {
					updates.push(text.text);
				}
			},
			{} as never
		);

		expect(updates).toEqual(["Searching the web..."]);
		expect(result).toEqual({
			content: [{ type: "text", text: "answer" }],
			details: {
				items: [
					{
						title: "Example",
						url: "https://example.com",
						summary: "Summary",
						highlights: ["H1"],
					},
				],
			},
		});
	});
});
