# Chat

A chat is phi's workspace-scoped container.
It owns chat-local state and workspace data.

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
The current working directory is execution context.
