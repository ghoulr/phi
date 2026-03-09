# ARCHITECT: phi

phi is a chat runtime built on top of pi.
It routes external messages to chat-scoped pi sessions and keeps phi-owned behavior around them.

## Principles

- Keep it simple.
- Fail fast.
- No backward compatibility.
- Reuse pi where possible, but let phi own chat behavior.

## Model

There is one chat model in phi.

A chat has:

- a route
- a state root
- a working context
- phi-owned behavior

### Service chat

- route: external service route
- state root: `<workspace>/.phi`
- working context: configured workspace
- behavior: phi-owned

Example chat config:

```yaml
chats:
  alice:
    workspace: ~/phi/workspaces/alice
    agent: main
    timezone: Asia/Shanghai
```

Global chat-level settings such as timezone belong here.
Other documents may assume this config shape.

### TUI chat

- route: `terminal`
- state root: `~/.phi/pi`
- working context: current `cwd`
- behavior: phi-owned

The TUI `cwd` is only working context.
It is not the phi state root.

## Runtime shape

```text
Service -> Runtime -> Chat -> pi session
```

- **Service** handles transport such as Telegram.
- **Runtime** resolves chat config, workspace, and pi resources.
- **Chat** is the resource container.
- **pi session** executes the actual conversation.

## Storage

### Global phi home

```text
~/.phi/
├─ phi.yaml
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
   ├─ sessions/
   ├─ skills/
   ├─ memory/
   │  ├─ MEMORY.md
   │  └─ YYYY-MM-DD.md
   ├─ inbox/
   └─ cron/
      └─ jobs/
```

## Memory

phi keeps memory file-based and simple.

- `MEMORY.md`: small durable memory injected into the system prompt
- `YYYY-MM-DD.md`: daily working notes, not auto-injected

Before session switch and compaction, phi runs an invisible maintenance turn.
That turn may update daily memory files, but it is not kept in the normal conversation history.
Observability is kept through session custom entries.

## Extensions

phi keeps pi-specific behavior in extension modules.

Current extension modules:

- `src/extensions/system-prompt/`
- `src/extensions/memory-maintenance/`

`src/core/` keeps runtime infrastructure and shared helpers.

## Cron and background tasks

phi has a chat-scoped cron system.

Cron has two runtime paths:

- normal chat execution
- isolated cron execution

Runtime shape:

```text
Service -> Runtime -> ChatExecutor -> pi session
Cron -> CronExecutor
Cron publish ----^
```

This means:

- external messages use the normal chat execution path
- cron jobs run outside the main session
- cron results are published back through the chat execution path
- chat session mutation stays serialized

Cron remains chat-scoped.
Job state lives under the chat state root, not in global runtime state.
If a chat has no cron jobs, cron is effectively off for that chat.

The detailed cron design lives in:

- `docs/concepts/cron.md`

phi should also expose a small chat-scoped reload tool.

That tool is not cron-specific.
It asks phi to reconcile and reload all phi-owned chat state that can be safely hot-reloaded.

## Failure strategy

Fail fast.
Do not hide errors.
Do not silently fail.
When a failure affects user-visible behavior, notify the user.
