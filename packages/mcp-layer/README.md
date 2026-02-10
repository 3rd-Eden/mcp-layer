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

`mcp-layer` exports package namespaces. If you are new to MCP Layer, this table explains what each namespace is for and links to full package documentation.

| Namespace export | Purpose | Documentation |
| --- | --- | --- |
| `attach` | Attach to in-process MCP SDK servers without launching external transports. | [`@mcp-layer/attach` README](https://github.com/3rd-Eden/mcp-layer/blob/main/packages/attach/README.md) |
| `cli` | Build command-line interfaces for MCP tools, prompts, resources, and templates. | [`@mcp-layer/cli` README](https://github.com/3rd-Eden/mcp-layer/blob/main/packages/cli/README.md) |
| `config` | Discover and normalize MCP server configuration across host tools. | [`@mcp-layer/config` README](https://github.com/3rd-Eden/mcp-layer/blob/main/packages/config/README.md) |
| `connect` | Connect to MCP servers over stdio, Streamable HTTP, or SSE. | [`@mcp-layer/connect` README](https://github.com/3rd-Eden/mcp-layer/blob/main/packages/connect/README.md) |
| `error` | Create structured runtime errors with stable references and docs links. | [`@mcp-layer/error` README](https://github.com/3rd-Eden/mcp-layer/blob/main/packages/error/README.md) |
| `gateway` | Reuse shared adapter runtime primitives for mapping, validation, resilience, and telemetry. | [`@mcp-layer/gateway` README](https://github.com/3rd-Eden/mcp-layer/blob/main/packages/gateway/README.md) |
| `graphql` | Expose MCP catalogs and operations through GraphQL. | [`@mcp-layer/graphql` README](https://github.com/3rd-Eden/mcp-layer/blob/main/packages/graphql/README.md) |
| `manager` | Manage authenticated and shared MCP sessions with reuse and limits. | [`@mcp-layer/manager` README](https://github.com/3rd-Eden/mcp-layer/blob/main/packages/manager/README.md) |
| `openapi` | Generate OpenAPI 3.1 documents from MCP catalogs. | [`@mcp-layer/openapi` README](https://github.com/3rd-Eden/mcp-layer/blob/main/packages/openapi/README.md) |
| `rest` | Expose MCP sessions as REST endpoints with Fastify. | [`@mcp-layer/rest` README](https://github.com/3rd-Eden/mcp-layer/blob/main/packages/rest/README.md) |
| `schema` | Extract and normalize tools, resources, prompts, and templates into a consistent catalog. | [`@mcp-layer/schema` README](https://github.com/3rd-Eden/mcp-layer/blob/main/packages/schema/README.md) |
| `session` | Use the shared session abstraction across connectors and adapters. | [`@mcp-layer/session` README](https://github.com/3rd-Eden/mcp-layer/blob/main/packages/session/README.md) |
| `testServer` | Run a feature-complete local MCP server for development and integration tests. | [`@mcp-layer/test-server` README](https://github.com/3rd-Eden/mcp-layer/blob/main/packages/test-server/README.md) |

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
