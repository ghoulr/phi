# Endpoint

An endpoint is a messaging transport that connects phi to an external platform such as Telegram or Feishu.

Keep endpoints thin.
Routing, session state, and agent execution belong elsewhere.

```text
Platform  ◄────►  Endpoint provider  ◄────►  Routes  ◄────►  Session  ◄────►  Agent(pi)
```

## Scope

An endpoint owns:
- connection lifecycle
- inbound parsing
- outbound formatting and delivery

## Relation

Endpoints register inbound and outbound bindings into routes.
Routes resolve which session receives inbound events.
Replies go back through the outbound delivery bound to that session.

## Config relation

Service config declares which endpoint bindings exist.
The runtime creates providers and registers them into routes.
