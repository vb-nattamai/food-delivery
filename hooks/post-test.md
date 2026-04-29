---
name: post-test
trigger: After running the test command
---

## Purpose

After the multi-service test suite completes, this hook updates agent-context.json with the latest test results and surfaces any service-specific failures so the agent can act on them without re-running the full suite.

## Actions

1. Parse the exit codes and output from each test stage in the composite test command (`cd order-service && mvn -B verify && cd ../inventory-service && pytest --tb=short -q && cd ../driver-service && go test ./... && cd ../notification-service && npx jest`) and record per-service pass/fail status in agent-context.json under a `test_results` key.
2. Load the current session state from agent-context.json and memory/schema.md, then append a structured summary entry noting which of the four services (order-service, inventory-service, driver-service, notification-service) failed, the failing test directories (`order-service/src/test`, `inventory-service/tests`, `driver-service/cmd/driver`, `notification-service/src`), and any short error messages captured from stdout, so the agent's next action targets only the affected service rather than the entire stack.

## Context loaded

- agent-context.json: current agent state, session metadata, and the `test_results` map written by this hook
- memory/schema.md: session state contract used to validate the structure of the updated agent-context.json before writing

## Skipped when

- `AGENT_SKIP_HOOKS=true` environment variable is set
- All four service test stages exited with code 0 and agent-context.json already reflects a passing state with no stale failure entries from a previous run
- The test command was not fully invoked (e.g. the agent ran only a subset such as a single service's test in isolation rather than the full composite command)