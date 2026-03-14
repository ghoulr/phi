# Cron

Cron is an internal trigger path.
It targets a session inside a chat.

## Scope

- cron belongs to the service runtime
- cron is not a message endpoint
- cron runs inside chat workspace scope
- cron triggers one target session

## Relation

Cron bindings live in routes.
The scheduler only fires the configured binding.
The target session and outbound delivery are resolved through routes.

## Storage

```text
<workspace>/.phi/
├─ config.yaml
└─ cron/
   └─ jobs/
      ├─ daily-summary.md
      └─ weekly-review.md
```

## Flow

1. load cron config from `.phi/config.yaml`
2. load the prompt file
3. resolve the target session through routes
4. run the session turn
5. deliver through the session's bound outbound route
6. recompute next run
