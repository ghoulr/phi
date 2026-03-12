# `pi-web`

Web tools for `pi`.

## Tools

- `websearch`: find relevant pages with URLs, summaries, and highlights
- `webfetch`: fetch a URL and return readable content; binary files are saved to a temp path

## Environment

- `EXA_MCP_URL`
- `EXA_API_KEY`

## Verification

- Default tests skip the live Exa MCP check
- Run `EXA_LIVE_TEST=1 bun test --cwd packages/pi-web tests/websearch.test.ts` to verify the hosted MCP path end to end
