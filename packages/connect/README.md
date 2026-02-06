# @mcp-layer/connect

`@mcp-layer/connect` turns normalized MCP server definitions into live client connections using the official MCP SDK. It is the transport layer for the workspace: given a server entry, it spawns the stdio process, completes the MCP handshake, and returns a `Session` you can close deterministically.


You should not have to rebuild MCP transport logic for every generator or tool. This package centralizes:
- stdio transport creation
- working directory + environment resolution
- consistent client identity (`MCP_CLIENT_AGENT`)
- a single close path for client + transport

## Table of Contents

- [Installation](#installation)
- [Usage](#usage)
- [Core concepts](#core-concepts)
- [API (authoritative)](#api-authoritative)
- [Behavior details](#behavior-details)
- [Responsibilities & lifecycle](#responsibilities-lifecycle)
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

```js
import { load } from '@mcp-layer/config';
import { connect } from '@mcp-layer/connect';

const config = await load(undefined, process.cwd());
const session = await connect(config, 'demo');

await session.client.ping();
await session.close();
```

## Core concepts

- **Session**: an object that owns the MCP client + transport and exposes a `close()` helper.
- **Entry**: a normalized server entry returned by `@mcp-layer/config`.
- **Source**: a `Config` instance or any object that exposes `get(name)` (including `Map`).

## API (authoritative)

### `select(source, name)`

Returns the server entry from a `Config` or `Map`.

### `setup(entry, options?)`

Normalizes transport parameters:
- `command` (required)
- `args` (optional)
- `cwd` (defaults to the directory of the config file)
- `env` (merged from entry + provided overrides)

It also adds the `MCP_CLIENT_AGENT` header derived from this package version.

### `connect(source, name, options?)`

Creates a `Client` and `StdioClientTransport`, runs MCP initialization, and returns a `Session`.

Options:
- `cwd` -- override working directory
- `env` -- environment overrides
- `stderr` -- control stderr handling (`pipe`, `inherit`, `overlapped`)
- `info` -- overrides for client `name`/`version`

### `Session` (re-exported from `@mcp-layer/session`)

Properties:
- `.client` -- MCP SDK client
- `.transport` -- stdio transport
- `.info` -- client identity used for initialization
- `.name` -- server name
- `.source` -- config file path

Method:
- `.close()` -- closes client and transport in order

## Behavior details

- **Stdio only**: this package currently supports stdio transports. URL/HTTP entries should be handled by a future transport package.
- **Relative paths**: working directory defaults to the config file location so relative `command` or `cwd` behave like they do in editors.
- **Environment merging**: config `env` is merged with caller `env`, where caller values win.
- **Error handling**: invalid input throws synchronously before any process is spawned.

## Responsibilities & lifecycle

- This package is responsible for connection lifecycle only.
- Use `@mcp-layer/schema` to extract tools/resources/prompts after you have a `Session`.
- Always call `session.close()` when you're done.

## Testing

```sh
pnpm test --filter @mcp-layer/connect
```

The integration suite spins up the real `@mcp-layer/test-server` binary, connects through stdio, and validates handshake + teardown behavior.

## Related packages

- [`@mcp-layer/config`](../config/README.md) for discovery and normalization.
- [`@mcp-layer/schema`](../schema/README.md) for schema extraction.
- [`@mcp-layer/test-server`](../test-server/README.md) for integration testing.

## Runtime Error Reference

This section is written for high-pressure debugging moments. Each entry maps to a concrete `@mcp-layer/connect` failure in config lookup or stdio transport setup.

<a id="error-e816b5"></a>
### Expected server name to be a non-empty string.

Thrown from: `connect`

This happens when `connect(src, name, opts)` receives an empty or non-string server name. The package cannot look up config entries without a valid key.

Step-by-step resolution:
1. Verify the `name` argument is the second positional parameter and is a non-empty string.
2. Check argument flow from CLI/env parsing to ensure `undefined` is not passed through.
3. Normalize user input (`trim`) and reject empty values before calling `connect`.
4. Add tests that reject empty names and accept known names.

<details>
<summary>Fix Example: validate the server key before connect</summary>

```js
const target = typeof input.server === 'string' ? input.server.trim() : '';
if (!target)
  throw new Error('connect() requires a non-empty server name.');

const session = await connect(config, target);
```

</details>

<a id="error-52f6c1"></a>
### Server "{server}" was not found in configuration.

Thrown from: `connect`

This happens when the provided server key does not exist in the loaded configuration map. `connect` calls `select(src, name)` and fails if no entry is found.

Step-by-step resolution:
1. Print available keys from `config.map` and compare exact spelling with `{server}`.
2. Confirm you loaded the expected config source/path before calling `connect`.
3. Ensure the server entry exists under `mcpServers`/`servers` in the file.
4. Add a preflight check that lists valid names in the user-facing error path.

<details>
<summary>Fix Example: verify configured server names before connect</summary>

```js
const names = Array.from(config.map.keys());
if (!names.includes(target))
  throw new Error(`Unknown server "${target}". Available: ${names.join(', ')}`);

const session = await connect(config, target);
```

</details>

<a id="error-b7ab8a"></a>
### Expected config source to support get(name).

Thrown from: `select`

This happens when `src` is neither a `Map` nor a map-like object implementing `get(name)`. Passing raw arrays/plain objects directly will trigger this guard.

Step-by-step resolution:
1. Check the value passed as `src` and confirm it is the `Config` object (or `config.map`) returned by `@mcp-layer/config`.
2. Do not pass raw parsed JSON directly into `connect` unless you wrap it with a `get` method.
3. Standardize your integration on `load(...)` from `@mcp-layer/config`.
4. Add an integration test that passes `Config` and rejects plain object input.

<details>
<summary>Fix Example: pass a Config map-like source into connect</summary>

```js
const config = await load(undefined, process.cwd());
const session = await connect(config, 'local-dev');
await session.close();
```

</details>

<a id="error-d05682"></a>
### Server "{server}" is missing a "command" property required for stdio transport.

Thrown from: `setup`

This happens when the selected server config does not define a `command`. `@mcp-layer/connect` uses `StdioClientTransport`, so it can only launch command-based MCP servers.

Step-by-step resolution:
1. Inspect the server entry in config and confirm `command` is present and non-empty.
2. If the entry is URL-only (`url`/`endpoint`), route through an HTTP/SSE-capable path instead of stdio connect.
3. Ensure connector parsing preserves `command` when reading the config format.
4. Add a test for one valid stdio server entry and one invalid URL-only entry.

<details>
<summary>Fix Example: define a stdio command in the server config</summary>

```js
{
  "mcpServers": {
    "local-dev": {
      "command": "node",
      "args": ["./server.js"]
    }
  }
}
```

</details>

## License

MIT
