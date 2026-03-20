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
- inbound cron trigger to session
- session to outbound delivery

Routes do not own session history.
Routes do not interpret message meaning.

## Config

Static routing intent lives in `~/.phi/phi.yaml`.
Runtime Telegram bindings live in `~/.phi/routes/telegram.yaml`.

Current cutover:
- Telegram routes use `allowList`
- Feishu routes still use one fixed `id`
- `cron` stays static

## Telegram

`allowList` declares which normalized Telegram chat ids may enter a session.

Current rules:
- `chatId` is `String(chat.id)`
- `allowList` entries must use that normalized string form
- `*` is reserved for a later runtime-binding step

On startup, phi restores or creates a runtime `chatId -> sessionId` binding for each allowed Telegram chat.
Replies use the active inbound route for that session.

## Current model

Each matched source enters one session.
Thread/topic-specific forks are a later concern.
