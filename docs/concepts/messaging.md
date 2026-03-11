# Messaging

phi owns route adaptation and visible delivery.
pi owns agent execution and tool orchestration.

Per-turn runtime context is defined in [system-reminder.md](/home/zhourui/workspace/phi/docs/concepts/system-reminder.md).

## Boundary

Messaging stays a self-contained phi extension.

- Load it only through the standard pi extension entrypoint.
- Messaging-only semantics must live inside the extension.
- Route code outside the extension must not interpret `NO_REPLY`, deferred drafts, or sender mentions.
- Route code outside the extension may only provide visible delivery.

## Message Kinds

| Kind | Delivery | Description |
| --- | --- | --- |
| Final reply | Agent run end | Default assistant reply |
| Instant message | Immediately | `send(instant: true)` |
| Deferred message | Agent run end | `send()` or `send(instant: false)` |
| Silent result | Never | Exact `NO_REPLY` |

## `send`

`send` is owned by the messaging extension.

Input:

- `text?`
- `attachments?`
- `instant?`
- `mentionSender?`

Rules:

- `text` and `attachments` cannot both be empty
- `instant: true` delivers immediately
- `instant: false` stages one deferred message for the active agent run
- `mentionSender` resolves from the current turn's `system-reminder`
- invalid input is an error

## `NO_REPLY`

`NO_REPLY` is messaging-only semantics.
It suppresses the final assistant text for the active messaging run.

Typical use:

- `send(instant: true)` already delivered the full visible answer
- a deferred message should be the only visible output

## Route Boundary

Routes may send plain text/media and apply platform rendering limits.
Routes must not own messaging-specific protocol.
