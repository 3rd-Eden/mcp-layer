# @mcp-layer/graphql

`@mcp-layer/graphql` exposes MCP catalogs through GraphQL using shared runtime primitives from `@mcp-layer/gateway`. It supports generated per-item operations and generic fallback operations in the same schema.

## Table of Contents

- [Installation](#installation)
- [What this package provides](#what-this-package-provides)
- [Quick Start](#quick-start)
- [API Reference](#api-reference)
- [Error Handling](#error-handling)
- [Runtime Error Reference](#runtime-error-reference)

## Installation

```sh
pnpm add @mcp-layer/graphql
# or
npm install @mcp-layer/graphql
# or
yarn add @mcp-layer/graphql
```

## What this package provides

- Fastify plugin for GraphQL endpoint registration on MCP sessions.
- Framework-agnostic schema builder export.
- Deterministic MCP-to-GraphQL field mapping.
- Shared validation/resilience/telemetry/session-manager behavior through `@mcp-layer/gateway`.

### Contract defaults

- Endpoint: `/{version}/graphql`
- IDE route: disabled by default
- Operation surface: generated operations + generic fallback operations
- Subscription root: intentionally omitted in v1

## Quick Start

This example demonstrates the plugin surface when you need a production GraphQL endpoint with minimal setup. This matters for teams that already run Fastify and want GraphQL over MCP without writing adapter boilerplate.

Expected behavior: the plugin mounts `POST /v0/graphql` (or other derived version), supports generic and generated operations, and reuses gateway runtime validation and breaker behavior.

```js
import Fastify from 'fastify';
import { attach } from '@mcp-layer/attach';
import mcpGraphql from '@mcp-layer/graphql';
import { build } from '@mcp-layer/test-server';

const server = build();
const session = await attach(server, 'primary');

const app = Fastify({ logger: true });
await app.register(mcpGraphql, { session });

await app.listen({ port: 3000 });
```

This example demonstrates framework-agnostic schema generation. This matters when you need custom hosting, custom execution pipelines, or prebuilt schema inspection in tooling.

Expected behavior: `schema(...)` returns executable schema + typeDefs + resolvers + deterministic mapping metadata.

```js
import { schema } from '@mcp-layer/graphql';

const built = schema(catalog, {
  operations: {
    generated: true,
    generic: true
  }
});

console.log(built.typeDefs);
console.log(built.mapping.findField('tool', 'echo'));
```

## API Reference

### Default export: Fastify plugin

Registers GraphQL routes from MCP sessions.

```ts
fastify.register(mcpGraphql, options)
```

Options:

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `session` | `Session` or `Session[]` | required | Bootstrap session(s) used for catalog extraction and static mode. |
| `manager` | `{ get(request), close?() }` | optional | Per-request session manager (requires bootstrap `session`). |
| `prefix` | `string` or `(version, info, name) => string` | derived | Per-session route prefix. |
| `endpoint` | `string` | `"/graphql"` | GraphQL POST endpoint path under prefix. |
| `ide.enabled` | `boolean` | `false` | Enables GraphiQL route. |
| `ide.path` | `string` | `"/graphiql"` | IDE alias route path when IDE is enabled (redirect stays within the session prefix). |
| `operations.generated` | `boolean` | `true` | Include generated per-item operations. |
| `operations.generic` | `boolean` | `true` | Include generic fallback operations. |
| `validation.*` | object | gateway defaults | Validation trust/safety options. |
| `resilience.*` | object | gateway defaults | Breaker options. |
| `telemetry.*` | object | gateway defaults | OpenTelemetry API options. |
| `errors.exposeDetails` | `boolean` | `false` | Include raw upstream error message in GraphQL error text. |

### `schema(catalog, options?)`

Builds executable GraphQL schema primitives from an extracted catalog.

```ts
schema(catalog, {
  operations?: {
    generated?: boolean;
    generic?: boolean;
  }
}) => {
  schema: GraphQLSchema;
  typeDefs: string;
  resolvers: Record<string, unknown>;
  mapping: ReturnType<typeof map>;
}
```

### `map(catalog, options?)`

Returns deterministic mapping metadata used by generated operations.

Returns:

- `entries[]` with `{ type, root, name, field, item }`
- `find(type, name)`
- `findField(type, name)`
- typed lists (`tools`, `prompts`, `resources`, `templates`)

### GraphQL operation surface

#### Generic operations

- `Mutation.callTool(name: String!, input: JSON): ToolResult!`
- `Mutation.getPrompt(name: String!, input: JSON): PromptResult!`
- `Query.readResource(uri: String!): ResourceResult!`
- `Query.readTemplate(uriTemplate: String!, params: JSON): ResourceResult!`

`readTemplate` uses RFC6570 expansion semantics through `uri-template`, so operator/modifier forms like `{+name}` and `{name*}` are expanded using the provided `params`.

#### Generated operations

Generated fields mirror MCP catalog items and are deterministic/sanitized.

Examples:

- Tool `echo` -> `Mutation.echo(input: JSON): ToolResult!`
- Tool `fail-gracefully` -> `Mutation.fail_gracefully(input: JSON): ToolResult!`

#### Response types

- `ToolResult { content, isError, structuredContent }`
- `PromptResult { messages, payload }`
- `ResourceResult { contents, text, mimeType, payload }`
- `Catalog` + `CatalogEntry` metadata for schema discovery

## Error Handling

GraphQL execution errors are returned in `errors[]` with machine-readable extensions. Successful transport responses may still include resolver failures (`HTTP 200` with `errors` present), so client-side handling must inspect both `data` and `errors`.

Response contract highlights:

- `extensions.code` carries the primary classification (`BAD_USER_INPUT`, `UNAUTHENTICATED`, `SERVICE_UNAVAILABLE`, `TOOL_ERROR`, etc.).
- `extensions.instance` and `extensions.requestId` provide request correlation metadata.
- Validation failures include `extensions.errors[]` payloads with path/keyword/message metadata.
- Tool failures include `extensions.toolError` with preserved MCP payload content.

Operational debugging checklist:
1. Capture `extensions.code`, `extensions.instance`, and `extensions.requestId`.
2. Distinguish transport success from resolver failure (`HTTP 200` plus `errors`).
3. For validation failures, inspect `extensions.errors` before retrying.
4. For startup failures, resolve configuration errors before plugin registration.

## Runtime Error Reference

This section is written for high-pressure debugging moments. Entries are split into request-time GraphQL errors, request-time internal `LayerError` guards, and startup configuration errors.
Every `LayerError` entry uses a hash anchor (`error-xxxxxx`) from `@mcp-layer/error` so incidents can link directly to a deterministic remediation block.

<a id="graphql-validation"></a>
### Validation failures (`BAD_USER_INPUT`)

When it happens: input validation fails against tool/prompt schemas or template parameter limits.

Step-by-step resolution:
1. Read `extensions.errors[]` and identify failing `path`/`message`.
2. Compare payload against tool/prompt schema from catalog discovery.
3. Re-submit with corrected input shape and types.
4. Add client-side validation for common invalid payloads.

This example demonstrates extracting validation details from GraphQL responses. This matters because GraphQL transport can be `200` while operations fail semantically. Expected behavior: client logs structured validation hints and blocks invalid retries.

<details>
<summary>Fix Example: inspect GraphQL validation extension payload</summary>

```js
const response = await gqlClient.request(query, vars);
if (Array.isArray(response.errors) && response.errors.length > 0) {
  const first = response.errors[0];
  if (first.extensions?.code === 'BAD_USER_INPUT') {
    console.error(first.extensions.errors);
  }
}
```

</details>


<a id="graphql-auth"></a>
### Authorization failures (`UNAUTHENTICATED`)

When it happens: manager mode requires auth header and request is missing/invalid.

Step-by-step resolution:
1. Verify `Authorization` header is present for protected routes.
2. Confirm `Bearer <token>` formatting is correct.
3. Validate manager auth mode (`required` vs `optional`) for your environment.
4. Add request middleware tests for missing and malformed auth headers.

This example shows a bearer-authenticated GraphQL request. This matters because manager mode may resolve different sessions based on identity. Expected behavior: request resolves session and executes operation without `UNAUTHENTICATED`.

<details>
<summary>Fix Example: provide authorization header in manager mode</summary>

```js
await fastify.inject({
  method: 'POST',
  url: '/v0/graphql',
  headers: {
    authorization: 'Bearer token-value',
    'content-type': 'application/json'
  },
  payload: { query, variables }
});
```

</details>

<a id="graphql-circuit-open"></a>
### Circuit open failures (`SERVICE_UNAVAILABLE`)

When it happens: breaker is open for the selected session and request is failed fast.

Step-by-step resolution:
1. Check recent upstream failures and breaker thresholds.
2. Reduce request pressure or isolate failing operations.
3. Tune `resilience.errorThresholdPercentage`, `volumeThreshold`, and `resetTimeout`.
4. Re-run traffic after reset window and monitor for repeat opens.

This example demonstrates conservative breaker tuning for unstable upstreams. This matters because GraphQL adapters often multiplex many clients through one session surface. Expected behavior: breaker opens less aggressively while still protecting upstream.

<details>
<summary>Fix Example: tune resilience options for unstable upstreams</summary>

```js
await fastify.register(mcpGraphql, {
  session,
  resilience: {
    enabled: true,
    timeout: 20000,
    errorThresholdPercentage: 60,
    resetTimeout: 10000,
    volumeThreshold: 10
  }
});
```

</details>

<a id="graphql-tool"></a>
### Tool payload errors (`TOOL_ERROR`)

When it happens: MCP tool returns `isError: true`.

Step-by-step resolution:
1. Read `extensions.toolError.content` for upstream tool diagnostics.
2. Inspect input arguments for domain/business constraint failures.
3. Retry only after correcting payload or upstream state.
4. Surface structured tool error content to API consumers.

This example shows handling tool-level failure payloads in GraphQL clients. This matters because tool failures are semantically different from protocol/runtime faults. Expected behavior: client presents tool-specific corrective guidance.

<details>
<summary>Fix Example: branch on TOOL_ERROR and show tool payload</summary>

```js
const first = response.errors?.[0];
if (first?.extensions?.code === 'TOOL_ERROR') {
  console.error(first.extensions.toolError?.content);
}
```

</details>

<a id="graphql-runtime"></a>
### Upstream runtime failures (`INTERNAL_SERVER_ERROR`, `TIMEOUT`, etc.)

When it happens: MCP/JSON-RPC errors bubble from upstream tool/prompt/resource calls.

Step-by-step resolution:
1. Inspect `extensions.mcpErrorCode` and classify retryability.
2. Correlate with upstream logs via `requestId` and `instance`.
3. Enable `errors.exposeDetails` temporarily in controlled environments.
4. Add retry/backoff only for transient categories (`TIMEOUT`, service pressure).

This example demonstrates temporary detail exposure during incident diagnosis. This matters because opaque runtime failures are hard to triage without short-term enhanced diagnostics. Expected behavior: richer error detail is available for debugging, then disabled again.

<details>
<summary>Fix Example: temporarily expose upstream error details</summary>

```js
await fastify.register(mcpGraphql, {
  session,
  errors: {
    exposeDetails: true
  }
});
```

</details>

### Runtime Guard Errors (LayerError)

These entries are emitted from resolver guard paths before the final GraphQL error mapping. They are still useful for root-cause analysis because they identify the failing internal method and deterministic hash.

<a id="error-633b3e"></a>
### `Request payload failed schema validation.` (`callTool`)

Thrown from: `callTool`

This happens when tool input fails schema validation before invoking MCP `tools/call`.

Step-by-step resolution:
1. Inspect the GraphQL `BAD_USER_INPUT` response and collect `extensions.errors`.
2. Compare tool variables against the tool schema exported in catalog metadata.
3. Coerce client values to the expected shape/types before dispatch.
4. Add tests that submit invalid and valid payloads for the same tool.

<details>
<summary>Fix Example: pass a schema-compliant tool payload</summary>

```js
const mutation = `
  mutation Call($input: JSONObject!) {
    callTool(name: "echo", input: $input) {
      isError
      content
    }
  }
`;

await gqlClient.request(mutation, {
  input: { text: 'hello world' }
});
```

</details>

<a id="error-97d14a"></a>
### `Tool "{tool}" reported an error.` (`callTool`)

Thrown from: `callTool`

This happens when MCP responds with `isError: true` for a tool invocation. GraphQL then maps this into `TOOL_ERROR`.

Step-by-step resolution:
1. Inspect `extensions.toolError.content` for the upstream tool failure details.
2. Validate tool arguments and domain constraints against server-side expectations.
3. Fix upstream state or request payload before retrying.
4. Add consumer handling that surfaces tool-level errors distinctly from transport/runtime failures.

<details>
<summary>Fix Example: branch on TOOL_ERROR and inspect tool payload</summary>

```js
const first = response.errors?.[0];
if (first?.extensions?.code === 'TOOL_ERROR') {
  const content = first.extensions.toolError?.content ?? [];
  console.error(content);
}
```

</details>

<a id="error-c0448a"></a>
### `Request payload failed schema validation.` (`getPrompt`)

Thrown from: `getPrompt`

This happens when prompt arguments fail schema validation before invoking MCP `prompts/get`.

Step-by-step resolution:
1. Inspect GraphQL `BAD_USER_INPUT` metadata for prompt argument path/message.
2. Compare client variables with prompt input schema from catalog.
3. Normalize optional/required prompt fields in client payload builders.
4. Add prompt-specific request validation tests in your GraphQL client or gateway layer.

<details>
<summary>Fix Example: submit prompt arguments that match schema</summary>

```js
const mutation = `
  mutation Prompt($input: JSONObject!) {
    getPrompt(name: "welcome", input: $input) {
      messages
      payload
    }
  }
`;

await gqlClient.request(mutation, {
  input: { topic: 'launch' }
});
```

</details>

### Startup Configuration Errors (LayerError)

The following entries are thrown before route registration when plugin options are invalid.

<a id="error-07b5a1"></a>
### `endpoint must start with "/".`

Thrown from: `validateOptions`

This happens when `endpoint` does not begin with `/`.

Step-by-step resolution:
1. Inspect `endpoint` option source.
2. Normalize path to absolute route format.
3. Keep endpoint formatting logic in one config utility.
4. Add startup tests for invalid and valid endpoint paths.

<details>
<summary>Fix Example: configure endpoint with absolute path</summary>

```js
await fastify.register(mcpGraphql, {
  session,
  endpoint: '/graphql'
});
```

</details>

<a id="error-8cd512"></a>
### `ide.path must start with "/".`

Thrown from: `validateOptions`

This happens when `ide.path` is not absolute.

Step-by-step resolution:
1. Ensure `ide.path` starts with `/`.
2. Keep IDE route path separate from endpoint path.
3. Validate defaults and env overrides together.
4. Add registration tests for custom IDE path.

<details>
<summary>Fix Example: configure IDE path as absolute route</summary>

```js
await fastify.register(mcpGraphql, {
  session,
  ide: {
    enabled: true,
    path: '/graphiql'
  }
});
```

</details>

<a id="error-a1c144"></a>
### `operations.generated and operations.generic cannot both be false.`

Thrown from: `validateOptions`

This happens when both operation surfaces are disabled.

Step-by-step resolution:
1. Enable at least one operation mode.
2. Use `generic: true` during migration phases.
3. Disable generated operations only when explicitly required.
4. Add tests covering each allowed operation combination.

<details>
<summary>Fix Example: enable at least one operation surface</summary>

```js
await fastify.register(mcpGraphql, {
  session,
  operations: {
    generated: true,
    generic: false
  }
});
```

</details>

<a id="error-7b8c55"></a>
### `"{option}" must be a positive number.`

Thrown from: `requirePositiveNumber` (via `@mcp-layer/gateway` `validateRuntimeOptions`)

This happens when any numeric runtime limit is `<= 0`, `NaN`, or non-finite.

Step-by-step resolution:
1. Read the failing `{option}` name from the thrown message.
2. Trace that value from env/config parsing into plugin registration.
3. Coerce and validate value ranges before calling `fastify.register(...)`.
4. Add startup tests for invalid and valid values.

Canonical gateway reference: [`@mcp-layer/gateway` runtime errors](../gateway/README.md#error-688cda).

<details>
<summary>Fix Example: preflight-check numeric GraphQL runtime options</summary>

```js
const timeout = Number(process.env.MCP_TIMEOUT_MS ?? 30000);
if (!Number.isFinite(timeout) || timeout <= 0)
  throw new Error('MCP_TIMEOUT_MS must be a positive number');

await fastify.register(mcpGraphql, {
  session,
  resilience: { timeout }
});
```

</details>

<a id="error-e88459"></a>
### `validation.trustSchemas must be "auto", true, or false.`

Thrown from: `trustMode` (via `@mcp-layer/gateway` `validateRuntimeOptions`)

This happens when `validation.trustSchemas` is set to a value outside `"auto"`, `true`, or `false`.

Step-by-step resolution:
1. Inspect runtime plugin options for `validation.trustSchemas`.
2. Replace stringified booleans (for example `"true"`) with real booleans.
3. Default to `"auto"` unless you need a strict trust override.
4. Add config tests covering all allowed values.

Canonical gateway reference: [`@mcp-layer/gateway` runtime errors](../gateway/README.md#error-a103aa).

<details>
<summary>Fix Example: configure supported trust mode</summary>

```js
await fastify.register(mcpGraphql, {
  session,
  validation: {
    trustSchemas: 'auto'
  }
});
```

</details>

<a id="error-b1960f"></a>
### `prefix must be a string or function.`

Thrown from: `validateRuntimeOptions` (via `@mcp-layer/gateway`)

This happens when `prefix` is neither a string nor a callback.

Step-by-step resolution:
1. Use a static string for fixed mounting.
2. Use a callback for version/session-aware prefixes.
3. Remove unsupported injected types from config loaders.
4. Add tests for both valid prefix modes.

Canonical gateway reference: [`@mcp-layer/gateway` runtime errors](../gateway/README.md#error-a74b20).

<details>
<summary>Fix Example: use supported prefix callback shape</summary>

```js
await fastify.register(mcpGraphql, {
  session,
  prefix: function prefix(version, info, name) {
    return `/${version}/${name}`;
  }
});
```

</details>

<a id="error-3b828a"></a>
### `manager does not support multiple sessions. Register multiple plugins instead.`

Thrown from: `validateRuntimeOptions` (via `@mcp-layer/gateway`)

This happens when `manager` is provided while `session` is an array.

Step-by-step resolution:
1. In manager mode, pass one bootstrap `session`.
2. For multi-session static mounts, remove `manager`.
3. Register separate plugin instances per static session surface.
4. Add startup tests for both architecture modes.

Canonical gateway reference: [`@mcp-layer/gateway` runtime errors](../gateway/README.md#error-712f62).

<details>
<summary>Fix Example: use one bootstrap session with manager</summary>

```js
await fastify.register(mcpGraphql, {
  session: bootstrapSession,
  manager
});
```

</details>

<a id="error-126799"></a>
### `session is required when manager is provided (used for catalog bootstrap).`

Thrown from: `validateRuntimeOptions` (via `@mcp-layer/gateway`)

This happens when `manager` is configured without a bootstrap `session`.

Step-by-step resolution:
1. Always provide a bootstrap `session` with `manager`.
2. Ensure bootstrap session is connected before registration.
3. Keep bootstrap and managed sessions aligned in capability surface.
4. Add tests that fail fast without bootstrap session.

Canonical gateway reference: [`@mcp-layer/gateway` runtime errors](../gateway/README.md#error-c773d9).

<details>
<summary>Fix Example: include bootstrap session in manager mode</summary>

```js
await fastify.register(mcpGraphql, {
  session: bootstrapSession,
  manager
});
```

</details>

<a id="error-66da32"></a>
### `session or manager option is required.`

Thrown from: `validateRuntimeOptions` (via `@mcp-layer/gateway`)

This happens when plugin options omit both `session` and `manager`.

Step-by-step resolution:
1. Pass a connected `session` for static mode.
2. Or pass `manager` plus bootstrap `session` for dynamic mode.
3. Assert required options before `register`.
4. Add tests that validate registration failure on missing session source.

Canonical gateway reference: [`@mcp-layer/gateway` runtime errors](../gateway/README.md#error-6e22f2).

<details>
<summary>Fix Example: provide GraphQL session source</summary>

```js
await fastify.register(mcpGraphql, { session });
```

</details>

<a id="error-e996df"></a>
### `manager must be an object with a get(request) function.`

Thrown from: `validateRuntimeOptions` (via `@mcp-layer/gateway`)

This happens when `manager` is not an object implementing `get(request)`.

Step-by-step resolution:
1. Ensure `manager` is an object.
2. Implement `async get(request)` returning a `Session`.
3. Optionally add `close()` for lifecycle cleanup.
4. Add contract tests for malformed manager values.

Canonical gateway reference: [`@mcp-layer/gateway` runtime errors](../gateway/README.md#error-b78e6d).

<details>
<summary>Fix Example: implement required manager contract</summary>

```js
const manager = {
  async get(request) {
    return resolveSession(request);
  }
};
```

</details>

<a id="error-d5f1ec"></a>
### `errors must be an object.`

Thrown from: `validateRuntimeOptions` (via `@mcp-layer/gateway`)

This happens when `errors` is provided as a primitive instead of an object.

Step-by-step resolution:
1. Ensure `errors` is an object literal.
2. Keep only supported keys under `errors`.
3. Remove primitive shorthand from environment mappers.
4. Add shape-validation tests.

Canonical gateway reference: [`@mcp-layer/gateway` runtime errors](../gateway/README.md#error-6fc055).

<details>
<summary>Fix Example: provide GraphQL error options object</summary>

```js
await fastify.register(mcpGraphql, {
  session,
  errors: { exposeDetails: false }
});
```

</details>

<a id="error-785cc4"></a>
### `validation must be an object.`

Thrown from: `validateRuntimeOptions` (via `@mcp-layer/gateway`)

This happens when `validation` is provided as a non-object value.

Step-by-step resolution:
1. Move validation keys under a `validation` object.
2. Keep values typed correctly (number/boolean/allowed enums).
3. Validate env/config coercion before registration.
4. Add tests for malformed and valid validation objects.

Canonical gateway reference: [`@mcp-layer/gateway` runtime errors](../gateway/README.md#error-349758).

<details>
<summary>Fix Example: pass validation options as object</summary>

```js
await fastify.register(mcpGraphql, {
  session,
  validation: {
    trustSchemas: 'auto',
    maxSchemaDepth: 10
  }
});
```

</details>

<a id="error-73e3ed"></a>
### `normalizeError must be a function.`

Thrown from: `validateRuntimeOptions` (via `@mcp-layer/gateway`)

This happens when `normalizeError` is provided with a non-callable value.

Step-by-step resolution:
1. Ensure `normalizeError` is a function reference.
2. Keep function signature aligned with gateway runtime usage.
3. Remove object/string placeholders from config loaders.
4. Add tests validating custom normalizer behavior.

Canonical gateway reference: [`@mcp-layer/gateway` runtime errors](../gateway/README.md#error-b72182).

<details>
<summary>Fix Example: provide callable normalizeError handler</summary>

```js
await fastify.register(mcpGraphql, {
  session,
  normalizeError: function normalizeError(error, instance, requestId, options) {
    return mapGraphQLError(error, instance, requestId, options);
  }
});
```

</details>

## License

MIT
