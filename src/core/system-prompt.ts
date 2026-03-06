import { existsSync, readFileSync } from "node:fs";

import {
	formatSkillsForPrompt,
	type Skill,
} from "@mariozechner/pi-coding-agent";

export interface BuildPhiSystemPromptParams {
	assistantName: string;
	workspacePath: string;
	skills: Skill[];
	memoryFilePath: string;
	toolNames: string[];
	eventText?: string;
}

const DEFAULT_MEMORY_FILE_HEADER = "# MEMORY";

const TOOL_DESCRIPTION_MAP: Record<string, string> = {
	read: "Read file contents",
	bash: "Execute bash commands (ls, rg, find, etc.)",
	edit: "Make surgical edits to files (exact text replacement)",
	write: "Create or overwrite files",
	grep: "Search file contents for patterns",
	find: "Find files by glob pattern",
	ls: "List directory contents",
};

interface ToolGuidelineRule {
	readonly id: string;
	readonly line: string;
	matches(toolNames: Set<string>): boolean;
}

const TOOL_GUIDELINE_RULES: readonly ToolGuidelineRule[] = [
	{
		id: "read-edit",
		line: "Use read to examine files before editing.",
		matches(toolNames: Set<string>): boolean {
			return toolNames.has("read") && toolNames.has("edit");
		},
	},
	{
		id: "edit",
		line: "Use edit for precise changes (old text must match exactly).",
		matches(toolNames: Set<string>): boolean {
			return toolNames.has("edit");
		},
	},
	{
		id: "write",
		line: "Use write only for new files or complete rewrites.",
		matches(toolNames: Set<string>): boolean {
			return toolNames.has("write");
		},
	},
	{
		id: "bash",
		line: "Use bash for execution tasks; prefer dedicated tools when an equivalent first-class tool exists.",
		matches(toolNames: Set<string>): boolean {
			return toolNames.has("bash");
		},
	},
	{
		id: "destructive",
		line: "For destructive actions, be explicit and cautious.",
		matches(toolNames: Set<string>): boolean {
			return (
				toolNames.has("bash") ||
				toolNames.has("edit") ||
				toolNames.has("write")
			);
		},
	},
];

function normalizeToolNames(toolNames: string[]): string[] {
	const unique = new Set<string>();
	const normalizedNames: string[] = [];
	for (const toolName of toolNames) {
		const normalized = toolName.trim();
		if (!normalized || unique.has(normalized)) {
			continue;
		}
		unique.add(normalized);
		normalizedNames.push(normalized);
	}
	return normalizedNames;
}

function buildToolsText(toolNames: string[]): string {
	const normalizedNames = normalizeToolNames(toolNames);
	if (normalizedNames.length === 0) {
		return "- (none)";
	}
	const lines: string[] = [];
	for (const toolName of normalizedNames) {
		const description = TOOL_DESCRIPTION_MAP[toolName.toLowerCase()];
		if (description) {
			lines.push(`- ${toolName}: ${description}`);
			continue;
		}
		lines.push(`- ${toolName}`);
	}
	return lines.join("\n");
}

function buildToolGuidance(toolNames: string[]): string[] {
	const normalizedToolNames = new Set(
		normalizeToolNames(toolNames).map((toolName) => toolName.toLowerCase())
	);
	const lines = ["Use the appropriate tool directly when available."];
	for (const rule of TOOL_GUIDELINE_RULES) {
		if (rule.matches(normalizedToolNames)) {
			lines.push(rule.line);
		}
	}
	return lines;
}

function buildSkillsText(skills: Skill[]): string {
	return formatSkillsForPrompt(skills).trim();
}

function readMemoryText(memoryFilePath: string): string {
	if (!existsSync(memoryFilePath)) {
		return "";
	}
	const text = readFileSync(memoryFilePath, "utf-8").trim();
	if (!text || text === DEFAULT_MEMORY_FILE_HEADER) {
		return "";
	}
	return text;
}

function appendSection(lines: string[], title: string, body: string): void {
	const normalized = body.trim();
	if (!normalized) {
		return;
	}
	lines.push(title, normalized, "");
}

function buildMemorySection(memoryText: string): string {
	const lines = [
		"Persist important long-lived context in memory files.",
		"",
		'- Use `.phi/memory/MEMORY.md` for durable facts and explicit "remember this" requests, when user asks to remember anything, add to this file, keep it small and concise, rewrite it if necessary.',
		"- Use `YYYY-MM-DD.md` in `.phi/memory/` for raw daily notes and working context.",
		"- Daily notes are not auto-injected; grep and read them on demand when needed.",
	];
	if (!memoryText) {
		return lines.join("\n");
	}
	lines.push("", "Current MEMORY.md:", "", memoryText);
	return lines.join("\n");
}

export function buildPhiSystemPrompt(
	params: BuildPhiSystemPromptParams
): string {
	const skillsText = buildSkillsText(params.skills);
	const memoryText = readMemoryText(params.memoryFilePath);
	const eventText = params.eventText?.trim() ?? "";
	const toolsText = buildToolsText(params.toolNames);
	const toolGuidance = buildToolGuidance(params.toolNames);

	const lines = [
		`You are ${params.assistantName}, a personal assistant. Be concise.`,
		"",
		"## Workspace Layout",
		`Workspace root: ${params.workspacePath}`,
		"",
		"Use workspace files and directories as the source of truth for persistent context.",
		"",
	];

	appendSection(lines, "## Skills", skillsText);
	appendSection(lines, "## Memory", buildMemorySection(memoryText));
	appendSection(lines, "## Events & Replies", eventText);

	lines.push("## Tools", toolsText, "", "Tool guidance:");
	for (const guideline of toolGuidance) {
		lines.push(`- ${guideline}`);
	}
	return lines.join("\n").trim();
}
