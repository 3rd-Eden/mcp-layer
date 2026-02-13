---
"@mcp-layer/cli": minor
"@mcp-layer/gateway": minor
"@mcp-layer/rest": minor
"@mcp-layer/graphql": minor
"@mcp-layer/plugin": minor
"@mcp-layer/guardrails": minor
"@mcp-layer/stateful": minor
"mcp-layer": minor
---

Add stateful session workflows and shared plugin/guardrail execution across CLI, gateway, REST, and GraphQL.

Highlights:
- Add `@mcp-layer/stateful` for session lifecycle management and local tracking in `~/.mcp-layer/sessions`.
- Add `@mcp-layer/plugin` powered by `supply` with `transport`, `schema`, `before`, `after`, and `error` phases.
- Add `@mcp-layer/guardrails` with first-party policy plugins for allow/deny, payload controls, PII/secret handling, prompt risk, egress policy, approvals, rate limits, and auditing.
- Route gateway, REST, and GraphQL execution through shared pipeline hooks for policy parity.
- Add CLI `session` command flow with optional `--name`, generated UUID sessions, list/stop controls, and session-scoped tool/prompt/resource/template execution.
