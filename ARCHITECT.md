# ARCHITECT: phi

phi is a chat runtime built on top of pi.
It routes messages from external services into chat-scoped pi sessions.

## Principles

- Keep it simple.
- Fail fast.
- No backward compatibility.
- Reuse pi as possible.

## Chat model

A chat has four dimensions:

| Dimension | Service chat | TUI chat |
|-----------|-------------|----------|
| route | external (e.g. Telegram) | terminal |
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

## Runtime shape

```text
Service → Runtime → Chat → pi session
```

## Storage

### Global

```text
~/.phi/
├─ phi.yaml              # operator config
├─ pi/
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

## Memory

- `MEMORY.md` — small durable memory, injected into system prompt.
- `YYYY-MM-DD.md` — daily notes, not auto-injected.

Before session switch and compaction, phi runs an invisible maintenance turn to update memory files.

## Extensions

- `src/extensions/system-prompt/` — prompt builder
- `src/extensions/memory-maintenance/` — memory maintenance
- `src/core/` — runtime infrastructure

## Cron

Chat-scoped cron system. Details in `docs/concepts/cron.md`.
Cron config lives in `<workspace>/.phi/config.yaml`.

```text
Service → Runtime → ChatExecutor → pi session
Cron → CronExecutor
              ^
Cron publish ─|
```

Job state lives under the chat workspace, not in global state.

## Reload

`reload` is a chat-scoped tool with no parameters.
It recreates the current session from workspace files.

## Failure strategy

Fail fast. Do not hide errors. Notify the user when failures affect visible behavior.
