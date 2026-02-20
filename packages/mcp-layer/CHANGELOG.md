# mcp-layer

## 0.2.1

### Patch Changes

- Updated dependencies [842299b]
  - @mcp-layer/connect@1.1.1
  - @mcp-layer/cli@1.2.1
  - @mcp-layer/rest@1.2.1
  - @mcp-layer/schema@1.0.2

## 0.2.0

### Minor Changes

- 9a08418: Add a shared `@mcp-layer/gateway` runtime package and a new `@mcp-layer/graphql` adapter package.

  REST now consumes gateway runtime primitives for option normalization, catalog bootstrap, validation, resilience, and telemetry so adapter logic is shared instead of duplicated.

  The root `mcp-layer` package now exports both `gateway` and `graphql` namespaces.

### Patch Changes

- Updated dependencies [9a08418]
  - @mcp-layer/gateway@0.2.0
  - @mcp-layer/graphql@0.2.0
  - @mcp-layer/rest@1.2.1

## 0.1.1

### Patch Changes

- Updated dependencies [9391cb2]
- Updated dependencies [9391cb2]
  - @mcp-layer/error@0.2.0
  - @mcp-layer/manager@0.2.0
  - @mcp-layer/rest@1.2.0
  - @mcp-layer/attach@1.1.1
  - @mcp-layer/cli@1.1.1
  - @mcp-layer/config@1.0.1
  - @mcp-layer/connect@1.0.1
  - @mcp-layer/openapi@1.1.1
  - @mcp-layer/schema@1.0.2
  - @mcp-layer/test-server@1.0.1

## 0.1.0

### Minor Changes

- 40732ae: Add OpenAPI generator and Fastify REST plugin packages.

### Patch Changes

- 1154f5b: Expose all workspace packages from the root `mcp-layer` entrypoint.
- Updated dependencies [40732ae]
- Updated dependencies [05c43ca]
- Updated dependencies [e5433ae]
- Updated dependencies [d1bbcd0]
  - @mcp-layer/openapi@1.1.0
  - @mcp-layer/rest@1.1.0
  - @mcp-layer/cli@1.1.0
  - @mcp-layer/attach@1.1.0
  - @mcp-layer/schema@1.0.1
