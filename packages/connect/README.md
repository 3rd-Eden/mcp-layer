# @mcp-layer/connect

`@mcp-layer/connect` turns normalized MCP server definitions into live client connections using the official MCP SDK. It is the transport layer for the workspace: given a server entry, it spawns the stdio process, completes the MCP handshake, and returns a `Session` you can close deterministically.

## Why this exists

You should not have to rebuild MCP transport logic for every generator or tool. This package centralizes:
- stdio transport creation
- working directory + environment resolution
- consistent client identity (`MCP_CLIENT_AGENT`)
- a single close path for client + transport

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

## License

MIT
