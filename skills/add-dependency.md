---
name: add-dependency
description: Add a new dependency to the project.
---

## When to use this skill

Use this skill when you need to add a new library or package to one or more services in this multi-language monorepo (Java/Spring, Python/FastAPI, Go, TypeScript/Node, or React frontend).

## Steps

1. **Identify which service requires the dependency** — this repo contains multiple services, each with its own language and package manager. Determine which service directory is the target before proceeding:
   - `order-service/` — Java/Spring Boot, managed via Maven (`pom.xml`)
   - `inventory-service/` — Python/FastAPI, managed via pip (check `requirements.txt` or `pyproject.toml`)
   - `driver-service/` — Go, managed via Go modules (`go.mod`)
   - `notification-service/` — TypeScript/Node, managed via npm (`package.json`)
   - `frontend/` — React/Vite/TypeScript, managed via npm (`package.json`)

2. **Add the dependency using the correct idiom for the target service:**
   - **Java (order-service):** Add a `<dependency>` block to `order-service/pom.xml` under `<dependencies>`.
   - **Python (inventory-service):** Add the package to the appropriate requirements file (e.g. `requirements.txt`) and run `pip install -r requirements.txt` inside the service directory. All database operations must use async/await patterns (asyncpg driver is in use).
   - **Go (driver-service):** Run `go get <module-path>` from within `driver-service/`, then `go mod tidy`. If the new dependency requires a new `DriverStore` method, add it to both the interface and the `mongoDriverStore` implementation, and update `mockStore` in tests.
   - **TypeScript/Node (notification-service or frontend):** Run `npm install <package>` from within the relevant directory (`notification-service/` or `frontend/`).

3. **Verify the dependency is correctly recorded** — confirm the package appears in the relevant manifest (`pom.xml`, `requirements.txt`, `go.mod`/`go.sum`, or `package.json`/`package-lock.json`).

4. **Run the test suite for the affected service to confirm nothing is broken:**
   - inventory-service: `cd inventory-service && pytest --tb=short -q`
   - order-service: `cd order-service && mvn -B verify`
   - driver-service: `cd driver-service && go test ./...`
   - notification-service: `cd notification-service && npx jest`

5. **Rebuild the Docker images to confirm the new dependency is installable in the container environment:**
   ```
   docker-compose build
   ```

## Expected output

- The dependency manifest for the target service is updated with the new package entry.
- All tests for the affected service pass without errors.
- `docker-compose build` completes successfully with no build errors related to the new dependency.

## Common failures

- **Wrong package manager used for service:** Each service has a different build system. Using `npm install` in `order-service/` or `pip install` in `notification-service/` will have no effect and may silently fail. Always operate from within the correct service directory using its designated tool.
- **Java Lombok compilation failure:** The `order-service` uses Lombok annotations (`@Getter`, `@Setter`, `@Builder`). If the new dependency conflicts with or requires annotation processing configuration, the Maven build will fail. Ensure Lombok is correctly configured in `pom.xml` and your build environment supports it.
- **Go interface not updated:** If a new Go dependency introduces or requires new data access patterns in `driver-service`, the `DriverStore` interface, `mongoDriverStore` implementation, and `mockStore` in tests must all be updated or the build will fail with interface satisfaction errors.
- **Python async violation:** The `inventory-service` uses async SQLAlchemy with the `asyncpg` driver. If the new Python dependency introduces synchronous database calls, it will cause runtime errors. All database operations must use `async/await`.
- **Docker build does not reflect new dependency:** If the service's `Dockerfile` copies dependency manifests and installs them