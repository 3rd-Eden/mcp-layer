# @mcp-layer/gateway

## 0.2.0

### Minor Changes

- 9a08418: Add a shared `@mcp-layer/gateway` runtime package and a new `@mcp-layer/graphql` adapter package.

  REST now consumes gateway runtime primitives for option normalization, catalog bootstrap, validation, resilience, and telemetry so adapter logic is shared instead of duplicated.

  The root `mcp-layer` package now exports both `gateway` and `graphql` namespaces.

## 0.1.0

### Minor Changes

- Added shared adapter runtime primitives for session resolution, catalog bootstrap, validation, resilience, telemetry, and deterministic catalog mapping.
