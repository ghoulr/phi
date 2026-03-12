export type JobHandler<TResult> = () => Promise<TResult>;

export interface JobQueue {
	enqueue<TResult>(
		key: string,
		handler: JobHandler<TResult>
	): Promise<TResult>;
}

export interface JobQueueProvider {
	createQueue(name: string): JobQueue;
}

export class InMemoryJobQueue implements JobQueue {
	private readonly tails = new Map<string, Promise<void>>();

	public async enqueue<TResult>(
		key: string,
		handler: JobHandler<TResult>
	): Promise<TResult> {
		if (key.length === 0) {
			throw new Error("Queue key must not be empty.");
		}

		const previousTail = this.tails.get(key) ?? Promise.resolve();
		const run = previousTail.then(
			async () => await handler(),
			async () => await handler()
		);
		const nextTail = run.then(
			() => undefined,
			() => undefined
		);

		this.tails.set(key, nextTail);
		nextTail.finally(() => {
			if (this.tails.get(key) === nextTail) {
				this.tails.delete(key);
			}
		});

		return await run;
	}
}

export class InMemoryJobQueueProvider implements JobQueueProvider {
	public createQueue(_name: string): JobQueue {
		return new InMemoryJobQueue();
	}
}
