---
name: pre-tool-call
trigger: Before any tool call that writes files
---

## Purpose

Guard against writes to restricted files and surface critical multi-service pitfalls before any file is modified in this polyglot (Java/Spring, Python/FastAPI, Go, TypeScript/Node) repository.

## Actions

1. **Block writes to restricted paths.** Reject any tool call whose target path matches `docker-compose.yml` or `.env.example`. These files are restricted and must not be modified by the agent.
2. **Load agent context and schema.** Read `agent-context.json` to retrieve current session state, and read `memory/schema.md` to confirm the session state contract is satisfied before the write proceeds.
3. **Emit pre-write warnings based on target path.** Before writing, surface the relevant pitfall(s) from the list below that correspond to the file being modified:
   - Writing to `order-service/`: Order status transitions are strictly validated in `OrderStatus.isValidTransition`; new statuses require updating the switch expression and all consuming services. Lombok annotations (`@Getter`, `@Setter`, `@Builder`) must be configured in the build or compilation will fail.
   - Writing to `inventory-service/`: All database operations must use async/await patterns (async SQLAlchemy with asyncpg driver); synchronous SQLAlchemy APIs must not be used. Any stock-modifying code must acquire and release Redis distributed locks correctly or risk deadlocks and overselling.
   - Writing to `driver-service/`: New database operations must be added to both the `DriverStore` interface and the `mongoDriverStore` implementation, plus the `mockStore` used in tests.
   - Writing to `notification-service/`: The in-memory idempotency Set resets on restart; duplicate notifications can occur after restarts.
   - Writing to any service that produces or consumes RabbitMQ events (`order-service/`, `inventory-service/`, `notification-service/`): exchange and routing key conventions (`order.events`, `order.*`) must be kept synchronized across all three services.
   - Writing to `frontend/`: The dev login view generates JWTs with a hardcoded dev secret that must match the gateway's `JWT_SECRET`; mismatched secrets cause silent 401 errors. React Query cache invalidation depends on matching query keys exactly when adding mutations.
   - Writing to any service that handles the `X-Customer-Id` header or JWT claim structure: downstream services trust this header implicitly; changes to the header name or claim structure break auth across all services.
   - Writing to any PostgreSQL schema file under `order-service/` or `inventory-service/`: PostgreSQL is shared between these two services; schema changes in one can affect the other if tables or columns overlap.

## Context loaded

- `agent-context.json`: Current session state, including any prior decisions about service boundaries, in-progress migrations, and restricted path overrides.
- `memory/schema.md`: Session state contract defining required fields and their expected types, used to validate that `agent-context.json` is well-formed before the write proceeds.

## Skipped when

- `AGENT_SKIP_HOOKS=true` environment variable is set.
- The tool call is a read-only operation (no file content is being created or modified).
- The target path is a tooling artifact (`agent-context.json`, `CLAUDE.md`, `AGENTS.md`, `AGENTIC_EVAL.md`, `cost_report.json