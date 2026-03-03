import { describe, expect, it } from "bun:test";

import {
	getPhiConfigFilePath,
	getPhiDir,
	getPhiSharedAuthFilePath,
	getPhiTuiAgentDir,
} from "@phi/core/paths";

describe("phi paths", () => {
	it("resolves all phi paths from a custom home directory", () => {
		const homeDir = "/tmp/custom-home";

		expect(getPhiDir(homeDir)).toBe("/tmp/custom-home/.phi");
		expect(getPhiConfigFilePath(homeDir)).toBe(
			"/tmp/custom-home/.phi/phi.yaml"
		);
		expect(getPhiSharedAuthFilePath(homeDir)).toBe(
			"/tmp/custom-home/.phi/auth/auth.json"
		);
		expect(getPhiTuiAgentDir(homeDir)).toBe("/tmp/custom-home/.phi/pi");
	});

	it("normalizes trailing slash in home directory", () => {
		const homeDir = "/tmp/custom-home/";

		expect(getPhiDir(homeDir)).toBe("/tmp/custom-home/.phi");
	});
});
