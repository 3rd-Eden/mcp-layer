---
"@mcp-layer/connect": patch
---

Fix stdio environment propagation so spawned servers inherit the caller shell environment (`process.env`) before applying `config.env` and runtime `options.env` overrides.
