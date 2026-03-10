# Chat Session Bridge

A bridge owns one pi session per phi chat and translates route I/O without reimplementing pi's queueing.

## Responsibilities

- Own session lifecycle; recreate after `invalidate()`.
- Convert route messages → pi user messages with `system-reminder`.
- Submit via `session.sendUserMessage()`; use `deliverAs: "steer"` when streaming.
- Subscribe to session events and route visible output to the channel.
- Surface failures to the user.

## Non-responsibilities

- No pi slash commands or prompt templates for IM users.
- No reply/mention decisions — agent decides.
- No second queue or turn state outside pi.
- No delivery policy inference from transport metadata.

## Submit Flow

1. Ensure session exists.
2. Build content from route text, images, and `system-reminder`.
3. `sendUserMessage(content)` when idle; `sendUserMessage(content, { deliverAs: "steer" })` when streaming.

## Event Flow

- `message_update` / tool events → typing or progress signals.
- `turn_end` → update the latest assistant candidate for the active agent run.
- `agent_end` → resolve visible output once for the whole run.

## Reload

- `invalidate()` marks session stale; next `submit()` recreates it.

## Boundary

- pi: prompt execution, queueing, steering, tools.
- phi: session lifecycle, route adaptation, reminders, delivery.
