# Messaging

phi owns all messaging decisions. Routes only deliver resolved messages.

Per-turn runtime context is defined in [system-reminder.md](/home/zhourui/workspace/phi/docs/concepts/system-reminder.md) and is persisted as a synthetic part on the current user message.

## Message Kinds

| Kind | Delivery | Description |
|------|----------|-------------|
| **Final reply** | Turn end | Default assistant reply |
| **Instant message** | Immediately | `send(instant: true)` — visible right away |
| **Deferred message** | Turn end | `send(instant: false)` — committed with final reply |
| **Status message** | When relevant | Progress/error notices (reload failure, cron, heartbeat) |
| **Silent result** | Never | Explicit suppression via `NO_REPLY` |

## Control Tokens

### `NO_REPLY`

Suppress the final reply. Use when:

- a tool already sent the full answer
- the turn only changed internal state
- background maintenance

### `HEARTBEAT_OK`

Explicit heartbeat acknowledgement. Resolved in phi, not in route.

__Not used for now__

## Turn Resolution

Order:

1. Instant messages delivered immediately
2. Deferred parts stored as turn draft
3. Final reply inspected
4. Delivery decided

Rules:

- Normal text → deliver as final reply
- `NO_REPLY` → suppress final reply
- Deferred draft exists → commit at turn end
- Tool sent full answer via `instant: true` → agent ends with `NO_REPLY`

Never infer that two texts are "probably the same message". Keep it explicit.

## `send` Tool

Purpose: stage or deliver a user-visible message part.

Input:

- `text?`: message text
- `attachments?`: files to include in the message
- `instant?`: `true` or `false`, defaults to `false`
- `mentionSender?`: mention the current sender

Rules:

- `text` and `attachments` cannot both be empty
- one turn can hold at most one deferred draft
- a deferred draft only stores message parts, not control tokens
- invalid input is an error
- reply behavior is explicit, not implicit

### `instant: true`

Sent immediately as a separate message.

Rules:

- visible to the user right away
- does not suppress the final reply
- use exact `NO_REPLY` if this message is the full answer

### `instant: false`

Stored as the pending outbound draft.

Rules:

- not delivered immediately
- committed at turn end
- combined with the final reply when one exists
- if the final reply is `NO_REPLY`, the draft is delivered alone

## Pending Outbound Draft

Turn-scoped, chat-scoped. Committed at turn end, discarded on failure. Invalid state is an error.

## Cron and Background Runs

Same rules apply. A cron run produces a normal result, an error notice, or a silent result (`NO_REPLY`). Failures that affect user-visible behavior must notify the user.

## Route Responsibility

Routes handle: text/media send, reply target, platform rendering limits.

Routes do NOT decide: whether a token means silence, whether heartbeat acks are hidden, whether cron output is announced.

## Boundary with pi

- pi runs the agent
- phi decides what the user sees

Control tokens, turn resolution, draft handling, cron publication, heartbeat suppression — all phi-owned.
