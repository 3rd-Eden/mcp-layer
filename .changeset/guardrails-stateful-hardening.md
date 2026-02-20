---
"@mcp-layer/plugin": patch
"@mcp-layer/guardrails": patch
"@mcp-layer/stateful": patch
"@mcp-layer/gateway": patch
---

Improve guardrail performance and session log hardening.

- Add trace collection and sink support to `@mcp-layer/plugin` with `MCP_LAYER_DEBUG` driven defaults.
- Add DNS resolution caching and in-flight de-duplication to `egressPolicy` with configurable TTL.
- Add defensive resolver override support for advanced egress policy integration scenarios.
- Add principal-aware guardrail policy support for identity-scoped allow/deny controls.
- Harden `@mcp-layer/stateful` event log redaction to scrub sensitive value patterns in addition to sensitive key names.
- Add bounded lifecycle event log rotation controls to keep `~/.mcp-layer/sessions/events.log` growth predictable.
