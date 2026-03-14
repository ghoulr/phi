# Session

A session is one conversation state inside a chat.
It is the runtime unit.

```text
Message endpoints  ──┐
Cron triggers      ──┼──► Routes ───► Session ───► Agent(pi)
Outbound delivery  ◄─┘
```

## Relation

A chat can contain multiple sessions.
Different endpoints should usually use different sessions.
Cron also targets a session inside the same chat.

A session uses one agent config.
The same agent config can be reused by many sessions.

## Runtime

The runtime resolves a route to one session, then runs that session.
The live pi-backed implementation can be `PiSessionRuntime`.

## Scope

One session runtime works with:
- one chat workspace
- one session history
- one agent config
