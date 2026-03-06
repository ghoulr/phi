# System Prompt

## Scope

This document describes the system prompt used by phi chat runtime sessions.

## Source Files

- Prompt builder: `src/extensions/system-prompt/prompt.ts`
- Prompt override helper: `src/extensions/system-prompt/override.ts`
- Prompt installer: `src/extensions/system-prompt/install.ts`
- Prompt application: `src/core/runtime.ts`, `src/commands/tui.ts`

## Where It Is Applied

- Applied to chat sessions created by runtime (`createDefaultAgentSession`).
- Applied to TUI sessions created by `src/commands/tui.ts`.
- Runtime and TUI both use an OpenClaw-style monkey patch to override pi session prompt rebuild behavior.

## Prompt Inputs

`buildPhiSystemPrompt(...)` receives:

- `assistantName`
- `workspacePath`
- `skills`
- `memoryFilePath`
- `toolNames`
- `eventText` (optional)

Current runtime values:

### Service chat

- `assistantName`: `"Phi"`
- `toolNames`: `read`, `bash`, `edit`, `write`
- `workspacePath`: resolved from `chats.<chatId>.workspace` in `~/.phi/phi.yaml`
- `skills`: from runtime `resourceLoader.getSkills().skills`
- `memoryFilePath`: `<workspace>/.phi/memory/MEMORY.md`
- `eventText`: not provided by default

### TUI chat

- `assistantName`: `"Phi"`
- `toolNames`: `read`, `bash`, `edit`, `write`
- `workspacePath`: current working directory
- `skills`: loaded through TUI resource loading
- `memoryFilePath`: `~/.phi/pi/memory/MEMORY.md`
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
- when the user asks to remember something, write it to the resolved `MEMORY.md` path for the current chat
- keep `MEMORY.md` small and concise, and rewrite it when needed
- `YYYY-MM-DD.md` is for raw daily notes and working context
- daily notes are not auto-injected; grep and read them on demand
- current `MEMORY.md` content is appended when non-empty

## Related Runtime Behavior

Memory maintenance before session switch / compaction is implemented separately via transient turns.
The system prompt only defines the memory rules.

phi does not rely on `resourceLoader.systemPromptOverride` for chat runtime prompt ownership.
Instead, phi owns this as a dedicated extension module: it builds the prompt, applies it to the session, and monkey patches pi's internal base prompt rebuild path so later turns keep using the phi prompt.

## Configuration Surface

- Prompt text/section logic: edit `src/extensions/system-prompt/prompt.ts`.
- Prompt installation/override behavior: edit `src/extensions/system-prompt/install.ts` and `src/extensions/system-prompt/override.ts`.
- Runtime prompt inputs: edit `src/core/runtime.ts` and `src/commands/tui.ts`.
- Service chat memory content: edit `<workspace>/.phi/memory/MEMORY.md`.
- TUI memory content: edit `~/.phi/pi/memory/MEMORY.md`.
