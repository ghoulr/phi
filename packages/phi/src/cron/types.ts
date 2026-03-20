export interface CronJobDefinition {
	id: string;
	enabled?: boolean;
	sessionId: string;
	endpointChatId: string;
	prompt: string;
	cron?: string;
	at?: string;
}

export interface LoadedCronJob {
	id: string;
	enabled: boolean;
	sessionId: string;
	endpointChatId: string;
	prompt: string;
	promptFilePath: string;
	promptText: string;
	cron?: string;
	at?: string;
	nextRunAtMs?: number;
}

export interface CronRunLogEntry {
	chatId: string;
	jobId: string;
	status: "ok" | "error";
	text?: string;
	error?: string;
	startedAt: string;
	finishedAt: string;
}

export interface CronReloadResult {
	jobCount: number;
	nextRunAtMs: number | undefined;
}
