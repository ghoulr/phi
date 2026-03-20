import { homedir } from "node:os";
import { join } from "node:path";

export function getPhiDir(userHomeDir: string = homedir()): string {
	return join(userHomeDir, ".phi");
}

export function getPhiConfigFilePath(userHomeDir: string = homedir()): string {
	return join(getPhiDir(userHomeDir), "phi.yaml");
}

export function getPhiRoutesDir(userHomeDir: string = homedir()): string {
	return join(getPhiDir(userHomeDir), "routes");
}

export function getPhiTelegramRoutesFilePath(
	userHomeDir: string = homedir()
): string {
	return join(getPhiRoutesDir(userHomeDir), "telegram.yaml");
}

export function getPhiSharedAuthFilePath(
	userHomeDir: string = homedir()
): string {
	return join(getPhiDir(userHomeDir), "auth", "auth.json");
}

export function getPhiPiAgentDir(userHomeDir: string = homedir()): string {
	return join(getPhiDir(userHomeDir), "pi");
}

export function getPhiPiMemoryDir(userHomeDir: string = homedir()): string {
	return join(getPhiPiAgentDir(userHomeDir), "memory");
}

export function getPhiPiMemoryFilePath(
	userHomeDir: string = homedir()
): string {
	return join(getPhiPiMemoryDir(userHomeDir), "MEMORY.md");
}
