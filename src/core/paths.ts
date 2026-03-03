import { homedir } from "node:os";
import { join } from "node:path";

export function getPhiDir(userHomeDir: string = homedir()): string {
	return join(userHomeDir, ".phi");
}

export function getPhiConfigFilePath(userHomeDir: string = homedir()): string {
	return join(getPhiDir(userHomeDir), "phi.yaml");
}

export function getPhiSharedAuthFilePath(
	userHomeDir: string = homedir()
): string {
	return join(getPhiDir(userHomeDir), "auth", "auth.json");
}

export function getPhiTuiAgentDir(userHomeDir: string = homedir()): string {
	return join(getPhiDir(userHomeDir), "pi");
}
