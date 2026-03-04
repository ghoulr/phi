import { describe, expect, it } from "bun:test";

import {
	formatUserFacingErrorMessage,
	normalizeUnknownError,
} from "@phi/core/user-error";

describe("normalizeUnknownError", () => {
	it("returns the same Error instance", () => {
		const error = new Error("boom");
		expect(normalizeUnknownError(error)).toBe(error);
	});

	it("normalizes non-error values", () => {
		const normalized = normalizeUnknownError(42);
		expect(normalized).toBeInstanceOf(Error);
		expect(normalized.message).toBe("42");
	});
});

describe("formatUserFacingErrorMessage", () => {
	it("sanitizes control characters", () => {
		expect(formatUserFacingErrorMessage(new Error("a\u0001b\u007fc"))).toBe(
			"abc"
		);
	});

	it("returns fallback when message becomes empty after sanitize", () => {
		expect(
			formatUserFacingErrorMessage(new Error("\u0001\u0002\u007f"))
		).toBe("Unknown error");
	});
});
