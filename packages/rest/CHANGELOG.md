# @mcp-layer/rest

## 1.2.0

### Minor Changes

- 9391cb2: Add auth-aware session manager support to enable true-proxy REST routing with per-request MCP sessions, plus new manager package and auth error responses.

### Patch Changes

- Updated dependencies [9391cb2]
  - @mcp-layer/error@0.2.0
  - @mcp-layer/openapi@1.1.1
  - @mcp-layer/schema@1.0.2

## 1.1.0

### Minor Changes

- 40732ae: Add OpenAPI generator and Fastify REST plugin packages.

### Patch Changes

- e5433ae: Propagate circuit breaker timeouts to MCP client requests to avoid lingering timers after breaker failures.
- Updated dependencies [40732ae]
- Updated dependencies [d1bbcd0]
  - @mcp-layer/openapi@1.1.0
  - @mcp-layer/schema@1.0.1
