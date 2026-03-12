import { homedir } from "node:os";

import { main as runPiMain } from "@mariozechner/pi-coding-agent";

import { ensurePhiPiAgentDir } from "@phi/core/pi-agent-dir";

const SUPPORTED_PI_COMMANDS = ["install", "remove", "update", "list"] as const;

const PI_HELP_TEXT = [
	"Global pi package commands",
	"",
	"Usage:",
	"  phi pi install <source>",
	"  phi pi remove <source>",
	"  phi pi update [source]",
	"  phi pi list",
	"",
	"Notes:",
	"  - Only global scope is supported.",
	"  - Packages are managed under ~/.phi/pi.",
	"  - Local flag -l is not supported.",
].join("\n");

const PI_SUBCOMMAND_HELP: Record<SupportedPiCommand, string> = {
	install: [
		"phi pi install",
		"",
		"Usage:",
		"  phi pi install <source>",
		"",
		"Examples:",
		"  phi pi install npm:@scope/pkg",
		"  phi pi install git:github.com/user/repo@v1",
	].join("\n"),
	remove: [
		"phi pi remove",
		"",
		"Usage:",
		"  phi pi remove <source>",
		"",
		"Examples:",
		"  phi pi remove npm:@scope/pkg",
	].join("\n"),
	update: [
		"phi pi update",
		"",
		"Usage:",
		"  phi pi update [source]",
		"",
		"Examples:",
		"  phi pi update",
		"  phi pi update npm:@scope/pkg",
	].join("\n"),
	list: ["phi pi list", "", "Usage:", "  phi pi list"].join("\n"),
};

type SupportedPiCommand = (typeof SUPPORTED_PI_COMMANDS)[number];

export interface RunPiCommandDependencies {
	run(args: string[]): Promise<number>;
	write(text: string): void;
}

function isSupportedPiCommand(command: string): command is SupportedPiCommand {
	return SUPPORTED_PI_COMMANDS.includes(command as SupportedPiCommand);
}

function isHelpFlag(arg: string | undefined): boolean {
	return arg === "--help" || arg === "-h";
}

function shouldPrintGeneralHelp(args: string[]): boolean {
	return args.length === 0 || args[0] === "help" || isHelpFlag(args[0]);
}

function resolvePiHelpText(args: string[]): string | undefined {
	if (shouldPrintGeneralHelp(args)) {
		return PI_HELP_TEXT;
	}
	const subcommand = args[0];
	if (!subcommand || !isSupportedPiCommand(subcommand)) {
		return undefined;
	}
	if (args.slice(1).some((arg) => isHelpFlag(arg))) {
		return PI_SUBCOMMAND_HELP[subcommand];
	}
	return undefined;
}

function assertSupportedPiCommand(
	command: string | undefined
): SupportedPiCommand {
	if (!command) {
		throw new Error(
			`Missing pi subcommand. Supported subcommands: ${SUPPORTED_PI_COMMANDS.join(", ")}`
		);
	}
	if (!isSupportedPiCommand(command)) {
		throw new Error(`Unsupported pi subcommand: ${command}`);
	}
	return command;
}

function assertGlobalOnly(args: string[]): void {
	if (args.includes("-l")) {
		throw new Error("phi pi only supports global commands; remove -l.");
	}
}

async function runBundledPiMain(args: string[]): Promise<number> {
	const previousExitCode = process.exitCode;
	process.exitCode = 0;
	await runPiMain(args);
	const exitCode = process.exitCode ?? 0;
	process.exitCode = previousExitCode ?? 0;
	return exitCode;
}

const defaultRunPiCommandDependencies: RunPiCommandDependencies = {
	run: runBundledPiMain,
	write(text) {
		console.log(text);
	},
};

export function shouldRunPiCommandDirectly(args: string[]): boolean {
	return args[0] === "pi";
}

export async function runPiCommand(
	args: string[],
	userHomeDir: string = homedir(),
	dependencies: RunPiCommandDependencies = defaultRunPiCommandDependencies
): Promise<void> {
	const helpText = resolvePiHelpText(args);
	if (helpText) {
		dependencies.write(helpText);
		return;
	}

	const subcommand = assertSupportedPiCommand(args[0]);
	assertGlobalOnly(args);

	const agentDir = ensurePhiPiAgentDir(userHomeDir);
	const previousCwd = process.cwd();
	const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
	process.chdir(agentDir);
	process.env.PI_CODING_AGENT_DIR = agentDir;
	try {
		const exitCode = await dependencies.run(args);
		if (exitCode !== 0) {
			throw new Error(
				`pi ${subcommand} exited with code ${String(exitCode)}`
			);
		}
	} finally {
		process.chdir(previousCwd);
		if (previousAgentDir === undefined) {
			delete process.env.PI_CODING_AGENT_DIR;
		} else {
			process.env.PI_CODING_AGENT_DIR = previousAgentDir;
		}
	}
}
