import { describe, expect, it } from "bun:test";

import { buildPhiMemoryMaintenanceContent } from "@phi/extensions/memory-maintenance";

describe("buildPhiMemoryMaintenanceContent", () => {
	it("builds switch maintenance instructions", () => {
		const content = buildPhiMemoryMaintenanceContent("switch");

		expect(content).toContain("session switch is about to happen");
		expect(content).toContain("store anything durable");
		expect(content).toContain("If nothing is worth storing, do nothing.");
		expect(content).toContain(".phi/memory/YYYY-MM-DD.md");
	});

	it("builds compaction maintenance instructions", () => {
		const content = buildPhiMemoryMaintenanceContent("compaction");

		expect(content).toContain("Compaction is about to happen.");
		expect(content).toContain("store anything durable");
		expect(content).toContain("survive compaction");
		expect(content).toContain(".phi/memory/YYYY-MM-DD.md");
	});

	it("uses custom daily memory path when provided", () => {
		const content = buildPhiMemoryMaintenanceContent("switch", {
			dailyMemoryFilePath: "/home/tester/.phi/pi/memory/YYYY-MM-DD.md",
		});

		expect(content).toContain("/home/tester/.phi/pi/memory/YYYY-MM-DD.md");
	});
});
