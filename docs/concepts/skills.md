# Skills

Phi uses pi skills directly. Discovery, validation, prompt formatting, and `/skill:name` expansion all come from pi.

## Sources

Skill lookup by priority (first match wins):

1. `<workspace>/.phi/skills` — chat-scoped
2. `~/.phi/pi/skills` — global

TUI chat loads global skills from `~/.phi/pi/skills`.

## Loader

Service chat builds a pi `DefaultResourceLoader` with `noSkills: true` and explicit `additionalSkillPaths`.
Phi does not implement a separate skill runtime.

## Prompt and commands

- Loaded skills are exposed via pi `formatSkillsForPrompt(...)`.
- `disable-model-invocation: true` hides the skill from the system prompt but keeps `/skill:name` available.
- Skills are not hot-reloaded within a session. New sessions discover the updated skill set.

## Skill env

`skills.entries.<name>.env` in workspace config sets per-skill environment overrides.
Phi injects env only for skills loaded into the current session.

## Safety

- Skill loading stays inside the configured roots; escaping paths are ignored.
- Oversized files may be skipped.
- Prompt-visible skills may be capped to keep the system prompt small.
