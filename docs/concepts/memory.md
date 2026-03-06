# Memory

## Status

This is a design note for phi memory.

## Goal

Keep memory simple and file-based.

We want two layers:

- small always-on memory
- cheap daily notes

## Layout

```text
<chat-workspace>/.phi/
└─ memory/
   ├─ MEMORY.md
   └─ YYYY-MM-DD.md
```

## Rules

### `MEMORY.md`

Use for short, high-value facts that should be visible on every turn.

Examples:

- stable user preferences
- assistant behavior rules
- important project invariants
- durable decisions

Keep it short.

### `YYYY-MM-DD.md`

Use for daily working notes.

Examples:

- temporary observations
- recent decisions
- session notes
- raw facts waiting to be distilled

Rules:

- append-oriented
- not auto-injected
- may be messy
- later distill useful content into `MEMORY.md`

## Runtime Rules

1. Inject `MEMORY.md` into the system prompt.
2. Do not inject `YYYY-MM-DD.md` automatically.
3. Write short durable facts to `MEMORY.md`.
4. Keep `MEMORY.md` small and concise; rewrite it when needed.
5. Write raw notes to `YYYY-MM-DD.md`.
6. If the user explicitly says to remember something, write it to `MEMORY.md`.
7. Daily notes should be found with grep/read on demand, not assumed to be in context.

## Update Timing

phi runs memory maintenance before:

- session switch
- compaction

The maintenance runs as a transient invisible turn.

That turn may update memory files, but the turn itself is dropped from the main session history.

## Why This Shape

- simpler than adding topic files
- close to openclaw
- no embeddings or indexes needed for now
- easy to read and edit manually

## Decision

phi memory is:

- Markdown-based
- file-backed
- explicit
- simple

In short:

- `MEMORY.md` = small always-on memory
- `YYYY-MM-DD.md` = daily notes
