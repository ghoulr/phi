import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "bun:test";

import { resolveExistingPhiPiAgentDir } from "@phi/core/pi-agent-dir";

describe("resolveExistingPhiPiAgentDir", () => {
	it("fails fast when shared pi workspace is missing", () => {
		const homeDir = mkdtempSync(join(tmpdir(), "phi-home-"));
		try {
			expect(() => resolveExistingPhiPiAgentDir(homeDir)).toThrow(
				"Missing shared pi workspace directory"
			);
		} finally {
			rmSync(homeDir, { recursive: true, force: true });
		}
	});

	it("returns shared pi workspace path when directory exists", () => {
		const homeDir = mkdtempSync(join(tmpdir(), "phi-home-"));
		const piDir = join(homeDir, ".phi", "pi");
		mkdirSync(piDir, { recursive: true });
		try {
			expect(resolveExistingPhiPiAgentDir(homeDir)).toBe(piDir);
		} finally {
			rmSync(homeDir, { recursive: true, force: true });
		}
	});
});
