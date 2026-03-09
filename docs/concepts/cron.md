# Cron

Chat-scoped background task scheduling.

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
- exactly one of `cron` or `at` must be set
- `cron` uses chat timezone
- `at` uses local wall-clock time (`YYYY-MM-DD HH:mm`)
- missing prompt files and invalid data are errors

## Execution

1. Load cron config from `.phi/config.yaml`
2. Load the prompt file
3. Run a fresh agent turn in the chat workspace
4. Publish the result back through `ChatExecutor`
5. Recompute next run

Cron runs are isolated from the main session context.

## Reload

Invalid cron config or prompt files make `reload` fail for that chat.

## Failure

Fail fast. Do not hide errors. Notify the user when failures affect visible behavior.
