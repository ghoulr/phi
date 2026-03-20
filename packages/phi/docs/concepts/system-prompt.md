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
| `tools` | active built-in file tools plus active runtime tools when available | active built-in file tools |

Service chat and TUI both use phi-managed pi `DefaultResourceLoader` instances.
Service chat uses chat-scoped and global phi skill roots.
TUI uses global phi skill roots.
Tool metadata contributes prompt text through `promptSnippet` and `promptGuidelines`.
Phi still provides fallback snippets for built-in file tools.

## Prompt sections

1. Identity line
2. `## Workspace`
3. `## Skills` (when non-empty)
4. `## Memory`
5. `## Tools`
6. `## Guidelines`
7. `## Message Format`

## Workspace layout

Workspace root is `${params.workspacePath}`.
Use workspace files and directories as the source of truth for persistent context.

Service chat appends extra guidance:

- Workspace config: `<workspace>/.phi/config.yaml`
- Template: `<workspace>/.phi/config.template.yaml`
- Call `reload` after workspace config changes to validate them and schedule apply after the current reply ends

## Skills in the prompt

Phi uses the skills already loaded into the session resource loader.
Skill changes take effect in new sessions.

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
The rebuild stays dynamic for active tools, so runtime tool registration and tool toggles update the `## Tools` and `## Guidelines` sections.

Memory maintenance runs as a separate transient turn.
See `docs/concepts/transient-turn.md`.
