# Cron

Chat-scoped background task scheduling.
Cron is a source-only endpoint.
It is not a route and not a message sink.

## Storage

```text
<workspace>/.phi/
├─ config.yaml         # chat settings + cron config
└─ cron/
   └─ jobs/
      ├─ daily-summary.md
      └─ weekly-review.md
```

- `config.yaml` stores cron metadata
- `cron/jobs/*.md` stores job prompt files

## Config shape

Timezone is chat-local and lives in workspace config.
Cron config also lives in workspace config.

```yaml
chat:
  timezone: Asia/Shanghai

cron:
  enabled: true
  jobs:
    - id: daily-summary
      enabled: true
      prompt: jobs/daily-summary.md
      cron: "0 9 * * 1-5"

    - id: dentist-reminder
      enabled: true
      prompt: jobs/dentist-reminder.md
      at: "2030-01-15 09:00"
```

- `id` must be unique within the chat
- `prompt` is relative to `<workspace>/.phi/cron/`
- prompt files should describe what to do when the job fires now, not setup text such as "task created" or "reminder enabled"
- exactly one of `cron` or `at` must be set
- `cron` uses chat timezone
- `at` uses local wall-clock time (`YYYY-MM-DD HH:mm`)
- missing prompt files and invalid data are errors

## Execution

1. Load cron config from `.phi/config.yaml`
2. Load the prompt file
3. Emit a cron trigger for the target chat
4. Route the trigger to the chat handler
5. Run the chat turn
6. Publish assistant state back through `ChatExecutor`
7. Route outbound messages to endpoints
8. Recompute next run

Cron runs are isolated from the main interactive session context.
They still target the same chat identity.

## Reload

`reload` validates cron config and prompt files first. Invalid cron config or prompt files make validation fail for that chat.

## Failure

Fail fast. Do not hide errors. Notify the user when failures affect visible behavior.
