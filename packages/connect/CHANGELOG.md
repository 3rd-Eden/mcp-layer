# @mcp-layer/connect

## 1.1.1

### Patch Changes

- 842299b: Fix stdio environment propagation so spawned servers inherit the caller shell environment (`process.env`) before applying `config.env` and runtime `options.env` overrides.

## 1.1.0

### Minor Changes

- 234ce1b: Add first-class transport support in `@mcp-layer/connect` for `stdio`, `streamable-http`, and `sse` sessions.

  The connect layer now chooses transport from runtime options and host config shape (`type`, `command`, `url`, `endpoint`) and can connect to URL-based MCP endpoints over localhost/network, not just spawned stdio servers.

  `@mcp-layer/cli` now supports `--transport` as a runtime override so legacy SSE endpoints can be selected without storing non-standard keys in shared MCP config files.

  Update the test server HTTP transport implementation and CLI HTTP entrypoint so integration suites can reliably launch streamable HTTP and SSE endpoints on explicit ports.

## 1.0.1

### Patch Changes

- Updated dependencies [9391cb2]
  - @mcp-layer/error@0.2.0

## 1.0.0

### Major Changes

- Release 1.0.0 for all published packages.

### Patch Changes

- Updated dependencies
  - @mcp-layer/session@1.0.0
