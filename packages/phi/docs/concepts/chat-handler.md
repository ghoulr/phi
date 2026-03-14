# Chat Handler

The chat-bound orchestration point between routes and the agent.

```text
Message endpoints  ◄────►  Routes  ◄────►  Chat handlers  ◄────►  Agent(pi)
Internal triggers  ─────►
```

## What it is

A chat handler binds chat config, workspace state, and one agent-facing identity into one runtime unit.
It is the only module that talks to pi.

Interactive path: submit user turns with one outbound destination, steer when streaming, subscribe to events.
Reload path: invalidate handler state; the next submit recreates it.

Cron reaches the same chat through an internal trigger path.
