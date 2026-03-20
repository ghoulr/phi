import { existsSync, readFileSync } from "node:fs";

import {
	formatSkillsForPrompt,
	type Skill,
} from "@mariozechner/pi-coding-agent";

import { buildPhiMemoryPromptPaths } from "@phi/core/memory-paths";
import { limitSkillsForPrompt } from "@phi/core/skills";

export interface PhiSystemPromptTool {
	name: string;
	promptSnippet?: string;
	promptGuidelines?: string[];
}

export interface BuildPhiSystemPromptParams {
	assistantName: string;
	workspacePath: string;
	skills: Skill[];
	memoryFilePath: string;
	tools: PhiSystemPromptTool[];
	includeWorkspaceConfigGuidance?: boolean;
}

const DEFAULT_MEMORY_FILE_HEADER = "# MEMORY";

const BUILTIN_TOOL_SNIPPETS: Record<string, string> = {
	read: "Read file contents",
	bash: "Execute bash commands (ls, rg, find, etc.)",
	edit: "Make surgical edits to files (exact text replacement)",
	write: "Create or overwrite files",
};

interface ToolGuidelineRule {
	readonly line: string;
	matches(toolNames: Set<string>): boolean;
}

const BUILTIN_TOOL_GUIDELINE_RULES: readonly ToolGuidelineRule[] = [
	{
		line: "Use read to examine files before editing.",
		matches(toolNames: Set<string>): boolean {
			return toolNames.has("read") && toolNames.has("edit");
		},
	},
	{
		line: "Use edit for precise changes (old text must match exactly).",
		matches(toolNames: Set<string>): boolean {
			return toolNames.has("edit");
		},
	},
	{
		line: "Use write only for new files or complete rewrites.",
		matches(toolNames: Set<string>): boolean {
			return toolNames.has("write");
		},
	},
	{
		line: "Use bash for execution tasks; prefer dedicated tools when an equivalent first-class tool exists, use `date` for correct datetime before doing anything about time.",
		matches(toolNames: Set<string>): boolean {
			return toolNames.has("bash");
		},
	},
	{
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

function normalizeGuidelines(guidelines: string[] | undefined): string[] {
	const unique = new Set<string>();
	const normalizedGuidelines: string[] = [];
	for (const guideline of guidelines ?? []) {
		const normalized = guideline.trim();
		if (!normalized || unique.has(normalized)) {
			continue;
		}
		unique.add(normalized);
		normalizedGuidelines.push(normalized);
	}
	return normalizedGuidelines;
}

function normalizeTools(tools: PhiSystemPromptTool[]): PhiSystemPromptTool[] {
	const normalizedTools = new Map<string, PhiSystemPromptTool>();
	for (const tool of tools) {
		const name = tool.name.trim();
		if (!name) {
			continue;
		}
		const key = name.toLowerCase();
		const existing = normalizedTools.get(key);
		const promptSnippet = tool.promptSnippet?.trim();
		const promptGuidelines = normalizeGuidelines(tool.promptGuidelines);
		if (!existing) {
			normalizedTools.set(key, {
				name,
				promptSnippet,
				promptGuidelines,
			});
			continue;
		}
		normalizedTools.set(key, {
			name: existing.name,
			promptSnippet: promptSnippet || existing.promptSnippet,
			promptGuidelines: normalizeGuidelines([
				...(existing.promptGuidelines ?? []),
				...promptGuidelines,
			]),
		});
	}
	return Array.from(normalizedTools.values());
}

function resolveToolSnippet(tool: PhiSystemPromptTool): string | undefined {
	if (tool.promptSnippet) {
		return tool.promptSnippet;
	}
	return BUILTIN_TOOL_SNIPPETS[tool.name.toLowerCase()];
}

function buildToolsText(tools: PhiSystemPromptTool[]): string {
	const lines = tools
		.map((tool) => {
			const snippet = resolveToolSnippet(tool);
			if (!snippet) {
				return undefined;
			}
			return `- ${tool.name}: ${snippet}`;
		})
		.filter((line): line is string => line !== undefined);
	if (lines.length === 0) {
		return "- (none)";
	}
	return lines.join("\n");
}

function buildGuidelines(tools: PhiSystemPromptTool[]): string {
	const lines: string[] = [];
	const unique = new Set<string>();
	const addLine = (line: string): void => {
		const normalized = line.trim();
		if (!normalized || unique.has(normalized)) {
			return;
		}
		unique.add(normalized);
		lines.push(`- ${normalized}`);
	};
	const normalizedToolNames = new Set(
		tools.map((tool) => tool.name.toLowerCase())
	);
	for (const rule of BUILTIN_TOOL_GUIDELINE_RULES) {
		if (rule.matches(normalizedToolNames)) {
			addLine(rule.line);
		}
	}
	for (const tool of tools) {
		for (const guideline of normalizeGuidelines(tool.promptGuidelines)) {
			addLine(guideline);
		}
	}
	return lines.join("\n");
}

function buildSkillsText(skills: Skill[]): string {
	return formatSkillsForPrompt(limitSkillsForPrompt(skills)).trim();
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

function buildWorkspaceSection(params: {
	workspacePath: string;
	includeWorkspaceConfigGuidance: boolean;
}): string {
	const lines = [
		`Workspace root: ${params.workspacePath}`,
		"Use workspace files and directories as the source of truth for persistent context.",
	];
	if (!params.includeWorkspaceConfigGuidance) {
		return lines.join("\n\n");
	}
	lines.push(
		"Phi config file is `.phi/config.yaml`, read `.phi/config.template.yaml` to learn config details about:",
		"",
		"- timezone",
		"- skills env",
		"",
		"After workspace config changes, call `reload` to validate them and schedule apply after your current reply ends."
	);
	return lines.join("\n");
}

function buildMessageFormatSection(): string {
	return [
		"- Input metadata: user messages may end with `<system-reminder>...</system-reminder>`; treat it as internal metadata, not user-authored input",
		"- Input metadata: the user message body is still the real input; never mention `<system-reminder>` to the user",
		"- Visible output: use the final assistant reply for normal user-visible output",
		"- Visible output: use `send(instant: true)` for immediate delivery; use `send()` to stage one deferred delivery at agent run end",
		"- Control token: `NO_REPLY` is a control token, not message text; when you have nothing else to say, your ENTIRE final assistant reply must be exact `NO_REPLY`",
		"- Control token: never append `NO_REPLY` to a real reply and never pass `NO_REPLY` to `send`",
	].join("\n");
}

function buildMemorySection(params: {
	workspacePath: string;
	memoryFilePath: string;
	memoryText: string;
}): string {
	const memoryPaths = buildPhiMemoryPromptPaths({
		workspacePath: params.workspacePath,
		memoryFilePath: params.memoryFilePath,
	});
	const lines = [
		"Persist important long-lived context in memory files.",
		"",
		`- Use \`${memoryPaths.memoryFilePath}\` for durable facts and explicit "remember this" requests, when user asks to remember anything, add to this file, keep it small and concise, rewrite it if necessary.`,
		`- Use \`${memoryPaths.dailyMemoryFilePath}\` for raw daily notes and working context.`,
		"- Daily notes are not auto-injected; grep and read them on demand when needed.",
	];
	if (!params.memoryText) {
		return lines.join("\n");
	}
	lines.push("", "Current MEMORY.md:", "", params.memoryText);
	return lines.join("\n");
}

export function buildPhiSystemPrompt(
	params: BuildPhiSystemPromptParams
): string {
	const skillsText = buildSkillsText(params.skills);
	const memoryText = readMemoryText(params.memoryFilePath);
	const normalizedTools = normalizeTools(params.tools);
	const toolsText = buildToolsText(normalizedTools);
	const guidelinesText = buildGuidelines(normalizedTools);

	const lines = [
		`You are ${params.assistantName}, a personal assistant. Be concise.`,
		"",
	];

	appendSection(
		lines,
		"## Workspace",
		buildWorkspaceSection({
			workspacePath: params.workspacePath,
			includeWorkspaceConfigGuidance:
				params.includeWorkspaceConfigGuidance !== false,
		})
	);
	appendSection(lines, "## Skills", skillsText);
	appendSection(
		lines,
		"## Memory",
		buildMemorySection({
			workspacePath: params.workspacePath,
			memoryFilePath: params.memoryFilePath,
			memoryText,
		})
	);
	appendSection(lines, "## Tools", toolsText);
	appendSection(lines, "## Guidelines", guidelinesText);
	appendSection(lines, "## Message Format", buildMessageFormatSection());
	return lines.join("\n").trim();
}
