# Messaging

phi owns route adaptation and visible delivery.
pi owns prompt execution, queueing, and tool orchestration.

Per-turn runtime context is defined in [system-reminder.md](/home/zhourui/workspace/phi/docs/concepts/system-reminder.md) and is persisted as a synthetic part on the current user message.

## Message Kinds

| Kind | Delivery | Description |
|------|----------|-------------|
| **Final reply** | Agent run end | Default assistant reply |
| **Instant message** | Immediately | `send(instant: true)` — visible right away |
| **Deferred message** | Agent run end | `send(instant: false)` — committed with final reply |
| **Status message** | When relevant | Progress or error notices owned by phi |
| **Silent result** | Never | Explicit suppression via `NO_REPLY` |

## Control Tokens

### `NO_REPLY`

Suppress the final reply.
Use when:

- a tool already sent the full answer
- the turn only changed internal state
- background maintenance

### `HEARTBEAT_OK`

Explicit heartbeat acknowledgement.
Resolved in phi, not in route.

__Not used for now__

## Turn Resolution

Order:

1. Instant messages delivered immediately.
2. Deferred parts stored as turn draft.
3. Final reply inspected.
4. Delivery decided.

Rules:

- Normal text → deliver as final reply.
- `NO_REPLY` → suppress final reply.
- Deferred draft exists → commit when the active agent run ends.
- Tool sent full answer via `instant: true` → agent ends with `NO_REPLY`.

Never infer that two texts are probably the same message.
Keep it explicit.

## `send` Tool

Purpose: stage or deliver a user-visible message part.

Input:

- `text?`: message text
- `attachments?`: files to include in the message
- `instant?`: `true` or `false`, defaults to `false`
- `mentionSender?`: mention the current sender

Rules:

- `text` and `attachments` cannot both be empty.
- One turn can hold at most one deferred draft.
- A deferred draft only stores message parts, not control tokens.
- Invalid input is an error.
- Reply behavior is explicit agent output, not route policy.

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
- committed when the active agent run ends
- combined with the final reply when one exists
- if the final reply is `NO_REPLY`, the draft is delivered alone

## Pending Outbound Draft

Turn-scoped and chat-scoped.
Committed when the active agent run ends.
Discarded on failure.
Invalid state is an error.

## Session Bridge Boundary

See `docs/concepts/chat-session-bridge.md`.

## Cron and Background Runs

Same rules apply.
A cron run produces a normal result, an error notice, or a silent result (`NO_REPLY`).
Failures that affect user-visible behavior must notify the user.

## Route Responsibility

Routes handle text or media send, typing indicators, and platform rendering limits.
Routes do not decide whether a token means silence, whether a message should mention the sender, or whether a reply should exist.

## Boundary with pi

- pi runs the agent
- phi adapts routes and delivers visible output
- Control tokens, turn resolution, deferred drafts, cron publication — all phi-owned.
