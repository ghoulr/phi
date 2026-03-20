# Cron

Cron is an internal trigger path.
It targets a session inside a chat.

## Scope

- cron belongs to the service runtime
- cron is not a message endpoint
- cron runs inside chat workspace scope
- cron triggers one target session
- cron delivery binds to one explicit endpoint chat per job

## Relation

Cron bindings live in routes.
The scheduler only fires the configured binding.
The target session comes from the job config.
Outbound delivery uses the job's stored `endpointChatId`.

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
- id
- enabled flag
- session id
- endpoint chat id
- prompt file path
- one schedule (`cron` or `at`)

## Flow

1. load workspace timezone from `.phi/config.yaml`
2. load cron jobs from `.phi/cron/cron.yaml`
3. load the prompt file
4. dispatch the cron trigger to the configured session
5. deliver through the job's stored `endpointChatId`
6. recompute next run
