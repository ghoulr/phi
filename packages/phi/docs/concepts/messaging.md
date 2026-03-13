# Messaging

phi owns chat handling and route wiring.
pi owns agent execution and tool orchestration.

Per-turn runtime context is defined in [system-reminder.md](/home/zhourui/workspace/phi/docs/concepts/system-reminder.md).

Messaging is a self-contained phi extension, loaded through the standard pi extension entrypoint.

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
- exact `NO_REPLY` is invalid input for `send`
- `instant: true` delivers immediately
- `instant: false` stages one deferred message for the active agent run
- `mentionSender` resolves from the current turn's `system-reminder`
- invalid input is an error

## `NO_REPLY`

`NO_REPLY` is messaging-only semantics.
It suppresses the final assistant text for the active messaging run.
It is only valid as the exact final assistant reply, not as `send.text`.

Messaging semantics (`NO_REPLY`, deferred drafts, sender mentions) live exclusively inside the extension.
