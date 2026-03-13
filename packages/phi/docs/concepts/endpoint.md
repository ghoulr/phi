# Endpoint

An endpoint is a messaging surface that connects phi to an external platform (Telegram, Feishu, Discord, etc).

Endpoints plug into the existing route model:

phi intentionally keeps endpoints thin.
Complexity belongs in the agent, not the transport.

```text
Endpoint Provider  ◄────►  Routes  ◄────►  Chat handlers  ◄────►  Agent(pi)
```

## What it is

An `EndpointProvider` is a self-contained adapter that owns:
- Connection lifecycle (polling, websocket, webhook)
- Inbound message parsing (platform format → unified context)
- Outbound message delivery (unified message → platform API)

It does not own routing, session management, or agent execution.
Those belong to Routes and Chat handlers.

## Interface

```typescript
interface EndpointProvider {
  readonly id: string;        // "telegram" | "feishu" | ...
  readonly instanceId: string; // stable, non-sensitive identifier

  start(): Promise<void>;
  stop(): Promise<void>;
  send(chatId: string, message: EndpointOutboundMessage): Promise<void>;
}
```

Providers use a factory pattern with lifecycle separation:

```typescript
// 1. Create (synchronous, does not connect)
const provider = TelegramProvider.create({
  token,
  callbacks,
  onMessage,
});

// 2. Register routes using provider.instanceId
routes.registerInteractiveRoute(provider.instanceId, routeId, chatId);

// 3. Start connection
await provider.start();
```

This separation allows routes to be registered before messages arrive,
avoiding race conditions where early messages are lost.

### Inbound context

```typescript
interface EndpointInboundContext {
  endpointId: string;          // provider id ("telegram")
  instanceId: string;          // stable instance identifier
  routeId: string;             // platform-specific chat/user id
  messageId: string;           // platform message id
  text?: string;
  attachments: EndpointAttachment[];
  metadata?: Record<string, unknown>;
  replyToMessageId?: string;
  sendTyping(): Promise<void>;
}
```

### Outbound message

```typescript
interface EndpointOutboundMessage {
  text?: string;
  attachments: PhiMessageAttachment[];
  replyToMessageId?: string;
}
```

## Architecture

```text
┌─────────────────────────────────────────────────────┐
│                    ServiceRoutes                    │
│  registerInteractiveRoute / registerOutboundRoute   │
└───────────┬────────────────────────────┬────────────┘
            │                            │
   ┌────────▼────────┐          ┌────────▼────────┐
   │TelegramProvider │          │ FeishuProvider  │
   │  (grammy)       │          │  (lark SDK)     │
   └─────────────────┘          └─────────────────┘
```

- `ServiceRoutes` stays endpoint-agnostic
- Each provider owns its SDK, connection, and message translation
- `ChatHandler` / `PiChatHandler` are unchanged

## Shared utilities

Providers share common patterns but not a framework:

| Utility | Purpose |
|---------|---------|
| `chunkAndSend(text, limit, send)` | Split long messages |
| `saveInboundAttachment(data, meta)` | Persist media to inbox |
| `createIdempotencyKey(endpoint, ...parts)` | Dedup keys |
| `sanitizeOutboundText(text)` | Clean markdown/HTML |

These live in `services/endpoints/shared.ts` as plain functions.
Providers import what they need.

## Config discovery

Providers are **not** configured in a separate `endpoints` section.
They are discovered from the existing chat config:

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
    agent: claude
    routes:
      telegram:
        id: 789012
        token: "xxx"  # same bot, different chat
```

The service startup:
1. Scans `chats.*.routes` to find which endpoints are in use
2. Groups routes by endpoint type and credential
3. Creates one provider instance per unique credential set
4. Wires provider inbound to routes, routes outbound to provider

This keeps chat as the first-class concept. Endpoints are just how chats connect.

## Adding a new endpoint

1. Create `services/endpoints/<name>-provider.ts`
2. Implement `EndpointProvider` with `static create(options)` factory
3. Add route config type to `core/config.ts`
4. Register provider creation in `commands/service.ts`

No changes to Routes, ChatHandler, or existing providers.
