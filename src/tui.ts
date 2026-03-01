import cac, { type CAC } from "cac";

export interface TuiChatRouteOptions {
	channel: string;
	chatId: string;
}

export interface TuiDependencies {
	runTui(route?: TuiChatRouteOptions): Promise<void>;
	runService(): Promise<void>;
}

interface TuiCommandOptions {
	chat?: string | number;
	channel?: string;
}

function resolveTuiRouteOptions(
	options: TuiCommandOptions
): TuiChatRouteOptions | undefined {
	const channel = options.channel;
	const chatId =
		options.chat === undefined ? undefined : String(options.chat);

	if (channel === undefined && chatId === undefined) {
		return undefined;
	}

	if (channel === undefined) {
		throw new Error(
			"TUI chat override requires --channel when --chat is provided."
		);
	}
	if (channel.length === 0) {
		throw new Error(
			"TUI chat override requires a non-empty --channel value."
		);
	}
	if (chatId === undefined) {
		throw new Error(
			"TUI chat override requires --chat when --channel is provided."
		);
	}
	if (chatId.length === 0) {
		throw new Error("TUI chat override requires a non-empty --chat value.");
	}

	return {
		channel,
		chatId,
	};
}

export function tui(dependencies: TuiDependencies): CAC {
	const app = cac("phi");

	app.command("tui", "Start phi in TUI mode")
		.option("--channel <channel>", "Channel for TUI chat override")
		.option("--chat <chatId>", "Chat id for TUI chat override")
		.action(async (options: TuiCommandOptions) => {
			await dependencies.runTui(resolveTuiRouteOptions(options));
		});

	app.command(
		"service",
		"Start channel service (currently Telegram polling)"
	).action(async () => {
		await dependencies.runService();
	});

	app.command("[...args]", "Run default command")
		.option("--channel <channel>", "Channel for TUI chat override")
		.option("--chat <chatId>", "Chat id for TUI chat override")
		.action(async (args: string[], options: TuiCommandOptions) => {
			if (args.length === 0) {
				await dependencies.runTui(resolveTuiRouteOptions(options));
				return;
			}
			throw new Error(`Unknown command: ${args[0]}`);
		});

	app.help();

	return app;
}
