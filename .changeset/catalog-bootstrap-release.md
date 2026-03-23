---
"@mcp-layer/gateway": patch
"@mcp-layer/schema": patch
---

Add `composeCatalog()` support for precomputed MCP catalogs and let gateway-backed adapters bootstrap manager mode from catalog metadata when no eager session exists.

This release also hardens the catalog bootstrap path by distrusting catalog-only schemas by default, preferring live bootstrap session metadata when available, and validating invalid catalog inputs before manager bootstrap checks.
