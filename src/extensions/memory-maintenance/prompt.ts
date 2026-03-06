export type PhiMemoryMaintenanceReason = "switch" | "compaction";

export function buildPhiMemoryMaintenanceContent(
	reason: PhiMemoryMaintenanceReason,
	paths: {
		dailyMemoryFilePath?: string;
	} = {}
): string {
	const dailyMemoryFilePath =
		paths.dailyMemoryFilePath ?? ".phi/memory/YYYY-MM-DD.md";
	if (reason === "switch") {
		return [
			"Phi memory maintenance.",
			"A session switch is about to happen.",
			"Review recent context and store anything durable that should survive leaving the current session.",
			`Use ${dailyMemoryFilePath} for raw working notes, intermediate facts, and temporary context when useful.`,
			"If nothing is worth storing, do nothing.",
		].join(" ");
	}

	return [
		"Phi memory maintenance.",
		"Compaction is about to happen.",
		"Review recent context and store anything durable that should survive compaction.",
		`Use ${dailyMemoryFilePath} for raw working notes, intermediate facts, and temporary context when useful.`,
		"If nothing is worth storing, do nothing.",
	].join(" ");
}
