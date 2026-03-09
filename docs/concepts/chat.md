# Chat

## Definition

A chat is the resource container that phi uses to run one conversation context.

A chat has these dimensions:

- route
- state root
- working context
- behavior

## Service Chat

A service chat is a normal user chat from an external route such as Telegram.

Properties:

- route: external service route
- state root: `<workspace>/.phi`
- working context: configured workspace
- behavior: phi-owned

This means the chat owns its own:

- sessions
- memory
- skills
- inbox
- cron job files

Structured logs are emitted through stdio.
In production, phi should run behind a collector such as `journald`.

## TUI Chat

TUI should also be treated as a chat, but a special one.

Properties:

- route: `terminal`
- state root: `~/.phi/pi`
- working context: current working directory
- behavior: phi-owned

Important distinction:

- the current working directory is only the working context
- it is not the phi state root

So TUI should not treat `<cwd>/.phi` as its phi home.

## Relationship with pi

phi reuses pi runtime infrastructure.

For TUI chat, pi-style state still lives under:

```text
~/.phi/pi
```

This includes TUI memory under:

```text
~/.phi/pi/memory/
```

But the behavior should still follow phi decisions, such as:

- phi system prompt extension
- phi memory rules
- phi memory maintenance extension

## Summary

There are not two unrelated systems.

There is one chat model in phi:

- service chats are workspace-rooted chats
- TUI is a terminal-routed special chat with a global state root
