import { existsSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "bun:test";

import {
	ensurePhiPiAgentDir,
	resolveExistingPhiPiAgentDir,
} from "@phi/core/pi-agent-dir";

describe("ensurePhiPiAgentDir", () => {
	it("creates the shared pi workspace directory on demand", () => {
		const homeDir = mkdtempSync(join(tmpdir(), "phi-home-"));

		try {
			const piDir = ensurePhiPiAgentDir(homeDir);

			expect(piDir).toBe(join(homeDir, ".phi", "pi"));
			expect(existsSync(piDir)).toBe(true);
		} finally {
			rmSync(homeDir, { recursive: true, force: true });
		}
	});
});

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
