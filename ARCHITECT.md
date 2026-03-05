# ARCHITECT: phi

`phi` is a multi-agent orchestration layer built on top of `pi-coding-agent`.
This document outlines the core design and architecture.

## Core Principles

- **KISS first**: Build the smallest working architecture. No speculative abstractions.
- **Fast fail**: Errors propagate immediately. No hidden recovery, no silent fallbacks.
- **Never look back**: No backward compatibility. Drop legacy baggage.
- **Follow `pi` philosiphy**: As a wrapper of `pi`, we should follow the design of `pi`.

---

## Architecture

phi is a multi-user, multi-agent system built on top of `pi`.

### Core Architecture

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

### Core Concepts

#### Chat
A **Chat** is the abstract resource container representing a user:
- Owns all user-specific resources (skills, memory, sessions)
- Binds to an Agent configuration for conversation handling
- One user = one Chat (1:1 mapping)

#### Runtime
The **Runtime** manages Chats and orchestrates execution:
- Manages Chat lifecycle and resources
- Routes messages between Service and Chats
- Creates execution context using Agent(pi) based on Chat config
- Handles inbound/outbound association per Chat

#### Agent (pi)
**Agent** is a wrapped `pi` instance that does the actual work:
- Manage all `pi` related resources, like sessions, extensions 
- Receives prompt + tools from Runtime
- Executes the conversation turn
- Returns response

#### Service
The **Service** provides all external interfaces:
- Handles inbound/outbound message transport
- Does auth and maps external identities to Chats
- Manages all communication protocols (Telegram, Discord, HTTP API, etc.)

**Note on TUI**: The TUI runs as an independent `pi` instance for local ops/debugging, using `~/.phi/pi/` for its configuration. It is not part of the multi-user chat system.

### Data Flow

### Data Flow

**Inbound**: `Service → Runtime → Chat → Runtime → Agent(pi)`

**Outbound**: `Agent(pi) → Runtime → Chat → Runtime → Service`

### Configuration

All configuration lives in `~/.phi/phi.yaml`. See [phi.example.yaml](./phi.example.yaml) for a complete example.

Config structure:
- `agents`: Agent templates (pi configurations)
- `chats`: User chat definitions with routes to external services
- Global service configs (e.g., `http.port`) at root level

### Storage

**Configuration (~/.phi/)**
```
~/.phi/
├─ phi.yaml               # Master config (see phi.example.yaml)
├─ pi/                    # TUI pi configuration
│  └─ skills/             # Global skills (shared across chats + TUI)
└─ auth/
   └─ auth.json
```

**Chat Workspace (configured in phi.yaml)**
```
<chat-workspace>/
└─ .phi/
   ├─ sessions/            # pi sessions
   ├─ skills/              # Chat-scoped skills
   ├─ memory/
   │  ├─ MEMORY.md
   │  └─ YYYY-MM-DD.md
   └─ logs/               # Message logs
```

### Failure Strategy
Fail fast, no silent fallbacks. All errors go to the user chats immediately.
