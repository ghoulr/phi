# Chat Handler

The chat-bound orchestration point between routes and the agent.

```text
Endpoints  ◄────►  Routes  ◄────►  Chat handlers  ◄────►  Agent(pi)
```

## What it is

A chat handler binds chat config, workspace state, and agent-facing identity into one runtime unit.
It is the only module that talks to pi.

Interactive path: submit user turns, steer when streaming, subscribe to events, resolve output.
Reload path: invalidate handler state; the next submit recreates it.

`ChatSessionBridge` is one implementation detail inside the interactive path.
Cron targets the same chat identity through a different endpoint path.
