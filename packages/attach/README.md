# @mcp-layer/attach

`@mcp-layer/attach` attaches to an in-process MCP server instance and returns a shared `Session`. This is the way to layer REST/GraphQL/UI functionality on top of an existing server without spawning a new process.

## Table of Contents

- [Installation](#installation)
- [Usage](#usage)
- [Platformatic MCP (Fastify)](#platformatic-mcp-fastify)
- [When to use attach vs connect](#when-to-use-attach-vs-connect)
- [API (authoritative)](#api-authoritative)
- [Behavior and constraints](#behavior-and-constraints)
- [Testing](#testing)
- [Runtime Error Reference](#runtime-error-reference)

## Installation

```sh
pnpm add @mcp-layer/attach
# or
npm install @mcp-layer/attach
# or
yarn add @mcp-layer/attach
```

## Usage

```js
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { attach } from '@mcp-layer/attach';

const server = new McpServer({ name: 'my-server', version: '1.0.0' });

// Register tools/resources/prompts on the server before attaching.
// server.registerTool(...)
// server.registerResource(...)

const session = await attach(server, 'my-server');

await session.client.ping();
await session.close();
```

## Platformatic MCP (Fastify)

If you're using the Platformatic MCP Fastify plugin, you can pass the Fastify instance directly to `attach` and the adapter will talk to the MCP endpoint in-process.

```js
import fastify from 'fastify';
import mcp from '@platformatic/mcp';
import { attach } from '@mcp-layer/attach';

const app = fastify();
await app.register(mcp, {
  serverInfo: { name: 'platformatic-demo', version: '1.0.0' }
});

// Register tools/resources/prompts using app.mcpAddTool/app.mcpAddResource/app.mcpAddPrompt.

const session = await attach(app, 'platformatic-demo', { path: '/mcp' });
await session.client.ping();
await session.close();
await app.close();
```

Notes:
- This adapter uses Fastify `inject()` against the MCP HTTP endpoint (default `/mcp`).
- Pass `path` when your MCP endpoint is mounted elsewhere.

## When to use attach vs connect

- Use `attach` when you already have an in-process `McpServer` instance and want to layer new behavior (REST/GraphQL/UI) without spawning another process.
- Use `@mcp-layer/connect` when you only have a configuration entry and need to spawn a stdio process.

## API (authoritative)

### `attach(server, name, options?)`

- `server`: an `McpServer` or `Server` instance from the MCP SDK
- `name`: logical server name for the Session
- `options`:
  - `info`: overrides for client identity (`name`, `version`)
  - `source`: override the Session source string (defaults to `in-memory`)

Returns a `Session` (from `@mcp-layer/session`) with:
- `client`, `transport`, `info`, `name`, `source`, `entry`

## Behavior and constraints

- **In-memory transport**: attach uses the SDK’s in-memory transport to connect client and server inside one process.
- **Single transport**: the target server must not already be connected. If it is, `attach` throws.
- **Lifecycle**: `session.close()` closes the client and the in-memory transport. The server instance remains yours to manage.
- **Errors**: if the server fails during handshake, the attach call will throw; you are still responsible for server cleanup.

## Testing

```sh
pnpm test --filter @mcp-layer/attach
```

## Runtime Error Reference

This section is written for high-pressure debugging moments. Each entry maps directly to the `@mcp-layer/attach` call path and transport lifecycle.

<a id="error-b7d53a"></a>
### Expected server name to be a non-empty string.

Thrown from: `attach`

This happens when `attach(instance, name, opts)` receives a missing or blank `name`. The value is used as `Session.name`, so attach fails before opening transports.

Step-by-step resolution:
1. Inspect the `attach(...)` call site and confirm the second argument is a non-empty string.
2. Check for argument shifting bugs (for example passing `opts` as the second argument by mistake).
3. Normalize CLI/env inputs (`trim`) before passing the session name.
4. Add a test that rejects empty names and accepts a valid one.

<details>
<summary>Fix Example: validate the session name before calling attach</summary>

```js
const name = typeof input.name === 'string' ? input.name.trim() : '';
if (!name)
  throw new Error('attach() requires a non-empty session name.');

const session = await attach(server, name, { source: 'in-memory' });
```

</details>

<a id="error-d0513e"></a>
### Server is already connected to a transport; attach requires an unconnected server.

Thrown from: `attach`

This happens when the SDK server instance already has an attached transport (`server.transport`). `attach` intentionally refuses to stack a second transport onto the same server instance.

Step-by-step resolution:
1. Find where the same server object is reused across multiple `attach` calls.
2. Confirm whether another code path already called `server.connect(...)`.
3. Use one attach per server instance, or construct a fresh server for each independent session.
4. Add lifecycle tests that fail on duplicate attach and pass on fresh instances.

<details>
<summary>Fix Example: use a fresh server instance for each attach lifecycle</summary>

```js
const serverA = createMcpServer();
const sessionA = await attach(serverA, 'a');

const serverB = createMcpServer();
const sessionB = await attach(serverB, 'b');

await Promise.all([sessionA.close(), sessionB.close()]);
```

</details>

<a id="error-895e0e"></a>
### Unknown attach provider "{provider}".

Thrown from: `attachWithProvider`

This happens when provider resolution returns a name that `attachWithProvider` does not implement. Right now the package only supports the `platformatic` provider branch.

Step-by-step resolution:
1. Confirm the incoming instance is actually a Platformatic Fastify MCP instance (`mcpAddTool` + `inject`).
2. If the instance is wrapped, pass the underlying MCP server object (`wrapper.server`) to `attach`.
3. If you are adding a new runtime integration, implement a provider branch before calling with that provider id.
4. Add a test for provider detection and branch coverage.

<details>
<summary>Fix Example: pass a supported instance type into attach</summary>

```js
const target = app.server ?? app;
const session = await attach(target, 'api');
await session.close();
```

</details>

<a id="error-848c8e"></a>
### Transport is not started.

Thrown from: `FastifyInjectTransport.send`

This happens when `FastifyInjectTransport.send(...)` is invoked before the transport has been started. In normal flows, `client.connect(transport)` starts it; direct low-level send calls can bypass that.

Step-by-step resolution:
1. Check whether code is calling transport internals directly instead of going through `Client`/`Session`.
2. Ensure connection initialization (`client.connect(...)` or `attach(...)`) happens before any request send.
3. Remove direct transport calls from tests unless you explicitly start the transport.
4. Add a regression test for aborted pre-start sends if you maintain custom transport code.

<details>
<summary>Fix Example: use attach/session APIs instead of raw transport send</summary>

```js
const session = await attach(app, 'fastify-dev', { path: '/mcp' });
const tools = await session.client.listTools();
console.log(tools.tools.length);
await session.close();
```

</details>

<a id="error-ffb926"></a>
### Expected an MCP server instance.

Thrown from: `resolveServer`

This happens when `attach` receives a value that is not an MCP SDK server instance, not a wrapper exposing `.server`, and not a supported provider instance.

Step-by-step resolution:
1. Log the exact object passed to `attach` and verify its shape.
2. Pass an actual MCP server instance (`McpServer`/SDK `Server`) or supported wrapper.
3. If you are integrating a framework wrapper, pass the underlying `.server` object.
4. Add a type guard before `attach` in your integration boundary.

<details>
<summary>Fix Example: construct and pass a real MCP SDK server instance</summary>

```js
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

const server = new McpServer({ name: 'demo', version: '1.0.0' });
const session = await attach(server, 'demo');
await session.close();
```

</details>

## License

MIT
