import { Text } from "@mariozechner/pi-tui";
import type {
	AgentToolResult,
	Theme,
	ToolRenderResultOptions,
} from "@mariozechner/pi-coding-agent";

const COLLAPSED_MAX_LINES = 10;

function getTextContent(result: AgentToolResult<unknown>): string {
	return result.content
		.filter((item) => item.type === "text")
		.map((item) => item.text)
		.join("\n");
}

function appendPreview(
	text: string,
	content: string,
	options: ToolRenderResultOptions,
	theme: Theme
): string {
	const lines = content.split("\n");
	const displayLines = options.expanded
		? lines
		: lines.slice(0, COLLAPSED_MAX_LINES);
	const remaining = lines.length - displayLines.length;
	if (displayLines.length > 0) {
		text += `\n\n${displayLines.map((line) => theme.fg("toolOutput", line)).join("\n")}`;
	}
	if (remaining > 0) {
		text += `\n${theme.fg("muted", `... ${remaining} more lines`)}`;
	}
	return text;
}

export function renderToolCall(
	toolName: string,
	label: string,
	theme: Theme
): Text {
	return new Text(
		`${theme.fg("toolTitle", theme.bold(toolName))} ${theme.fg("accent", label)}`,
		0,
		0
	);
}

export function renderTextToolResult(
	result: AgentToolResult<unknown>,
	options: ToolRenderResultOptions,
	theme: Theme,
	summary: string
): Text {
	if (options.isPartial) {
		return new Text(theme.fg("warning", "Running..."), 0, 0);
	}
	const content = getTextContent(result);
	const text = theme.fg("success", summary);
	return new Text(appendPreview(text, content, options, theme), 0, 0);
}
