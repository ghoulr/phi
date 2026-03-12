# ARCHITECT: phi monorepo

## Layout

```text
packages/
├─ phi/           # main application package
└─ pi-*/          # installable pi extension packages
```

## Packaging

- repo root — Bun workspace root, private npm package, pi package root
- `packages/phi` — phi runtime, built-in extensions, tests, docs
- `packages/pi-*` — self-contained pi extension packages for `phi pi install`

## Rules

- built-in extensions stay inside `packages/phi`
- installable extensions must not depend on `packages/phi`
- shared logic for installable extensions must be extracted into separate packages when needed
- repo root `pi` manifest only exposes `packages/pi-*`
