## Project

Project `phi` is a `openclaw` like agent running behind IMs

## Law of agentic

- NEVER EVER `git checkout` or `git reset` anything, if you feel it's absolutely nessacery, ask me to do that
- For better international DX, use English in all documents

## Using Bun instead of Node.js

- use `bun <file>/test/run` instead of `node ...`
- read `node_modules/bun-types/docs/**.md[x]` for bun API before use any node API

## Architecture

- extend `pi-coding-agent` for full capabilities

## Design and coding

- let errors propagate instead of swallowing them, follow the `fast fail` principle, let callers to deal with the error
- we must NEVER have type any anywhere, unless absolutely, positively necessary
- if you are working with an external API, check node_modules for the type definitions as needed instead of assuming things
- always run `bun check` after changing the codes, never change any lint rules, if you feel absolutely necessary, ask me to add/change the rules for you
- use alias to import, like `import @agent/tools.ts`, unless in same folder: `import ./tools.ts`

## Test

- run `bun test:agent` for unit tests
- test file for `src/foo/bar.ts` must be at `tests/foo/bar.test.ts` (mirror the source path)

## Run

- NEVER run `bun dev` by yourself, inform me to run all these long-running tasks
