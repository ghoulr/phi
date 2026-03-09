# phi

Phi is a chat runtime built on top of [pi](https://github.com/badlogic/pi-mono) and the [pi ecosystem](https://pi.dev), inspired by [openclaw](https://github.com/openclaw/openclaw).

## Architecture

See [ARCHITECT.md](./ARCHITECT.md) for the full design.

## Concepts

- [Chat](./docs/concepts/chat.md)
- [System Prompt](./docs/concepts/system-prompt.md)
- [Skills](./docs/concepts/skills.md)
- [Memory](./docs/concepts/memory.md)
- [Transient Turn](./docs/concepts/transient-turn.md)

```
                    ┌─────────┐
                    │ Service │ ← All external interfaces (IM, API, CLI, etc.)
                    └────┬────┘
                         │ routes
                    ┌────▼────┐
              ┌─────┤ Runtime ├─────┐
              │     └────┬────┘     │
              │          │          │
         ┌────▼────┐     │     ┌────▼─────┐
         │  Chat   │◄────┘     │ Agent(pi)│
         └─────────┘           └──────────┘
```

## Quick Start

1. Configure any supported model credential (for example `OPENAI_API_KEY` or `ANTHROPIC_API_KEY`).

2. Copy [phi.example.yaml](./phi.example.yaml) to `~/.phi/phi.yaml` and adjust for your environment:

```bash
cp phi.example.yaml ~/.phi/phi.yaml
```

3. Directory layout:

```text
~/.phi/
├─ phi.yaml               # Master configuration
├─ pi/                    # TUI pi configuration
│  └─ skills/             # Global skills (shared across chats + TUI)
└─ auth/
   └─ auth.json
```

Chat workspaces are configured in `phi.yaml`:

```text
<chat-workspace>/
└─ .phi/
   ├─ sessions/            # pi sessions
   ├─ skills/              # Chat-scoped skills
   ├─ memory/
   │  ├─ MEMORY.md
   │  └─ YYYY-MM-DD.md
   ├─ inbox/               # Inbound attachments
   └─ cron/
      ├─ jobs.yaml
      └─ jobs/
```

## Run

### TUI (Local Terminal)

TUI is a special phi chat with global state under `~/.phi/pi`:

```bash
bun index.ts tui
```

In TUI, use `/login` directly when authentication is needed.
Its working directory is only execution context. Phi state still lives under `~/.phi/pi`.

### Service

Start the service (Telegram, HTTP, etc.):

```bash
bun index.ts service
```

Service reads all configurations from `~/.phi/phi.yaml`.

## Logging

Phi writes all logs to stdio.

- development: pretty console logs via `pino-pretty`
- production: structured JSONL logs to stdout for collectors such as `journald`

Every log record includes a `tag` field such as `service`, `runtime`, `telegram`, or `cron`.
Use your own filters to inspect one subsystem only.

Environment overrides:

- `PHI_LOG_LEVEL`: log level (`silent`, `debug`, `info`, `warn`, `error`)
- `PHI_LOG_FORMAT`: log format (`pretty`, `json`)
