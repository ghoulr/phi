import cac, { type CAC } from "cac";

export interface ServiceCommandOptions {
	printSystemPrompt?: boolean;
}

export interface TuiDependencies {
	runTui(): Promise<void>;
	runService(options: ServiceCommandOptions): Promise<void>;
}

export function tui(dependencies: TuiDependencies): CAC {
	const app = cac("phi");

	app.command("tui", "Start phi in TUI mode").action(async () => {
		await dependencies.runTui();
	});

	app.command("service", "Start channel service (currently Telegram polling)")
		.option(
			"--print-system-prompt",
			"Print injected system prompt for service chat sessions"
		)
		.action(async (options: ServiceCommandOptions) => {
			await dependencies.runService(options);
		});

	app.command("[...args]", "Run default command").action(
		async (args: string[]) => {
			if (args.length === 0) {
				await dependencies.runTui();
				return;
			}
			throw new Error(`Unknown command: ${args[0]}`);
		}
	);

	app.help();

	return app;
}
