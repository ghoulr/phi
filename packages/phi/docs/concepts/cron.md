# Cron

Chat-scoped scheduled triggers.
Cron is an internal runtime trigger path.
It is not a message endpoint provider.

## Storage

```text
<workspace>/.phi/
├─ config.yaml
└─ cron/
   └─ jobs/
      ├─ daily-summary.md
      └─ weekly-review.md
```

## Config

Cron lives in workspace config.

```yaml
chat:
  timezone: Asia/Shanghai

cron:
  enabled: true
  destination: telegram
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

- `destination` selects the outbound message endpoint for cron runs
- `destination` must match a message route key configured for the chat, such as `telegram` or `feishu`
- agents should default `destination` to the current interactive message source endpoint when creating cron config
- `prompt` is relative to `<workspace>/.phi/cron/`
- prompt files should describe what to do when the job fires now, not setup text such as "task created" or "reminder enabled"
- exactly one of `cron` or `at` must be set
- `cron` uses chat timezone
- `at` uses local wall-clock time (`YYYY-MM-DD HH:mm`)
- invalid config or missing prompt files are errors

## Flow

1. load cron config from `.phi/config.yaml`
2. load the prompt file
3. emit a trigger for the target chat
4. run the chat turn
5. deliver outbound messages to `cron.destination`
6. recompute next run

Cron runs are isolated from the main interactive session context.
They still target the same chat identity.

## Reload

`reload` validates cron config and prompt files first. Invalid cron config or prompt files make validation fail for that chat.

## Failure

Fail fast.
Do not hide errors.
