# phi monorepo

Monorepo for `phi` and future installable pi extensions.

## Layout

```text
packages/
├─ phi/           # main phi application
└─ pi-*/          # installable pi extension packages
```

## Commands

- `bun run tui` — run `phi` TUI from `packages/phi` with `bun run --cwd`
- `bun run dev:service` — run `phi` service in development from `packages/phi`
- `bun run check` — run workspace checks
- `bun run test:agent` — run `packages/phi` agent tests

## Application Docs

- app package: `packages/phi`
- app README: `packages/phi/README.md`
- app architecture: `packages/phi/ARCHITECT.md`

## Pi Package

The repository root is a pi package root.
Future installable extensions live under `packages/pi-*` and are exposed through the root `pi` manifest.
Built-in `phi` extensions stay inside `packages/phi` and are not installed through `phi pi install`.
