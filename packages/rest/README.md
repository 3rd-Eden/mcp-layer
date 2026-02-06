# @mcp-layer/rest

Fastify plugin for exposing MCP servers over REST.

`mcpRest` takes one or more MCP `Session` instances and registers HTTP routes that proxy MCP tools, prompts, and resources. A `Session` is the client-side handle you get from `@mcp-layer/attach` (in-process server) or `@mcp-layer/connect` (remote server). A Fastify “app” in this context is just a `Fastify` instance that owns routing, lifecycle hooks, and configuration.

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

## License

MIT
