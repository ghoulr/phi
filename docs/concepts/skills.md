# Skills

How phi discovers and loads skills.

## Locations

### Service chat

Two scopes, chat-scoped wins on name collision:

1. `<workspace>/.phi/skills` (chat-scoped)
2. `~/.phi/pi/skills` (global)

### TUI chat

Uses pi-style loading rooted at `~/.phi/pi`. Does not use `<cwd>/.phi/skills`.

## Loader setup

Service chat uses `DefaultResourceLoader` with `noSkills: true` and `additionalSkillPaths` from `resolvePhiSkillPaths(...)`.

TUI uses pi-style `DefaultResourceLoader` directly.

## Prompt exposure

Skills are formatted by `formatSkillsForPrompt(skills)`.
Skills with `disable-model-invocation: true` are excluded.

## Configuration

- Global skills: `~/.phi/pi/skills`
- Chat-scoped skills: `<workspace>/.phi/skills`
- Workspace config: see `docs/concepts/workspace-config.md`
