import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "bun:test";

import { ensureChatWorkspaceLayout } from "@phi/core/chat-workspace";

describe("ensureChatWorkspaceLayout", () => {
	it("creates workspace and required .phi directories", () => {
		const root = mkdtempSync(join(tmpdir(), "phi-chat-workspace-"));
		const workspaceDir = join(root, "alice");

		try {
			const layout = ensureChatWorkspaceLayout(workspaceDir);

			expect(layout.workspaceDir).toBe(workspaceDir);
			expect(existsSync(layout.phiDir)).toBe(true);
			expect(existsSync(layout.sessionsDir)).toBe(true);
			expect(existsSync(layout.memoryDir)).toBe(true);
			expect(existsSync(layout.logsDir)).toBe(true);
			expect(existsSync(layout.skillsDir)).toBe(true);
			expect(existsSync(layout.memoryFilePath)).toBe(true);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("initializes MEMORY.md once and keeps existing content", () => {
		const root = mkdtempSync(join(tmpdir(), "phi-chat-workspace-"));
		const workspaceDir = join(root, "bob");

		try {
			const first = ensureChatWorkspaceLayout(workspaceDir);
			expect(readFileSync(first.memoryFilePath, "utf-8")).toBe(
				"# MEMORY\n"
			);

			const customContent = "# MEMORY\ncustom notes\n";
			writeFileSync(first.memoryFilePath, customContent, "utf-8");

			const second = ensureChatWorkspaceLayout(workspaceDir);
			expect(readFileSync(second.memoryFilePath, "utf-8")).toBe(
				customContent
			);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("keeps session storage flat under workspace", () => {
		const root = mkdtempSync(join(tmpdir(), "phi-chat-workspace-"));
		const workspaceDir = join(root, "carol");

		try {
			const layout = ensureChatWorkspaceLayout(workspaceDir);

			expect(layout.sessionsDir).toBe(
				join(workspaceDir, ".phi", "sessions")
			);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
