import { describe, expect, it } from "bun:test";

import {
	createEnabledPhiOwnedExtensionFactories,
	PHI_MEMORY_MAINTENANCE_EXTENSION_ID,
	PHI_MESSAGING_EXTENSION_ID,
} from "@phi/core/phi-extensions";

describe("phi extension factory filtering", () => {
	it("keeps enabled extension factories in order", () => {
		const memoryFactory = (() => undefined) as never;
		const messagingFactory = (() => undefined) as never;
		const extensionFactories = createEnabledPhiOwnedExtensionFactories({
			disabledExtensionIds: [],
			definitions: [
				{
					id: PHI_MEMORY_MAINTENANCE_EXTENSION_ID,
					create: () => memoryFactory,
				},
				{
					id: PHI_MESSAGING_EXTENSION_ID,
					create: () => messagingFactory,
				},
			],
		});

		expect(extensionFactories).toEqual([memoryFactory, messagingFactory]);
	});

	it("drops disabled extension factories", () => {
		const memoryFactory = (() => undefined) as never;
		const messagingFactory = (() => undefined) as never;
		const extensionFactories = createEnabledPhiOwnedExtensionFactories({
			disabledExtensionIds: [PHI_MESSAGING_EXTENSION_ID],
			definitions: [
				{
					id: PHI_MEMORY_MAINTENANCE_EXTENSION_ID,
					create: () => memoryFactory,
				},
				{
					id: PHI_MESSAGING_EXTENSION_ID,
					create: () => messagingFactory,
				},
			],
		});

		expect(extensionFactories).toEqual([memoryFactory]);
	});
});
