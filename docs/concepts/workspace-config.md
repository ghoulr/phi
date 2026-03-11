# Workspace Config

Agent-owned config that lives inside a chat workspace.

## Files

| File | Purpose |
| --- | --- |
| `<workspace>/.phi/config.yaml` | active config |
| `<workspace>/.phi/config.template.yaml` | reference template |

`~/.phi/phi.yaml` is operator-owned.
Agents do not modify it.

## What it contains

- `chat.*` — chat-local settings such as timezone
- `cron.*` — cron enablement and job metadata
- `skills.entries.<name>.env` — per-skill environment variables
- `extensions.disabled` — disabled phi-owned optional extensions

## How agents use it

1. Read the template to see available options.
2. Edit `config.yaml` with normal file tools.
3. Call `reload` to apply config changes.

Skill file creation and edits do not need `reload`.
New sessions discover the updated skill set automatically.

Example:

```yaml
extensions:
  disabled:
    - messaging
    - memory-maintenance
```

## Reload

Chat-scoped, no parameters.
Recreates the current session from workspace files.
The current turn finishes normally; the new session takes effect on the next turn.

## Template source

The repo-level template lives at `src/templates/workspace-config.template.yaml`.
It is copied into each workspace as `.phi/config.template.yaml` during workspace setup.
