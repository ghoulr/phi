# Chat

A chat is phi's resource container for one conversation.

## Dimensions

| Dimension | Service chat | TUI chat |
|-----------|-------------|----------|
| route | external (e.g. Telegram) | terminal |
| state root | `<workspace>/.phi` | `~/.phi/pi` |
| working context | configured workspace | current `cwd` |

## Service chat

A service chat owns:

- workspace config (`.phi/config.yaml`)
- sessions
- memory
- skills
- inbox
- cron prompt files

`config.yaml` holds chat-local settings and cron metadata.

See `docs/concepts/workspace-config.md` for workspace config details.

## TUI chat

TUI is a special chat with a global state root at `~/.phi/pi`.

The current working directory is only working context, not the phi state root.
TUI does not use `<cwd>/.phi` as its phi home.

## Relationship with pi

phi reuses pi infrastructure.
TUI state lives under `~/.phi/pi` but follows phi behavior (system prompt, memory rules, maintenance).
