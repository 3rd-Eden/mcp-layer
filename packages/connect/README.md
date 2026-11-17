# @mcp-layer/connect

`@mcp-layer/connect` turns normalized MCP server definitions into live client connections using the official MCP SDK. It supports stdio, Streamable HTTP, and SSE transports.

This package centralizes:
- transport selection,
- stdio spawn setup (`cwd`, `env`, `stderr`),
- remote URL validation,
- `Session` lifecycle ownership.

## Table of Contents

- [Installation](#installation)
- [Usage](#usage)
- [Transport Selection](#transport-selection)
- [Public profiles and OAuth](#public-profiles-and-oauth)
- [API Reference](#api-reference)
- [Behavior details](#behavior-details)
- [Testing](#testing)
- [Related packages](#related-packages)
- [Runtime Error Reference](#runtime-error-reference)

## Installation

Install the connector and config loader to run the examples below. The packages expose ESM APIs and connect directly through the official SDK:

```sh
pnpm add @mcp-layer/connect @mcp-layer/config
# or
npm install @mcp-layer/connect @mcp-layer/config
# or
yarn add @mcp-layer/connect @mcp-layer/config
```

## Usage

Use the configured server key with `connect`; the package resolves transport from that entry. This example performs a real handshake and ping, then closes the owned process or connection.

```js
import { load } from '@mcp-layer/config';
import { connect } from '@mcp-layer/connect';

const config = await load(undefined, process.cwd());
// "demo" is the configured server name, not a transport label.
const session = await connect(config, 'demo');

await session.client.ping();
await session.close();
```

For URL-based entries, transport is selected automatically (defaults to Streamable HTTP). This example lists real remote tools and then releases the connection.

```js
import { load } from '@mcp-layer/config';
import { connect } from '@mcp-layer/connect';

const config = await load(undefined, process.cwd());
// "remote-http" is just the server key in config.
// Transport is auto-selected from that server entry (url/endpoint => streamable-http).
const session = await connect(config, 'remote-http');

await session.client.listTools({});
await session.close();
```

For legacy servers, force SSE with an explicit override. This example completes a ping over the SDK legacy SSE transport without changing shared configuration.

```js
import { load } from '@mcp-layer/config';
import { connect } from '@mcp-layer/connect';

const config = await load(undefined, process.cwd());
// "legacy" is the server key in config.
// Here transport is explicitly overridden to SSE.
const session = await connect(config, 'legacy', { transport: 'sse' });

await session.client.ping();
await session.close();
```

## Transport Selection

Transport is chosen automatically from server configuration unless you override it.

About configuration keys:
- MCP defines transport protocols, not a universal `.mcp.json` schema: [MCP Transports](https://modelcontextprotocol.io/specification/latest/basic/transports)
- Tool config shapes (for example `type`, `url`, `command`) are client-specific: [VS Code MCP config](https://code.visualstudio.com/docs/copilot/customization/mcp-servers), [Claude Code MCP config](https://docs.claude.com/en/docs/claude-code/mcp)
- `options.transport` is an `@mcp-layer/connect` runtime override (not a cross-client config standard)

Automatic selection algorithm:
1. `options.transport` override (if provided)
2. `entry.config.type`
3. inferred fallback from connection shape:
   - `command` => `stdio`
   - `url` or `endpoint` => `streamable-http`

Supported values:
- `stdio`
- `streamable-http` (`http` and `streamableHttp` aliases)
- `sse`

For remote transports, URL resolution order:
1. `options.url`
2. `entry.config.url`
3. `entry.config.endpoint`

## Public profiles and OAuth

`profile` is an evidence-backed public identity object or bundled verified ID from [`@mcp-layer/profiles`](../profiles/README.md). `parts` selects `http`, `mcp`, and `oauth`; all parts apply by default. Explicit runtime `info`, `requestInit.headers`, and per-request headers take precedence over profile defaults. The built-in connector identity is applied last only as a fallback, so it does not replace observed clientInfo.

Load a profile artifact when reproducing a captured client. This example sends its public HTTP and initialize identity to the configured remote server, lists its tools, and closes the session. The profile must have been derived from real capture evidence; arbitrary edited identities fail validation:

```js
import { readFile } from 'node:fs/promises';
import { load } from '@mcp-layer/config';
import { connect } from '@mcp-layer/connect';

const config = await load(undefined, process.cwd());
const profile = JSON.parse(await readFile('./profile.json', 'utf8'));
const session = await connect(config, 'remote', {
  profile,
  parts: ['http', 'mcp'],
});
try {
  console.log(await session.client.listTools());
} finally {
  await session.close();
}
```

HTTP identity is applied through the SDK transport fetch hooks. For SSE this includes both POST messages and the initial EventSource GET; an explicit `eventSourceInit.fetch` is decorated independently. Profile application does not replace negotiated MCP versions, capabilities, transport headers, SDK response streams, session IDs or credentials.

Inject an official SDK `OAuthClientProvider` through `authProvider` for either remote transport. Connect does not construct a store, launch a browser, or interpret tokens itself. A selected OAuth profile decorates public registration metadata and can supply a public client ID only for an explicit matching `issuer`; runtime registration takes precedence. The profile is identity metadata and does not grant access. Direct callers own provider lifecycle and any browser callback listeners.

With `@mcp-layer/forward.authorize`, construct the provider with the profile's selected public `oauth.metadata` before calling its store-bound `access()` method; decoration cannot change an original provider's internal metadata. Resolve any issuer-bound public client ID before constructing it, or supply explicit runtime `clientInformation`. Complete interactive `access()` before `connect()` when browser consent must have its own longer deadline, pass the provider's authenticated `fetch` for refresh/retry, and close the provider after the session. [`@mcp-layer/cli`](../cli/README.md#oauth-and-private-storage) performs that composition for command-line use.

These runtime options compose the [official MCP authorization specification](https://modelcontextprotocol.io/specification/latest/basic/authorization) and the [SDK OAuth provider/transport APIs](https://github.com/modelcontextprotocol/typescript-sdk/tree/main/src/client). They add no persisted keys to [host configuration](https://code.visualstudio.com/docs/copilot/customization/mcp-servers).

## API Reference

### `select(source, name): Entry | undefined`

`source` is a `Map<string, Entry>` or an object implementing `get(name)`. `name` is the configured server key. An `Entry` is `{ name: string, source: string, config: Record<string, unknown> }`, where `source` is the originating configuration path. Returns the selected entry or `undefined`; an incompatible source throws `LayerError` with reference `#B7AB8A`.

### `setup(entry, options?): StdioOptions`

`entry` is a normalized `Entry` containing `config.command` and optional `args`, `cwd`, and `env`. Options accept `cwd?: string`, `env?: NodeJS.ProcessEnv`, and `stderr?: 'pipe' | 'overlapped' | 'inherit'`. Returns `{ command, args?, cwd, env, stderr? }` for the official SDK stdio transport. Missing `command` throws `LayerError` with reference `#D05682`.

### `connect(source, name, options?): Promise<Session>`

Creates an actual SDK `Client`, instantiates the selected SDK transport, performs initialization, and returns a `Session`. `source` accepts the same map-like contract as `select`; `name` must identify a configured server.

| Option | Type / default | Behavior |
| --- | --- | --- |
| `info` | `Partial<Implementation>` from the official SDK | Explicit standard MCP clientInfo fields, including title, description, website URL, and icons. Fallback is `mcp-layer` and the installed connect package version. |
| `profile` | `Profile \| string` | Validated profile object or bundled verified ID; no default and no filesystem reads. |
| `parts` | `Array<'http' \| 'mcp' \| 'oauth'>` / all | Profile identity layers to apply. |
| `issuer` | `string` | Issuer binding for a profile's public OAuth client ID. |
| `authProvider` | SDK `OAuthClientProvider` | Forwarded to Streamable HTTP and SSE SDK transports; no default provider. |
| `transport` | `'stdio' \| 'http' \| 'streamable-http' \| 'streamableHttp' \| 'sse'` | Runtime override; otherwise use the selection order above. |
| `url` | `string` | Runtime remote endpoint override. |
| `timeout` | positive finite milliseconds / absent | Deadline for MCP initialization; closes both client and transport on failure. |
| `cwd`, `env`, `stderr` | same as `setup` | Runtime stdio process settings. |
| `requestInit` | `RequestInit` | SDK HTTP request options; explicit headers override profile defaults. |
| `eventSourceInit` | `EventSourceInit` | SSE EventSource options; its explicit fetch overrides the top-level fetch for GET requests. |
| `fetch` | `typeof fetch` / SDK default | Request implementation; profile identity wraps it without consuming response streams. Also used for SSE EventSource when no separate fetch is given. |
| `sessionId` | `string` | Existing Streamable HTTP session ID for SDK reconnection. |
| `reconnectionOptions` | SDK object | Streamable HTTP `maxReconnectionDelay`, `initialReconnectionDelay`, `reconnectionDelayGrowFactor`, and `maxRetries` numeric fields. |

Bad names, sources, server entries, URLs, or transport overrides throw documented `LayerError` instances. Initialization timeout uses code `ERR_CONNECT_TIMEOUT`, package/method identity, stable reference `#1E2F95` and its generated README URL. Profile validation errors retain [`@mcp-layer/profiles`](../profiles/README.md#runtime-error-reference) codes; SDK, process, network and OAuth errors propagate. Any failed handshake closes the created client and transport before rejecting. An injected provider remains caller-owned.

### `Session` (re-exported from `@mcp-layer/session`)

Constructed by `connect`, with `.name: string`, `.source: string`, `.entry: Entry`, `.info: {name,version}`, the actual SDK `.client: Client`, and `.transport: StdioClientTransport | StreamableHTTPClientTransport | SSEClientTransport`. Use normal SDK APIs such as `session.client.callTool(...)`; neither object is replaced by a forwarding facade. `session.close(): Promise<void>` closes the client and its transport. The wrapper class is defined by [`@mcp-layer/session`](../session/README.md); direct users can construct it with `{ name, source, entry, client, transport, info }`.

## Behavior details

- Stdio defaults `cwd` to the config file directory.
- Stdio env is merged in this order: `process.env` -> entry `config.env` -> `options.env` -> enforced `MCP_CLIENT_AGENT`.
- `opts.env` overrides entry `env` values.
- URL-based entries default to Streamable HTTP unless `options.transport` is explicitly `sse`.
- Invalid transport and URL values fail fast with `LayerError`.
- `options.timeout` fails fast when the MCP initialization handshake exceeds the configured timeout.

## Testing

Run the focused integration suite to verify real stdio, Streamable HTTP and SSE handshakes, profile identity precedence and teardown. A passing run exercises actual SDK endpoints without mocks:

```sh
pnpm --filter @mcp-layer/connect test
```

The integration suite validates all three transports against real `@mcp-layer/test-server` endpoints over localhost.

## Related packages

- [`@mcp-layer/config`](../config/README.md)
- [`@mcp-layer/schema`](../schema/README.md)
- [`@mcp-layer/test-server`](../test-server/README.md)

## Runtime Error Reference

<a id="error-e816b5"></a>
### Expected server name to be a non-empty string.

Thrown from: `connect`

`connect` cannot look up a server entry without a valid key.

Step-by-step resolution:
1. Ensure the second argument passed to `connect` is a non-empty string.
2. Trim command-line input before forwarding it.
3. Reject missing/blank values before calling `connect`.
4. Add a regression test for blank names.

<details>
<summary>Fix Example: validate the name before connect</summary>

```js
const name = typeof input.server === 'string' ? input.server.trim() : '';
if (!name) throw new Error('Missing server name.');

const session = await connect(config, name);
```

</details>

<a id="error-52f6c1"></a>
### Server "{server}" was not found in configuration.

Thrown from: `connect`

The requested server key is not present in the loaded config map.

Step-by-step resolution:
1. List available server keys from config.
2. Compare exact key spelling and casing.
3. Verify the expected config file was loaded.
4. Add preflight validation before connect.

<details>
<summary>Fix Example: check available server names first</summary>

```js
const names = Array.from(config.map.keys());
if (!names.includes(target)) throw new Error(`Unknown server: ${target}`);
```

</details>

<a id="error-b7ab8a"></a>
### Expected config source to support get(name).

Thrown from: `select`

The first argument is not a `Map` or map-like object.

Step-by-step resolution:
1. Pass the `Config` object returned by `@mcp-layer/config`.
2. Or pass `config.map` directly.
3. Do not pass raw parsed JSON objects.
4. Add a type guard in callers.

<details>
<summary>Fix Example: pass a Config instance</summary>

```js
const config = await load(undefined, process.cwd());
const session = await connect(config, 'demo');
```

</details>

<a id="error-1e2f95"></a>
### Timed out while connecting to server "{server}" after {timeout}ms.

Thrown from: `connect`

The server accepted the transport but never completed the MCP initialization handshake before the deadline.

Step-by-step resolution:
1. Verify the server process is running and logging output.
2. Confirm the transport config (command/url) is correct.
3. Increase `timeout` if the server requires more startup time.
4. Add integration coverage for slow-start servers.

<details>
<summary>Fix Example: set a timeout for unresponsive servers</summary>

Use a connection timeout to fail fast when a server never completes initialization, and expect `connect` to reject with a `LayerError` if the deadline is exceeded.

```js
const session = await connect(config, 'demo', { timeout: 10_000 });
```

</details>

<a id="error-d05682"></a>
### Server "{server}" is missing a "command" property required for stdio transport.

Thrown from: `setup`

Stdio transport was selected but no executable command was provided.

Step-by-step resolution:
1. Add `command` to the server entry.
2. Provide optional `args` if required.
3. If the server is URL-based, use remote transport instead.
4. Add config tests for stdio and URL server entries.

<details>
<summary>Fix Example: define stdio command config</summary>

```json
{
  "servers": {
    "demo": {
      "command": "node",
      "args": ["./server.js"]
    }
  }
}
```

</details>

<a id="error-a36c6c"></a>
### Server "{server}" is missing a URL/endpoint required for remote transport.

Thrown from: `connect`

A remote transport (`streamable-http` or `sse`) was requested without `url` or `endpoint`.

Step-by-step resolution:
1. Add `url` or `endpoint` to the server entry.
2. Or pass `options.url` at connect time.
3. Confirm the value is not empty after env interpolation.
4. Add a negative test for missing URL.

<details>
<summary>Fix Example: define URL for remote transport</summary>

```json
{
  "servers": {
    "remote": {
      "url": "http://127.0.0.1:3000/mcp"
    }
  }
}
```

</details>

<a id="error-969028"></a>
### Server "{server}" URL "{url}" is not a valid URL.

Thrown from: `connect`

The provided URL cannot be parsed by the runtime URL parser.

Step-by-step resolution:
1. Ensure the value includes scheme (`http://` or `https://`).
2. Remove whitespace and malformed characters.
3. Validate URL formation before calling `connect`.
4. Add a test for invalid URL rejection.

<details>
<summary>Fix Example: use an absolute URL</summary>

```js
await connect(config, 'demo', { url: 'http://127.0.0.1:3000/mcp' });
```

</details>

<a id="error-6cc59a"></a>
### Transport "{transport}" is not supported. Use "stdio", "streamable-http", or "sse".

Thrown from: `connect`

`options.transport` was provided with an unsupported value.

Step-by-step resolution:
1. Use one of the supported transport values.
2. Prefer `streamable-http` for modern HTTP servers.
3. Use `sse` for legacy HTTP+SSE servers.
4. Add input validation in CLI/config layers.

<details>
<summary>Fix Example: choose a supported transport override</summary>

```js
await connect(config, 'demo', { transport: 'streamable-http' });
```

</details>

<a id="error-7bcd76"></a>
### Server "{server}" is missing a supported transport configuration.

Thrown from: `connect`

The entry has no recognized connection primitive (`command`, `url`, or `endpoint`) and no valid transport declaration.

Step-by-step resolution:
1. Add `command` for stdio servers or `url`/`endpoint` for remote servers.
2. Set a host-supported `type` or pass `options.transport` at runtime when needed.
3. Validate config schema before connect.
4. Add a failing fixture for empty server entries.

<details>
<summary>Fix Example: provide a concrete connection primitive</summary>

```json
{
  "servers": {
    "demo": {
      "command": "node",
      "args": ["./server.js"]
    }
  }
}
```

</details>

## License

MIT
