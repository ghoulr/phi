import { describe, expect, it } from "bun:test";

import type {
	Extension,
	ExtensionFactory,
	ExtensionRuntime,
	LoadExtensionsResult,
	ToolInfo,
} from "@mariozechner/pi-coding-agent";

import {
	applyInlineExtensionLabels,
	labelInlineExtensionFactory,
} from "@phi/core/inline-extension-labels";

function createExtension(path: string): Extension {
	return {
		path,
		resolvedPath: path,
		handlers: new Map(),
		tools: new Map(),
		messageRenderers: new Map(),
		commands: new Map(),
		flags: new Map(),
		shortcuts: new Map(),
	};
}

function createRuntime(): ExtensionRuntime {
	return {
		flagValues: new Map(),
		pendingProviderRegistrations: [],
		registerProvider() {},
		unregisterProvider() {},
		sendMessage() {},
		sendUserMessage() {},
		appendEntry() {},
		setSessionName() {},
		getSessionName() {
			return undefined;
		},
		setLabel() {},
		getActiveTools() {
			return [];
		},
		getAllTools() {
			return [] satisfies ToolInfo[];
		},
		setActiveTools() {},
		refreshTools() {},
		getCommands() {
			return [];
		},
		async setModel() {
			return false;
		},
		getThinkingLevel() {
			return "off";
		},
		setThinkingLevel() {},
	};
}

function createResult(paths: string[]): LoadExtensionsResult {
	return {
		extensions: paths.map((path) => createExtension(path)),
		errors: paths.map((path) => ({ path, error: `failed: ${path}` })),
		runtime: createRuntime(),
	};
}

describe("labelInlineExtensionFactory", () => {
	it("rejects empty labels", () => {
		expect(() => labelInlineExtensionFactory("   ", () => {})).toThrow(
			"Inline extension label must not be empty."
		);
	});

	it("rejects invalid path segments", () => {
		expect(() =>
			labelInlineExtensionFactory("phi//messaging", () => {})
		).toThrow("Inline extension label contains invalid path segments.");
		expect(() =>
			labelInlineExtensionFactory("phi/../messaging", () => {})
		).toThrow("Inline extension label contains invalid path segments.");
	});
});

describe("applyInlineExtensionLabels", () => {
	it("rewrites labeled inline extension paths to readable labels", () => {
		const result = createResult(["<inline:1>"]);
		const extensionFactories: ExtensionFactory[] = [
			labelInlineExtensionFactory("phi/memory-maintenance", () => {}),
		];

		const labeledResult = applyInlineExtensionLabels({
			extensionFactories,
			result,
		});

		expect(labeledResult.extensions[0]?.path).toBe(
			"phi/memory-maintenance"
		);
		expect(labeledResult.errors[0]?.path).toBe("phi/memory-maintenance");
	});

	it("keeps unlabeled inline extensions unchanged", () => {
		const result = createResult(["<inline:1>"]);
		const extensionFactories: ExtensionFactory[] = [() => {}];

		const labeledResult = applyInlineExtensionLabels({
			extensionFactories,
			result,
		});

		expect(labeledResult.extensions[0]?.path).toBe("<inline:1>");
		expect(labeledResult.errors[0]?.path).toBe("<inline:1>");
	});

	it("dedupes duplicate labels with numeric suffixes", () => {
		const result = createResult(["<inline:1>", "<inline:2>"]);
		const extensionFactories: ExtensionFactory[] = [
			labelInlineExtensionFactory("phi/messaging", () => {}),
			labelInlineExtensionFactory("phi/messaging", () => {}),
		];

		const labeledResult = applyInlineExtensionLabels({
			extensionFactories,
			result,
		});

		expect(labeledResult.extensions[0]?.path).toBe("phi/messaging");
		expect(labeledResult.extensions[1]?.path).toBe("phi/messaging-2");
	});
});
