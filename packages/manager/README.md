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
- Machine-readable `code` values are preserved for branching (`AUTH_REQUIRED`, `AUTH_INVALID`, etc).

## Errors

<a id="error-7ef0f5"></a>
### `7EF0F5` `MANAGER_OPTIONS_REQUIRED`

- Method: `normalize`
- Message: `Session manager options are required.`
- Remedy: Call `createManager({ factory })` with a valid options object.

<a id="error-f140a9"></a>
### `F140A9` `MANAGER_FACTORY_REQUIRED`

- Method: `normalize`
- Message: `Session manager requires a factory function.`
- Remedy: Provide `factory: async function factory(ctx) { ... }`.

<a id="error-4bcf88"></a>
### `4BCF88` `MANAGER_MAX_INVALID`

- Method: `normalize`
- Message: `max must be a positive number.`
- Remedy: Set `max` to a finite number greater than `0`.

<a id="error-ed0d39"></a>
### `ED0D39` `MANAGER_TTL_INVALID`

- Method: `normalize`
- Message: `ttl must be a positive number.`
- Remedy: Set `ttl` to milliseconds greater than `0`.

<a id="error-aa7610"></a>
### `AA7610` `MANAGER_IDENTIFY_INVALID`

- Method: `identity`
- Message: `identify() must return a string or { key, auth } object.`
- Remedy: Return a string key or object containing `key`.

<a id="error-bc38ab"></a>
### `BC38AB` `AUTH_REQUIRED`

- Method: `identity`
- Message: `Authorization header is required.`
- Remedy: Send the configured auth header or use `auth.mode: 'optional'`.

<a id="error-828f17"></a>
### `828F17` `AUTH_INVALID`

- Method: `identity`
- Message: `Authorization header must use Bearer scheme.`
- Remedy: Send `Authorization: Bearer <token>` or configure a different scheme.

<a id="error-42f901"></a>
### `42F901` `AUTH_INVALID`

- Method: `identity`
- Message: `Authorization header must use Basic scheme.`
- Remedy: Send `Authorization: Basic <value>` or configure a different scheme.

<a id="error-87a41c"></a>
### `87A41C` `MANAGER_FACTORY_RESULT_INVALID`

- Method: `get`
- Message: `factory must return a Session instance.`
- Remedy: Return an instance from `@mcp-layer/session`.

## Identity Rules

When `identify` is not supplied, identity is derived from configured auth settings:

- `auth.mode = 'disabled'`: always uses `sharedKey`.
- `auth.mode = 'optional'`: uses auth header when present, otherwise `sharedKey`.
- `auth.mode = 'required'`: missing header throws `AUTH_REQUIRED`.

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
