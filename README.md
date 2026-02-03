# MCP Layer

`mcp-layer` helps engineers bolt extra behaviors on top of existing MCP servers without reimplementing transport or schema parsing. It is a small, focused toolbox for discovering MCP configs, connecting to servers, and extracting a unified schema that can drive CLIs, REST APIs, UI renderers, or additional MCP layers.

## What you can build with this repo

- **CLI layers** that expose MCP tools as commands with validated input.
- **REST gateways** that generate endpoints and schemas from MCP tool definitions.
- **UI renderers** that surface MCP Apps resources using `_meta.ui` metadata.
- **New MCP layers** that programmatically reason about tool/resource catalogs.

## Packages

### Infrastructure and utilities

| Package | Purpose |
| --- | --- |
| [`@mcp-layer/config`](packages/config/README.md) | Discover and normalize MCP server configs across editors/clients. |
| [`@mcp-layer/session`](packages/session/README.md) | Shared Session handle used by connect and attach. |
| [`@mcp-layer/connect`](packages/connect/README.md) | Connect to MCP servers over stdio and return a closeable Session. |
| [`@mcp-layer/attach`](packages/attach/README.md) | Attach to in-process MCP servers and return a Session. |
| [`@mcp-layer/schema`](packages/schema/README.md) | Extract tools/resources/prompts/templates into a unified Zod-backed schema (including MCP Apps metadata). |
| [`@mcp-layer/test-server`](packages/test-server/README.md) | Feature-complete MCP server for integration tests and local exploration. |

### Layers and interfaces

| Package | Purpose |
| --- | --- |
| [`@mcp-layer/cli`](packages/cli/README.md) | CLI framework for turning MCP schemas into commands. |

## CLI quick try

If you already have an MCP config on disk, you can try the CLI immediately:

```sh
mcp-layer servers list
mcp-layer tools list --server <name>
mcp-layer tools <tool> --help
```

## Quick start (end-to-end)

```js
import { load } from '@mcp-layer/config';
import { connect } from '@mcp-layer/connect';
import { extract } from '@mcp-layer/schema';

const config = await load(undefined, process.cwd());
const session = await connect(config, 'demo');

const schema = await extract(session);
console.log(schema.items.map((item) => item.name));

await session.close();
```

## Design principles

- **Single source of truth**: normalized schemas flow from the MCP server, not from tool-specific parsing.
- **Minimal surface area**: each package does one job and composes cleanly with the others.
- **Real integration tests**: no mocks; the test server is used as a real MCP target.

## Development

```sh
pnpm install
pnpm test
```

## Releasing

We use Changesets to manage versions and a GitHub Actions release workflow to publish packages. In short:

1) Add a changeset: `pnpm changeset`
2) Merge the Changesets PR
3) GitHub Actions publishes via npm Trusted Publishing (OIDC)

Before publishing, configure npm Trusted Publishers for each package in the npm registry and ensure the release workflow has `id-token: write` permissions.

See `.github/workflows/release.yml` for the pipeline details.

## Repository guidelines

See `AGENTS.md` for coding style, testing requirements, and documentation expectations.

## License

MIT
