# Chat

A chat is phi's runtime unit for one conversation.
It is not just a pi session and not just a transport binding.

## Dimensions

| Dimension | Service chat | TUI chat |
|-----------|-------------|----------|
| endpoint side | configured endpoints | terminal |
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

A service chat is the config-bound composition of endpoints, routes, and chat handlers around one agent-facing identity.

See `docs/concepts/chat-handler.md`, `docs/concepts/routes.md`, and `docs/concepts/workspace-config.md`.

## TUI chat

TUI is a special chat with a global state root at `~/.phi/pi`.
The current working directory is only working context, not the phi state root.
TUI does not use `<cwd>/.phi` as its phi home.
TUI does not use the routed service runtime.

## Relationship with pi

phi reuses pi infrastructure.
TUI state lives under `~/.phi/pi` but follows phi behavior (system prompt, memory rules, maintenance).
Service chats also reuse pi sessions, but chat handlers hide pi's interactive input language from endpoints.
