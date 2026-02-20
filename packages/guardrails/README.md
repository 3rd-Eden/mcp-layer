# @mcp-layer/guardrails

`@mcp-layer/guardrails` provides first-party policy plugins for `@mcp-layer/plugin`. These policies are applied by `@mcp-layer/gateway` and can also be used directly by CLI integrations.

## Why this package exists

This package demonstrates a reusable, fail-closed policy layer that can be shared across execution surfaces.

Expected behavior: the same operation input is evaluated with the same guardrail rules in CLI, REST, and GraphQL.

## Installation

```sh
pnpm add @mcp-layer/guardrails
```

## API Reference

### Policy factories

- `denyTools(options?)`
- `allowTools(options?)`
- `denyPrompts(options?)`
- `allowPrompts(options?)`
- `denyResources(options?)`
- `allowResources(options?)`
- `principalPolicy(options?)`
- `piiRedact()`
- `secretDetect()`
- `promptRisk()`
- `payloadLimits(options?)`
- `egressPolicy(options?)`
- `approvalGate(options?)`
- `sessionBinding()`
- `ratePolicy(options?)`
- `auditPolicy(options?)`

Each factory returns a plugin object compatible with `@mcp-layer/plugin`.

### Policy reference

| Factory | Phase | Trigger | Meta fields used | Deny code | Included by profile |
| --- | --- | --- | --- | --- | --- |
| `allowTools` | `before` | `tools/call` name not allow-listed | none | `GUARDRAIL_DENIED` | baseline + strict (if configured) |
| `denyTools` | `before` | `tools/call` name deny-listed | none | `GUARDRAIL_DENIED` | baseline + strict (if configured) |
| `allowPrompts` | `before` | `prompts/get` name not allow-listed | none | `GUARDRAIL_DENIED` | baseline + strict (if configured) |
| `denyPrompts` | `before` | `prompts/get` name deny-listed | none | `GUARDRAIL_DENIED` | baseline + strict (if configured) |
| `allowResources` | `before` | `resources/read` URI not allow-listed | none | `GUARDRAIL_DENIED` | baseline + strict (if configured) |
| `denyResources` | `before` | `resources/read` URI deny-listed | none | `GUARDRAIL_DENIED` | baseline + strict (if configured) |
| `principalPolicy` | `before` | principal-specific method allow/deny checks | `principal` (or configured field) | `GUARDRAIL_DENIED` | baseline + strict (if configured) |
| `payloadLimits` | `before` | payload depth/string/json-size exceeds limits | none | `GUARDRAIL_DENIED` | baseline + strict |
| `piiRedact` | `before` + `after` | PII-like content in params/result | none | none (mutation-only) | baseline + strict |
| `secretDetect` | `before` | secret-like text found in request params | none | `GUARDRAIL_DENIED` | baseline + strict |
| `promptRisk` | `before` | prompt-injection/jailbreak indicators in params | none | `GUARDRAIL_DENIED` | baseline + strict |
| `egressPolicy` | `before` | disallowed URL/host/port/private target/redirect mode | `egressUrl`, `followRedirects` | `EGRESS_POLICY_DENIED` | strict |
| `approvalGate` | `before` | configured high-risk tool without approval | `approved` | `APPROVAL_REQUIRED` | strict |
| `sessionBinding` | `before` | request/session ownership mismatch | `sessionOwner`, `requestOwner` | `GUARDRAIL_DENIED` | strict |
| `ratePolicy` | `before` | per-session rate budget exceeded | `sessionId` (fallback `shared`) | `RATE_LIMITED` | strict |
| `auditPolicy` | `after` + `error` | always emits success/error events | none | none (observer) | strict |

### Runtime context meta contract

Guardrails only read a few optional `context.meta` fields. If you do not set these fields, related policies are effectively no-ops:

- `egressUrl: string` for `egressPolicy`.
- `followRedirects: boolean` for `egressPolicy` redirect block.
- `principal: string` (or configured field) for `principalPolicy`.
- `approved: boolean` for `approvalGate`.
- `sessionOwner: string` and `requestOwner: string` for `sessionBinding`.

The runtime itself typically sets `sessionId`, `method`, and `params`; `ratePolicy` keys by `sessionId` when present.

### `createGuardrails(input?)`

Builds a policy profile list for pipeline registration.

`input` fields:
- `profile?: 'baseline' | 'strict'`
- `allowTools?: string[]`
- `denyTools?: string[]`
- `allowPrompts?: string[]`
- `denyPrompts?: string[]`
- `allowResources?: string[]`
- `denyResources?: string[]`
- `principal?: { field?: string, requirePrincipal?: boolean, principals?: Record<string, { allowTools?: string[], denyTools?: string[], allowPrompts?: string[], denyPrompts?: string[], allowResources?: string[], denyResources?: string[] }> }`
- `payload?: { maxDepth?: number, maxStringLength?: number, maxJsonBytes?: number }`
- `egress?: { allowedHosts?: string[], allowedPorts?: number[], allowPrivateIps?: boolean, dnsTimeoutMs?: number, dnsCacheTtlMs?: number, resolve?: (host: string) => Promise<{ addresses: string[] }> }`
- `approval?: { tools?: string[] }`
- `rate?: { limit?: number, intervalMs?: number }`
- `audit?: { write?: (event) => void }`

`baseline` includes payload, redaction, secret, prompt-risk, allow/deny lists, and optional principal policy.

`strict` adds egress, approval, session binding, rate limits, and audit emission.

`egressPolicy` enforcement in strict mode includes:
- host allow-list checks (`allowedHosts`)
- optional port allow-list checks (`allowedPorts`)
- credential-free URL requirement
- private IP blocking by default (including resolved hostnames)
- DNS timeout enforcement (`dnsTimeoutMs`, default `2000`)
- DNS success cache with in-flight de-duplication (`dnsCacheTtlMs`, default `30000`)
- redirect-follow blocking via `meta.followRedirects !== true`

### Profile behavior by surface

In this repo, runtime defaults use strict guardrails for gateway-backed surfaces (REST/GraphQL) and CLI defaults are aligned to strict as well.

Expected outcome: matching operation intent should produce matching deny/allow behavior across CLI, REST, and GraphQL.

### Usage examples

This example demonstrates strict guardrails with explicit egress + approval controls. This matters when you need one policy definition that works for both adapter surfaces and CLI tooling. Expected behavior: risky tools require approval, and egress is denied unless host/port policy passes.

```js
import { createGuardrails } from '@mcp-layer/guardrails';

const plugins = createGuardrails({
  profile: 'strict',
  denyTools: ['shell_exec'],
  egress: {
    allowedHosts: ['api.example.com'],
    allowedPorts: [443]
  },
  approval: {
    tools: ['deploy_production']
  },
  rate: {
    limit: 60,
    intervalMs: 60000
  }
});
```

This example demonstrates principal-aware policy controls. This matters when the same runtime is shared by multiple identities and permissions must differ by principal. Expected behavior: only explicitly allowed methods are permitted for each principal identity.

```js
const plugins = createGuardrails({
  principal: {
    field: 'principal',
    principals: {
      analyst: {
        allowTools: ['echo'],
        denyResources: ['secrets/*']
      }
    }
  }
});
```

This example demonstrates passing strict guardrails into a shared runtime surface. Expected behavior: built-in guardrails run before custom plugins.

```js
import Fastify from 'fastify';
import mcpRest from '@mcp-layer/rest';

const app = Fastify();

await app.register(mcpRest, {
  session,
  guardrails: {
    profile: 'strict'
  }
});
```

## Error Behavior

All policy denials are `LayerError` instances with stable codes:
- `GUARDRAIL_DENIED`
- `EGRESS_POLICY_DENIED`
- `APPROVAL_REQUIRED`
- `RATE_LIMITED`

## Standards and config portability

Guardrail config is runtime-only in this repo. Shared MCP config files stay standards-compliant and are not extended with custom persisted keys.

MCP transport/spec references:
- [MCP Specification](https://modelcontextprotocol.io/specification)
- [MCP Transports](https://modelcontextprotocol.io/specification/latest/basic/transports)

## Testing

```sh
pnpm --filter @mcp-layer/guardrails test
```

Tests use `node:test` with real plugin execution and cover deny/allow rules, redaction, secret checks, payload limits, egress policy checks, and strict profile composition.
