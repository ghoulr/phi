import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import {
	AuthStorage,
	createAgentSession,
	DefaultResourceLoader,
	InteractiveMode,
	ModelRegistry,
	SessionManager,
	type AgentSession,
} from "@mariozechner/pi-coding-agent";

import {
	getPhiPiMemoryFilePath,
	getPhiSharedAuthFilePath,
} from "@phi/core/paths";
import { resolveExistingPhiPiAgentDir } from "@phi/core/pi-agent-dir";
import {
	createPhiSkillsOverride,
	resolvePhiGlobalSkillPaths,
} from "@phi/core/skills";
import { createPhiMemoryMaintenanceExtension } from "@phi/extensions/memory-maintenance";
import { installPhiSystemPrompt } from "@phi/extensions/system-prompt";

export type TuiModeRunner = (session: AgentSession) => Promise<void>;
export type TuiSessionFactory = () => Promise<AgentSession>;

const DEFAULT_PROMPT_TOOL_NAMES = ["read", "bash", "edit", "write"];

function getTuiSessionsDir(agentDir: string): string {
	return join(agentDir, "sessions");
}

export function ensureTuiMemoryFile(userHomeDir: string = homedir()): string {
	const memoryFilePath = getPhiPiMemoryFilePath(userHomeDir);
	mkdirSync(dirname(memoryFilePath), { recursive: true });
	if (!existsSync(memoryFilePath)) {
		writeFileSync(memoryFilePath, "# MEMORY\n", "utf-8");
	}
	return memoryFilePath;
}

export async function createDefaultTuiSession(
	cwd: string = process.cwd(),
	userHomeDir: string = homedir()
): Promise<AgentSession> {
	const memoryFilePath = ensureTuiMemoryFile(userHomeDir);
	const agentDir = resolveExistingPhiPiAgentDir(userHomeDir);
	const authStorage = AuthStorage.create(
		getPhiSharedAuthFilePath(userHomeDir)
	);
	const modelRegistry = new ModelRegistry(
		authStorage,
		join(agentDir, "models.json")
	);
	const skillPaths = resolvePhiGlobalSkillPaths(userHomeDir);
	const resourceLoader = new DefaultResourceLoader({
		cwd,
		agentDir,
		noSkills: true,
		additionalSkillPaths: skillPaths,
		skillsOverride: createPhiSkillsOverride({
			roots: skillPaths,
		}),
		extensionFactories: [
			createPhiMemoryMaintenanceExtension({
				memoryFilePath,
			}),
		],
	});
	await resourceLoader.reload();

	const { session } = await createAgentSession({
		cwd,
		agentDir,
		authStorage,
		modelRegistry,
		sessionManager: SessionManager.continueRecent(
			cwd,
			getTuiSessionsDir(agentDir)
		),
		resourceLoader,
	});
	installPhiSystemPrompt({
		session,
		assistantName: "Phi",
		workspacePath: cwd,
		skills: resourceLoader.getSkills().skills,
		memoryFilePath,
		toolNames: DEFAULT_PROMPT_TOOL_NAMES,
		includeWorkspaceConfigGuidance: false,
	});
	return session;
}

export async function runInteractiveTui(session: AgentSession): Promise<void> {
	const mode = new InteractiveMode(session);
	await mode.run();
}

export async function runTuiCommand(
	createSession: TuiSessionFactory = () => createDefaultTuiSession(),
	runMode: TuiModeRunner = runInteractiveTui
): Promise<void> {
	const session = await createSession();
	try {
		await runMode(session);
	} finally {
		session.dispose();
	}
}
