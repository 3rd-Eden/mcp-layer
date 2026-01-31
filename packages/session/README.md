# @mcp-layer/session

`@mcp-layer/session` provides the shared Session class used by both `@mcp-layer/connect` and `@mcp-layer/attach`. A Session is the handle you pass around when layering new functionality on top of an MCP server.

## Why this exists

Multiple packages return the same connected handle. To avoid duplication and drift, the Session class lives here and is re-exported by other packages.

## Usage

```js
import { Session } from '@mcp-layer/session';
```

Most users do not construct Session manually. Instead, create one via:
- `@mcp-layer/connect` (remote/stdio transport)
- `@mcp-layer/attach` (in-process server instance)

## Session shape

A Session instance contains:
- `client` - MCP SDK client
- `transport` - the active transport (stdio or in-memory)
- `info` - client identity
- `name` - logical server name
- `source` - source string (config path or `in-memory`)
- `entry` - server entry when available (otherwise `null`)

## Lifecycle

Always call `session.close()` when you are done to close the client and transport.

## License

MIT
