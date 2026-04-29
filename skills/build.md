---
name: build
description: Build the project artifacts.
---

## When to use this skill

Use this skill when you need to build all service container images for the project.

## Steps

1. Ensure Docker and Docker Compose are installed and the Docker daemon is running.
2. Run the build command: `docker-compose build`
3. Confirm each service image was built successfully by checking that Docker reports no errors and all images appear in the output.

## Expected output

A successful run produces output from Docker Compose showing each service being built in sequence (e.g., `order-service`, `inventory-service`, `driver-service`, `notification-service`, `frontend`). Each service step should complete with a `Successfully built` or equivalent layer-caching message, and the command exits with code `0`.

## Common failures

- **Missing or mismatched `.env` values**: The project has secrets present (verified from `.env` or `.env.example`). If a service fails to build due to missing environment variables, check that all required values are populated. Do not commit secrets — refer to `.env.example` for required keys.
- **Lombok compilation failure in `order-service`**: The `order-service` uses Lombok annotations (`@Getter`, `@Setter`, `@Builder`). If the Java build inside the container fails with annotation-processing errors, ensure the Maven build in the `order-service` Dockerfile has Lombok on the classpath and annotation processing enabled.
- **Async SQLAlchemy misconfiguration in `inventory-service`**: The `inventory-service` uses async SQLAlchemy with the `asyncpg` driver. If the Python build fails at dependency installation or startup validation, confirm that `asyncpg` is listed in the service's dependencies and that no synchronous SQLAlchemy APIs have been introduced.
- **Docker daemon not running**: If `docker-compose build` exits immediately with a connection error, start the Docker daemon before retrying.
- **`docker-compose.yml` not found or altered**: `docker-compose.yml` is a restricted write path. If the file has been inadvertently modified, restore it from version control before building.