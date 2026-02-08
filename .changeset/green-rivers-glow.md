---
"mcp-layer": minor
"@mcp-layer/gateway": minor
"@mcp-layer/graphql": minor
"@mcp-layer/rest": patch
---

Add a shared `@mcp-layer/gateway` runtime package and a new `@mcp-layer/graphql` adapter package.

REST now consumes gateway runtime primitives for option normalization, catalog bootstrap, validation, resilience, and telemetry so adapter logic is shared instead of duplicated.

The root `mcp-layer` package now exports both `gateway` and `graphql` namespaces.
