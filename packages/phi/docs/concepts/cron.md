# Cron

Cron is a chat-scoped runtime feature.

## Scope

- cron belongs to the service runtime
- cron runs inside one chat workspace
- each job targets one session
- each job stores one explicit outbound `endpointChatId`
- scheduler and cron tools are part of the same feature

## Storage

```text
<workspace>/.phi/
├─ config.yaml
└─ cron/
   ├─ cron.yaml
   └─ jobs/
      ├─ daily-summary.md
      └─ weekly-review.md
```

`cron.yaml` stores job metadata.
Each job stores:
- `id`
- `enabled`
- `sessionId`
- `endpointChatId`
- `prompt`
- exactly one schedule: `cron` or `at`

Prompt text lives in `cron/jobs/*.md`.

## Runtime relation

- the scheduler loads workspace timezone from `.phi/config.yaml`
- the scheduler loads jobs from `.phi/cron/cron.yaml`
- the scheduler loads the prompt file for each job
- due jobs dispatch through `routes.dispatchCron(sessionId, ...)`
- outbound delivery uses the job's stored `endpointChatId`

## Tools relation

Cron tools manage job files in the workspace.
After changes, they reload the chat cron controller so the scheduler picks up the new state.
