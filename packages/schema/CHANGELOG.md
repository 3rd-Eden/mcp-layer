# @mcp-layer/schema

## 1.0.4

### Patch Changes

- 6d94f04: Add `composeCatalog()` support for precomputed MCP catalogs and let gateway-backed adapters bootstrap manager mode from catalog metadata when no eager session exists.

  This release also hardens the catalog bootstrap path by distrusting catalog-only schemas by default, preferring live bootstrap session metadata when available, and validating invalid catalog inputs before manager bootstrap checks.

## 1.0.3

### Patch Changes

- 35172f0: Add generated TypeScript declaration exports for every package and verify them in the workspace test suite.
- Updated dependencies [35172f0]
  - @mcp-layer/error@0.2.1

## 1.0.2

### Patch Changes

- Updated dependencies [9391cb2]
  - @mcp-layer/error@0.2.0

## 1.0.1

### Patch Changes

- d1bbcd0: Add support for attaching to Platformatic MCP Fastify instances via Fastify inject transport.

## 1.0.0

### Major Changes

- Release 1.0.0 for all published packages.
