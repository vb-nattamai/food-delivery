---
name: run-ci
description: Trigger or simulate the CI pipeline.
---

## When to use this skill

Use this skill when you need to validate all services pass their tests locally before pushing changes or reviewing a pull request.

## Steps

1. Run the order-service tests:
   ```
   cd order-service && mvn -B verify
   ```

2. Run the inventory-service tests:
   ```
   cd inventory-service && pytest --tb=short -q
   ```

3. Run the driver-service tests:
   ```
   cd driver-service && go test ./...
   ```

4. Run the notification-service tests:
   ```
   cd notification-service && npx jest
   ```

5. Build all service images to confirm Docker configuration is valid:
   ```
   docker-compose build
   ```

6. Validation: confirm each test suite exits with code `0` and no failure summaries are printed. Maven should report `BUILD SUCCESS`, pytest should report `passed` with no errors, Go testing should report `ok` for all packages, and Jest should report all test suites passing.

## Expected output

A successful run produces:
- `order-service`: Maven prints `BUILD SUCCESS` with all JUnit 5 tests passing under `order-service/src/test`.
- `inventory-service`: pytest prints a summary like `N passed` with no failures or errors, sourced from `inventory-service/tests`.
- `driver-service`: Go testing prints `ok` for each package under `driver-service/cmd/driver` with no `FAIL` lines.
- `notification-service`: Jest prints a summary showing all test suites and tests passed, sourced from `notification-service/src`.
- `docker-compose build`: All service images build without error.

## Common failures

- **Maven compilation fails with missing symbols (Lombok)**: The order-service uses Lombok annotations (`@Getter`, `@Setter`, `@Builder`). Ensure Lombok is configured in your IDE and that the Maven build includes the Lombok annotation processor. Run `mvn -B verify` again after confirming the dependency is present.

- **pytest fails with database or async errors**: The inventory-service uses async SQLAlchemy with the asyncpg driver. All database operations must use `async/await` patterns. Synchronous SQLAlchemy API calls will cause failures. Check that the test environment has the correct database URL configured.

- **Go tests fail due to missing interface implementation**: The driver-service uses a `DriverStore` interface for testability. If new database operations were added to `mongoDriverStore` without updating the interface and the `mockStore` in tests, compilation and tests will fail. Add missing methods to both.

- **Jest tests fail in notification-service after restart**: The notification service uses an in-memory idempotency `Set` that resets on restart. Duplicate notification events may cause unexpected test state if tests assume prior idempotency state is preserved across runs. Ensure tests do not depend on cross-run state.

- **RabbitMQ or Redis not available locally**: The inventory-service uses Redis distributed locks and services communicate via RabbitMQ with the `order.events` / `order.*` conventions. Integration tests that require these dependencies will fail if the backing services are not running. Start dependencies via `docker-compose up` before running integration-level tests.

- **Order status transition test failures**: Status transitions are strictly validated in `OrderStatus.isValidTransition`. If new statuses were added without updating the switch expression and all consuming services, tests will fail. Verify the switch expression covers all new states.