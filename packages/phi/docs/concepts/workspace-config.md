# Workspace Config

Config for one chat workspace.

## Files

| File | Purpose |
| --- | --- |
| `<workspace>/.phi/config.yaml` | active config |
| `<workspace>/.phi/config.template.yaml` | reference template |

`~/.phi/phi.yaml` is operator-owned.
Agents do not modify it.

## What it contains

- `chat.*` — chat-local settings such as timezone
- `skills.entries.<name>.env` — per-skill environment variables

Cron config does not live here.
Use `<workspace>/.phi/cron/cron.yaml` and cron tools instead.

## How agents use it

1. Read the template to see available options.
2. Edit `config.yaml` with normal file tools.
3. Call `reload` to validate workspace config changes and schedule apply after the current reply ends.

Skill file creation and edits do not need `reload`.
New sessions discover the updated skill set automatically.

## Reload

Chat-scoped, no parameters.
Validates workspace-backed runtime state, then schedules apply for after the current reply ends.
Validation failures throw immediately.
The current turn finishes normally; the reloaded session runtime takes effect on the next turn.

## Template source

The repo-level template lives at `src/templates/workspace-config.template.yaml`.
It is copied into each workspace as `.phi/config.template.yaml` during workspace setup.
