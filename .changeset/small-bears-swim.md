---
'@mcp-layer/cli': major
'mcpcli': minor
---

Split CLI distribution into dedicated packages.

`@mcp-layer/cli` is now API-only and no longer publishes the `mcp-layer` binary.

Use `mcpcli` for executable installs. It now ships the standalone `mcpcli` command backed by `@mcp-layer/cli`.
