# phi

Phi is a homemade [openclaw](https://github.com/openclaw/openclaw) based on [pi](https://github.com/badlogic/pi-mono) and the [pi ecosystem](https://pi.dev).

## Current status

- ✅ Core runtime abstraction is in place for multi-entry integration.
- ✅ `phi tui` is implemented by reusing `pi-coding-agent` defaults.
- ✅ Future channels (for example Telegram) can reuse the same runtime/session layer.

## Run

1. Configure any supported model credential (for example `OPENAI_API_KEY` or `ANTHROPIC_API_KEY`).
2. Phi keeps its own data under `~/.phi`, and stores pi-compatible runtime data under `~/.phi/pi` (instead of `~/.pi/agent`).
3. Legacy global skills from `~/.agents/skills` are disabled; use `~/.phi/pi/skills` instead.
4. AGENTS.md auto-discovery is disabled; phi loads context only from:
   - `~/.phi/context/**/*.md`
   - `<cwd>/.phi/context/**/*.md`
5. Start TUI:

```bash
bun run tui
```

You can also run default command (same as `tui`):

```bash
bun index.ts
```

In TUI, use `/login` directly when authentication is needed.
