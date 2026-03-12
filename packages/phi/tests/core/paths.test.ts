import { describe, expect, it } from "bun:test";

import {
	getPhiConfigFilePath,
	getPhiDir,
	getPhiPiAgentDir,
	getPhiPiMemoryDir,
	getPhiPiMemoryFilePath,
	getPhiSharedAuthFilePath,
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
		expect(getPhiPiAgentDir(homeDir)).toBe("/tmp/custom-home/.phi/pi");
		expect(getPhiPiMemoryDir(homeDir)).toBe(
			"/tmp/custom-home/.phi/pi/memory"
		);
		expect(getPhiPiMemoryFilePath(homeDir)).toBe(
			"/tmp/custom-home/.phi/pi/memory/MEMORY.md"
		);
	});

	it("normalizes trailing slash in home directory", () => {
		const homeDir = "/tmp/custom-home/";

		expect(getPhiDir(homeDir)).toBe("/tmp/custom-home/.phi");
	});
});
