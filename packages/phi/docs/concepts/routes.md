# Routes

Routes belong to the service runtime.
They are the routing table between external inputs, sessions, and outbound deliveries.

```text
Message endpoints  ─┐
Cron triggers      ─┼──► Routes ───► Session
Outbound delivery  ◄─┘
```

## What it does

Routes map:
- inbound endpoint route to session
- inbound cron trigger to session
- session to outbound delivery

Routes do not own session history.
Routes do not interpret message meaning.

## Runtime relation

The runtime owns routes and updates them when chats, sessions, endpoints, and cron bindings are created or removed.

## Reply flow

The normal reply path is route-local.
A turn replies through the route bound to its session.
