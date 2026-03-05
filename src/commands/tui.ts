import { homedir } from "node:os";
import { join } from "node:path";

import {
	AuthStorage,
	createAgentSession,
	DefaultResourceLoader,
	InteractiveMode,
	ModelRegistry,
	SessionManager,
	type AgentSession,
} from "@mariozechner/pi-coding-agent";

import { getPhiSharedAuthFilePath } from "@phi/core/paths";
import { resolveExistingPhiPiAgentDir } from "@phi/core/pi-agent-dir";
import { resolvePhiSkillPaths } from "@phi/core/skills";

export type TuiModeRunner = (session: AgentSession) => Promise<void>;
export type TuiSessionFactory = () => Promise<AgentSession>;

function getTuiSessionsDir(agentDir: string): string {
	return join(agentDir, "sessions");
}

export async function createDefaultTuiSession(
	cwd: string = process.cwd(),
	userHomeDir: string = homedir()
): Promise<AgentSession> {
	const agentDir = resolveExistingPhiPiAgentDir(userHomeDir);
	const authStorage = AuthStorage.create(
		getPhiSharedAuthFilePath(userHomeDir)
	);
	const modelRegistry = new ModelRegistry(
		authStorage,
		join(agentDir, "models.json")
	);
	const resourceLoader = new DefaultResourceLoader({
		cwd,
		agentDir,
		noSkills: true,
		additionalSkillPaths: resolvePhiSkillPaths({
			workspaceDir: cwd,
			userHomeDir,
		}),
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
