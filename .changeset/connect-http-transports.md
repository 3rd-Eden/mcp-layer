---
"@mcp-layer/connect": major
"@mcp-layer/cli": minor
"@mcp-layer/test-server": patch
---

Add first-class transport support in `@mcp-layer/connect` for `stdio`, `streamable-http`, and `sse` sessions.

The connect layer now chooses transport from runtime options and host config shape (`type`, `command`, `url`, `endpoint`) and can connect to URL-based MCP endpoints over localhost/network, not just spawned stdio servers.

Breaking change: config-level `transport` steering is removed from `@mcp-layer/connect` to avoid relying on non-standard shared config keys. Use runtime `options.transport` instead.

`@mcp-layer/cli` now supports `--transport` as a runtime override so legacy SSE endpoints can be selected without storing non-standard keys in shared MCP config files.

Update the test server HTTP transport implementation and CLI HTTP entrypoint so integration suites can reliably launch streamable HTTP and SSE endpoints on explicit ports.
