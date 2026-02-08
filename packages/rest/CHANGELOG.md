# @mcp-layer/rest

## 1.2.1

### Patch Changes

- 9a08418: Add a shared `@mcp-layer/gateway` runtime package and a new `@mcp-layer/graphql` adapter package.

  REST now consumes gateway runtime primitives for option normalization, catalog bootstrap, validation, resilience, and telemetry so adapter logic is shared instead of duplicated.

  The root `mcp-layer` package now exports both `gateway` and `graphql` namespaces.

- Updated dependencies [9a08418]
  - @mcp-layer/gateway@0.2.0

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
