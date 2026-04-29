---
name: session-start
trigger: At the start of every Claude Code session
---

## Purpose

Loads persisted session state and project context at the start of every Claude Code session so the agent has accurate, grounded knowledge of this polyglot microservices repository before taking any action.

## Actions

1. Read `agent-context.json` to restore current session state, including any in-progress task context, prior decisions, and known service boundaries across the five runtimes (Java/Spring Boot order-service, Python/FastAPI inventory-service, Go driver-service, TypeScript/Node notification-service, React/Vite frontend).
2. Read `memory/schema.md` to confirm the session state contract and verify that the in-memory structure expected by the agent matches the persisted schema before proceeding.
3. Surface the following critical pitfalls into active context so they constrain every tool call this session:
   - `docker-compose.yml` and `.env.example` are restricted write paths — do not modify them.
   - Order status transitions are strictly validated in `OrderStatus.isValidTransition`; any new status requires updating the switch expression and all consuming services.
   - The inventory service uses Redis distributed locks for stock reservation — stock-modifying code must acquire and release locks correctly.
   - RabbitMQ exchange/routing key conventions (`order.events`, `order.*`) are shared across order-service, inventory-service, and notification-service — changes must be synchronized.
   - The API Gateway forwards `X-Customer-Id` from JWT claims; downstream services trust this header implicitly — changes to the header name or JWT claim structure break auth across all services.
   - The frontend dev login view uses a hardcoded dev secret that must match the gateway's `JWT_SECRET` — mismatched secrets cause silent 401 errors.
   - Python inventory-service uses async SQLAlchemy (asyncpg driver) — all database operations must use async/await patterns.
   - The Go driver-service `DriverStore` interface requires new database operations to be added to both the interface and `mongoDriverStore` implementation plus `mockStore` in tests.
   - The notification service's in-memory idempotency Set resets on restart — duplicate notifications can occur after restarts.
   - The frontend uses `@tanstack/react-query` with specific query keys — cache invalidation depends on matching these keys exactly.

## Context loaded

- **agent-context.json**: Current session state including task progress, prior decisions, and service-level notes.
- **memory/schema.md**: The authoritative contract for session state structure, used to validate that loaded context conforms to the expected schema before the agent begins work.

## Skipped when

- `AGENT_SKIP_HOOKS=true` environment variable is set.
- Neither `agent-context.json` nor `memory/schema.md` exists on disk (i.e., this is a first-time initialisation with no prior state to load).