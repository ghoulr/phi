import cac, { type CAC } from "cac";

export interface TuiDependencies {
	runTui(): Promise<void>;
	runService(): Promise<void>;
}

export function tui(dependencies: TuiDependencies): CAC {
	const app = cac("phi");

	app.command("tui", "Start phi in TUI mode").action(async () => {
		await dependencies.runTui();
	});

	app.command(
		"service",
		"Start channel service (currently Telegram polling)"
	).action(async () => {
		await dependencies.runService();
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
