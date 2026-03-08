# TODO

## IM behavior parity

- [ ] Support richer message formatting across channels.
  - Define a channel-agnostic formatting model first (plain text, markdown, code block, mentions, links).
  - Add per-channel renderers (Telegram first), with explicit fallback rules when a format is unsupported.

- [ ] Introduce a command-routing abstraction for IM commands.
  - Stop hardcoded command interception behavior in channel adapters.
  - Add a command policy layer to decide, per channel and per command:
    - handled by channel adapter
    - handled by phi service layer
    - forwarded to pi as normal user input

- [ ] Revisit multi-session/thread semantics per chat.
  - Keep current "one chat => continue recent session" behavior for now.
  - Re-evaluate when business scenarios require explicit thread/session branching.

- [ ] ask agent to respond in correct rich text format for specific channel
