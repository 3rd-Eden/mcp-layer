# @mcp-layer/config

`@mcp-layer/config` discovers MCP server configuration files produced by supported clients and normalizes their contents into a single, predictable structure. It is the entry point for finding and updating MCP server definitions across popular tools.


MCP server configuration is fragmented across tools, file formats, and locations. This package gives you one API that:
- Finds those files reliably.
- Parses each tool's schema correctly.
- Normalizes everything into `{ servers, metadata }` and a `Config` map keyed by server name.
- Lets you update or remove entries while preserving the host tool's expected format.

## Installation

```sh
pnpm add @mcp-layer/config
# or
npm install @mcp-layer/config
# or
yarn add @mcp-layer/config
```

## Core concepts

- **Connector**: A tool-specific adapter that knows where configs live and how to parse/write them.
- **Server entry**: `{ name, config }`, where `config` includes `command`, `args`, `cwd`, `env`, `url`, `endpoint`, etc.
- **Metadata**: Tool-specific extras like VS Code `inputs` or Cline flags.
- **Config**: The normalized container returned by `load`. It exposes:
  - `.map` (Map of server entries by name)
  - `.list` (discovered files + connector metadata)
  - `.get(name)` convenience method
  - `.add(...)` / `.remove(name)` to update the original file

## Connectors (discovery + parsing)

Each connector exposes (and is accessible via `@mcp-layer/config/<connector-name>`):
- `project(dir)` / `home(ctx)` discovery
- `parse(raw, file)` returning `{ servers, metadata }`
- `write(...)` helpers used by `Config.add` to preserve formatting and metadata

Supported connectors:

- **[Claude Code](https://docs.claude.com/en/docs/claude-code/mcp)** -- project `.mcp.json`, user `~/.mcp.json` (including `~` expansion), managed enterprise files on macOS (`/Library/Application Support/ClaudeCode/managed-mcp.json`), Windows (`C:/ProgramData/ClaudeCode/managed-mcp.json`), and Linux (`/etc/claude-code/managed-mcp.json`), plus explicit overrides via `MCP_CONFIG_PATH`. Parses JSON `mcpServers` blocks.
- **[Cursor](https://cursor.com/docs/context/mcp)** -- `.cursor/mcp.json` in workspace ancestry + user home. Parses JSON `mcpServers` blocks.
- **[Codex](https://developers.openai.com/codex/mcp/)** -- `config.toml` under `${CODEX_HOME}` or `~/.codex/`. Parses `[mcp_servers.*]` TOML tables.
- **[VS Code](https://code.visualstudio.com/docs/copilot/customization/mcp-servers)** -- `.vscode/mcp.json`, workspace `mcp.json`, and `~/.vscode/mcp.json` (including Insiders/VSCodium variants). Parses JSON `servers` arrays and preserves `inputs` metadata.
- **[Cline](https://docs.cline.bot/mcp/configuring-mcp-servers)** -- user-level `cline_mcp_settings.json` (auto-discovered in VS Code / VSCodium storage, overridable via `CLINE_MCP_SETTINGS_PATH`). Parses `mcpServers` and Cline flags.
- **[Gemini CLI](https://ai.google.dev/gemini-api/gemini-cli)** -- `.gemini/settings.json` under workspace ancestry and user home.
- **[Windsurf](https://codeium.com/windsurf)** -- `~/.codeium/windsurf/mcp_config.json`.
- **Claude Desktop** -- `~/.claude/settings.json` and platform-specific `claude_desktop_config.json` (macOS `~/Library/Application Support/Claude/`, Windows `%APPDATA%/Claude/`).
- **Neovim** -- `~/.config/nvim/mcp.json`.
- **Helix** -- `~/.config/helix/mcp.json`.
- **Zed** -- `~/.config/zed/mcp.json`.
- **Generic** -- globs for `mcp*.json`, `*.mcp.json`, `mcp*.yaml`, `*.mcp.yaml` in ancestor directories and fallback user paths like `~/.config/mcp/servers.json` or `~/.config/mcp.(json|yaml)`. Parses JSON/YAML for `mcpServers`, `servers`, or top-level maps and preserves shared metadata like `inputs` and `defaultMode`.

## Usage

### Load discovered configuration

```js
import { load } from '@mcp-layer/config';

const config = await load(undefined, process.cwd());
const server = config.get('demo');
```

### Load inline configuration (no discovery)

```js
const config = await load(
  {
    servers: {
      manual: {
        command: '/usr/local/bin/manual-server',
        args: ['--flag']
      }
    },
    inputs: [{ id: 'token', type: 'promptString', password: true }]
  },
  '/virtual/config'
);
```

### Update or remove servers

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
    scope: 'project'
  }
);

await config.remove('new-server');
```

## API (authoritative)

### `load(doc?, optionsOrStart?)`

Loads configuration and returns a `Config` instance.

- `doc` (optional): inline config object. When present, discovery is skipped.
- `optionsOrStart`: either a string start path or an options object:
  - `start`: directory to begin upward search (defaults to `process.cwd()`)
  - `homeDir`: override for the user home directory
  - `env`: environment variables (defaults to `process.env`)
  - `platform`: operating system (`process.platform` when omitted)
  - `connector`: (inline documents only) connector name to associate with the document

### `locate(options)`

Returns the list of discovered configuration files with connector metadata.

### `Config` methods

- `get(name)` -- returns a server entry by name.
- `add(entry, options)` -- add or update a server entry in the appropriate file.
- `remove(name)` -- remove a server entry from its original file.

`add` options:
- `connector` **(required for new servers)** -- connector name to use for a new entry.
- `scope` -- `'project' | 'home'` when both scopes are supported.
- `file` -- explicit file path override if discovery did not cover the desired target.
- `metadata` -- tool-specific metadata to persist (ex: VS Code `inputs`).

## Validation rules

Every server entry must declare **at least one** of:
- `command` (stdio transport)
- `url` (HTTP transport)
- `endpoint` (HTTP transport)

Invalid entries are rejected during parsing so downstream tooling only receives runnable definitions.

## Responsibilities & lifecycle

- This package does not open transports or connect to servers.
- It is responsible only for discovery, parsing, normalization, and updates.
- Use `@mcp-layer/connect` for live connections and `@mcp-layer/schema` to extract schemas.

## Testing

```sh
pnpm test --filter @mcp-layer/config
```

## Security & safety

- Never commit real MCP credentials or server binaries; use `.env.example` where needed.
- Prefer `MCP_CONFIG_PATH` for temporary overrides rather than mutating user files.

## License

MIT
