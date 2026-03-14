# Endpoint

An endpoint is a messaging transport that connects phi to an external platform such as Telegram or Feishu.

Keep endpoints thin.
Routing, session state, and agent execution belong elsewhere.

```text
Platform  ◄────►  Endpoint provider  ◄────►  Routes  ◄────►  Chat handlers  ◄────►  Agent(pi)
```

## Scope

This document is about **message endpoints**.

`EndpointProvider` is for transports that both receive and/or send messages.
It is not the abstraction for every runtime source.
For example, cron is a source runtime wired through Routes, not an `EndpointProvider`.

## Provider contract

An `EndpointProvider` owns only:
- connection lifecycle
- inbound parsing
- outbound formatting and delivery

```typescript
interface EndpointProvider {
  readonly id: string;         // endpoint type: "telegram" | "feishu" | ...
  readonly instanceId: string; // stable, non-sensitive, credential-scoped id

  start(): Promise<void>;
  stop(): Promise<void>;
  send(chatId: string, message: EndpointOutboundMessage): Promise<void>;
}
```

Providers use a factory pattern:

```typescript
const provider = FeishuProvider.create({
  appId,
  appSecret,
  callbacks,
  onMessage,
});

routes.registerInteractiveRoute(provider.instanceId, routeId, chatId);

await provider.start();
```

Create first, register routes, then start.
This avoids losing early inbound messages.

## Address model

```typescript
interface EndpointInboundContext {
  endpointId: string;
  instanceId: string;
  routeId: string;
  messageId: string;
  text?: string;
  attachments: EndpointAttachment[];
  metadata?: Record<string, unknown>;
  replyToMessageId?: string;
  sendTyping(): Promise<void>;
}
```

- `id` is the endpoint type.
- `instanceId` is the concrete provider instance. Routes bind against `instanceId`, not endpoint type.
- `routeId` is the platform address used for both inbound and outbound.
- `routeId` must be stable and directly sendable. Example: Telegram chat id, Feishu `chat_id`.
- interactive inbound turns should use one stable outbound destination derived from the source route.

```typescript
interface EndpointOutboundMessage {
  text?: string;
  attachments: PhiMessageAttachment[];
  replyToMessageId?: string;
}
```

## Config discovery

Endpoints are discovered from `chats.*.routes`.
There is no separate top-level `endpoints` section.

```yaml
chats:
  alice:
    workspace: ~/phi/workspaces/alice
    agent: main
    routes:
      telegram:
        id: 123456
        token: "xxx"

  bob:
    workspace: ~/phi/workspaces/bob
    agent: support
    routes:
      feishu:
        id: oc_xxx
        appId: cli_xxx
        appSecret: xxx
```

Service startup:
1. scan `chats.*.routes`
2. group routes by endpoint type and credentials
3. create one provider instance per group
4. register all routes with `provider.instanceId`
5. start providers

A provider owns a route table.
Chats declare routes, but do not create provider instances directly.

## Shared utilities

Shared helpers stay as plain functions in `services/endpoints/shared.ts`.
Examples:
- text chunking
- attachment persistence
- idempotency key creation
- outbound text sanitization

No provider framework.
Reuse helpers only when they stay generic.

## Adding an endpoint

1. add `services/endpoints/<name>-provider.ts`
2. implement `EndpointProvider` with `static create(options)`
3. add route config types in `core/config.ts`
4. add config collection and provider grouping in service startup
5. wire inbound/outbound through `ServiceRoutes`
6. add tests for config, startup grouping, and provider behavior
7. update example config and docs

No changes should be needed in `Routes` or `ChatHandler` for a normal messaging endpoint.
