import { describe, expect, it } from "bun:test";

import {
	chunkTextForOutbound,
	sanitizeInboundText,
	sanitizeOutboundText,
} from "@phi/core/message-text";

describe("sanitizeInboundText", () => {
	it("rejects null bytes", () => {
		expect(sanitizeInboundText("before\u0000after")).toEqual({
			ok: false,
			error: "message must not contain null bytes",
		});
	});

	it("strips unsafe control chars and keeps tab/newline/carriage return", () => {
		expect(sanitizeInboundText("a\u0001b\tc\nd\re\u0007f\u007f")).toEqual({
			ok: true,
			message: "ab\tc\nd\ref",
		});
	});

	it("normalizes NFC", () => {
		expect(sanitizeInboundText("Cafe\u0301")).toEqual({
			ok: true,
			message: "Café",
		});
	});
});

describe("sanitizeOutboundText", () => {
	it("strips unsafe control chars", () => {
		expect(sanitizeOutboundText("x\u0001y\u007fz")).toBe("xyz");
	});
});

describe("chunkTextForOutbound", () => {
	it("returns empty for empty text", () => {
		expect(chunkTextForOutbound("", 10)).toEqual([]);
	});

	it("splits on newline or whitespace boundaries", () => {
		expect(chunkTextForOutbound("alpha\nbeta gamma", 8)).toEqual([
			"alpha",
			"beta",
			"gamma",
		]);
	});

	it("falls back to hard limit when no separator exists", () => {
		expect(chunkTextForOutbound("abcdefghij", 4)).toEqual([
			"abcd",
			"efgh",
			"ij",
		]);
	});
});
