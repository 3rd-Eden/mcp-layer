# @mcp-layer/config

`@mcp-layer/config` discovers MCP server configuration files produced by supported clients and normalises their contents into a shared structure.

## Installation

```sh
pnpm add @mcp-layer/config
# or
npm install @mcp-layer/config
# or
yarn add @mcp-layer/config
```

## Connectors

- **[Claude Code](https://docs.claude.com/en/docs/claude-code/mcp)** — project `.mcp.json`, user `~/.mcp.json` (including `~` expansion), managed enterprise files on macOS (`/Library/Application Support/ClaudeCode/managed-mcp.json`), Windows (`C:/ProgramData/ClaudeCode/managed-mcp.json`), and Linux (`/etc/claude-code/managed-mcp.json`), plus explicit overrides via `MCP_CONFIG_PATH`. Parses JSON `mcpServers` blocks.
- **[Cursor](https://cursor.com/docs/context/mcp)** — searches for `.cursor/mcp.json` in the workspace ancestry and user home directory. Parses JSON `mcpServers` blocks.
- **[Codex](https://developers.openai.com/codex/mcp/)** — reads `config.toml` under `${CODEX_HOME}` or `~/.codex/`, parsing `[mcp_servers.*]` TOML tables into server entries.
- **[VS Code](https://code.visualstudio.com/docs/copilot/customization/mcp-servers)** — looks for `.vscode/mcp.json`, workspace `mcp.json`, and `~/.vscode/mcp.json` (including Code Insiders/VSCodium variants). Parses JSON `servers` arrays while preserving declared `inputs` metadata.
- **[Cline](https://docs.cline.bot/mcp/configuring-mcp-servers)** — loads the user-level `cline_mcp_settings.json` (auto-discovered under VS Code / VSCodium global storage directories and overridable via `CLINE_MCP_SETTINGS_PATH`). Parses JSON `mcpServers` blocks and captures Cline-specific flags.

Each connector exposes (and is accessible via `@mcp-layer/config/<connector-name>`):
- `project(dir)` / `home(ctx)` path discovery tailored to the tool
- `parse(raw, file)` returning `{ servers, metadata }`, where `servers` contains `{ name, config }` entries and `metadata` preserves tool-specific extras (for example VS Code `inputs`).
- Internal `write` helpers used by the `Config` API to merge new `{ name, config }` definitions while preserving documented formatting (JSON/TOML) and metadata (for example VS Code `inputs`, Cline `defaultMode`).

## Features

- Connector-aware discovery with documented precedence (project first, then user/enterprise).
- Format-specific parsing without guessing at schema differences.
- Exported `Config` object exposing both the discovered file list and a `Map` keyed by server name.

## Usage

```js
import { load } from '@mcp-layer/config';

const config = await load(undefined, process.cwd());
const server = config.get('demo');
```

You can also supply an inline MCP configuration object (using the same `mcpServers` shape documented by Claude/Cursor/Cline/Codex). When a document is provided, on-disk discovery is skipped:

```js
const config = await load({
  mcpServers: {
    manual: {
      command: '/usr/local/bin/manual-server',
      args: ['--flag']
    }
  },
  inputs: [{ id: 'token', type: 'promptString', password: true }]
}, '/virtual/config');
```

When working with a `Config` instance returned by `load`, call `config.add(entry, options)`/`config.remove(name)` to update the underlying files. Existing servers automatically reuse their original connector and file path; new servers require a `connector` name (one of the entries in the table above) and a target `file` path:

```js
await config.add(
  {
    name: 'new-server',
    config: {
      command: '/usr/local/bin/new-server',
      args: ['--stdio']
    }
  },
  {
    connector: 'claude-code',
    file: '/path/to/project/.mcp.json'
  }
);

await config.remove('new-server');
```
```

The second argument can be either a string (treated as `start`) or an options object with the following fields:

- `start`: directory to begin the upward search (defaults to `process.cwd()`).
- `homeDir`: override for the current user home directory.
- `env`: environment variables (defaults to `process.env`).
- `platform`: operating system (`process.platform` when omitted).
- `connector`: (inline documents only) identify the connector to associate with the provided configuration.

## Testing

```sh
pnpm test --filter @mcp-layer/config
```

## License

MIT
