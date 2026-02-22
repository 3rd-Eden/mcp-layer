# @mcp-layer/cli

## 1.3.0

### Minor Changes

- 11f686b: Add connection timeouts to avoid hanging CLI sessions and update the test server to use stateful Streamable HTTP sessions.

### Patch Changes

- Updated dependencies [77e8932]
- Updated dependencies [11f686b]
  - @mcp-layer/connect@1.2.0
  - @mcp-layer/schema@1.0.2

## 1.2.1

### Patch Changes

- Updated dependencies [842299b]
  - @mcp-layer/connect@1.1.1
  - @mcp-layer/schema@1.0.2

## 1.2.0

### Minor Changes

- 234ce1b: Add first-class transport support in `@mcp-layer/connect` for `stdio`, `streamable-http`, and `sse` sessions.

  The connect layer now chooses transport from runtime options and host config shape (`type`, `command`, `url`, `endpoint`) and can connect to URL-based MCP endpoints over localhost/network, not just spawned stdio servers.

  `@mcp-layer/cli` now supports `--transport` as a runtime override so legacy SSE endpoints can be selected without storing non-standard keys in shared MCP config files.

  Update the test server HTTP transport implementation and CLI HTTP entrypoint so integration suites can reliably launch streamable HTTP and SSE endpoints on explicit ports.

### Patch Changes

- Updated dependencies [234ce1b]
  - @mcp-layer/connect@1.1.0
  - @mcp-layer/schema@1.0.2

## 1.1.1

### Patch Changes

- Updated dependencies [9391cb2]
  - @mcp-layer/error@0.2.0
  - @mcp-layer/config@1.0.1
  - @mcp-layer/connect@1.0.1
  - @mcp-layer/schema@1.0.2

## 1.1.0

### Minor Changes

- 05c43ca: Improve CLI help rendering, custom command helpers, raw resource output, and documentation.

### Patch Changes

- Updated dependencies [d1bbcd0]
  - @mcp-layer/schema@1.0.1

## 1.0.0

### Major Changes

- Release 1.0.0 for all published packages.

### Patch Changes

- Updated dependencies
  - @mcp-layer/config@1.0.0
  - @mcp-layer/connect@1.0.0
  - @mcp-layer/schema@1.0.0
