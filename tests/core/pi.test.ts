import { afterEach, describe, expect, it } from "bun:test";

import { disablePiVersionCheck } from "@phi/core/pi";

const KEY = "PI_SKIP_VERSION_CHECK";
const originalValue = process.env[KEY];

afterEach(() => {
	if (originalValue === undefined) {
		delete process.env[KEY];
		return;
	}
	process.env[KEY] = originalValue;
});

describe("disablePiVersionCheck", () => {
	it("sets PI_SKIP_VERSION_CHECK when it is missing", () => {
		delete process.env[KEY];

		disablePiVersionCheck();

		expect(process.env[KEY]).toBe("1");
	});

	it("overwrites existing value to enforce skipping version check", () => {
		process.env[KEY] = "0";

		disablePiVersionCheck();

		expect(process.env[KEY]).toBe("1");
	});
});
