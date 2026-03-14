# ARCHITECT: phi

phi is a chat runtime built on top of pi.
It connects external message endpoints and internal triggers to one chat runtime.

## Principles

- Keep it simple.
- Fail fast.
- No backward compatibility.
- Reuse pi as much as possible.

## Core model

```text
Message endpoints  ◄────►  Routes  ◄────►  Chat handlers  ◄────►  Agent(pi)
Internal triggers  ─────►
```

- **Message endpoints** — external messaging surfaces such as Telegram and Feishu
- **Routes** — config-driven wiring into chat handlers
- **Chat handlers** — chat-bound runtime that talks to pi
- **Agent(pi)** — prompt execution, queueing, steering, tools

Cron is an internal trigger path.
It is not a message endpoint provider.

## Chat model

A chat is not a transport name.
A chat is the config-bound composition of routes, chat handlers, workspace state, and one agent-facing identity.

| Dimension | Service chat | TUI chat |
|-----------|-------------|----------|
| message side | configured message endpoints | terminal |
| state root | `<workspace>/.phi` | `~/.phi/pi` |
| working context | configured workspace | current `cwd` |
| behavior | phi-owned | phi-owned |

## Config

Operator-owned config lives in `~/.phi/phi.yaml`.
It binds chats to agents and message routes.

Workspace config lives in `<workspace>/.phi/config.yaml`.
It stores chat-local settings, cron config, and skills config.

## Routes

Routes do only wiring.
They do not interpret message meaning.
They accept both:
- interactive messages from external message endpoints
- internal triggers such as cron

## Storage

```text
~/.phi/
├─ phi.yaml
├─ pi/
└─ auth/
```

```text
<workspace>/
└─ .phi/
   ├─ config.yaml
   ├─ config.template.yaml
   ├─ sessions/
   ├─ skills/
   ├─ memory/
   ├─ inbox/
   └─ cron/
      └─ jobs/
```

## Reload

`reload` is chat-scoped.
It invalidates the current chat handler state.
The next turn recreates it.

## Failure strategy

Fail fast.
Do not hide errors.
Notify the user when failures affect visible behavior.
