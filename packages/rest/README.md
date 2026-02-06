# @mcp-layer/rest

Fastify plugin for exposing MCP servers over REST.

`mcpRest` takes one or more MCP `Session` instances and registers HTTP routes that proxy MCP tools, prompts, and resources. A `Session` is the client-side handle you get from `@mcp-layer/attach` (in-process server) or `@mcp-layer/connect` (remote server). A Fastify “app” in this context is just a `Fastify` instance that owns routing, lifecycle hooks, and configuration.

## Table of Contents

- [Installation](#installation)
- [Quick Start (In-Process Server)](#quick-start-in-process-server)
- [Connect From Discovered Config](#connect-from-discovered-config)
- [What Gets Exposed](#what-gets-exposed)
- [Plugin Options](#plugin-options)
- [Configuration Example](#configuration-example)
- [True Proxy Mode (Proxy Session Manager)](#true-proxy-mode-proxy-session-manager)
- [Performance Tips](#performance-tips)
- [Validation](#validation)
- [Error Handling](#error-handling)
- [Error Catalog](#error-catalog)
- [Resilience](#resilience)
- [Observability](#observability)
- [Composition with Fastify Ecosystem](#composition-with-fastify-ecosystem)
- [Runtime Error Reference](#runtime-error-reference)

## Installation

```sh
pnpm add @mcp-layer/rest
# or
npm install @mcp-layer/rest
# or
yarn add @mcp-layer/rest
```

## Quick Start (In-Process Server)

```js
import Fastify from 'fastify';
import { attach } from '@mcp-layer/attach';
import mcpRest from '@mcp-layer/rest';
import { createServer } from './mcp-server.js';

const server = createServer();
const session = await attach(server, 'primary');

const app = Fastify({ logger: true });
await app.register(mcpRest, { session });

await app.listen({ port: 3000 });
```

This registers REST routes on the Fastify instance using the MCP catalog returned by the session.

## Connect From Discovered Config

This example uses `@mcp-layer/config` to discover local MCP server definitions and then connects using `@mcp-layer/connect`.

```js
import Fastify from 'fastify';
import { load } from '@mcp-layer/config';
import { connect } from '@mcp-layer/connect';
import mcpRest from '@mcp-layer/rest';

const config = await load();
const entry = config.get('my-server');
if (!entry) {
  throw new Error('Server "my-server" not found in config');
}

const session = await connect(config, entry.name);

const app = Fastify({ logger: true });
await app.register(mcpRest, { session });

await app.listen({ port: 3000 });
```

See:
- [`packages/attach/README.md`](packages/attach/README.md) (for in-process sessions)
- [`packages/connect/README.md`](packages/connect/README.md) (for stdio/remote sessions)
- [`packages/config/README.md`](packages/config/README.md) (for configuration discovery)
- [`packages/openapi/README.md`](packages/openapi/README.md) (for OpenAPI generation)

## What Gets Exposed

For each session, the plugin registers routes under a versioned prefix (default: `/v{major}` or `/v0`). The list below shows the routes **after** the prefix is applied:

- `POST /{toolName}` to execute a tool
- `POST /prompts/{promptName}` to render a prompt
- `GET /{resourcePath}` to read a resource
- `GET /resource-templates` to list resource templates
- `GET /{templatedPath}` to read a dynamic resource template route
- `GET /openapi.json` to serve the OpenAPI 3.1 document

`/openapi.json` is the standard OpenAPI endpoint. `swagger.json` is the legacy name and is not used here.

Resource templates are registered as **dynamic HTTP routes**. A template like `template://note/{name}` becomes `GET /template/note/{name}`, which expands `{name}` into a concrete URI before reading the resource. The template list is still available at `GET /resource-templates` for discovery and documentation tooling.

## Plugin Options

Top-level options:

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `session` | `Session` or `Session[]` | required | MCP session(s) to expose over REST. |
| `manager` | `{ get(request) }` | optional | Session manager used to resolve per-request MCP sessions (true proxy mode). Requires `session` for catalog bootstrap. |
| `prefix` | `string` or `(version, serverInfo, sessionName) => string` | derived | Route prefix. Use a function to create per-session routes. |
| `validation` | `object` | see below | Validation and schema safety controls. |
| `resilience` | `object` | see below | Circuit breaker configuration. |
| `telemetry` | `object` | see below | OpenTelemetry API integration. |
| `errors` | `object` | see below | Error response behavior. |
| `exposeOpenAPI` | `boolean` | `true` | Serve `/openapi.json` for each session prefix. |

Validation options:

| Option | Default | Description |
| --- | --- | --- |
| `trustSchemas` | `auto` | Trust in-process/stdio schemas by default, distrust remote Streamable HTTP schemas. |
| `maxSchemaDepth` | `10` | Prevents deeply nested schemas from consuming memory/CPU. |
| `maxSchemaSize` | `102400` bytes | Limits schema payload size to reduce abuse risk. |
| `maxPatternLength` | `1000` | Limits regex length to reduce ReDoS risk. |
| `maxToolNameLength` | `64` | Rejects tool names that are too long to be safe path segments. |
| `maxTemplateParamLength` | `200` | Caps template parameter length to prevent oversized URIs. |

Resilience options (backed by `opossum`):

| Option | Default | Description |
| --- | --- | --- |
| `enabled` | `true` | Enables circuit breaker protection. |
| `timeout` | `30000` | Maximum time (ms) before a request is treated as failed. |
| `errorThresholdPercentage` | `50` | Error rate that opens the breaker. |
| `resetTimeout` | `30000` | Time (ms) before moving to half-open. |
| `volumeThreshold` | `5` | Minimum volume before breaker starts tripping. |

When resilience is enabled, the breaker timeout is also passed through to MCP requests so the underlying client does not keep long-running request timers alive after a breaker timeout.

Telemetry options:

| Option | Default | Description |
| --- | --- | --- |
| `enabled` | `false` | Enables OpenTelemetry API instrumentation. |
| `serviceName` | `mcp-layer-rest` | Service name used for metrics and spans. |
| `api` | `undefined` | Optional OpenTelemetry API instance. If provided, telemetry is automatically enabled. |

Error options:

| Option | Default | Description |
| --- | --- | --- |
| `exposeDetails` | `false` | If true, Problem Details responses include upstream error messages. |

## Configuration Example

This example shows a multi-session setup with a prefix strategy that keeps per-server routes isolated while tightening validation and circuit breaker thresholds. It demonstrates how the REST layer can enforce consistent safety limits even when multiple servers are attached.

```js
await app.register(mcpRest, {
  session,
  prefix(version, info, name) {
    return `/mcp/${name}/${version}`;
  },
  validation: {
    trustSchemas: 'auto',
    maxSchemaDepth: 8,
    maxSchemaSize: 65536,
    maxPatternLength: 512,
    maxToolNameLength: 64,
    maxTemplateParamLength: 120
  },
  resilience: {
    enabled: true,
    timeout: 20000,
    errorThresholdPercentage: 40,
    resetTimeout: 15000,
    volumeThreshold: 3
  },
  telemetry: {
    api: otelApi,
    serviceName: 'my-mcp-rest'
  },
  errors: {
    exposeDetails: false
  },
  exposeOpenAPI: true
});
```

## True Proxy Mode (Proxy Session Manager)

When you need per-request authentication or want to scale beyond a single MCP connection, register a session manager. The session manager derives an identity from the HTTP request (typically `Authorization`) and caches MCP sessions per identity.

```js
import { createManager } from '@mcp-layer/manager';
import { connect } from '@mcp-layer/connect';
import { load } from '@mcp-layer/config';

const config = await load();
const entry = config.get('my-server');
if (!entry) {
  throw new Error('Server not found.');
}

const manager = createManager({
  max: 10,
  ttl: 5 * 60 * 1000,
  factory: async function factory(ctx) {
    const token = ctx.identity.auth ? ctx.identity.auth.token : undefined;
    return connect(config, entry.name, {
      env: token ? { MCP_AUTH_TOKEN: token } : undefined
    });
  }
});

await app.register(mcpRest, {
  session,
  manager: manager
});
```

Notes:
- Today the REST plugin uses the provided `session` to build routes and OpenAPI. The manager is used for per-request execution.
- The session manager must return sessions that match the same MCP server surface as the catalog session.

## Performance Tips

- Scale REST horizontally (multiple worker processes) before increasing MCP session counts. In benchmarks, the REST process saturates first.
- Disable or tune validation/telemetry when load testing to measure raw throughput.
- Use stdio/remote MCP servers for realistic load tests; in-process sessions are excellent for correctness but do not model real transport contention.
- See Fastify’s benchmarking guidance and published results:
  - https://fastify.dev/docs/v5.7.x/Guides/Benchmarking/
  - https://fastify.dev/benchmarks/

## Validation

The plugin validates tool and prompt inputs with Ajv when schemas are trusted. For untrusted schemas, safety checks are applied and validation is skipped if a schema fails the safety limits.

Trust policy:

- `auto` trusts in-process/stdio sessions and distrusts remote Streamable HTTP sessions
- `true` always trusts
- `false` never trusts (skip validation)

Hardening notes:

- `maxToolNameLength` and `maxTemplateParamLength` guard the HTTP surface area by preventing extremely long path segments.
- Schema limits (`maxSchemaDepth`, `maxSchemaSize`, `maxPatternLength`) reduce the risk of abuse from untrusted schemas. Increase them cautiously if your catalog uses deeply nested schemas.

## Error Handling

All errors return RFC 9457 Problem Details. MCP/JSON-RPC errors are mapped to HTTP status codes and include `mcpErrorCode` for debugging.

Tool execution errors (`isError: true`) return **HTTP 502** with a Problem Details body and a `toolError` extension that preserves the original MCP payload.

By default, `detail` is a generic message. Set `errors.exposeDetails` to `true` when you want the upstream error text included.

## Error Catalog

The `type` field in Problem Details responses maps to the error names below.

**Contents**

- [error-validation](#error-validation)
- [error-not-found](#error-not-found)
- [error-parse](#error-parse)
- [error-auth](#error-auth)
- [error-invalid-params](#error-invalid-params)
- [error-timeout](#error-timeout)
- [error-circuit-open](#error-circuit-open)
- [error-internal](#error-internal)
- [error-conflict](#error-conflict)
- [error-tool](#error-tool)

### error-validation

When it happens: request payload failed schema validation or a request parameter exceeded the configured limits.

Resolution: confirm the payload matches the tool or prompt input schema. Validate against the catalog to see which fields are required, and check `validation` limits if you are sending very large payloads or long path segments.

### error-not-found

When it happens: requested tool, prompt, or resource was not found by the underlying server.

Resolution: list the server catalog (`listTools`, `listPrompts`, `listResources`, `listResourceTemplates`) and ensure the requested name or URI exists. For templates, verify the generated HTTP route matches the template you expect.

### error-parse

When it happens: malformed JSON or request body parsing failure.

Resolution: ensure the request body is valid JSON and the `Content-Type` is `application/json`. If you send an empty body, make sure the endpoint expects it.

### error-auth

When it happens: missing or invalid authorization when `manager` requires auth.

Resolution: send a valid `Authorization` header (for example `Bearer <token>`) or configure `manager` with `auth.mode: "optional"` when auth is not required.

### error-invalid-params

When it happens: parameters failed server-side validation beyond schema validation.

Resolution: inspect server-specific constraints. Some servers require values that are not expressible in JSON Schema alone (e.g., referential integrity or capability checks).

### error-timeout

When it happens: an upstream call exceeded the configured timeout.

Resolution: increase `resilience.timeout`, reduce downstream work, or address upstream latency with caching or batching.

### error-circuit-open

When it happens: the circuit breaker is open and rejecting traffic.

Resolution: reduce request volume, inspect upstream health, and wait for `resetTimeout` to elapse. You can also temporarily disable the breaker to debug, then re-enable it.

### error-internal

When it happens: unexpected server-side failure in the REST layer.

Resolution: check server logs and enable `errors.exposeDetails` temporarily for debugging. If the error is reproducible, capture the request ID for faster triage.

### error-conflict

When it happens: upstream resource state conflict.

Resolution: re-read the resource state and retry with updated parameters. If the server supports versioning or optimistic locking, include the expected version.

### error-tool

When it happens: a tool returned `isError: true`.

Resolution: inspect the `toolError` payload in the response to determine which input or state caused the tool to fail. If the tool emits structured fields, surface those to the caller so they can correct inputs.

## Resilience

Circuit breaker support prevents cascading failures and supports half-open recovery. When open, requests fail fast with HTTP 503 and a Problem Details payload.

<details>
<summary>Resilience configuration example</summary>

```js
await app.register(mcpRest, {
  session,
  resilience: {
    enabled: true,
    timeout: 15000,
    errorThresholdPercentage: 30,
    resetTimeout: 10000,
    volumeThreshold: 2
  }
});
```

</details>

## Observability

Telemetry is opt-in. When enabled, the plugin uses the OpenTelemetry **API** (not SDK) and exposes:

- `mcp.call.duration` (Histogram)
- `mcp.call.errors` (Counter)
- `rest.validation.errors` (Counter)
- `rest.circuit.state` (ObservableGauge)

<details>
<summary>Observability configuration example</summary>

```js
import * as otelApi from '@opentelemetry/api';

await app.register(mcpRest, {
  session,
  telemetry: {
    api: otelApi,
    serviceName: 'mcp-rest'
  }
});
```

</details>

## Composition with Fastify Ecosystem

This plugin is designed to compose with standard Fastify plugins:

- `@fastify/under-pressure` for health checks
- `@fastify/cors` for CORS headers
- `@fastify/helmet` for security headers
- `@fastify/rate-limit` for rate limiting

## Runtime Error Reference

This section is written for high-pressure debugging moments. Each entry maps to concrete REST plugin option validation or route-generation guard rails.

<a id="error-2a0345"></a>
### mcpBreakers map is not initialized.

Thrown from: `ensureBreaker`

This happens when resilience is enabled and the plugin cannot access `fastify.mcpBreakers`. The map is normally decorated during plugin registration.

Step-by-step resolution:
1. Ensure you use the exported Fastify plugin (`fastify.register(restPlugin, ...)`) rather than calling internals directly.
2. Verify no plugin/hook deletes or overwrites `fastify.mcpBreakers`.
3. In isolated unit tests of internal helpers, decorate the map manually.
4. Add a startup assertion that `fastify.mcpBreakers` is a `Map` after registration.

<details>
<summary>Fix Example: register plugin so breaker storage is initialized</summary>

```js
await fastify.register(restPlugin, { session, resilience: { enabled: true } });
if (!(fastify.mcpBreakers instanceof Map))
  throw new Error('rest plugin did not initialize breaker map');
```

</details>

<a id="error-6d20db"></a>
### "{option}" must be a positive number.

Thrown from: `requirePositiveNumber`

This happens when numeric validation options are `<= 0`, `NaN`, or non-finite. The plugin validates limits like schema depth/size, name length, and resilience timers.

Step-by-step resolution:
1. Identify which option name is shown in `{option}`.
2. Trace that value from env/config to plugin registration.
3. Coerce to number and enforce `> 0` before passing options.
4. Add tests for invalid and valid values for that exact option.

<details>
<summary>Fix Example: sanitize numeric REST plugin options</summary>

```js
const maxToolNameLength = Number(process.env.MCP_MAX_TOOL_LEN ?? 64);
if (!Number.isFinite(maxToolNameLength) || maxToolNameLength <= 0)
  throw new Error('MCP_MAX_TOOL_LEN must be a positive number');

await fastify.register(restPlugin, {
  session,
  validation: { maxToolNameLength }
});
```

</details>

<a id="error-3869ce"></a>
### Invalid template expression "{expression}" in template "{template}".

Thrown from: `toFastifyPath`

This happens when a template expression resolves to an unusable parameter name after normalization (for example malformed braces or empty expression content).

Step-by-step resolution:
1. Inspect `{template}` and the failing `{expression}` from your resource template catalog.
2. Ensure each placeholder has a concrete name (`{slug}`), not empty or malformed tokens.
3. Correct template definitions at the MCP server layer before exposing them via REST.
4. Add validation tests for malformed template expressions.

<details>
<summary>Fix Example: replace malformed template expressions with named placeholders</summary>

```js
// Invalid: mcp://docs/{}
const template = 'mcp://docs/{slug}';
registerTemplate(template);
```

</details>

<a id="error-7723da"></a>
### Template expression "{expression}" is not supported.

Thrown from: `toFastifyPath`

This happens when URI templates use unsupported RFC 6570 operators (`+`, `#`, `.`, `/`, `?`, `&`, `*`, or comma forms). REST route conversion accepts simple `{name}` placeholders only.

Step-by-step resolution:
1. Find `{expression}` in the failing template.
2. Remove operator syntax and use plain placeholders.
3. Move query/path expansion behavior into handler logic instead of template operators.
4. Add tests for unsupported operator forms and supported simple forms.

<details>
<summary>Fix Example: convert operator templates to simple placeholders</summary>

```js
// Unsupported: mcp://docs/{+slug}
const template = 'mcp://docs/{slug}';
registerTemplate(template);
```

</details>

<a id="error-7f1cfb"></a>
### Template parameter "{parameter}" must be URL-safe.

Thrown from: `toFastifyPath`

This happens when a template parameter name contains invalid identifier characters and cannot be converted to Fastify route params safely.

Step-by-step resolution:
1. Review placeholder names in URI templates.
2. Use only URL-safe parameter identifiers (`A-Z`, `a-z`, `0-9`, `.`, `_`, `-`).
3. Keep human-readable labels outside parameter names.
4. Add template validation tests for bad and good parameter names.

<details>
<summary>Fix Example: rename template parameters to URL-safe identifiers</summary>

```js
// Invalid: mcp://docs/{team name}
const template = 'mcp://docs/{team_name}';
registerTemplate(template);
```

</details>

<a id="error-1a7da5"></a>
### validation.trustSchemas must be "auto", true, or false.

Thrown from: `trustMode`

This happens when `validation.trustSchemas` is set to anything other than `"auto"`, `true`, or `false`.

Step-by-step resolution:
1. Inspect plugin options and find `validation.trustSchemas`.
2. Replace stringified booleans (`"true"`) with actual booleans or `"auto"`.
3. Keep one explicit trust mode per environment.
4. Add config tests for each allowed trust mode.

<details>
<summary>Fix Example: set trustSchemas to an allowed value</summary>

```js
await fastify.register(restPlugin, {
  session,
  validation: { trustSchemas: 'auto' }
});
```

</details>

<a id="error-587c11"></a>
### errors must be an object.

Thrown from: `validateOptions`

This happens when `options.errors` is provided as a non-object (for example boolean or string). The REST plugin expects an object like `{ exposeDetails: boolean }`.

Step-by-step resolution:
1. Inspect the shape of the `errors` option at registration.
2. Replace primitive values with an options object.
3. Configure only supported keys under `errors`.
4. Add option-shape tests for invalid and valid `errors` config.

<details>
<summary>Fix Example: provide errors settings as an object</summary>

```js
await fastify.register(restPlugin, {
  session,
  errors: { exposeDetails: false }
});
```

</details>

<a id="error-7a5a51"></a>
### manager does not support multiple sessions. Register multiple plugins instead.

Thrown from: `validateOptions`

This happens when `manager` is provided together with `session` as an array. Manager mode resolves sessions per request and only supports a single bootstrap session.

Step-by-step resolution:
1. If using `manager`, pass a single `session` object (not an array).
2. If you need multiple static sessions, remove `manager` and register multiple plugin instances.
3. Keep manager-backed and multi-session modes separate in architecture.
4. Add tests for both registration modes.

<details>
<summary>Fix Example: choose one mode per plugin instance</summary>

```js
await fastify.register(restPlugin, {
  session: bootstrapSession,
  manager
});
```

</details>

<a id="error-6e5a7e"></a>
### manager must be an object with a get(request) function.

Thrown from: `validateOptions`

This happens when `manager` is not an object exposing `get(request)`. The plugin calls `manager.get` to resolve request-scoped sessions.

Step-by-step resolution:
1. Confirm `manager` value is an object.
2. Implement `async get(request)` that returns a `Session`.
3. Optionally provide `close()` for shutdown cleanup.
4. Add tests validating manager contract shape.

<details>
<summary>Fix Example: implement required manager interface</summary>

```js
const manager = {
  async get(request) {
    return resolveSessionForRequest(request);
  }
};
```

</details>

<a id="error-7fd4f0"></a>
### prefix must be a string or function.

Thrown from: `validateOptions`

This happens when `prefix` is neither a string nor a function. REST version/prefix routing can only be configured with those two forms.

Step-by-step resolution:
1. Use a string prefix (`/v1`) for static routing.
2. Use a function `(version, info, name) => string` for dynamic prefixes.
3. Remove unsupported prefix types from env/config injection.
4. Add tests for both allowed forms.

<details>
<summary>Fix Example: configure prefix with supported type</summary>

```js
await fastify.register(restPlugin, {
  session,
  prefix: function prefix(version, info, name) {
    return `/${version}/${name}`;
  }
});
```

</details>

<a id="error-2c7a98"></a>
### session is required when manager is provided (used for catalog bootstrap).

Thrown from: `validateOptions`

This happens when `manager` mode is enabled but no bootstrap `session` is provided. The plugin still needs one session to build catalog/OpenAPI metadata at startup.

Step-by-step resolution:
1. Provide a bootstrap `session` alongside `manager`.
2. Ensure the bootstrap session is connected before plugin registration.
3. Keep manager responsible for per-request switching, not initial catalog extraction.
4. Add startup tests for manager mode with and without bootstrap session.

<details>
<summary>Fix Example: provide bootstrap session in manager mode</summary>

```js
await fastify.register(restPlugin, {
  session: bootstrapSession,
  manager
});
```

</details>

<a id="error-69348f"></a>
### session or manager option is required.

Thrown from: `validateOptions`

This happens when plugin options include neither `session` nor `manager`. REST cannot expose MCP endpoints without at least one session source.

Step-by-step resolution:
1. Supply a connected `session` for static mode, or `manager` + bootstrap `session` for dynamic mode.
2. Verify DI wiring does not drop these options before registration.
3. Add startup assertions for required plugin options.
4. Add tests that confirm registration fails fast without session sources.

<details>
<summary>Fix Example: pass required session option to REST plugin</summary>

```js
await fastify.register(restPlugin, { session });
```

</details>

<a id="error-92524a"></a>
### validation must be an object.

Thrown from: `validateOptions`

This happens when `validation` is provided as a non-object. The plugin expects a validation config object with limit/trust fields.

Step-by-step resolution:
1. Ensure `validation` is an object literal.
2. Move validation-related keys under `validation` instead of top-level options.
3. Keep option values typed correctly (numbers/booleans/allowed strings).
4. Add tests for malformed and valid validation option objects.

<details>
<summary>Fix Example: pass validation settings in object form</summary>

```js
await fastify.register(restPlugin, {
  session,
  validation: {
    trustSchemas: 'auto',
    maxToolNameLength: 64
  }
});
```

</details>

<a id="error-01dca8"></a>
### Tool name "{tool}" exceeds maximum length of {maxLength}.

Thrown from: `validateSegmentName`

This happens when an MCP tool name exceeds the configured maximum route segment length (`validation.maxToolNameLength`).

Step-by-step resolution:
1. Check `{maxLength}` from plugin validation settings.
2. Find tool names from `tools/list` that exceed that limit.
3. Shorten tool identifiers at MCP server registration time.
4. Add tests for long-name rejection and acceptable-name registration.

<details>
<summary>Fix Example: keep MCP tool names within route limits</summary>

```js
const max = 64;
if (toolName.length > max)
  throw new Error(`Tool name "${toolName}" exceeds ${max} chars`);

server.registerTool(toolName, meta, handler);
```

</details>

<a id="error-67adce"></a>
### Tool name "{tool}" must be URL-safe (letters, digits, ".", "_", "-").

Thrown from: `validateSegmentName`

This happens when a tool name contains characters that cannot be used safely in REST route path segments.

Step-by-step resolution:
1. Validate tool names against `^[a-z0-9._-]+$` (case-insensitive).
2. Remove spaces, slashes, colons, and query-style characters.
3. Keep display labels in description fields, not in tool IDs.
4. Add tests for invalid characters and sanitized names.

<details>
<summary>Fix Example: register REST-safe MCP tool identifiers</summary>

```js
const toolName = rawName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9._-]/g, '');
if (!toolName)
  throw new Error('Tool name is empty after normalization');

server.registerTool(toolName, meta, handler);
```

</details>

<a id="error-1ba529"></a>
### Tool name must be a non-empty string.

Thrown from: `validateSegmentName`

This happens when the tool name is missing or not a string. Route registration requires a non-empty string key for each tool.

Step-by-step resolution:
1. Inspect tool definitions produced by your MCP server/catalog extraction.
2. Ensure every tool has a string `name`.
3. Reject/skip malformed tool entries before REST route registration.
4. Add tests for missing-name and valid-name tool definitions.

<details>
<summary>Fix Example: enforce non-empty tool names before registration</summary>

```js
if (typeof tool.name !== 'string' || tool.name.length === 0)
  throw new Error('Each MCP tool must declare a non-empty name');

server.registerTool(tool.name, tool.meta, tool.handler);
```

</details>

<a id="error-52145c"></a>
### Tool name "{tool}" conflicts with reserved path. Reserved paths: {reservedPaths}

Thrown from: `validateToolName`

This happens when a tool name collides with reserved REST routes (`prompts`, `resource-templates`, `openapi.json`) or template-derived path segments.

Step-by-step resolution:
1. Compare the failing name against `{reservedPaths}`.
2. Rename tool identifiers to avoid route namespace conflicts.
3. Re-run route registration after renaming and verify no overlap with template prefixes.
4. Add tests that assert reserved names are rejected.

<details>
<summary>Fix Example: avoid reserved route names in MCP tool registration</summary>

```js
const blocked = new Set(['prompts', 'resource-templates', 'openapi.json']);
if (blocked.has(toolName))
  throw new Error(`Tool name "${toolName}" is reserved by REST routes`);

server.registerTool(toolName, meta, handler);
```

</details>

## License

MIT
