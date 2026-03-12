# phi

Phi is a chat runtime built on top of [pi](https://github.com/badlogic/pi-mono) and the [pi ecosystem](https://pi.dev), inspired by [openclaw](https://github.com/openclaw/openclaw).

In the monorepo, this package lives at `packages/phi`. From the repository root, use `bun run tui` or `bun run dev:service`.

## Architecture

See [ARCHITECT.md](./ARCHITECT.md) for the full design.

## Concepts

- [Chat](./docs/concepts/chat.md)
- [Chat Handler](./docs/concepts/chat-handler.md)
- [Workspace Config](./docs/concepts/workspace-config.md)
- [System Prompt](./docs/concepts/system-prompt.md)
- [Skills](./docs/concepts/skills.md)
- [Cron](./docs/concepts/cron.md)
- [Routes](./docs/concepts/routes.md)
- [Memory](./docs/concepts/memory.md)
- [Transient Turn](./docs/concepts/transient-turn.md)
- [Log](./docs/concepts/log.md)

```text
Endpoints  ◄────►  Routes  ◄────►  Chat handlers  ◄────►  Agent(pi)
                     config-driven wiring
```

## Quick Start

1. Configure a supported model credential.
2. Copy [phi.example.yaml](./phi.example.yaml) to `~/.phi/phi.yaml` and adjust for your environment.

```bash
cp phi.example.yaml ~/.phi/phi.yaml
```

## Storage

### Global operator-owned config

```text
~/.phi/
├─ phi.yaml               # Operator-owned chat routing + agent config
├─ pi/                    # TUI state
│  ├─ sessions/
│  ├─ memory/
│  │  ├─ MEMORY.md
│  │  └─ YYYY-MM-DD.md
│  └─ skills/
└─ auth/
   └─ auth.json
```

Agents do not modify `~/.phi/phi.yaml`.

### Service chat workspace

Each configured chat points to a workspace. Phi scaffolds the workspace on first use.

```text
<workspace>/
└─ .phi/
   ├─ config.yaml            # Active workspace config
   ├─ config.template.yaml   # Reference template
   ├─ sessions/              # Session history
   ├─ skills/                # Chat-scoped skills
   ├─ memory/
   │  ├─ MEMORY.md
   │  └─ YYYY-MM-DD.md
   ├─ inbox/                 # Inbound attachments
   └─ cron/
      └─ jobs/               # Cron prompt files
```

Workspace config is file-based:

- read `.phi/config.template.yaml` to learn the shape
- edit `.phi/config.yaml` to change chat-local settings
- call `reload` to apply changes

Current workspace config covers:

- `chat.timezone`
- `cron.enabled`
- `cron.jobs`

## Run

### TUI

TUI is a special phi chat with global state under `~/.phi/pi`:

```bash
bun index.ts tui
```

Its working directory is only execution context. Phi state still lives under `~/.phi/pi`.

### Service

Start the service:

```bash
bun index.ts service
```

Or in development:

```bash
bun run dev:service
```

Print the injected system prompt for service chats:

```bash
bun run dev:service:prompt
```

`--print-system-prompt` only affects service mode.

## Logging

Phi writes logs to stdio.

- development: pretty console logs via `pino-pretty`
- production: structured JSON logs to stdout for collectors such as `journald`

Every log record includes a `tag` field such as `service`, `runtime`, `telegram`, or `cron`.

Environment overrides:

- `PHI_LOG_LEVEL`: `silent` | `debug` | `info` | `warn` | `error`
- `PHI_LOG_FORMAT`: `pretty` | `json`
