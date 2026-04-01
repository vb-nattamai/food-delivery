# 🍕 Food Delivery Platform

A **polyglot microservices** platform for food delivery, built with 5 independent services across different technology stacks.

## Architecture

```
                          ┌─────────────────┐
                          │   API Gateway   │
                          │ Kotlin + Spring │
                          │  Cloud Gateway  │
                          └────────┬────────┘
                                   │ JWT Auth
           ┌───────────────────────┼───────────────────────┐
           │                       │                       │
  ┌────────▼────────┐   ┌──────────▼──────┐   ┌──────────▼──────┐
  │  Order Service  │   │Inventory Service│   │  Driver Service │
  │ Java 21 +       │   │ Python 3.11 +   │   │  Go 1.21 +      │
  │ Spring Boot     │   │ FastAPI         │   │  MongoDB        │
  └────────┬────────┘   └─────────────────┘   └─────────────────┘
           │ RabbitMQ events
  ┌────────▼────────┐
  │Notification Svc │
  │ Node.js + TS    │
  │ Twilio/SendGrid │
  └─────────────────┘
```

## Services

| Service | Language | Framework | Database | Port |
|---------|----------|-----------|----------|------|
| **API Gateway** | Kotlin | Spring Cloud Gateway | — | 8080 |
| **Order Service** | Java 21 | Spring Boot 3 | PostgreSQL | 8081 |
| **Inventory Service** | Python 3.11 | FastAPI | PostgreSQL + Redis | 8082 |
| **Driver Service** | Go 1.21 | net/http | MongoDB | 8083 |
| **Notification Service** | Node.js 20 | TypeScript | — | 8084 |

## Infrastructure

- **PostgreSQL** — orders, inventory
- **Redis** — distributed locks, caching
- **MongoDB** — driver locations & profiles
- **RabbitMQ** — async event bus for order lifecycle events

## Getting Started

### Prerequisites

- Docker & Docker Compose
- Copy `.env.example` to `.env` and fill in secrets

```bash
cp .env.example .env
docker-compose up --build
```

### API

See [`openapi.yaml`](openapi.yaml) for the full REST API specification.

- Gateway: http://localhost:8080
- Order Service: http://localhost:8081
- Inventory Service: http://localhost:8082
- Driver Service: http://localhost:8083
- Notification Service: http://localhost:8084
- RabbitMQ Management: http://localhost:15672

## Order Lifecycle

```
PENDING → ACCEPTED → PREPARING → READY_FOR_PICKUP → IN_TRANSIT → DELIVERED
                                                                ↓
                                                           CANCELLED / REFUNDED
```

## CI/CD

GitHub Actions CI runs for all 5 services on every push and pull request. See [`.github/workflows/ci.yml`](.github/workflows/ci.yml).
