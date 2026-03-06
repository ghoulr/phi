import { dirname, isAbsolute, join, relative } from "node:path";

function formatPhiMemoryDate(date: Date): string {
	const year = date.getFullYear();
	const month = `${date.getMonth() + 1}`.padStart(2, "0");
	const day = `${date.getDate()}`.padStart(2, "0");
	return `${year}-${month}-${day}`;
}

export function getPhiDailyMemoryFilePath(memoryFilePath: string): string {
	return join(dirname(memoryFilePath), "YYYY-MM-DD.md");
}

export function getPhiDailyMemoryFilePathForDate(
	memoryFilePath: string,
	date: Date = new Date()
): string {
	return join(dirname(memoryFilePath), `${formatPhiMemoryDate(date)}.md`);
}

export function buildPhiMemoryPaths(memoryFilePath: string): {
	memoryFilePath: string;
	dailyMemoryFilePath: string;
} {
	return {
		memoryFilePath,
		dailyMemoryFilePath: getPhiDailyMemoryFilePath(memoryFilePath),
	};
}

export function formatPhiPromptPath(
	workspacePath: string,
	targetPath: string
): string {
	const relativePath = relative(workspacePath, targetPath);
	if (
		relativePath.length > 0 &&
		!relativePath.startsWith("..") &&
		!isAbsolute(relativePath)
	) {
		return relativePath;
	}
	return targetPath;
}

export function buildPhiMemoryPromptPaths(params: {
	workspacePath: string;
	memoryFilePath: string;
}): {
	memoryFilePath: string;
	dailyMemoryFilePath: string;
} {
	const memoryPaths = buildPhiMemoryPaths(params.memoryFilePath);
	return {
		memoryFilePath: formatPhiPromptPath(
			params.workspacePath,
			memoryPaths.memoryFilePath
		),
		dailyMemoryFilePath: formatPhiPromptPath(
			params.workspacePath,
			memoryPaths.dailyMemoryFilePath
		),
	};
}
