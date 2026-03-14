# System Prompt

Describes the system prompt used by phi chat sessions.

## Source files

- Builder: `src/core/system-prompt/prompt.ts`
- Override: `src/core/system-prompt/override.ts`
- Installer: `src/core/system-prompt/install.ts`
- Barrel: `src/core/system-prompt/index.ts`
- Applied in: `src/core/runtime.ts`, `src/commands/tui.ts`, `src/core/transient-turn.ts`

## Prompt inputs

`buildPhiSystemPrompt(...)` receives:

| Input | Service chat | TUI chat |
| --- | --- | --- |
| `assistantName` | `"Phi"` | `"Phi"` |
| `workspacePath` | `chats.<id>.workspace` | current `cwd` |
| `skills` | `resourceLoader.getSkills().skills` | `resourceLoader.getSkills().skills` |
| `memoryFilePath` | `<workspace>/.phi/memory/MEMORY.md` | `~/.phi/pi/memory/MEMORY.md` |
| `toolNames` | built-in file tools plus runtime tools when available | built-in file tools |

Service chat skills come from pi `DefaultResourceLoader` with phi-managed skill roots.
TUI chat uses pi skill loading from the global phi state.

## Prompt sections

1. Identity line
2. `## Workspace`
3. `## Skills` (when non-empty)
4. `## Memory`
5. `## Tools`
6. Tool guidance
7. `## Message Format`

## Workspace layout

Workspace root is `${params.workspacePath}`.
Use workspace files and directories as the source of truth for persistent context.

Service chat appends extra guidance:

- Workspace config: `<workspace>/.phi/config.yaml`
- Template: `<workspace>/.phi/config.template.yaml`
- Call `reload` after workspace config changes to validate them and schedule apply after the current reply ends

See `docs/concepts/workspace-config.md`.

## Skills in the prompt

Phi uses the skills already loaded into the session resource loader.
Skill file changes do not rewrite the current system prompt — the agent already knows files it created or edited in the current session.
New sessions pick up the updated discovered skills.

## Message format

Phi groups message-format rules into three buckets:

- Input metadata — user messages may end with `<system-reminder>...</system-reminder>`; this is internal metadata, not user input, and should never be mentioned to the user
- Visible output — normal user-visible output should use the final assistant reply; `send(instant: true)` is for immediate delivery; `send()` stages one deferred delivery until agent run end
- Control token — `NO_REPLY` is a control token, not message text; when nothing else should be said, the entire final assistant reply must be exact `NO_REPLY`; never append it to a real reply and never pass it to `send`

## Memory rules

- `MEMORY.md` — durable memory injected into the prompt. Keep it small.
- `YYYY-MM-DD.md` — daily notes, not injected automatically.
- Current memory content is appended to the prompt when non-empty.

## Runtime behavior

Phi owns the system prompt as a dedicated core module.
It monkey-patches pi's internal prompt rebuild so the phi prompt persists across turns.

Memory maintenance runs as a separate transient turn.
See `docs/concepts/transient-turn.md`.
