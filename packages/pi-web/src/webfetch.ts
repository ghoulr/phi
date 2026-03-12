import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, extname, join } from "node:path";

import { Type, type Static } from "@sinclair/typebox";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";

import { getCachedWebText, setCachedWebText } from "./cache.ts";
import { truncateToolText } from "./truncate.ts";

const DEFAULT_TIMEOUT_MS = 25_000;
const MARKDOWN_ACCEPT_HEADER = "text/markdown, text/html;q=0.9, */*;q=0.1";

const WebfetchSchema = Type.Object({
	url: Type.String({ description: "HTTP or HTTPS URL to fetch." }),
});

export type WebfetchInput = Static<typeof WebfetchSchema>;

type FetchLike = (
	input: string | URL | Request,
	init?: RequestInit
) => Promise<Response>;

type ExtractReadableText = (
	html: string,
	url: string
) => Promise<string | undefined>;

function normalizeHttpUrl(rawUrl: string): string {
	const url = new URL(rawUrl);
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		throw new Error("URL must start with http:// or https://");
	}
	url.hash = "";
	return url.toString();
}

function normalizeContentType(value: string | null): string {
	const contentType = value?.split(";")[0]?.trim().toLowerCase();
	return contentType || "application/octet-stream";
}

function isBinaryContentType(contentType: string): boolean {
	if (contentType.startsWith("text/")) {
		return false;
	}
	return ![
		"application/json",
		"application/ld+json",
		"application/xml",
		"application/xhtml+xml",
		"application/javascript",
		"application/x-javascript",
		"application/ecmascript",
		"application/x-www-form-urlencoded",
	].includes(contentType);
}

function isAttachment(response: Response): boolean {
	return (
		response.headers
			.get("content-disposition")
			?.toLowerCase()
			.includes("attachment") ?? false
	);
}

function getBinaryFilename(url: string, contentType: string): string {
	const pathname = new URL(url).pathname;
	const filename = basename(pathname) || "download";
	if (extname(filename)) {
		return filename;
	}
	if (contentType === "application/pdf") {
		return `${filename}.pdf`;
	}
	if (contentType.startsWith("image/")) {
		return `${filename}.${contentType.slice("image/".length)}`;
	}
	return `${filename}.bin`;
}

function saveBinaryContent(
	url: string,
	contentType: string,
	content: Uint8Array
): string {
	const directory = mkdtempSync(join(tmpdir(), "pi-webfetch-"));
	const outputPath = join(directory, getBinaryFilename(url, contentType));
	writeFileSync(outputPath, content);
	return outputPath;
}

function buildBinaryResult(path: string, contentType: string): string {
	return `Content-Type is: ${contentType}, saved to ${path}`;
}

async function extractReadableText(
	html: string,
	url: string
): Promise<string | undefined> {
	const [{ Readability }, { Window }] = await Promise.all([
		import("@mozilla/readability"),
		import("happy-dom"),
	]);
	const window = new Window({ url });
	window.document.write(html);
	const article = new Readability(window.document).parse();
	return article?.textContent?.trim() || undefined;
}

export async function executeWebfetch(
	input: WebfetchInput,
	options: {
		signal?: AbortSignal;
		fetchImpl?: FetchLike;
		extractReadableTextImpl?: ExtractReadableText;
	} = {}
): Promise<string> {
	const normalizedUrl = normalizeHttpUrl(input.url);
	const cachedText = getCachedWebText(normalizedUrl)?.trim();
	if (cachedText) {
		return truncateToolText(cachedText);
	}

	const signal = options.signal
		? AbortSignal.any([
				options.signal,
				AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
			])
		: AbortSignal.timeout(DEFAULT_TIMEOUT_MS);
	const response = await (options.fetchImpl ?? fetch)(normalizedUrl, {
		method: "GET",
		headers: {
			Accept: MARKDOWN_ACCEPT_HEADER,
		},
		redirect: "follow",
		signal,
	});
	if (!response.ok) {
		throw new Error(
			`Web fetch failed: ${response.status} ${response.statusText}`
		);
	}

	const finalUrl = normalizeHttpUrl(response.url || normalizedUrl);
	const contentType = normalizeContentType(
		response.headers.get("content-type")
	);
	if (isAttachment(response) || isBinaryContentType(contentType)) {
		const content = new Uint8Array(await response.arrayBuffer());
		const outputPath = saveBinaryContent(finalUrl, contentType, content);
		return buildBinaryResult(outputPath, contentType);
	}

	const body = await response.text();
	if (contentType === "text/markdown") {
		setCachedWebText(finalUrl, body);
		return truncateToolText(body);
	}
	if (contentType !== "text/html") {
		setCachedWebText(finalUrl, body);
		return truncateToolText(body);
	}

	const extractText = options.extractReadableTextImpl ?? extractReadableText;
	const readableText = await extractText(body, finalUrl);
	if (readableText) {
		setCachedWebText(finalUrl, readableText);
		return truncateToolText(readableText);
	}
	return truncateToolText(body);
}

export function createWebfetchTool(
	dependencies: { execute?: typeof executeWebfetch } = {}
): ToolDefinition {
	const execute = dependencies.execute ?? executeWebfetch;
	return {
		name: "webfetch",
		label: "Web Fetch",
		description:
			"Fetch the content of a specific URL. Good for reading articles, docs, and pages when you already know the URL.",
		promptSnippet:
			"Fetch the content of a specific URL when you already know where to read",
		promptGuidelines: [
			"Use webfetch to read the main content of a known URL, such as an article, doc page, or blog post.",
			"If the URL points to a binary file, webfetch saves it to a temporary file path instead of returning raw bytes.",
		],
		parameters: WebfetchSchema,
		async execute(
			_toolCallId,
			params: WebfetchInput,
			signal,
			onUpdate,
			_ctx
		) {
			onUpdate?.({
				content: [{ type: "text", text: "Fetching URL..." }],
				details: {},
			});
			const text = await execute(params, { signal });
			return {
				content: [{ type: "text", text }],
				details: {},
			};
		},
	};
}
