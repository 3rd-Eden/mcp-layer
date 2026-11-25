# @mcp-layer/forward

## 0.2.0

### Minor Changes

- f9b16af: Add sanitized client-identity captures and evidence-backed profiles, with HTTP/MCP/OAuth application and advisory matching. The profiles package owns the capture runner, artifact loading, and standalone capture/build/list/show tooling. Add Streamable HTTP forwarding, a stdio bridge, and separate downstream/upstream OAuth providers using cli-storage for every stored record and process lock. Integrate runtime profile/OAuth options and forwarding into the main CLI and existing SDK transports.

  Profile selection and OAuth overrides are runtime options. Shared MCP configuration keys and resolution order are unchanged. Captures retain issuer/redirect constraints; credentials, capabilities, protocol negotiation, and session state are never replayed from profiles. The catalog accepts only verifiable capture contributions.
