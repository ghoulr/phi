# Routes

Routes belong to the service runtime.

```text
Message endpoints  ◄────►  Routes  ◄────►  Chat handlers  ◄────►  Agent(pi)
Internal triggers  ─────►
```

## What it is

Routes are config-driven wiring.
They dispatch interactive messages and internal triggers to chat handlers.
They also deliver outbound messages to configured message endpoints.
Each turn carries exactly one outbound destination.
They do not interpret message meaning.

Route availability comes from config, not from incidental runtime order.

## Chat relation

A service chat is the config-bound composition of routes, chat handlers, workspace state, and one agent-facing identity.
