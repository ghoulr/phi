# System Prompt

Describes the system prompt used by phi chat sessions.

## Source files

- Builder: `src/extensions/system-prompt/prompt.ts`
- Override: `src/extensions/system-prompt/override.ts`
- Installer: `src/extensions/system-prompt/install.ts`
- Applied in: `src/core/runtime.ts`, `src/commands/tui.ts`

## Prompt inputs

`buildPhiSystemPrompt(...)` receives:

| Input | Service chat | TUI chat |
|-------|-------------|----------|
| `assistantName` | `"Phi"` | `"Phi"` |
| `workspacePath` | from `chats.<id>.workspace` | current `cwd` |
| `skills` | `resourceLoader.getSkills()` | pi-style loading |
| `memoryFilePath` | `<workspace>/.phi/memory/MEMORY.md` | `~/.phi/pi/memory/MEMORY.md` |
| `toolNames` | `read`, `bash`, `edit`, `write` + runtime tools (`reload`, `send`) | `read`, `bash`, `edit`, `write` |
| `eventText` | optional | optional |

## Prompt sections

1. Identity line
2. `## Workspace`
3. `## Skills` (when non-empty)
4. `## Memory`
6. `## Tools`
7. Tool guidance
8. `## Message Format`

## Workspace Layout

Workspace root: `${params.workspacePath}`,
Use workspace files and directories as the source of truth for persistent context.

append text below in service chat:

Phi config file is `<workspace>/.phi/config.yaml`, read `<workspace>/.phi/config.template.yaml` to learn config details about:

- timezone
- cron

After config modification, call `reload` for hot-reload.

See `docs/concepts/workspace-config.md`.

## Message format

User messages end with `<system-reminder>...</system-reminder>`.
This is metadata, not user input. The agent should not mention it to the user.

## Memory rules

- `MEMORY.md` — durable facts, injected into prompt. Keep small.
- `YYYY-MM-DD.md` — daily notes, not injected. Read on demand.
- Current `MEMORY.md` content is appended to the prompt when non-empty.

## Runtime behavior

phi owns the system prompt as a dedicated extension.
It monkey-patches pi's internal prompt rebuild so the phi prompt persists across turns.

Memory maintenance runs as a separate transient turn (see `docs/concepts/transient-turn.md`).
