# System Prompt

## Scope

This document describes the system prompt used by phi chat runtime sessions.

## Source Files

- Prompt builder: `src/core/system-prompt.ts`
- Prompt override helper: `src/core/system-prompt-override.ts`
- Prompt application: `src/core/runtime.ts`

## Where It Is Applied

- Applied to chat sessions created by runtime (`createDefaultAgentSession`).
- Runtime uses an OpenClaw-style monkey patch to override pi session prompt rebuild behavior.
- Current TUI session creation (`src/commands/tui.ts`) does not call `buildPhiSystemPrompt`.

## Prompt Inputs

`buildPhiSystemPrompt(...)` receives:

- `assistantName`
- `workspacePath`
- `skills`
- `memoryFilePath`
- `toolNames`
- `eventText` (optional)

Current runtime values:

- `assistantName`: `"Phi"`
- `toolNames`: `read`, `bash`, `edit`, `write`
- `workspacePath`: resolved from `chats.<chatId>.workspace` in `~/.phi/phi.yaml`
- `skills`: from runtime `resourceLoader.getSkills().skills`
- `memoryFilePath`: `<workspace>/.phi/memory/MEMORY.md`
- `eventText`: not provided by default

## Prompt Sections

Rendered in this order:

1. Identity line
2. `## Workspace Layout`
3. `## Skills` (only when skills text is non-empty)
4. `## Memory` (always included)
5. `## Events & Replies` (only when `eventText` is non-empty)
6. `## Tools`
7. Tool guidance bullets

## Tool Text and Guidance

- Tool list is built from `toolNames` with de-duplication (first occurrence kept).
- Known tool descriptions are defined in `TOOL_DESCRIPTION_MAP`.
- Guidance always includes: `Use the appropriate tool directly when available.`
- Additional guidance lines are included conditionally based on enabled tools.

## Memory Rules in Prompt

The memory section now uses stricter write rules.

It tells the agent:

- `MEMORY.md` is for durable facts and explicit "remember this" requests
- when the user asks to remember something, write it to `.phi/memory/MEMORY.md`
- keep `MEMORY.md` small and concise, and rewrite it when needed
- `.phi/memory/YYYY-MM-DD.md` is for raw daily notes and working context
- daily notes are not auto-injected; grep and read them on demand
- current `MEMORY.md` content is appended when non-empty

## Related Runtime Behavior

Memory maintenance before session switch / compaction is implemented separately via transient turns.
The system prompt only defines the memory rules.

phi does not rely on `resourceLoader.systemPromptOverride` for chat runtime prompt ownership.
Instead, runtime applies the built prompt to the session and monkey patches pi's internal base prompt rebuild path so later turns keep using the phi prompt.

## Configuration Surface

- Prompt text/section logic: edit `src/core/system-prompt.ts`.
- Runtime prompt inputs: edit `src/core/runtime.ts`.
- Memory content: edit `<workspace>/.phi/memory/MEMORY.md`.
