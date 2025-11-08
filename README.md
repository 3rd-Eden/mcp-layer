# MCP Layer

`mcp-layer` helps engineers bolt extra behaviours on top of existing MCP servers without reimplementing transport details. This repository currently ships discovery and connection helpers built on top of the official [@modelcontextprotocol/sdk](https://www.npmjs.com/package/@modelcontextprotocol/sdk).

## Installation

```sh
pnpm add @mcp-layer/config
# or
npm install @mcp-layer/config
# or
yarn add @mcp-layer/config
```

## Packages

| Package | Description |
| --- | --- |
| [`@mcp-layer/config`](packages/config/README.md) | Walks upward from a starting directory to find `.mcp.json` (Claude Code project scope), `.cursor/mcp.json` (Cursor project scope), `.vscode/mcp.json` (VS Code workspace scope), `cline_mcp_settings.json` (Cline global storage), and `~/.codex/config.toml` (Codex user scope). Each connector parses its documented format (`mcpServers`, `servers`, or `[mcp_servers.*]`) and normalises the result into a shared `{ servers, metadata }` shape before the loader merges them into a `Config` instance keyed by server name. |
| [`@mcp-layer/connect`](packages/connect/README.md) | Accepts the `Config` emitted by `@mcp-layer/config`, instantiates the MCP SDK `Client`, and connects to servers via stdio using their declared `command`, `args`, `cwd`, and `env`. |
| [`@mcp-layer/test-server`](packages/test-server/README.md) | Provides a feature-rich MCP server (`build` and `start`) for local integration tests, exposing multiple tools, resources, prompts, and instructions. |

Import the scoped packages directly:

```js
import { connect } from '@mcp-layer/connect';
import { load } from '@mcp-layer/config';

const cfg = await load(undefined, process.cwd());
const link = await connect(cfg, 'demo');
await link.client.ping();
await link.close();
```

Spin up the bundled test server over stdio for quick manual exploration:

```sh
pnpm exec mcp-test-server
```

## Development
- Install dependencies with `pnpm install`.
- Run tests with `pnpm test`; the suite exercises real stdio handshakes against a fixture MCP server powered by the official SDK.
- Follow the guidelines in `AGENTS.md` for naming, documentation, testing, and dependency choices. Every contribution must add or update `node:test` coverage and document behavioural changes here in the README.
