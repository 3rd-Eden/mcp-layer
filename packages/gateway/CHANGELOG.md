# @mcp-layer/gateway

## 0.2.4

### Patch Changes

- 8de95e8: Update runtime dependencies to patched releases. Replace the test-only package that included an unpatched dependency. Use the MCP SDK Streamable HTTP transport for Fastify endpoints.
  - @mcp-layer/schema@2.0.0

## 0.2.3

### Patch Changes

- Updated dependencies [d2e9171]
  - @mcp-layer/schema@2.0.0

## 0.2.2

### Patch Changes

- 6d94f04: Add `composeCatalog()` support for precomputed MCP catalogs and let gateway-backed adapters bootstrap manager mode from catalog metadata when no eager session exists.

  This release also hardens the catalog bootstrap path by distrusting catalog-only schemas by default, preferring live bootstrap session metadata when available, and validating invalid catalog inputs before manager bootstrap checks.

- Updated dependencies [6d94f04]
  - @mcp-layer/schema@1.0.4

## 0.2.1

### Patch Changes

- 35172f0: Add generated TypeScript declaration exports for every package and verify them in the workspace test suite.
- Updated dependencies [35172f0]
  - @mcp-layer/error@0.2.1
  - @mcp-layer/schema@1.0.3

## 0.2.0

### Minor Changes

- 9a08418: Add a shared `@mcp-layer/gateway` runtime package and a new `@mcp-layer/graphql` adapter package.

  REST now consumes gateway runtime primitives for option normalization, catalog bootstrap, validation, resilience, and telemetry so adapter logic is shared instead of duplicated.

  The root `mcp-layer` package now exports both `gateway` and `graphql` namespaces.

## 0.1.0

### Minor Changes

- Added shared adapter runtime primitives for session resolution, catalog bootstrap, validation, resilience, telemetry, and deterministic catalog mapping.
