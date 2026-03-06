# Transient Turn

## Goal

A transient turn lets phi run one extra invisible agent turn without polluting the main session history.

## Behavior

A transient turn:

- reuses the current session context
- uses the same workspace
- can read and write real files
- is not kept in the main session history

Only file side effects remain in workspace state. Debug observability is stored separately through custom session entries when the caller chooses to do so.

## Current Use

phi uses transient turns for memory maintenance before:

- session switch
- compaction

## Why

This keeps housekeeping logic simple:

- no extra visible conversation
- no fake branch
- no transcript extraction logic
- one unified mechanism for pre-action maintenance
