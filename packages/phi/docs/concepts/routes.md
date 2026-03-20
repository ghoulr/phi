# Routes

Routes belong to the service runtime.
They bind external sources, sessions, and outbound deliveries.

```text
Message endpoints  ──┐
Cron triggers      ──┼──► Routes ───► Session
Outbound delivery  ◄─┘
```

## Scope

Routes map:
- inbound source to session
- session to outbound delivery
- session to endpoint chat binding

Routes do not own session history.
Routes do not interpret message meaning.

## Config

Static routing intent lives in `~/.phi/phi.yaml`.
Runtime Telegram bindings live in `~/.phi/routes/telegram.yaml`.

Current cutover:
- Telegram routes use `allowList`
- Feishu routes still use one fixed `id`

## Runtime keys

Persistent ids:
- `sessionId`
- `endpointChatId`

Runtime-only ids:
- `endpointId`

`endpointChatId` is the endpoint-scoped peer id used for reply delivery.
For Telegram it is `String(chat.id)`.
For Feishu it is the chat id.

## Telegram

`allowList` declares which normalized Telegram chat ids may enter a session.

Current rules:
- `chatId` is `String(chat.id)`
- `allowList` entries must use that normalized string form
- `*` is reserved for a later runtime-binding step

On startup, phi restores or creates a runtime `chatId -> sessionId` binding for each allowed Telegram chat.
Replies use the active inbound `endpointChatId` for that session.

## Current model

Each matched source enters one session.
Thread/topic-specific forks are a later concern.
