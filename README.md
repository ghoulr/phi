# phi

Phi is a homemade [openclaw](https://github.com/openclaw/openclaw) based on [pi](https://github.com/badlogic/pi-mono) and the [pi ecosystem](https://pi.dev).

## Current status

- ✅ Multi-agent runtime abstraction is in place (`agentId`-scoped sessions).
- ✅ `phi tui --agent <agentId>` is implemented (default agent: `main`).
- ✅ Future channels (for example Telegram) can reuse the same runtime/session layer.

## Run

1. Configure any supported model credential (for example `OPENAI_API_KEY` or `ANTHROPIC_API_KEY`).
2. Prepare phi workspace layout:

```text
~/.phi/
├─ auth/
│  └─ auth.json
├─ agents/
│  └─ main/
│     ├─ pi/
│     └─ sessions/
└─ phi.yaml
```

3. Phi uses per-agent pi data dir (`~/.phi/agents/<agentId>/pi`) and shared auth (`~/.phi/auth/auth.json`).
4. Legacy global skills from `~/.agents/skills` are disabled; use per-agent skills under `~/.phi/agents/<agentId>/pi/skills` instead.
5. Start TUI:

```bash
bun run tui
```

Run with a specific agent:

```bash
bun run tui -- --agent support
```

You can also run default command (same as `tui`):

```bash
bun index.ts
```

In TUI, use `/login` directly when authentication is needed.
