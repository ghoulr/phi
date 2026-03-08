import {
	InMemoryJobQueueProvider,
	type JobQueueProvider,
} from "@phi/core/job-queue";

export interface ChatExecutor {
	run<TResult>(
		chatId: string,
		handler: () => Promise<TResult>
	): Promise<TResult>;
}

export class InMemoryChatExecutor implements ChatExecutor {
	private readonly queue;

	public constructor(
		queueProvider: JobQueueProvider = new InMemoryJobQueueProvider()
	) {
		this.queue = queueProvider.createQueue("chat-executor");
	}

	public async run<TResult>(
		chatId: string,
		handler: () => Promise<TResult>
	): Promise<TResult> {
		return await this.queue.enqueue(chatId, handler);
	}
}
