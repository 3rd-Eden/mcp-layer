# mcp-layer

`mcp-layer` is the npm entry point for MCP Layer, a toolkit for building production-ready interfaces on top of any MCP server.

Use it to discover MCP configs, connect sessions, normalize catalogs, and expose those capabilities through CLI, REST, GraphQL, and OpenAPI layers in one cohesive stack.

## Install

Use your package manager of choice to install `mcp-layer` in any Node.js project.

```sh
npm install mcp-layer
pnpm add mcp-layer
yarn add mcp-layer
```

## Quick Start

This example demonstrates the primary workflow: load MCP configuration, open a session, and extract a normalized catalog from one package import. This matters when you want to wire a prototype quickly without managing multiple top-level dependencies.

```js
import { config, connect, schema } from 'mcp-layer';

const cfg = await config.load(undefined, process.cwd());
const session = await connect.connect(cfg, 'demo');
const catalog = await schema.extract(session);

console.log(catalog.items?.length ?? 0);
await session.close();
```

Running this script prints the number of discovered catalog items for the selected server.

## API Reference

`mcp-layer` exports package namespaces. Use the links below as the canonical API documentation for each namespace.

| Namespace export | Documentation |
| --- | --- |
| `attach` | [`@mcp-layer/attach` README](https://github.com/3rd-Eden/mcp-layer/blob/main/packages/attach/README.md) |
| `cli` | [`@mcp-layer/cli` README](https://github.com/3rd-Eden/mcp-layer/blob/main/packages/cli/README.md) |
| `config` | [`@mcp-layer/config` README](https://github.com/3rd-Eden/mcp-layer/blob/main/packages/config/README.md) |
| `connect` | [`@mcp-layer/connect` README](https://github.com/3rd-Eden/mcp-layer/blob/main/packages/connect/README.md) |
| `error` | [`@mcp-layer/error` README](https://github.com/3rd-Eden/mcp-layer/blob/main/packages/error/README.md) |
| `gateway` | [`@mcp-layer/gateway` README](https://github.com/3rd-Eden/mcp-layer/blob/main/packages/gateway/README.md) |
| `graphql` | [`@mcp-layer/graphql` README](https://github.com/3rd-Eden/mcp-layer/blob/main/packages/graphql/README.md) |
| `manager` | [`@mcp-layer/manager` README](https://github.com/3rd-Eden/mcp-layer/blob/main/packages/manager/README.md) |
| `openapi` | [`@mcp-layer/openapi` README](https://github.com/3rd-Eden/mcp-layer/blob/main/packages/openapi/README.md) |
| `rest` | [`@mcp-layer/rest` README](https://github.com/3rd-Eden/mcp-layer/blob/main/packages/rest/README.md) |
| `schema` | [`@mcp-layer/schema` README](https://github.com/3rd-Eden/mcp-layer/blob/main/packages/schema/README.md) |
| `session` | [`@mcp-layer/session` README](https://github.com/3rd-Eden/mcp-layer/blob/main/packages/session/README.md) |
| `testServer` | [`@mcp-layer/test-server` README](https://github.com/3rd-Eden/mcp-layer/blob/main/packages/test-server/README.md) |

### Error Behavior

This package does not introduce a custom runtime layer. Errors are raised by whichever namespace package you call.

For structured runtime errors, refer to the package-level error sections in the linked namespace READMEs.

## Standards and Portability

MCP behavior follows the official MCP specification and official TypeScript SDK contracts:

- [Model Context Protocol specification](https://modelcontextprotocol.io/specification)
- [MCP transport specification](https://modelcontextprotocol.io/specification/latest/basic/transports)
- [Model Context Protocol TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)

## License

MIT
