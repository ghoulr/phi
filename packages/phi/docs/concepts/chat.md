# Chat

A chat is phi's workspace-scoped container.
It is not a transport and not a pi session.

## Owns

A service chat owns:
- workspace config (`.phi/config.yaml`)
- sessions
- memory
- skills
- inbox
- cron config (`.phi/cron/cron.yaml`)
- cron prompt files

## TUI chat

TUI is a special chat with a global state root at `~/.phi/pi`.
The current working directory is only working context, not the phi state root.
TUI does not use the routed service runtime.
