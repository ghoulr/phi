# System Prompt

## Scope

This document describes the system prompt used by phi chat runtime sessions.

## Source Files

- Prompt builder: `src/core/system-prompt.ts`
- Prompt application: `src/core/runtime.ts` (`session.agent.setSystemPrompt(...)`)

## Where It Is Applied

- Applied to chat sessions created by runtime (`createDefaultAgentSession`).
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
4. `## Memory` (only when memory file content is non-empty and not just `# MEMORY`)
5. `## Events & Replies` (only when `eventText` is non-empty)
6. `## Tools`
7. Tool guidance bullets

## Tool Text and Guidance

- Tool list is built from `toolNames` with de-duplication (first occurrence kept).
- Known tool descriptions are defined in `TOOL_DESCRIPTION_MAP`.
- Guidance always includes: `Use the appropriate tool directly when available.`
- Additional guidance lines are included conditionally based on enabled tools.

## Configuration Surface

- Prompt text/section logic: edit `src/core/system-prompt.ts`.
- Runtime prompt inputs: edit `src/core/runtime.ts`.
- Memory content: edit `<workspace>/.phi/memory/MEMORY.md`.
