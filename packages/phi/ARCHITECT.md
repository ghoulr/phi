# ARCHITECT: phi

phi is a chat runtime built on top of pi.

## Core model

- `agent`: execution config template
- `chat`: workspace-scoped long-lived context
- `session`: one conversation state inside a chat
- `routes`: runtime routing table between external inputs, sessions, and outbound deliveries

## Relations

- one `chat` owns one workspace
- one `chat` contains many `sessions`
- one `session` belongs to one `chat`
- one `session` uses one `agent`
- one `agent` can be reused by many `sessions`
- one inbound route targets one `session`

## Runtime

```text
Message endpoints  ──┐
Cron triggers      ──┼──► Routes ───► Session ───► Agent(pi)
Outbound delivery  ◄─┘
```

The runtime owns:
- `routes`
- one chat-scoped session manager per chat
- session lifecycle
- endpoint and cron bindings

## Chat

A chat is the workspace-scoped container for runtime state.

A service chat owns:
- workspace config
- sessions
- memory
- skills
- inbox
- cron config
- cron prompt files

## Session

A session is one conversation state inside a chat.
Different endpoints should usually use different sessions.
Cron also targets a session.

pi still runs on one session file at a time.
phi manages which session file to load.

## Agent

An agent is only execution config.
Typical fields are provider, model, and thinking level.

## Routes

Routes map:
- inbound endpoint route to session
- inbound cron trigger to session
- session to outbound delivery

Default reply flow is endpoint-chat-local.
A message normally replies through the same `endpointChatId` that entered the session.
Cron stores one explicit `endpointChatId` per job.

## Storage

```text
~/.phi/
├─ phi.yaml
├─ pi/
└─ auth/
```

```text
<workspace>/
└─ .phi/
   ├─ config.yaml
   ├─ sessions/
   │  ├─ index.json
   │  └─ <sessionId>.jsonl
   ├─ skills/
   ├─ memory/
   ├─ inbox/
   └─ cron/
      ├─ cron.yaml
      └─ jobs/
```

## Failure strategy

Fail fast.
Do not hide errors.
Send the error to the endpoint so the user knows.
