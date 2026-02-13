# @mcp-layer/session

`@mcp-layer/session` provides the shared `Session` class used by both `@mcp-layer/connect` and `@mcp-layer/attach`.

Most consumers should treat `Session` as the canonical runtime handle for MCP operations: it bundles client, transport, source metadata, and close semantics in one object.

## Installation

```sh
pnpm add @mcp-layer/session
```

## API Reference

### `new Session(data)`

Creates a session wrapper around an already initialized MCP client + transport pair.

`data` fields:

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `name` | `string` | yes | Logical server name for routing/telemetry. |
| `source` | `string` | yes | Session source label (config path or `in-memory`). |
| `entry` | `{ name, source, config } \| null` | yes | Resolved config entry, if available. |
| `client` | MCP SDK client | yes | Initialized MCP client instance. |
| `transport` | `unknown` | yes | Backing transport object used by the client. |
| `info` | `{ name: string, version: string }` | yes | Client identity metadata used during handshake. |

Exposed instance properties:

- `session.name`
- `session.source`
- `session.entry`
- `session.client`
- `session.transport`
- `session.info`

### `session.close()`

Closes client first, then transport (if the transport exposes a `close()` function).

Signature:

```ts
close(): Promise<void>
```

## Usage patterns

This example demonstrates the typical path: create a session through `@mcp-layer/connect`, call MCP methods, and always close in a `finally` block. Expected behavior: methods execute through one reusable handle and transport resources are released on exit.

```js
import { load } from '@mcp-layer/config';
import { connect } from '@mcp-layer/connect';

const config = await load(undefined, process.cwd());
const session = await connect(config, 'demo');

try {
  const tools = await session.client.listTools({});
  console.log(tools.tools.map(function mapName(tool) {
    return tool.name;
  }));
} finally {
  await session.close();
}
```

This example demonstrates manual `Session` construction for advanced integration scenarios (custom bootstrapping/testing). Expected behavior: you can wrap any MCP client/transport pair while preserving one session contract for downstream packages.

```js
import { Session } from '@mcp-layer/session';

const session = new Session({
  name: 'custom',
  source: 'in-memory',
  entry: null,
  client,
  transport,
  info: { name: 'custom-client', version: '0.1.0' }
});
```

## Lifecycle and ownership

- `Session` itself does not own connection setup; `@mcp-layer/connect` and `@mcp-layer/attach` do.
- `Session` does own unified teardown through `close()`.
- Reusing one session for multiple calls is expected and preferred to repeated reconnects.

## Error behavior

`@mcp-layer/session` does not define custom `LayerError` branches; failures are surfaced by underlying client/transport implementations invoked through `close()` or downstream MCP calls.

## License

MIT
