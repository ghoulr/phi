import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";

import { afterEach, describe, expect, it } from "bun:test";

import type { PhiMessage } from "@phi/messaging/types";
import type { Session } from "@phi/services/session";
import { ServiceRoutes, type InteractiveInput } from "@phi/services/routes";
import {
	startFeishuEndpoint,
	type FeishuRouteTarget,
} from "@phi/services/feishu";
import type {
	FeishuClientFactory,
	FeishuClientLike,
	FeishuEventDispatcherFactory,
	FeishuEventDispatcherLike,
	FeishuMessageEvent,
	FeishuWsClientFactory,
	FeishuWsClientLike,
} from "@phi/services/endpoints";

class FakeFeishuClient implements FeishuClientLike {
	public readonly sentMessages: Array<Record<string, unknown>> = [];
	public readonly repliedMessages: Array<Record<string, unknown>> = [];
	public readonly uploadedImages: Array<Record<string, unknown>> = [];
	public readonly uploadedFiles: Array<Record<string, unknown>> = [];
	public readonly resources = new Map<
		string,
		{
			data: Uint8Array;
			headers?: Record<string, string>;
		}
	>();

	public readonly im = {
		v1: {
			message: {
				create: async (payload?: Record<string, unknown>) => {
					this.sentMessages.push(payload ?? {});
					return { data: { message_id: "created-message" } };
				},
				reply: async (payload?: Record<string, unknown>) => {
					this.repliedMessages.push(payload ?? {});
					return { data: { message_id: "reply-message" } };
				},
			},
			image: {
				create: async (payload?: Record<string, unknown>) => {
					this.uploadedImages.push(payload ?? {});
					return {
						image_key: `img_${String(this.uploadedImages.length)}`,
					};
				},
			},
			file: {
				create: async (payload?: Record<string, unknown>) => {
					this.uploadedFiles.push(payload ?? {});
					return {
						file_key: `file_${String(this.uploadedFiles.length)}`,
					};
				},
			},
			messageResource: {
				get: async (payload?: Record<string, unknown>) => {
					const path = payload?.path;
					if (
						typeof path !== "object" ||
						path === null ||
						!("message_id" in path) ||
						!("file_key" in path)
					) {
						throw new Error("Invalid message resource payload.");
					}
					const resourceKey = `${String(path.message_id)}:${String(path.file_key)}`;
					const resource = this.resources.get(resourceKey);
					if (!resource) {
						throw new Error(`Missing fake resource ${resourceKey}`);
					}
					return {
						getReadableStream: () => Readable.from([resource.data]),
						headers: resource.headers ?? {},
					};
				},
			},
		},
	};

	public addResource(params: {
		messageId: string;
		fileKey: string;
		data: Uint8Array;
		headers?: Record<string, string>;
	}): void {
		this.resources.set(`${params.messageId}:${params.fileKey}`, {
			data: params.data,
			headers: params.headers,
		});
	}
}

class FakeFeishuEventDispatcher implements FeishuEventDispatcherLike {
	private messageHandler?: (event: FeishuMessageEvent) => Promise<unknown>;

	register(
		handles: Record<string, (event: FeishuMessageEvent) => Promise<unknown>>
	): this {
		const messageHandler = handles["im.message.receive_v1"];
		if (!messageHandler) {
			throw new Error("Missing Feishu message handler.");
		}
		this.messageHandler = messageHandler;
		return this;
	}

	async dispatch(event: FeishuMessageEvent): Promise<void> {
		if (!this.messageHandler) {
			throw new Error("Feishu message handler was not registered.");
		}
		await this.messageHandler(event);
	}
}

class FakeFeishuWsClient implements FeishuWsClientLike {
	public startCalls = 0;
	public closeCalls = 0;

	private dispatcher?: FakeFeishuEventDispatcher;
	private logger?: {
		info(...msg: unknown[]): void | Promise<void>;
		error(...msg: unknown[]): void | Promise<void>;
	};

	public constructor(
		private readonly events: FeishuMessageEvent[],
		private readonly options: {
			fatalMessage?: string;
		} = {}
	) {}

	setLogger(
		logger:
			| {
					info(...msg: unknown[]): void | Promise<void>;
					error(...msg: unknown[]): void | Promise<void>;
			  }
			| undefined
	): void {
		this.logger = logger;
	}

	async start(params: {
		eventDispatcher: FeishuEventDispatcherLike;
	}): Promise<void> {
		this.startCalls += 1;
		this.dispatcher = params.eventDispatcher as FakeFeishuEventDispatcher;
		await this.logger?.info("[ws]", "ws client ready");
		for (const event of this.events) {
			await this.dispatcher.dispatch(event);
		}
		if (this.options.fatalMessage) {
			await this.logger?.error("[ws]", this.options.fatalMessage);
		}
	}

	close(): void {
		this.closeCalls += 1;
	}
}

const createdWorkspaces: string[] = [];

function createRouteTarget(params: {
	sessionId: string;
	chatId: string;
}): FeishuRouteTarget {
	const workspace = mkdtempSync(join(tmpdir(), "phi-feishu-workspace-"));
	createdWorkspaces.push(workspace);
	return { sessionId: params.sessionId, chatId: params.chatId, workspace };
}

function createSession(overrides: Partial<Session> = {}): Session {
	return {
		async submitInteractive(): Promise<void> {},
		async submitCron(): Promise<PhiMessage[]> {
			return [];
		},
		async validateReload(): Promise<string[]> {
			return [];
		},
		invalidate(): void {},
		dispose(): void {},
		...overrides,
	};
}

function createClientFactory(client: FakeFeishuClient): FeishuClientFactory {
	return () => client as unknown as FeishuClientLike;
}

function createDispatcherFactory(
	dispatcher: FakeFeishuEventDispatcher
): FeishuEventDispatcherFactory {
	return () => dispatcher as FeishuEventDispatcherLike;
}

function createWsClientFactory(
	wsClient: FakeFeishuWsClient
): FeishuWsClientFactory {
	return (config) => {
		wsClient.setLogger(config.logger as never);
		return wsClient as FeishuWsClientLike;
	};
}

function createMessageEvent(
	overrides?: Partial<FeishuMessageEvent>
): FeishuMessageEvent {
	return {
		event_id: "event-1",
		tenant_key: "tenant-1",
		sender: {
			sender_type: "user",
			sender_id: {
				open_id: "ou_user_1",
			},
		},
		message: {
			message_id: "om_1",
			create_time: "1",
			chat_id: "oc_1",
			chat_type: "group",
			message_type: "text",
			content: JSON.stringify({ text: "hello" }),
			...overrides?.message,
		},
		...overrides,
	};
}

afterEach(() => {
	for (const workspace of createdWorkspaces) {
		rmSync(workspace, { recursive: true, force: true });
	}
	createdWorkspaces.length = 0;
});

describe("startFeishuEndpoint", () => {
	it("routes feishu text messages to the configured session", async () => {
		const client = new FakeFeishuClient();
		const dispatcher = new FakeFeishuEventDispatcher();
		const wsClient = new FakeFeishuWsClient([createMessageEvent()]);
		const routes = new ServiceRoutes();
		const submissions: InteractiveInput[] = [];
		routes.registerSession(
			"alice-feishu",
			createSession({
				async submitInteractive(input): Promise<void> {
					submissions.push(input);
				},
			})
		);

		const endpoint = await startFeishuEndpoint(
			routes,
			{
				appId: "cli_app_1",
				appSecret: "secret-1",
				chatRoutes: {
					oc_1: createRouteTarget({
						sessionId: "alice-feishu",
						chatId: "alice",
					}),
				},
			},
			{
				clientFactory: createClientFactory(client),
				eventDispatcherFactory: createDispatcherFactory(dispatcher),
				wsClientFactory: createWsClientFactory(wsClient),
			}
		);
		await endpoint.stop();
		await endpoint.done;

		expect(submissions).toHaveLength(1);
		expect(submissions[0]?.text).toBe("hello");
	});

	it("downloads inbound image and file attachments", async () => {
		const client = new FakeFeishuClient();
		client.addResource({
			messageId: "om_image",
			fileKey: "img_1",
			data: new Uint8Array([1, 2, 3]),
			headers: {
				"content-type": "image/png",
				"content-disposition": 'attachment; filename="pic.png"',
			},
		});
		client.addResource({
			messageId: "om_file",
			fileKey: "file_1",
			data: new Uint8Array([4, 5, 6]),
			headers: {
				"content-type": "application/pdf",
				"content-disposition": 'attachment; filename="report.pdf"',
			},
		});
		const dispatcher = new FakeFeishuEventDispatcher();
		const wsClient = new FakeFeishuWsClient([
			createMessageEvent({
				event_id: "event-image",
				message: {
					message_id: "om_image",
					create_time: "2",
					chat_id: "oc_1",
					chat_type: "group",
					message_type: "image",
					content: JSON.stringify({ image_key: "img_1" }),
				},
			}),
			createMessageEvent({
				event_id: "event-file",
				message: {
					message_id: "om_file",
					create_time: "3",
					chat_id: "oc_1",
					chat_type: "group",
					message_type: "file",
					content: JSON.stringify({
						file_key: "file_1",
						file_name: "report.pdf",
					}),
				},
			}),
		]);
		const routes = new ServiceRoutes();
		const submissions: InteractiveInput[] = [];
		routes.registerSession(
			"alice-feishu",
			createSession({
				async submitInteractive(input): Promise<void> {
					submissions.push(input);
				},
			})
		);
		const target = createRouteTarget({
			sessionId: "alice-feishu",
			chatId: "alice",
		});

		const endpoint = await startFeishuEndpoint(
			routes,
			{
				appId: "cli_app_1",
				appSecret: "secret-1",
				chatRoutes: {
					oc_1: target,
				},
			},
			{
				clientFactory: createClientFactory(client),
				eventDispatcherFactory: createDispatcherFactory(dispatcher),
				wsClientFactory: createWsClientFactory(wsClient),
			}
		);
		await endpoint.stop();

		expect(submissions).toHaveLength(2);
		expect(submissions[0]?.attachments).toHaveLength(1);
		expect(submissions[1]?.attachments).toHaveLength(1);
		expect(submissions[0]?.attachments[0]?.name).toBe("pic.png");
		expect(submissions[1]?.attachments[0]?.name).toBe("report.pdf");
		expect(existsSync(submissions[0]?.attachments[0]?.path ?? "")).toBe(
			true
		);
		expect(existsSync(submissions[1]?.attachments[0]?.path ?? "")).toBe(
			true
		);
	});

	it("sends text, image, and file outbound messages", async () => {
		const client = new FakeFeishuClient();
		const dispatcher = new FakeFeishuEventDispatcher();
		const wsClient = new FakeFeishuWsClient([]);
		const routes = new ServiceRoutes();
		const uploadDirectory = mkdtempSync(
			join(tmpdir(), "phi-feishu-upload-")
		);
		createdWorkspaces.push(uploadDirectory);
		const imagePath = join(uploadDirectory, "photo.png");
		const filePath = join(uploadDirectory, "notes.pdf");
		writeFileSync(imagePath, new Uint8Array([1, 2, 3]));
		writeFileSync(filePath, new Uint8Array([4, 5, 6]));

		const endpoint = await startFeishuEndpoint(
			routes,
			{
				appId: "cli_app_1",
				appSecret: "secret-1",
				chatRoutes: {
					oc_1: createRouteTarget({
						sessionId: "alice-feishu",
						chatId: "alice",
					}),
				},
			},
			{
				clientFactory: createClientFactory(client),
				eventDispatcherFactory: createDispatcherFactory(dispatcher),
				wsClientFactory: createWsClientFactory(wsClient),
			}
		);
		await routes.deliverOutbound("alice-feishu", {
			text: "done",
			attachments: [
				{ path: imagePath, name: "photo.png" },
				{ path: filePath, name: "notes.pdf" },
			],
		});
		await endpoint.stop();

		expect(client.uploadedImages).toHaveLength(1);
		expect(client.uploadedFiles).toHaveLength(1);
		expect(client.sentMessages).toEqual([
			{
				params: {
					receive_id_type: "chat_id",
				},
				data: {
					receive_id: "oc_1",
					content: JSON.stringify({ text: "done" }),
					msg_type: "text",
					uuid: expect.any(String),
				},
			},
			{
				params: {
					receive_id_type: "chat_id",
				},
				data: {
					receive_id: "oc_1",
					content: JSON.stringify({ image_key: "img_1" }),
					msg_type: "image",
					uuid: expect.any(String),
				},
			},
			{
				params: {
					receive_id_type: "chat_id",
				},
				data: {
					receive_id: "oc_1",
					content: JSON.stringify({ file_key: "file_1" }),
					msg_type: "file",
					uuid: expect.any(String),
				},
			},
		]);
	});

	it("rejects done when websocket reconnect exhausts", async () => {
		const client = new FakeFeishuClient();
		const dispatcher = new FakeFeishuEventDispatcher();
		const wsClient = new FakeFeishuWsClient([], {
			fatalMessage:
				"unable to connect to the server after trying 3 times",
		});
		const routes = new ServiceRoutes();

		const endpoint = await startFeishuEndpoint(
			routes,
			{
				appId: "cli_app_1",
				appSecret: "secret-1",
				chatRoutes: {
					oc_1: createRouteTarget({
						sessionId: "alice-feishu",
						chatId: "alice",
					}),
				},
			},
			{
				clientFactory: createClientFactory(client),
				eventDispatcherFactory: createDispatcherFactory(dispatcher),
				wsClientFactory: createWsClientFactory(wsClient),
			}
		);

		await expect(endpoint.done).rejects.toThrow(
			"Feishu websocket failed: [ws] unable to connect to the server after trying 3 times"
		);
		await expect(
			routes.deliverOutbound("alice-feishu", {
				text: "done",
				attachments: [],
			})
		).rejects.toThrow(
			"No outbound route configured for session alice-feishu"
		);
	});

	it("unregisters routes when stopped", async () => {
		const client = new FakeFeishuClient();
		const dispatcher = new FakeFeishuEventDispatcher();
		const wsClient = new FakeFeishuWsClient([]);
		const routes = new ServiceRoutes();

		const endpoint = await startFeishuEndpoint(
			routes,
			{
				appId: "cli_app_1",
				appSecret: "secret-1",
				chatRoutes: {
					oc_1: createRouteTarget({
						sessionId: "alice-feishu",
						chatId: "alice",
					}),
				},
			},
			{
				clientFactory: createClientFactory(client),
				eventDispatcherFactory: createDispatcherFactory(dispatcher),
				wsClientFactory: createWsClientFactory(wsClient),
			}
		);
		await endpoint.stop();

		await expect(
			routes.deliverOutbound("alice-feishu", {
				text: "done",
				attachments: [],
			})
		).rejects.toThrow(
			"No outbound route configured for session alice-feishu"
		);
	});
});
