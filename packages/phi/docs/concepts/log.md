# Logging

Phi uses [Pino](https://github.com/pinojs/pino) and writes to stdio.

- Development → `pretty` (via `pino-pretty`)
- Production → `json`

Configure with `PHI_LOG_LEVEL` and `PHI_LOG_FORMAT`.

## API

```ts
const log = getPhiLogger("telegram");          // tag = "telegram"
log.info("telegram.message.received", { chatId, telegramMessageId });
log.child({ chatId }).info("telegram.turn.completed", { durationMs });
```

For one-off structured entries:

```ts
appendStructuredLogEntry({ tag: "cron", event: "cron.job.failed", err });
```

## Fields

| Field     | Description                    | Required |
| --------- | ------------------------------ | -------- |
| `tag`     | Subsystem name (noun, short)   | ✓        |
| `event`   | Machine-readable `tag.subj.state` | ✓     |
| `message` | Human-readable summary         | optional |

Add context fields as needed: `chatId`, `telegramChatId`, `telegramUpdateId`, `telegramMessageId`, `feishuChatId`, `feishuEventId`, `feishuMessageId`, `jobId`, `durationMs`, `err`.

For audit records, add `category: "audit"`.

## Event Naming

Pattern: **`<tag>.<subject>.<state>`**

```
service.command.started
runtime.session.created
telegram.message.received
cron.job.failed
```

Preferred state words: `starting` · `started` · `stopping` · `stopped` · `received` · `queued` · `completed` · `failed` · `skipped` · `reload_started` · `reload_completed` · `reload_failed`

Pick one word and stick with it — don't mix `done` / `finished` / `completed`.

## Levels

| Level   | Use for                        |
| ------- | ------------------------------ |
| `debug` | Internal details               |
| `info`  | Normal lifecycle events        |
| `warn`  | Unusual but recoverable        |
| `error` | Failed operations              |

## Rules

- Put queryable data in fields, not in `message`.
- Never log secrets or large payloads — prefer IDs, counts, lengths.
