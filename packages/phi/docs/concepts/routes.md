# Routes

Routes belong to the service runtime.

```text
Endpoints  ◄────►  Routes  ◄────►  Chat handlers  ◄────►  Agent(pi)
```

## What it is

Routes are config-driven wiring.
They dispatch messages and triggers between endpoints and chat handlers.
They forward to the module configured on the other side.
They do not interpret what a message means.

Route availability comes from config, not from incidental runtime order.

An endpoint may be source-only, sink-only, or bidirectional.

## Chat relation

A service chat is the config-bound composition of endpoints, routes, and chat handlers around one agent-facing identity.
