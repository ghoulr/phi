# phi

Phi is a multi-user, multi-agent conversation system built on top of [pi](https://github.com/badlogic/pi-mono) and the [pi ecosystem](https://pi.dev), inspired by [openclaw](https://github.com/openclaw/openclaw).

## Architecture

See [ARCHITECT.md](./ARCHITECT.md) for the full design.

## Concepts

- [System Prompt](./docs/concepts/system-prompt.md)
- [Skills](./docs/concepts/skills.md)

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
   └─ logs/               # Message logs
```

## Run

### TUI (Local Terminal)

TUI runs as an independent pi instance for local ops:

```bash
bun index.ts tui
```

In TUI, use `/login` directly when authentication is needed.

### Service

Start the service (Telegram, HTTP, etc.):

```bash
bun index.ts service
```

Service reads all configurations from `~/.phi/phi.yaml`.
