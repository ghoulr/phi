# ARCHITECT

## Goal

`phi` is a thin wrapper around `pi-coding-agent`, focused on one clear responsibility:

- provide a stable `phi` command surface,
- keep `pi` runtime data isolated under `~/.phi/pi`,
- and leave model/tool/session engine to `pi`.

We intentionally keep this layer small (KISS) and fail fast.

## Current Architecture

### 1) Entry Layer

- **File**: `index.ts`
- Responsibility:
  - build runtime (`createPhiRuntime()`)
  - build CLI app (`tui(...)`)
  - route to TUI command (`runTuiCommand(...)`)

This file is only composition glue, no business logic.

### 2) Command Wrapper Layer

- **File**: `src/tui.ts`
- Responsibility:
  - define `phi tui`
  - default command behavior (no args => same as `tui`)
  - unknown command => throw error directly (fast fail)

### 3) TUI Adapter Layer

- **File**: `src/commands/tui.ts`
- Responsibility:
  - acquire session from runtime by key (`tui:default`)
  - run `InteractiveMode(session)` from `pi`
  - always dispose session after mode exits

This is the adapter from our command system to `pi` interactive mode.

### 4) Runtime Layer

- **File**: `src/core/runtime.ts`
- Responsibility:
  - session lifecycle abstraction (`ConversationRuntime<TSession>`)
  - de-duplicate concurrent session creation by conversation key
  - default session factory based on `createAgentSession(...)`

## How We Wrap `pi`

We do not reimplement `pi` core engine. We configure and constrain it:

- use `createAgentSession` + `DefaultResourceLoader`
- set `agentDir` to: `~/.phi/pi`
- disable legacy global skills source: `~/.agents/skills`
- disable AGENTS.md auto-discovery by overriding `agentsFiles`
- load context only from:
  - `~/.phi/context/**/*.md`
  - `<cwd>/.phi/context/**/*.md`

So `phi` owns the integration boundary, while `pi` still executes the agent loop.

## Data Boundary

- `~/.phi`: phi-owned data namespace
- `~/.phi/pi`: pi-compatible runtime data (settings/auth/sessions/models)

This avoids mixing with default `~/.pi/agent`.

## Non-Goals (Current)

- no custom agent engine
- no custom TUI framework
- no extra channel adapters in this stage

## Extension Direction

Future channels (Telegram, etc.) should reuse:

- `ConversationRuntime` for keyed session lifecycle
- same `createAgentSession` factory constraints
- channel-specific adapter layer similar to `src/commands/tui.ts`
