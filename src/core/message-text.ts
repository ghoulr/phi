function stripDisallowedControlChars(text: string): string {
	let output = "";
	for (const char of text) {
		const code = char.charCodeAt(0);
		if (
			code === 9 ||
			code === 10 ||
			code === 13 ||
			(code >= 32 && code !== 127)
		) {
			output += char;
		}
	}
	return output;
}

export function sanitizeInboundText(
	message: string
): { ok: true; message: string } | { ok: false; error: string } {
	const normalized = message.normalize("NFC");
	if (normalized.includes("\u0000")) {
		return { ok: false, error: "message must not contain null bytes" };
	}
	return { ok: true, message: stripDisallowedControlChars(normalized) };
}

export function sanitizeOutboundText(text: string): string {
	return stripDisallowedControlChars(text.normalize("NFC"));
}

export function chunkTextByBreakResolver(
	text: string,
	limit: number,
	resolveBreakIndex: (window: string) => number
): string[] {
	if (!text) {
		return [];
	}
	if (limit <= 0 || text.length <= limit) {
		return [text];
	}
	const chunks: string[] = [];
	let remaining = text;
	while (remaining.length > limit) {
		const window = remaining.slice(0, limit);
		const candidateBreak = resolveBreakIndex(window);
		const breakIdx =
			Number.isFinite(candidateBreak) &&
			candidateBreak > 0 &&
			candidateBreak <= limit
				? candidateBreak
				: limit;
		const rawChunk = remaining.slice(0, breakIdx);
		const chunk = rawChunk.trimEnd();
		if (chunk.length > 0) {
			chunks.push(chunk);
		}
		const brokeOnSeparator =
			breakIdx < remaining.length && /\s/.test(remaining[breakIdx] ?? "");
		const nextStart = Math.min(
			remaining.length,
			breakIdx + (brokeOnSeparator ? 1 : 0)
		);
		remaining = remaining.slice(nextStart).trimStart();
	}
	if (remaining.length > 0) {
		chunks.push(remaining);
	}
	return chunks;
}

export function chunkTextForOutbound(text: string, limit: number): string[] {
	return chunkTextByBreakResolver(text, limit, (window) => {
		const lastNewline = window.lastIndexOf("\n");
		const lastSpace = window.lastIndexOf(" ");
		return lastNewline > 0 ? lastNewline : lastSpace;
	});
}
