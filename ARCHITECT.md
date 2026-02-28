# ARCHITECT

## Goal

`phi` is a **multi-agent orchestration layer** built on top of `pi-coding-agent`.

Each phi agent owns an isolated `pi` workspace, while all phi agents share one auth boundary.

Core responsibilities:

- provide a stable `phi` command/API surface,
- isolate runtime data per agent,
- share auth state across agents,
- keep `pi` as the execution engine,

We keep design small (KISS), fail fast, and treat hot-reload as a first-class runtime capability.

## Design Philosophy

- KISS first: smallest viable architecture, no over-design.
- Fast fail: propagate errors directly, no silent recovery.
- **Hot-reload first**: rely on `pi` reload capability so `phi` configuration/prompt/context changes can take effect without service restart.

## Abstracted Data Layout

```text
~/.phi/
├─ auth/
│  └─ auth.json               # shared by all phi agents
├─ agents/
│  ├─ main/
│  │  ├─ pi/                  # isolated pi resources for agent "main"
│  │  ├─ sessions/            # phi-level session metadata (optional)
│  │  └─ ...                  # other per-agent phi configs
│  └─ <agent-id>/
│     ├─ pi/
│     └─ ...
└─ phi.yaml                   # global config + agent registry
```

## Resource Provider Adapter Model

All agent resources must be accessed through provider adapters.

Core abstractions:

- `AgentResourceProvider`: read/write agent resources (`phi.yaml`, per-agent config, context, prompts, session metadata)
- `AuthProvider`: shared auth boundary (`auth/auth.json`)
- `WorkspaceProvider`: resolve/provision per-agent workspace (`agents/<agentId>/pi`)

`PhiRuntime` depends on these interfaces only.

### Built-in Implementation

- `FileSystemResourceProvider`
- Implements exactly this layout:
  - `~/.phi/auth/auth.json`
  - `~/.phi/agents/<agentId>/...`
  - `~/.phi/phi.yaml`

### Extension-based Providers

Additional providers are delivered via the same extension mechanism philosophy as `pi`.

Examples:

- HTTP-backed resource provider
- database/object-storage backed provider
- hybrid cache + remote provider

Extensions should support **hot reload** too. 

## Architecture

### 1) Entry Layer

- **File**: `index.ts`
- Responsibility:
  - build `PhiRuntime`
  - build CLI app
  - route commands to adapters

Composition only, no business logic.

### 2) Command Adapter Layer

- **Files**: `src/commands/*`
- Responsibility:
  - parse `agentId` + conversation key from command input
  - call runtime abstraction only
  - fail fast on unknown command / unknown agent

### 3) Agent Runtime Orchestration Layer

- **Core abstraction**: `PhiRuntime`
- Responsibility:
  - manage per-agent runtime instance
  - provide keyed conversation/session lifecycle per agent
  - de-duplicate concurrent session creation

Recommended shape:

- `AgentRegistry` (read from `phi.yaml`)
- `AgentWorkspaceResolver` (resolve paths under `~/.phi/agents/<agentId>`)
- `AgentRuntimePool` (`Map<agentId, ConversationRuntime>`)

### 4) Pi Session Factory Layer

- Responsibility:
  - create `pi` session for one specific agent
  - set `agentDir` to `~/.phi/agents/<agentId>/pi`
  - bind shared auth from `~/.phi/auth/auth.json`
  - keep context loading rules consistent and explicit

No custom engine logic; `pi` still runs the loop.

## Human Interface Layer

We expose phi to humans through adapters, not through direct runtime internals.

### 1) TUI

- Command: `phi tui`
- Agent selection: `--agent <agentId>`
- Default agent: `main`

Examples:

- `phi tui` → starts TUI with `main`
- `phi tui --agent support` → starts TUI with `support`

### 2) Channels (Telegram/IM/HTTP webhook)

Channels are also adapters. They map inbound user messages to the right `agentId` and conversation key.

Mapping is configured in `phi.yaml`, for example:

```yaml
channels:
  telegram:
    bots:
      "123456789":
        agentId: main
```

Runtime routing flow:

1. receive inbound event (`provider`, `botId`, `chatId`, `userId`, message)
2. resolve `agentId` from channel mapping in `phi.yaml`
3. build deterministic conversation key (e.g. `telegram:123456789:chat:<chatId>:user:<userId>`)
4. get/create session from `PhiRuntime(agentId, conversationKey)`
5. forward message to `pi` session

This keeps user-facing behavior simple while preserving strict multi-agent isolation.

## Isolation Model

Isolation unit = `agentId`.

Each agent has:

- isolated `pi` data directory,
- isolated session namespace,
- isolated per-agent config.

Shared across all agents:

- `auth/auth.json`,
- global `phi.yaml` registry/policy.

This gives clear security and operational boundaries, and enables future remote control.

## Service-Ready Abstraction

All `agents.main` behavior must be accessed via abstract runtime interfaces, not direct filesystem coupling.

This allows hard cutover from local CLI-only flow to network-managed flow without changing business semantics:

- local adapter (CLI/TUI)
- remote adapter (HTTP/IM/WebSocket)

Both call the same `PhiRuntime` contract.

## Failure Strategy

- unknown `agentId` => throw immediately
- unknown channel mapping (`botId`/route not configured) => throw immediately
- missing required files (`phi.yaml`, agent workspace) => throw immediately
- provider read/write/reload errors => throw immediately
- no silent fallback to legacy single-agent directories
- no backward compatibility layer (hard cutover)

## Non-Goals

- do not reimplement `pi` engine
- do not hide upstream errors
- do not add compatibility shims for old `~/.phi/pi` layout

## Why This Design

- simple mental model: one agent = one isolated `pi` workspace
- easy for operators: "which bot talks to which agent" is explicit in `phi.yaml`
- minimal coupling: shared auth only
- scalable: naturally extends to many agents
- service-oriented: runtime abstraction can be exposed over network later
