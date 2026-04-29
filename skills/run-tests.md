---
name: run-tests
description: Run the full test suite with project-configured settings.
---

## When to use this skill

Use this skill whenever you need to verify that all services pass their tests after making changes to any part of the codebase.

## Steps

1. Run the order-service tests (Java/JUnit 5):
   ```bash
   cd order-service && mvn -B verify
   ```

2. Run the inventory-service tests (Python/pytest):
   ```bash
   cd ../inventory-service && pytest --tb=short -q
   ```

3. Run the driver-service tests (Go):
   ```bash
   cd ../driver-service && go test ./...
   ```

4. Run the notification-service tests (TypeScript/Jest):
   ```bash
   cd ../notification-service && npx jest
   ```

5. Confirm all four suites exit with code `0` and report no failures.

## Expected output

A successful run produces passing output from all four test suites:

- **order-service**: Maven prints `BUILD SUCCESS` and reports test counts with zero failures or errors.
- **inventory-service**: pytest prints a summary line such as `N passed` with no failures; short tracebacks appear only when a test fails.
- **driver-service**: `go test ./...` prints `ok` followed by each tested package path with no `FAIL` lines.
- **notification-service**: Jest prints a summary showing test suites and tests with all results as `PASS`.

## Common failures

- **`mvn -B verify` fails to compile**: The order-service uses Lombok annotations (`@Getter`, `@Setter`, `@Builder`). Ensure Lombok is configured in your Maven toolchain; missing annotation processing causes compilation failure before any test runs.

- **`pytest` fails with import or database errors**: The inventory-service uses async SQLAlchemy with the `asyncpg` driver. All database operations must use `async/await`. A synchronous call to an async function will raise a coroutine error. Also confirm that any required environment variables (database URL, Redis URL) are set — secrets are present in this repository and a `.env.example` file exists as a reference.

- **`go test ./...` reports a missing interface method**: The driver-service uses a `DriverStore` interface for testability. If you added a new database operation to `mongoDriverStore` without adding the same method signature to both the interface and the `mockStore` used in tests, compilation will fail.

- **`npx jest` reports unexpected failures after a service restart**: The notification-service uses an in-memory idempotency set that resets on restart. Duplicate-message test scenarios may behave differently after the process is restarted mid-test run.

- **RabbitMQ or Redis unavailable**: Several services depend on RabbitMQ (order, inventory, notification) and Redis (inventory distributed locks). If the test environment does not have these running, integration-level tests will fail with connection errors. Start the full stack with `docker-compose up` if needed before running service-level tests that require infrastructure.

- **Order status transition test failures**: `OrderStatus.isValidTransition` enforces strict transitions via a switch expression. If a test introduces a new status without updating the switch expression and all consuming services, both compilation and transition-assertion tests will fail.