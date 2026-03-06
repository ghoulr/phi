import { describe, expect, it } from "bun:test";

import {
	buildPhiMemoryPaths,
	buildPhiMemoryPromptPaths,
	formatPhiPromptPath,
	getPhiDailyMemoryFilePath,
	getPhiDailyMemoryFilePathForDate,
} from "@phi/core/memory-paths";

describe("memory prompt paths", () => {
	it("builds memory paths from the memory file path", () => {
		expect(buildPhiMemoryPaths("/tmp/memory/MEMORY.md")).toEqual({
			memoryFilePath: "/tmp/memory/MEMORY.md",
			dailyMemoryFilePath: "/tmp/memory/YYYY-MM-DD.md",
		});
	});

	it("keeps workspace-local memory paths relative", () => {
		expect(
			buildPhiMemoryPromptPaths({
				workspacePath: "/workspace/alice",
				memoryFilePath: "/workspace/alice/.phi/memory/MEMORY.md",
			})
		).toEqual({
			memoryFilePath: ".phi/memory/MEMORY.md",
			dailyMemoryFilePath: ".phi/memory/YYYY-MM-DD.md",
		});
	});

	it("keeps external memory paths absolute", () => {
		expect(
			buildPhiMemoryPromptPaths({
				workspacePath: "/workspace/alice",
				memoryFilePath: "/home/tester/.phi/pi/memory/MEMORY.md",
			})
		).toEqual({
			memoryFilePath: "/home/tester/.phi/pi/memory/MEMORY.md",
			dailyMemoryFilePath: "/home/tester/.phi/pi/memory/YYYY-MM-DD.md",
		});
	});

	it("builds daily memory file path template from memory file path", () => {
		expect(getPhiDailyMemoryFilePath("/tmp/memory/MEMORY.md")).toBe(
			"/tmp/memory/YYYY-MM-DD.md"
		);
	});

	it("builds concrete daily memory file path for a date", () => {
		expect(
			getPhiDailyMemoryFilePathForDate(
				"/tmp/memory/MEMORY.md",
				new Date("2026-03-06T10:00:00.000Z")
			)
		).toBe("/tmp/memory/2026-03-06.md");
	});

	it("returns absolute path when target is outside workspace", () => {
		expect(
			formatPhiPromptPath(
				"/workspace/alice",
				"/home/tester/.phi/pi/memory/MEMORY.md"
			)
		).toBe("/home/tester/.phi/pi/memory/MEMORY.md");
	});
});
