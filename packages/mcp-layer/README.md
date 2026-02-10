# mcp-layer

`mcp-layer` is a standalone npm package that re-exports MCP Layer modules behind a single import path.

It is useful when you want one dependency and one import statement, while still accessing the full public APIs from the underlying `@mcp-layer/*` packages.

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

`mcp-layer` exports namespace bindings. Each export is the module namespace of the underlying package:

- `attach`: `typeof import('@mcp-layer/attach')`
- `cli`: `typeof import('@mcp-layer/cli')`
- `config`: `typeof import('@mcp-layer/config')`
- `connect`: `typeof import('@mcp-layer/connect')`
- `error`: `typeof import('@mcp-layer/error')`
- `gateway`: `typeof import('@mcp-layer/gateway')`
- `graphql`: `typeof import('@mcp-layer/graphql')`
- `manager`: `typeof import('@mcp-layer/manager')`
- `openapi`: `typeof import('@mcp-layer/openapi')`
- `rest`: `typeof import('@mcp-layer/rest')`
- `schema`: `typeof import('@mcp-layer/schema')`
- `session`: `typeof import('@mcp-layer/session')`
- `testServer`: `typeof import('@mcp-layer/test-server')`

### Namespace Documentation

Each namespace has its own README with complete API details, options, return shapes, and package-specific error behavior.

- `attach`: https://github.com/3rd-Eden/mcp-layer/blob/main/packages/attach/README.md
- `cli`: https://github.com/3rd-Eden/mcp-layer/blob/main/packages/cli/README.md
- `config`: https://github.com/3rd-Eden/mcp-layer/blob/main/packages/config/README.md
- `connect`: https://github.com/3rd-Eden/mcp-layer/blob/main/packages/connect/README.md
- `error`: https://github.com/3rd-Eden/mcp-layer/blob/main/packages/error/README.md
- `gateway`: https://github.com/3rd-Eden/mcp-layer/blob/main/packages/gateway/README.md
- `graphql`: https://github.com/3rd-Eden/mcp-layer/blob/main/packages/graphql/README.md
- `manager`: https://github.com/3rd-Eden/mcp-layer/blob/main/packages/manager/README.md
- `openapi`: https://github.com/3rd-Eden/mcp-layer/blob/main/packages/openapi/README.md
- `rest`: https://github.com/3rd-Eden/mcp-layer/blob/main/packages/rest/README.md
- `schema`: https://github.com/3rd-Eden/mcp-layer/blob/main/packages/schema/README.md
- `session`: https://github.com/3rd-Eden/mcp-layer/blob/main/packages/session/README.md
- `testServer`: https://github.com/3rd-Eden/mcp-layer/blob/main/packages/test-server/README.md

### Error Behavior

This package does not introduce a custom runtime layer. Errors are raised by whichever namespace package you call.

For structured runtime errors, refer to the package-level error sections in the linked namespace READMEs.

## Standards and Portability

MCP behavior follows the official MCP specification and official TypeScript SDK contracts:

- https://modelcontextprotocol.io/specification
- https://modelcontextprotocol.io/specification/latest/basic/transports
- https://github.com/modelcontextprotocol/typescript-sdk

## License

MIT
