# phi

Phi is a homemade [openclaw](https://github.com/openclaw/openclaw) based on [pi](https://github.com/badlogic/pi-mono) and the [pi ecosystem](https://pi.dev).

## Current status

- ✅ Multi-agent runtime abstraction is in place (`agentId`-scoped sessions).
- ✅ TUI channel routing is config-driven via `channels.tui.agent`.
- ✅ Telegram channel adapter is implemented with polling (`phi service`).

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

Example `phi.yaml`:

```yaml
agents:
  main:
    model: big-pickle
    provider: opencode
    thinkingLevel: medium

channels:
  tui:
    agent: main
  telegram:
    chats:
      "<telegram-chat-id>":
        enabled: true
        agent: main
        token: <telegram-bot-token>
```

3. Phi uses per-agent pi data dir (`~/.phi/agents/<agentId>/pi`) and shared auth (`~/.phi/auth/auth.json`).
4. Legacy global skills from `~/.agents/skills` are disabled; use per-agent skills under `~/.phi/agents/<agentId>/pi/skills` instead.
5. Start TUI:

```bash
bun index.ts tui
```

By default, TUI agent is resolved from `channels.tui.agent` in `~/.phi/phi.yaml`.

For debugging a specific Telegram chat route, override with both `--channel` and `--chat`:

```bash
bun index.ts tui --channel telegram --chat=<telegram-chat-id>
```

When chat override is provided, TUI resolves agent from `channels.<channel>.chats.<chatId>.agent` (currently `telegram` is supported) and uses conversation key `telegram:chat:<chatId>`.

Start service (currently Telegram polling channel):

```bash
bun index.ts service
```

Service reads all channel configs from the shared `~/.phi/phi.yaml`.

You can also run default command (same as `tui`):

```bash
bun index.ts
```

In TUI, use `/login` directly when authentication is needed.
