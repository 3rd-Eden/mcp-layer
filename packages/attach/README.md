# @mcp-layer/attach

`@mcp-layer/attach` attaches to an in-process MCP server instance and returns a shared `Session`. This is the way to layer REST/GraphQL/UI functionality on top of an existing server without spawning a new process.

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

## License

MIT
