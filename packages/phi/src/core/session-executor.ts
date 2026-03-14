import {
	InMemoryJobQueueProvider,
	type JobQueueProvider,
} from "@phi/core/job-queue";

export interface SessionExecutor {
	run<TResult>(
		sessionId: string,
		handler: () => Promise<TResult>
	): Promise<TResult>;
}

export class InMemorySessionExecutor implements SessionExecutor {
	private readonly queue;

	public constructor(
		queueProvider: JobQueueProvider = new InMemoryJobQueueProvider()
	) {
		this.queue = queueProvider.createQueue("session-executor");
	}

	public async run<TResult>(
		sessionId: string,
		handler: () => Promise<TResult>
	): Promise<TResult> {
		return await this.queue.enqueue(sessionId, handler);
	}
}
