---
"@mcp-layer/connect": patch
---

Ensure connect timeout cleanup fully tears down stalled stdio connections by wiring timeout into SDK initialization and closing transport/client on timeout.
