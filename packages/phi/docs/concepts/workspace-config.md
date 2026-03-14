# Workspace Config

Agent-owned config inside a chat workspace.

## Files

| File | Purpose |
| --- | --- |
| `<workspace>/.phi/config.yaml` | active config |
| `<workspace>/.phi/config.template.yaml` | reference template |

`~/.phi/phi.yaml` is operator-owned.
Agents do not modify it.

## What it contains

- `chat.*` — chat-local settings such as timezone
- `cron.*` — cron enablement, destination, and job metadata
- `skills.entries.<name>.env` — per-skill environment variables

## How agents use it

1. Read the template to see available options.
2. Edit `config.yaml` with normal file tools.
3. Call `reload` to validate config changes and schedule them to apply after the current reply ends.

When creating cron config, agents should default `cron.destination` to the current interactive message source endpoint unless the user asks for something else.

Skill file creation and edits do not need `reload`.
New sessions discover the updated skill set automatically.

## Reload

Chat-scoped, no parameters.
Validates workspace-backed runtime state, then schedules apply for after the current reply ends.
Validation failures throw immediately.
The current turn finishes normally; the new session takes effect on the next turn.

## Template source

The repo-level template lives at `src/templates/workspace-config.template.yaml`.
It is copied into each workspace as `.phi/config.template.yaml` during workspace setup.
