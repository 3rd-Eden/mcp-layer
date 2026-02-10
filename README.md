# MCP Layer

Build production-ready interfaces on top of any MCP server without rewriting transport, schema, or adapter plumbing.

MCP Layer is a collection of focused packages that help you discover server configs, connect sessions, normalize catalogs, and expose those capabilities through CLI, REST, and GraphQL surfaces. You can adopt one package at a time, or use the aggregate `mcp-layer` package when you want a single import path.

## Why teams use MCP Layer

- Ship faster: start from a real MCP server and generate usable interfaces quickly.
- Keep contracts consistent: drive adapters from one normalized catalog.
- Stay portable: align with MCP transport semantics and official SDK behavior.
- Scale safely: shared validation, resilience, and telemetry primitives are built in.

## What you can build

- CLI tooling for MCP tools, prompts, resources, and templates.
- REST gateways with OpenAPI 3.1 output.
- GraphQL gateways backed by MCP catalogs.
- Internal developer portals and UI layers over MCP resources.
- Integration test harnesses using a feature-complete local MCP server.

## Package catalog

### Foundation and runtime

| Package | Purpose |
| --- | --- |
| [`@mcp-layer/config`](packages/config/README.md) | Discover and normalize MCP server config files across host tools. |
| [`@mcp-layer/session`](packages/session/README.md) | Shared `Session` handle used by connect/attach and adapters. |
| [`@mcp-layer/connect`](packages/connect/README.md) | Connect to stdio, Streamable HTTP, or SSE MCP servers. |
| [`@mcp-layer/attach`](packages/attach/README.md) | Attach to in-process MCP SDK servers. |
| [`@mcp-layer/schema`](packages/schema/README.md) | Extract and normalize tool/resource/prompt/template catalogs. |
| [`@mcp-layer/gateway`](packages/gateway/README.md) | Shared adapter runtime primitives for validation, resilience, telemetry, and mapping. |
| [`@mcp-layer/test-server`](packages/test-server/README.md) | Feature-complete MCP server for integration testing and local exploration. |

### Interfaces and adapters

| Package | Purpose |
| --- | --- |
| [`@mcp-layer/cli`](packages/cli/README.md) | Build CLI surfaces from MCP catalogs. |
| [`@mcp-layer/openapi`](packages/openapi/README.md) | Generate OpenAPI 3.1 specs from extracted catalogs. |
| [`@mcp-layer/rest`](packages/rest/README.md) | Expose MCP sessions through Fastify REST routes. |
| [`@mcp-layer/graphql`](packages/graphql/README.md) | Expose MCP catalogs through GraphQL. |

### Aggregate package

| Package | Purpose |
| --- | --- |
| [`mcp-layer`](packages/mcp-layer/README.md) | Re-export workspace packages as a single namespace import. |

## Quick start

This first example is the fastest path to validate an end-to-end MCP workflow in your own environment. It discovers config, opens a session, extracts the normalized catalog, and prints item names.

```js
import { load } from '@mcp-layer/config';
import { connect } from '@mcp-layer/connect';
import { extract } from '@mcp-layer/schema';

const cfg = await load(undefined, process.cwd());
const session = await connect(cfg, 'demo');

const catalog = await extract(session);
console.log(catalog.items?.map(function names(item) { return item.name; }) ?? []);

await session.close();
```

When this succeeds, you should see an array of discovered catalog item names in stdout.

If you prefer a single import during prototyping, the aggregate package exposes the same surface as namespace exports:

```js
import { config, connect, schema } from 'mcp-layer';

const cfg = await config.load(undefined, process.cwd());
const session = await connect.connect(cfg, 'demo');
const catalog = await schema.extract(session);

console.log(catalog.items?.length ?? 0);
await session.close();
```

That run should print the catalog item count while keeping version alignment across package namespaces.

<details>
<summary>Advanced example: generate OpenAPI from an in-process MCP server</summary>

Use this pattern when you want deterministic API contracts in tests or local tooling, without depending on an external MCP deployment.

```js
import { attach } from '@mcp-layer/attach';
import { extract } from '@mcp-layer/schema';
import { spec } from '@mcp-layer/openapi';
import { build } from '@mcp-layer/test-server';

const server = build();
const session = await attach(server, 'local');

const catalog = await extract(session);
const openapi = spec(catalog, {
  title: 'Local MCP API',
  version: '0.1.0',
  prefix: '/v1'
});

console.log(openapi.openapi);

await session.close();
await server.close();
```

A healthy run prints `3.1.0` and gives you a complete OpenAPI document from the live catalog.

</details>

## CLI quick try

If you already have an MCP config on disk, this is the quickest way to confirm discovery and command generation are working:

```sh
mcp-layer servers list
mcp-layer tools list --server <name>
mcp-layer tools <tool> --help
```

You should first see discovered server names, then tool inventory and command-level help for the chosen server.

## API reference (`mcp-layer` aggregate package)

The aggregate package does not add a custom runtime abstraction. It re-exports package namespaces so you can import once and compose as needed.

### Module shape

```js
import {
  attach,
  cli,
  config,
  connect,
  error,
  gateway,
  graphql,
  manager,
  openapi,
  rest,
  schema,
  session,
  testServer
} from 'mcp-layer';
```

Each namespace value is the module namespace of its underlying package (`typeof import('<package>')`).

### Namespace exports

| Export | Type signature | API docs |
| --- | --- | --- |
| `attach` | `typeof import('@mcp-layer/attach')` | [`packages/attach/README.md`](packages/attach/README.md) |
| `cli` | `typeof import('@mcp-layer/cli')` | [`packages/cli/README.md`](packages/cli/README.md) |
| `config` | `typeof import('@mcp-layer/config')` | [`packages/config/README.md`](packages/config/README.md) |
| `connect` | `typeof import('@mcp-layer/connect')` | [`packages/connect/README.md`](packages/connect/README.md) |
| `error` | `typeof import('@mcp-layer/error')` | [`packages/error/README.md`](packages/error/README.md) |
| `gateway` | `typeof import('@mcp-layer/gateway')` | [`packages/gateway/README.md`](packages/gateway/README.md) |
| `graphql` | `typeof import('@mcp-layer/graphql')` | [`packages/graphql/README.md`](packages/graphql/README.md) |
| `manager` | `typeof import('@mcp-layer/manager')` | [`packages/manager/README.md`](packages/manager/README.md) |
| `openapi` | `typeof import('@mcp-layer/openapi')` | [`packages/openapi/README.md`](packages/openapi/README.md) |
| `rest` | `typeof import('@mcp-layer/rest')` | [`packages/rest/README.md`](packages/rest/README.md) |
| `schema` | `typeof import('@mcp-layer/schema')` | [`packages/schema/README.md`](packages/schema/README.md) |
| `session` | `typeof import('@mcp-layer/session')` | [`packages/session/README.md`](packages/session/README.md) |
| `testServer` | `typeof import('@mcp-layer/test-server')` | [`packages/test-server/README.md`](packages/test-server/README.md) |

### Error behavior

Errors come from the underlying package implementations. The aggregate package does not wrap or remap those contracts.

For package-specific runtime error references and remediation steps:

- [`@mcp-layer/config` runtime error reference](packages/config/README.md#runtime-error-reference)
- [`@mcp-layer/rest` runtime error reference](packages/rest/README.md#runtime-error-reference)
- [`mcp-layer` package error behavior](packages/mcp-layer/README.md#error-behavior)

## Standards and portability

MCP Layer is standards-first, with host-specific behavior isolated to connectors and runtime options.

- MCP specification: [Model Context Protocol](https://modelcontextprotocol.io/specification)
- MCP transports: [Transport specification](https://modelcontextprotocol.io/specification/latest/basic/transports)
- SDK baseline: [@modelcontextprotocol/sdk](https://github.com/modelcontextprotocol/typescript-sdk)

For host-tool config schema references (Claude, Cursor, Codex, VS Code, Cline, and others), use the connector documentation in [`@mcp-layer/config`](packages/config/README.md#connectors-discovery-parsing).

## Development workflow

```sh
pnpm install
pnpm test
```

These commands install workspace dependencies and run all package test suites from the repository root.

When iterating on a single area, run package-scoped commands:

```sh
pnpm --filter @mcp-layer/config test
pnpm --filter mcp-layer prepack
pnpm --filter mcp-layer test
```

## Release workflow

MCP Layer uses Changesets and a GitHub Actions release workflow.

1. Create a changeset with `pnpm changeset`.
2. Merge the generated version PR (`changeset-release/main`).
3. Publish through the `Release` GitHub Actions workflow (npm Trusted Publishing / OIDC).

The aggregate package prepack behavior is maintained in [`packages/mcp-layer`](packages/mcp-layer/README.md).

## Repository guidelines

Contributor standards and required workflows are documented in [`AGENTS.md`](AGENTS.md).

## License

MIT
