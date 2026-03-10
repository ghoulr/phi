import type {
	ExtensionFactory,
	LoadExtensionsResult,
} from "@mariozechner/pi-coding-agent";

const INLINE_EXTENSION_PATH_PREFIX = "<inline:";
const INLINE_EXTENSION_LABEL_KEY = "phiInlineExtensionLabel";

interface PhiLabeledExtensionFactory extends ExtensionFactory {
	[INLINE_EXTENSION_LABEL_KEY]?: string;
}

function normalizeInlineExtensionLabel(label: string): string {
	const normalizedLabel = label.trim().replaceAll("\\", "/");
	if (!normalizedLabel) {
		throw new Error("Inline extension label must not be empty.");
	}
	const segments = normalizedLabel.split("/");
	if (
		segments.some(
			(segment) =>
				segment.trim().length === 0 ||
				segment === "." ||
				segment === ".."
		)
	) {
		throw new Error(
			"Inline extension label contains invalid path segments."
		);
	}
	return segments.join("/");
}

function getInlineExtensionLabel(
	factory: ExtensionFactory | undefined
): string | undefined {
	return (factory as PhiLabeledExtensionFactory | undefined)?.[
		INLINE_EXTENSION_LABEL_KEY
	];
}

function parseInlineExtensionIndex(path: string): number | undefined {
	if (!path.startsWith(INLINE_EXTENSION_PATH_PREFIX) || !path.endsWith(">")) {
		return undefined;
	}
	const indexText = path.slice(INLINE_EXTENSION_PATH_PREFIX.length, -1);
	const inlineIndex = Number.parseInt(indexText, 10);
	if (Number.isNaN(inlineIndex)) {
		return undefined;
	}
	return inlineIndex;
}

function buildInlineExtensionDisplayLabel(params: {
	label: string;
	labelCounts: Map<string, number>;
}): string {
	const currentCount = (params.labelCounts.get(params.label) ?? 0) + 1;
	params.labelCounts.set(params.label, currentCount);
	const segments = params.label.split("/");
	const lastSegment = segments.at(-1);
	if (!lastSegment) {
		throw new Error("Inline extension label must not be empty.");
	}
	if (currentCount > 1) {
		segments[segments.length - 1] = `${lastSegment}-${currentCount}`;
	}
	return segments.join("/");
}

export function labelInlineExtensionFactory(
	label: string,
	factory: ExtensionFactory
): ExtensionFactory {
	const normalizedLabel = normalizeInlineExtensionLabel(label);
	const labeledFactory: PhiLabeledExtensionFactory = (pi) => factory(pi);
	labeledFactory[INLINE_EXTENSION_LABEL_KEY] = normalizedLabel;
	return labeledFactory;
}

export function applyInlineExtensionLabels(params: {
	extensionFactories: ExtensionFactory[];
	result: LoadExtensionsResult;
}): LoadExtensionsResult {
	const labelCounts = new Map<string, number>();
	const pathByInlineIndex = new Map<number, string>();

	for (const [index, factory] of params.extensionFactories.entries()) {
		const label = getInlineExtensionLabel(factory);
		if (!label) {
			continue;
		}
		pathByInlineIndex.set(
			index + 1,
			buildInlineExtensionDisplayLabel({
				label,
				labelCounts,
			})
		);
	}

	const rewriteInlinePath = (path: string): string => {
		const inlineIndex = parseInlineExtensionIndex(path);
		if (inlineIndex === undefined) {
			return path;
		}
		return pathByInlineIndex.get(inlineIndex) ?? path;
	};

	return {
		...params.result,
		extensions: params.result.extensions.map((extension) => ({
			...extension,
			path: rewriteInlinePath(extension.path),
		})),
		errors: params.result.errors.map((error) => ({
			...error,
			path: rewriteInlinePath(error.path),
		})),
	};
}
