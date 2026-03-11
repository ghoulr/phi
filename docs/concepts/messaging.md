# Messaging

phi owns route adaptation and visible delivery.
pi owns agent execution and tool orchestration.

Per-turn runtime context is defined in [system-reminder.md](/home/zhourui/workspace/phi/docs/concepts/system-reminder.md).

## Boundary

Messaging must stay an optional phi extension.

- Load it only through the standard pi extension entrypoint.
- If it is not loaded, phi still runs normal turns and publishes plain assistant text.
- Messaging-only semantics must live inside the extension.
- Route code outside the extension must not interpret `NO_REPLY`, deferred drafts, or sender mentions.

## Message Kinds

| Kind | Delivery | Description |
| --- | --- | --- |
| Final reply | Agent run end | Default assistant reply |
| Instant message | Immediately | `send(instant: true)` |
| Deferred message | Agent run end | `send()` or `send(instant: false)` |
| Silent result | Never | Exact `NO_REPLY` |

## `send`

`send` is owned by the messaging extension.
If messaging is disabled, this tool does not exist.

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
It suppresses the final assistant text when the messaging extension is active.

Typical use:

- `send(instant: true)` already delivered the full visible answer
- a deferred message should be the only visible output

If messaging is disabled, `NO_REPLY` has no special meaning.

## Route Boundary

Routes may send plain text/media and apply platform rendering limits.
Routes must not own messaging-specific protocol.

## Disable Semantics

If messaging is disabled:

- normal assistant replies still work
- routes still publish plain text/media output
- `send` is unavailable
- `NO_REPLY` is treated as plain assistant text
- deferred draft semantics do not exist
- sender-mention behavior does not exist
