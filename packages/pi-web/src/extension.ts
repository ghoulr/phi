import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

import { createPiWebExtension } from "./websearch.ts";

export default function (pi: ExtensionAPI): void {
	createPiWebExtension()(pi);
}
