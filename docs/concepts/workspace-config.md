# Workspace Config

Agent-owned config that lives inside a chat workspace.

## Files

| File | Purpose |
|------|---------|
| `<workspace>/.phi/config.yaml` | Active config |
| `<workspace>/.phi/config.template.yaml` | Reference template with all options |

`~/.phi/phi.yaml` is operator-owned. Agents do not modify it.

## What it contains

Typical workspace-owned settings:

- `chat.*` — chat-local settings such as timezone
- `cron.*` — cron enablement and job metadata

## How agents use it

1. Read the template to see available options.
2. Edit `config.yaml` with normal file tools.
3. Call `reload` to apply changes.

No special config tool is needed.

## Reload

- Chat-scoped, no parameters.
- Recreates the current session from workspace files.
- The current turn finishes normally; the new session takes effect on the next turn.

## Template source

The repo-level template lives at `src/templates/workspace-config.template.yaml`.
It is copied into each workspace as `.phi/config.template.yaml` during workspace setup.
