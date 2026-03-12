import { describe, expect, it } from "bun:test";

import {
	createWebsearchTool,
	executeExaWebsearch,
	parseMcpToolCallResponse,
	resolveExaMcpUrl,
} from "../src/websearch.ts";

const liveIt = process.env.EXA_LIVE_TEST === "1" ? it : it.skip;

describe("resolveExaMcpUrl", () => {
	it("uses default url and enables advanced tool", () => {
		expect(resolveExaMcpUrl({} as NodeJS.ProcessEnv)).toBe(
			"https://mcp.exa.ai/mcp?tools=web_search_advanced_exa"
		);
	});

	it("appends api key when present", () => {
		expect(
			resolveExaMcpUrl({ EXA_API_KEY: "secret" } as NodeJS.ProcessEnv)
		).toBe(
			"https://mcp.exa.ai/mcp?tools=web_search_advanced_exa&exaApiKey=secret"
		);
	});

	it("preserves explicit tools in custom url", () => {
		expect(
			resolveExaMcpUrl({
				EXA_MCP_URL: "https://example.com/mcp?tools=custom_tool",
			} as NodeJS.ProcessEnv)
		).toBe("https://example.com/mcp?tools=custom_tool");
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

		expect(parsed.results?.[0]?.url).toBe("https://example.com");
		expect(parsed.results?.[0]?.summary).toBe("Summary");
	});

	it("fails fast on mcp error", () => {
		expect(() =>
			parseMcpToolCallResponse(
				JSON.stringify({ error: { message: "boom" } })
			)
		).toThrow("boom");
	});

	it("fails fast on tool error text payload", () => {
		expect(() =>
			parseMcpToolCallResponse(
				JSON.stringify({
					result: {
						content: [
							{
								type: "text",
								text: "MCP error: rate limit exceeded",
							},
						],
						isError: true,
					},
				})
			)
		).toThrow("MCP error: rate limit exceeded");
	});
});

describe("executeExaWebsearch", () => {
	it("returns formatted search results and caches full text", async () => {
		let body = "";
		let accept = "";
		const result = await executeExaWebsearch(
			{ query: "phi" },
			{
				exaMcpUrl:
					"https://example.com/mcp?tools=web_search_advanced_exa",
				fetchImpl: async (_input, init) => {
					body = String(init?.body ?? "");
					accept = new Headers(init?.headers).get("accept") ?? "";
					return new Response(
						'data: {"result":{"content":[{"type":"text","text":"{\\"results\\":[{\\"title\\":\\"Example\\",\\"url\\":\\"https://example.com\\",\\"text\\":\\"Body\\",\\"summary\\":\\"Summary\\",\\"highlights\\":[\\"H1\\",\\"H2\\"]}]}"}]}}',
						{ status: 200 }
					);
				},
			}
		);

		expect(body).toContain('"name":"web_search_advanced_exa"');
		expect(accept).toBe("application/json, text/event-stream");
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

	liveIt(
		"calls Exa hosted MCP end to end",
		async () => {
			const result = await executeExaWebsearch({
				query: "Bun JavaScript runtime",
				numResults: 3,
			});

			expect(result.items.length).toBeGreaterThan(0);
			expect(result.items[0]?.url).toMatch(/^https?:\/\//);
			expect(result.text.length).toBeGreaterThan(0);
		},
		30_000
	);
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
