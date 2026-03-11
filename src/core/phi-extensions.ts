import type { ExtensionFactory } from "@mariozechner/pi-coding-agent";

export const PHI_MEMORY_MAINTENANCE_EXTENSION_ID = "memory-maintenance";
export const PHI_MESSAGING_EXTENSION_ID = "messaging";

export type PhiOwnedExtensionId =
	| typeof PHI_MEMORY_MAINTENANCE_EXTENSION_ID
	| typeof PHI_MESSAGING_EXTENSION_ID;

export interface PhiOwnedExtensionFactoryDefinition {
	id: PhiOwnedExtensionId;
	create(): ExtensionFactory;
}

export function isPhiOwnedExtensionEnabled(
	disabledExtensionIds: readonly string[],
	id: PhiOwnedExtensionId
): boolean {
	return !disabledExtensionIds.includes(id);
}

export function createEnabledPhiOwnedExtensionFactories(params: {
	disabledExtensionIds: readonly string[];
	definitions: readonly PhiOwnedExtensionFactoryDefinition[];
}): ExtensionFactory[] {
	return params.definitions
		.filter((definition) =>
			isPhiOwnedExtensionEnabled(
				params.disabledExtensionIds,
				definition.id
			)
		)
		.map((definition) => definition.create());
}
