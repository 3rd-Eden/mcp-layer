# @mcp-layer/manager

Reusable MCP session manager with identity-based session reuse, TTL expiration, and LRU eviction.

This package is transport-agnostic. It can be used with REST plugins, CLIs, job workers, or any runtime that needs controlled MCP session lifecycles.

## Installation

```sh
pnpm add @mcp-layer/manager
# or
npm install @mcp-layer/manager
# or
yarn add @mcp-layer/manager
```

## What This Package Provides

`@mcp-layer/manager` solves session lifecycle concerns that are separate from any single framework:

- Identity derivation per incoming request/context.
- Session reuse for repeated identities.
- Time-based eviction (`ttl`) for stale sessions.
- Capacity-based eviction (`max`) using least-recently-used policy.
- Graceful shutdown via `close()`.
- Runtime visibility via `stats()`.

## API Reference

### `createManager(options)`

Creates a manager instance.

```ts
createManager(options: {
  max?: number;
  ttl?: number;
  sharedKey?: string;
  auth?: {
    mode?: 'optional' | 'required' | 'disabled';
    header?: string;
    scheme?: 'bearer' | 'basic' | 'raw';
  };
  identify?: (request) =>
    | string
    | {
        key: string;
        auth?: { scheme?: 'bearer' | 'basic' | 'raw'; token?: string; header?: string };
        shared?: boolean;
      };
  factory: (ctx: {
    identity: {
      key: string;
      auth: { scheme: 'bearer' | 'basic' | 'raw'; token: string; header: string } | null;
      shared: boolean;
    };
    request: FastifyRequest;
  }) => Promise<Session>;
  now?: () => number;
}) => {
  get(request): Promise<Session>;
  stats(): {
    size: number;
    max: number;
    ttl: number;
    evictions: number;
    hits: number;
    misses: number;
    keys: string[];
  };
  close(): Promise<void>;
}
```

### `options` fields

| Field | Type | Default | Required | Behavior |
| --- | --- | --- | --- | --- |
| `max` | `number` | `10` | no | Maximum cached sessions. When exceeded, oldest LRU session is evicted and closed. |
| `ttl` | `number` | `300000` | no | Idle timeout in milliseconds. Expired sessions are closed and recreated on next access. |
| `sharedKey` | `string` | `"shared"` | no | Identity key used when auth is optional and missing (or disabled). |
| `auth.mode` | `'optional' \| 'required' \| 'disabled'` | `'optional'` | no | Controls whether identity must come from auth headers. |
| `auth.header` | `string` | `'authorization'` | no | Header name used for auth parsing. Case-insensitive. |
| `auth.scheme` | `'bearer' \| 'basic' \| 'raw'` | `'bearer'` | no | Header parsing strategy when `identify` is not provided. |
| `identify` | `function` | `undefined` | no | Custom identity derivation. Overrides built-in auth parsing. |
| `factory` | `function` | none | yes | Creates a `Session` for an identity. Must return `@mcp-layer/session` `Session`. |
| `now` | `function` | `Date.now` | no | Clock source, mainly for deterministic tests. |

### Manager methods

| Method | Signature | Behavior |
| --- | --- | --- |
| `get` | `get(request) => Promise<Session>` | Resolves identity, returns cached session when possible, otherwise creates and caches a new session. |
| `stats` | `stats() => { size, max, ttl, evictions, hits, misses, keys }` | Returns in-memory pool statistics for observability and testing. |
| `close` | `close() => Promise<void>` | Closes all tracked sessions and clears in-memory state. |

### Error Behavior

Manager runtime errors are thrown as `LayerError` from `@mcp-layer/error`.

- Every error includes package + method source metadata.
- Every error includes a stable `reference` id.
- Every error includes a generated `docs` URL to this package README error section.
- Runtime references and full debugging playbooks are documented in [Runtime Error Reference](#runtime-error-reference).

## Identity Rules

When `identify` is not supplied, identity is derived from configured auth settings:

- `auth.mode = 'disabled'`: always uses `sharedKey`.
- `auth.mode = 'optional'`: uses auth header when present, otherwise `sharedKey`.
- `auth.mode = 'required'`: missing header raises a documented `LayerError` from `identity`.

Scheme handling:

- `bearer`: expects `Authorization: Bearer <token>`.
- `basic`: expects `Authorization: Basic <base64>`.
- `raw`: takes the full header value as token.

## Example: Default Auth Parsing

This example shows the default identity path (`Authorization` header) with per-identity session creation. This matters when multiple callers should not always share one MCP session.

Expected behavior: requests with the same bearer token reuse one session; a different token creates a different session.

```js
import { createManager } from '@mcp-layer/manager';
import { connect } from '@mcp-layer/connect';
import { load } from '@mcp-layer/config';

const config = await load();

const manager = createManager({
  max: 10,
  ttl: 5 * 60 * 1000,
  factory: async function factory(ctx) {
    const entry = config.get('server-name');
    if (!entry) {
      throw new Error('Server not found.');
    }

    const token = ctx.identity.auth ? ctx.identity.auth.token : undefined;
    return connect(config, entry.name, {
      env: token ? { MCP_AUTH_TOKEN: token } : undefined
    });
  }
});
```

## Example: Custom Identity Strategy

This example shows tenant-based routing without forcing header auth parsing. This matters when identity comes from app-level metadata instead of authorization headers.

Expected behavior: requests with the same tenant key share one session; requests without tenant fallback to shared identity.

```js
const manager = createManager({
  identify: function identify(request) {
    const tenant = request.headers['x-tenant-id'];
    if (!tenant || typeof tenant !== 'string') {
      return 'shared';
    }

    return {
      key: `tenant:${tenant}`,
      shared: false
    };
  },
  factory: async function factory(ctx) {
    return connect(config, 'tenant-server');
  }
});
```

## Example: Integration with a Plugin

This example shows how to pass the manager into another package that resolves sessions per request.

Expected behavior: the host plugin calls `manager.get(request)` internally and reuses or creates sessions according to manager policy.

```js
app.register(mcpRest, {
  session,
  manager
});
```

## Shutdown

Call `close()` during process shutdown so cached sessions are closed cleanly.

```js
await manager.close();
```

## Runtime Error Reference

This section is written for high-pressure debugging moments. Each entry maps to a specific `createManager(...)` validation or identity-resolution branch.

<a id="error-87a41c"></a>
### factory must return a Session instance.

Thrown from: `get`

This happens when your `factory(ctx)` returns something other than `@mcp-layer/session` `Session`. Manager cache/storage and route integration require real `Session` instances.

Step-by-step resolution:
1. Inspect the return value of `factory(ctx)` and verify its constructor/type.
2. Ensure the factory awaits `connect(...)` or `attach(...)` rather than returning raw clients.
3. Reject non-Session returns in your own factory wrapper.
4. Add tests for one invalid factory return and one valid Session return.

<details>
<summary>Fix Example: return Session objects from manager factory</summary>

```js
const manager = createManager({
  factory: async function makeSession() {
    return connect(config, 'local-dev');
  }
});

const session = await manager.get(request);
```

</details>

<a id="error-bc38ab"></a>
### Authorization header is required.

Thrown from: `identity`

This happens when `auth.mode` is set to `required` and the configured auth header is missing from the incoming request.

Step-by-step resolution:
1. Confirm manager auth config (`mode`, `header`, `scheme`) used at runtime.
2. Check upstream proxy/gateway forwarding for the authorization header.
3. Ensure requests include the required header when manager auth is `required`.
4. Add tests for missing-header rejection and valid-header acceptance.

<details>
<summary>Fix Example: send required auth header for manager identity</summary>

```js
await fastify.inject({
  method: 'GET',
  url: '/v1/tools/weather.get',
  headers: { authorization: 'Bearer test-token' }
});
```

</details>

<a id="error-42f901"></a>
### Authorization header must use Basic scheme.

Thrown from: `identity`

This happens when manager auth scheme is configured as `basic`, but the request header is not formatted as `Basic <base64>`.

Step-by-step resolution:
1. Verify manager auth config uses `scheme: "basic"` intentionally.
2. Check header format and ensure it starts with `Basic `.
3. Encode credentials as Base64 (`username:password`) before sending.
4. Add tests for incorrect scheme prefix and valid Basic header parsing.

<details>
<summary>Fix Example: send correctly formatted Basic auth header</summary>

```js
const credentials = Buffer.from('user:pass').toString('base64');
await fastify.inject({
  method: 'GET',
  url: '/v1/tools/example',
  headers: { authorization: `Basic ${credentials}` }
});
```

</details>

<a id="error-828f17"></a>
### Authorization header must use Bearer scheme.

Thrown from: `identity`

This happens when manager auth scheme is `bearer`, but the header does not match `Bearer <token>`.

Step-by-step resolution:
1. Confirm manager config uses `scheme: "bearer"`.
2. Check clients/proxies are not rewriting the header prefix.
3. Ensure token is sent as `Bearer <token>` exactly.
4. Add tests for malformed bearer headers and valid token headers.

<details>
<summary>Fix Example: send Bearer token with correct prefix</summary>

```js
await fastify.inject({
  method: 'GET',
  url: '/v1/tools/example',
  headers: { authorization: 'Bearer abc123' }
});
```

</details>

<a id="error-aa7610"></a>
### identify() must return a string or { key, auth } object.

Thrown from: `identity`

This happens when a custom `identify(request)` hook returns an unsupported shape (for example `undefined`, number, or object missing `key`).

Step-by-step resolution:
1. Review your custom `identify` implementation return type.
2. Return either a string key or `{ key, auth?, shared? }`.
3. If supplying auth metadata, include `token` under `auth`.
4. Add tests for both supported return shapes.

<details>
<summary>Fix Example: implement identify with a supported return shape</summary>

```js
const manager = createManager({
  identify: function identify(request) {
    const tenant = String(request.headers['x-tenant-id'] ?? 'shared');
    return { key: `tenant:${tenant}`, shared: false };
  },
  factory: makeSession
});
```

</details>

<a id="error-4bcf88"></a>
### max must be a positive number.

Thrown from: `normalize`

This happens when `createManager` receives `max <= 0`, `NaN`, or non-finite values. `max` controls cache capacity and must be a positive number.

Step-by-step resolution:
1. Inspect the source of `max` (env/config flags).
2. Parse/coerce to number and validate positivity before manager creation.
3. Set a sensible upper bound for your workload to avoid churn.
4. Add tests for invalid (`0`, `-1`, `NaN`) and valid values.

<details>
<summary>Fix Example: validate manager max before createManager</summary>

```js
const max = Number(process.env.MCP_SESSION_MAX ?? 10);
if (!Number.isFinite(max) || max <= 0)
  throw new Error('MCP_SESSION_MAX must be a positive number.');

const manager = createManager({ max, ttl: 300000, factory: makeSession });
```

</details>

<a id="error-7ef0f5"></a>
### Session manager options are required.

Thrown from: `normalize`

This happens when `createManager(...)` is called with `undefined`, `null`, or a non-object value. Manager initialization requires an options object.

Step-by-step resolution:
1. Check the code path building manager options.
2. Ensure options object construction does not short-circuit to `undefined`.
3. Add a local assertion before calling `createManager`.
4. Add tests for missing-options and valid-options initialization.

<details>
<summary>Fix Example: pass an explicit options object to createManager</summary>

```js
const manager = createManager({
  factory: makeSession,
  max: 10,
  ttl: 300000
});
```

</details>

<a id="error-f140a9"></a>
### Session manager requires a factory function.

Thrown from: `normalize`

This happens when manager options do not include a callable `factory`. Session creation is delegated entirely to this function.

Step-by-step resolution:
1. Verify `factory` exists and is a function.
2. Ensure dependency injection/config wiring does not pass factory results instead of function references.
3. Keep factory async and return `Session`.
4. Add tests that reject missing factory and accept valid factory functions.

<details>
<summary>Fix Example: pass a factory callback (not a precomputed value)</summary>

```js
const manager = createManager({
  factory: async function makeSession(ctx) {
    return connect(config, ctx.identity.key);
  }
});
```

</details>

<a id="error-ed0d39"></a>
### ttl must be a positive number.

Thrown from: `normalize`

This happens when `ttl` is `<= 0`, `NaN`, or non-finite. Session entries use `ttl` for eviction; invalid values break expiration semantics.

Step-by-step resolution:
1. Trace TTL input from environment/config to manager setup.
2. Parse as number and enforce `ttl > 0`.
3. Choose a TTL aligned with upstream session cost and traffic patterns.
4. Add tests for invalid TTL values and expected expiration behavior.

<details>
<summary>Fix Example: validate ttl before manager initialization</summary>

```js
const ttl = Number(process.env.MCP_SESSION_TTL_MS ?? 300000);
if (!Number.isFinite(ttl) || ttl <= 0)
  throw new Error('MCP_SESSION_TTL_MS must be a positive number.');

const manager = createManager({ factory: makeSession, max: 10, ttl });
```

</details>
