# ARCHITECT: phi

phi is a chat runtime built on top of pi.
It connects endpoints and internal agent execution through config-driven routes.

## Principles

- Keep it simple.
- Fail fast.
- No backward compatibility.
- Reuse pi as much as possible.

## Core model

Use this shape:

```text
Endpoints  ◄────►  Routes  ◄────►  Chat handlers  ◄────►  Agent(pi)
```

`◄────►` bidirectional (request + response).
`─────►` one-way trigger (e.g. cron emits, never receives).

- **Endpoints** — external surfaces (Telegram, cron, terminal)
- **Routes** — config-driven wiring between endpoints and chat handlers
- **Chat handlers** — chat-bound runtime that talks to pi
- **Agent(pi)** — prompt execution, queueing, steering, tools

## Chat model

A chat is not a transport name.
There is no separate kind of "cron chat" or "telegram chat".

A chat is the config-bound composition of endpoints, routes, and chat handlers around the same agent-facing identity.

| Dimension | Service chat | TUI chat |
|-----------|-------------|----------|
| endpoint side | configured endpoints | terminal |
| state root | `<workspace>/.phi` | `~/.phi/pi` |
| working context | configured workspace | current `cwd` |
| behavior | phi-owned | phi-owned |

### Service chat config

```yaml
chats:
  alice:
    workspace: ~/phi/workspaces/alice
    agent: main
```

This lives in `~/.phi/phi.yaml` and is **operator-owned**.
Agents do not modify it.

Chat-local settings such as timezone live in the workspace config.

### Workspace config

Each workspace has its own agent-owned config:

- `<workspace>/.phi/config.yaml` — active config
- `<workspace>/.phi/config.template.yaml` — reference template with all options

The agent edits these with normal file tools and calls `reload` to apply.

## Routes

Routes are config-driven wiring between endpoints and chat handlers.
They dispatch messages and triggers to the module configured on the other side.
They do not interpret what a message means.

## Storage

### Global

```text
~/.phi/
├─ phi.yaml              # operator config
├─ pi/
│  ├─ settings.json      # global pi packages/extensions config
│  ├─ models.json
│  ├─ npm/
│  ├─ git/
│  ├─ sessions/
│  ├─ memory/
│  │  ├─ MEMORY.md
│  │  └─ YYYY-MM-DD.md
│  └─ skills/
└─ auth/
   └─ auth.json
```

### Service chat workspace

```text
<workspace>/
└─ .phi/
   ├─ config.yaml            # agent-owned config
   ├─ config.template.yaml   # reference template
   ├─ sessions/
   ├─ skills/
   ├─ memory/
   │  ├─ MEMORY.md
   │  └─ YYYY-MM-DD.md
   ├─ inbox/
   └─ cron/
      └─ jobs/
```

`config.yaml` stores workspace config, including chat-local settings and cron metadata.

`phi pi install|remove|update|list` proxies directly into the global pi workspace at `~/.phi/pi`.

## Memory

- `MEMORY.md` — small durable memory, injected into system prompt.
- `YYYY-MM-DD.md` — daily notes, not auto-injected.

Before session switch and compaction, phi runs an invisible maintenance turn to update memory files.

## Extensions

- `src/core/` — runtime infrastructure
- `src/extensions/memory-maintenance/` — memory maintenance extension
- `src/extensions/messaging/` — messaging extension
- `src/services/` — endpoints, routes, and chat handlers

## Cron

Cron is a source-only endpoint.

```text
Cron endpoint  ─────►  Routes  ◄────►  Chat handlers  ◄────►  Agent(pi)
Endpoints      ◄────►  Routes  ◄────►  Chat handlers  ◄────►  Agent(pi)
```

Cron emits triggers for chats through routes.

## Reload

`reload` is a chat-scoped tool with no parameters.
It invalidates the current chat handler state; the next interactive submit recreates it.

## Failure strategy

Fail fast. Do not hide errors. Notify the user when failures affect visible behavior.
