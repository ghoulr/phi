# Cron

## Goal

Cron lets a chat run background tasks at specific times.

Cron is chat-scoped.
Each chat owns its own schedule, timezone, prompt files, and run history.

## Storage

Cron state lives under the chat workspace state root.

```text
<workspace>/
└─ .phi/
   └─ cron/
      ├─ jobs.yaml
      ├─ runs.jsonl
      └─ jobs/
         ├─ daily-summary.md
         └─ weekly-review.md
```

- `jobs.yaml` stores job metadata
- `jobs/*.md` stores the task prompt for each job
- `runs.jsonl` stores execution results

## Chat config

Timezone belongs to the chat, not to individual jobs.

Example:

```yaml
chats:
  alice:
    workspace: ~/phi/workspaces/alice
    agent: main
    timezone: Asia/Shanghai
```

One user's time should be interpreted consistently.

## Job format

Example:

```yaml
jobs:
  - id: daily-summary
    enabled: true
    prompt: jobs/daily-summary.md
    cron: "0 9 * * 1-5"

  - id: dentist-reminder
    enabled: true
    prompt: jobs/dentist-reminder.md
    at: "2026-03-08 09:00"
```

Rules:

- `id` must be unique within the chat
- `prompt` is relative to `<workspace>/.phi/cron/`
- exactly one of `cron` or `at` must be set
- missing prompt files are errors
- invalid job data is an error

## Prompt files

phi does not use inline payload objects for cron jobs.

Each job points to one Markdown file.
That file is the task definition given to the agent.

This keeps:

- scheduling metadata in YAML
- task content in Markdown

## Time rules

Cron supports two schedule fields:

- `cron`: recurring cron expression
- `at`: one-shot local datetime

Examples:

```yaml
cron: "0 9 * * *"
```

```yaml
at: "2026-03-08 09:00"
```

Rules:

- cron expressions use the chat timezone
- `at` uses chat-local wall-clock time
- `at` should use `YYYY-MM-DD HH:mm` or `YYYY-MM-DD HH:mm:ss`
- invalid time values are errors

## Execution model

When a job becomes due, phi:

1. loads the job from `jobs.yaml`
2. loads the prompt file
3. starts a fresh agent run for that job
4. runs the task in the chat workspace with the chat config
5. appends the final assistant result to the current chat session
6. appends the result to `runs.jsonl`
7. recomputes the next run

Different chats may run concurrently.

Cron execution does not reuse the main session context.
This keeps recurring jobs and one-shot jobs from polluting the main conversation context.

Publishing the final result back to the chat still goes through `ChatExecutor`.
This keeps chat history mutation serialized even though cron execution itself is isolated.

## Failure strategy

Cron follows the normal phi rules:

- fail fast
- do not hide errors
- do not silently fail
- notify the user when a failure affects user-visible behavior

Reload keeps the previous valid cron state when the new state is invalid.
