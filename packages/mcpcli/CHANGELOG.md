# mcpcli

## 0.2.0

### Minor Changes

- 3342b07: Split CLI distribution into dedicated packages.

  `@mcp-layer/cli` is now API-only and no longer publishes the `mcp-layer` binary.

  Use `mcpcli` for executable installs. It now ships the standalone `mcpcli` command backed by `@mcp-layer/cli`.

### Patch Changes

- Updated dependencies [3342b07]
  - @mcp-layer/cli@2.0.0

## 0.1.0

### Minor Changes

- Introduce `mcpcli` as a dedicated standalone executable package for MCP server workflows.
