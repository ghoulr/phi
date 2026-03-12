import { StringEnum } from "@mariozechner/pi-ai";
import type {
	ExtensionAPI,
	ExtensionFactory,
	ToolDefinition,
} from "@mariozechner/pi-coding-agent";
import { Type, type Static } from "@sinclair/typebox";

import { setCachedWebText } from "./cache.ts";
import { truncateToolText } from "./truncate.ts";
import { createWebfetchTool } from "./webfetch.ts";

export const DEFAULT_EXA_MCP_URL = "https://mcp.exa.ai/mcp";
export const DEFAULT_NUM_RESULTS = 8;
export const DEFAULT_TEXT_MAX_CHARACTERS = 12_000;
export const DEFAULT_TIMEOUT_MS = 25_000;

const WebsearchSchema = Type.Object({
	query: Type.String({ description: "Web search query." }),
	numResults: Type.Optional(
		Type.Integer({
			minimum: 1,
			maximum: 10,
			description: "Number of search results to return. Defaults to 8.",
		})
	),
	livecrawl: Type.Optional(
		StringEnum(["never", "fallback", "always", "preferred"] as const, {
			description:
				"Exa livecrawl mode. never: cached/indexed content only. fallback: use cached content first, then live crawl if needed. always: always live crawl. preferred: prefer live crawl but may still reuse cached content.",
		})
	),
});

export type WebsearchInput = Static<typeof WebsearchSchema>;

interface McpToolCallEnvelope {
	result?: {
		content?: Array<{
			type: string;
			text?: string;
		}>;
	};
	error?: {
		message?: string;
	};
}

export interface ExaSearchItem {
	title: string;
	url: string;
	text?: string;
	summary?: string;
	highlights?: string[];
}

interface ExaSearchResponse {
	results: ExaSearchItem[];
}

export interface WebsearchResultItem {
	title: string;
	url: string;
	summary?: string;
	highlights: string[];
}

export interface WebsearchResult {
	text: string;
	items: WebsearchResultItem[];
}

type FetchLike = (
	input: string | URL | Request,
	init?: RequestInit
) => Promise<Response>;

function truncateField(
	value: string | undefined,
	maxChars: number
): string | undefined {
	const trimmed = value?.trim();
	if (!trimmed) {
		return undefined;
	}
	if (trimmed.length <= maxChars) {
		return trimmed;
	}
	return `${trimmed.slice(0, maxChars - 1)}…`;
}

function normalizeHighlights(highlights: string[] | undefined): string[] {
	if (!highlights) {
		return [];
	}
	return highlights
		.map((item) => truncateField(item, 220))
		.filter((item): item is string => Boolean(item))
		.slice(0, 3);
}

function buildMcpRequestBody(input: WebsearchInput): string {
	return JSON.stringify({
		jsonrpc: "2.0",
		id: 1,
		method: "tools/call",
		params: {
			name: "web_search_advanced_exa",
			arguments: {
				query: input.query,
				type: "auto",
				numResults: input.numResults ?? DEFAULT_NUM_RESULTS,
				livecrawl: input.livecrawl ?? "fallback",
				textMaxCharacters: DEFAULT_TEXT_MAX_CHARACTERS,
				enableSummary: true,
				enableHighlights: true,
				highlightsNumSentences: 2,
				highlightsPerUrl: 3,
				highlightsQuery: input.query,
			},
		},
	});
}

export function resolveExaMcpUrl(env: NodeJS.ProcessEnv = process.env): string {
	const url = new URL(env.EXA_MCP_URL?.trim() || DEFAULT_EXA_MCP_URL);
	const apiKey = env.EXA_API_KEY?.trim();
	if (apiKey && !url.searchParams.has("exaApiKey")) {
		url.searchParams.set("exaApiKey", apiKey);
	}
	return url.toString();
}

function parseOuterEnvelope(text: string): McpToolCallEnvelope {
	return JSON.parse(text) as McpToolCallEnvelope;
}

function extractMcpTextPayload(responseText: string): string {
	const normalized = responseText.trim();
	if (!normalized) {
		throw new Error("Empty MCP response.");
	}
	if (normalized.startsWith("{")) {
		const envelope = parseOuterEnvelope(normalized);
		if (envelope.error?.message) {
			throw new Error(envelope.error.message);
		}
		const text = envelope.result?.content
			?.find((item) => item.type === "text")
			?.text?.trim();
		if (!text) {
			throw new Error("No search results found.");
		}
		return text;
	}

	for (const line of normalized.split("\n")) {
		if (!line.startsWith("data: ")) {
			continue;
		}
		const envelope = parseOuterEnvelope(line.slice(6));
		if (envelope.error?.message) {
			throw new Error(envelope.error.message);
		}
		const text = envelope.result?.content
			?.find((item) => item.type === "text")
			?.text?.trim();
		if (text) {
			return text;
		}
	}

	throw new Error("No search results found.");
}

export function parseMcpToolCallResponse(
	responseText: string
): ExaSearchResponse {
	return JSON.parse(extractMcpTextPayload(responseText)) as ExaSearchResponse;
}

function formatResultItems(
	query: string,
	items: WebsearchResultItem[]
): string {
	if (items.length === 0) {
		return `No search results found for: ${query}`;
	}

	const lines = [`Search results for: ${query}`, ""];
	for (const [index, item] of items.entries()) {
		lines.push(`${index + 1}. ${item.title}`);
		lines.push(`URL: ${item.url}`);
		if (item.summary) {
			lines.push(`Summary: ${item.summary}`);
		}
		if (item.highlights.length > 0) {
			lines.push(`Highlights: ${item.highlights.join(" | ")}`);
		}
		lines.push("");
	}
	return lines.join("\n").trim();
}

function cacheSearchResults(results: ExaSearchItem[]): void {
	for (const item of results) {
		const text = item.text?.trim();
		if (text) {
			setCachedWebText(item.url, text);
		}
	}
}

function toResultItems(results: ExaSearchItem[]): WebsearchResultItem[] {
	return results.map((item) => ({
		title: truncateField(item.title, 160) ?? item.url,
		url: item.url,
		summary: truncateField(item.summary, 320),
		highlights: normalizeHighlights(item.highlights),
	}));
}

export async function executeExaWebsearch(
	input: WebsearchInput,
	options: {
		signal?: AbortSignal;
		fetchImpl?: FetchLike;
		exaMcpUrl?: string;
	} = {}
): Promise<WebsearchResult> {
	const signal = options.signal
		? AbortSignal.any([
				options.signal,
				AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
			])
		: AbortSignal.timeout(DEFAULT_TIMEOUT_MS);
	const response = await (options.fetchImpl ?? fetch)(
		options.exaMcpUrl ?? resolveExaMcpUrl(),
		{
			method: "POST",
			headers: {
				accept: "application/json, text/event-stream",
				"content-type": "application/json",
			},
			body: buildMcpRequestBody(input),
			signal,
		}
	);
	if (!response.ok) {
		throw new Error(
			`Web search failed: ${response.status} ${response.statusText}`
		);
	}

	const results =
		parseMcpToolCallResponse(await response.text()).results ?? [];
	cacheSearchResults(results);
	const items = toResultItems(results);
	return {
		text: truncateToolText(formatResultItems(input.query, items)),
		items,
	};
}

export function createWebsearchTool(
	dependencies: { execute?: typeof executeExaWebsearch } = {}
): ToolDefinition {
	const execute = dependencies.execute ?? executeExaWebsearch;
	return {
		name: "websearch",
		label: "Web Search",
		description:
			"Search the web for relevant pages and return URLs, summaries, and highlights. Good for discovery before reading a specific page.",
		promptSnippet:
			"Search the web for relevant pages, summaries, and highlights",
		promptGuidelines: [
			"Use websearch to discover relevant pages before choosing which URL to read in full.",
			"Use livecrawl when freshness matters, such as recent news or fast-changing pages.",
		],
		parameters: WebsearchSchema,
		async execute(
			_toolCallId,
			params: WebsearchInput,
			signal,
			onUpdate,
			_ctx
		) {
			onUpdate?.({
				content: [{ type: "text", text: "Searching the web..." }],
				details: {},
			});
			const result = await execute(params, { signal });
			return {
				content: [{ type: "text", text: result.text }],
				details: {
					items: result.items,
				},
			};
		},
	};
}

export function createPiWebExtension(): ExtensionFactory {
	return (pi: ExtensionAPI) => {
		pi.registerTool(createWebsearchTool());
		pi.registerTool(createWebfetchTool());
	};
}
