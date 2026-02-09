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
- [API Reference](#api-reference)
- [Behavior details](#behavior-details)
- [Testing](#testing)
- [Related packages](#related-packages)
- [Runtime Error Reference](#runtime-error-reference)

## Installation

```sh
pnpm add @mcp-layer/connect
# or
npm install @mcp-layer/connect
# or
yarn add @mcp-layer/connect
```

## Usage

Use the configured server key with `connect`; the package resolves transport from that entry.

```js
import { load } from '@mcp-layer/config';
import { connect } from '@mcp-layer/connect';

const config = await load(undefined, process.cwd());
// "demo" is the configured server name, not a transport label.
const session = await connect(config, 'demo');

await session.client.ping();
await session.close();
```

For URL-based entries, transport is selected automatically (defaults to Streamable HTTP).

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

For legacy servers, force SSE with an explicit override.

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

## API Reference

### `select(source, name)`

Returns a server entry from a `Map` or any object implementing `get(name)`.

### `setup(entry, options?)`

Builds stdio spawn settings (`command`, `args`, `cwd`, `env`, `stderr`).

### `connect(source, name, options?)`

Creates an SDK `Client`, instantiates the chosen transport, performs MCP handshake, and returns a `Session`.

Options include:
- `info`
- `transport`
- `url`
- `cwd`
- `env`
- `stderr`
- `requestInit`
- `eventSourceInit`
- `fetch`
- `sessionId`
- `reconnectionOptions`

### `Session` (re-exported from `@mcp-layer/session`)

Properties:
- `.client`
- `.transport`
- `.info`
- `.name`
- `.source`

Method:
- `.close()`

## Behavior details

- Stdio defaults `cwd` to the config file directory.
- `opts.env` overrides entry `env` values.
- URL-based entries default to Streamable HTTP unless `options.transport` is explicitly `sse`.
- Invalid transport and URL values fail fast with `LayerError`.

## Testing

```sh
pnpm test --filter @mcp-layer/connect
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
