---
"@mcp-layer/profiles": minor
"@mcp-layer/forward": minor
"@mcp-layer/connect": minor
"@mcp-layer/cli": minor
"mcp-layer": minor
---

Add sanitized client-identity captures and evidence-backed profiles, with HTTP/MCP/OAuth application and advisory matching. Add Streamable HTTP forwarding, a stdio bridge, and separate downstream/upstream OAuth providers using cli-storage for every stored record and process lock. Integrate capture/build/list/show/forward commands and runtime profile/OAuth options into the CLI and existing SDK transports.

Profile selection and OAuth overrides are runtime options. Shared MCP configuration keys and resolution order are unchanged. Captures retain issuer/redirect constraints; credentials, capabilities, protocol negotiation, and session state are never replayed from profiles. The catalog accepts only verifiable capture contributions.
