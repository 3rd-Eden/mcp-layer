# @mcp-layer/config

`@mcp-layer/config` discovers MCP server configuration files produced by supported clients and normalizes their contents into a single, predictable structure. It is the entry point for finding and updating MCP server definitions across popular tools.


MCP server configuration is fragmented across tools, file formats, and locations. This package gives you one API that:
- Finds those files reliably.
- Parses each tool's schema correctly.
- Normalizes everything into `{ servers, metadata }` and a `Config` map keyed by server name.
- Lets you update or remove entries while preserving the host tool's expected format.

## Table of Contents

- [Installation](#installation)
- [Core concepts](#core-concepts)
- [Connectors (discovery + parsing)](#connectors-discovery-parsing)
- [Usage](#usage)
- [API (authoritative)](#api-authoritative)
- [Validation rules](#validation-rules)
- [Responsibilities & lifecycle](#responsibilities-lifecycle)
- [Testing](#testing)
- [Security & safety](#security-safety)
- [Runtime Error Reference](#runtime-error-reference)

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

## Runtime Error Reference

This section is written for high-pressure debugging moments. Each entry maps to a concrete parser/connector path in `@mcp-layer/config`.

<a id="error-4c2281"></a>
### Failed to parse JSON file "{file}": {reason}

Thrown from: `cline.parse`

This happens when Cline connector parsing fails for `cline_mcp_settings.json` (usually in VS Code global storage or `CLINE_MCP_SETTINGS_PATH`). Invalid JSON syntax is the common cause.

Step-by-step resolution:
1. Confirm which Cline settings file was loaded (`CLINE_MCP_SETTINGS_PATH` or VS Code global storage path).
2. Validate that exact file as strict JSON (no comments, no trailing commas).
3. Ensure the file contains a top-level object (typically with `mcpServers`).
4. Re-run config load and add a fixture with malformed JSON to keep parser failure coverage.

<details>
<summary>Fix Example: validate Cline JSON before loading connectors</summary>

```js
const raw = await fs.readFile(file, 'utf8');
JSON.parse(raw); // throws immediately with concrete syntax location

const config = await load(undefined, process.cwd());
console.log(config.map.size);
```

</details>

<a id="error-193d7b"></a>
### Failed to parse TOML file "{file}": {reason}

Thrown from: `codex.parse`

This happens when Codex connector parsing fails for `config.toml` (usually under `$CODEX_HOME` or `~/.codex`). Invalid TOML syntax or malformed `[mcp_servers]` blocks are the usual cause.

Step-by-step resolution:
1. Confirm the resolved Codex config path (`$CODEX_HOME/config.toml` if set).
2. Validate TOML syntax with a parser before loading config.
3. Verify server definitions are nested under `mcp_servers`.
4. Add a failing fixture for malformed TOML and a passing fixture for the corrected document.

<details>
<summary>Fix Example: parse TOML before connector ingestion</summary>

```js
import { parse as parseToml } from '@iarna/toml';

const raw = await fs.readFile(file, 'utf8');
parseToml(raw);
const config = await load(undefined, process.cwd());
console.log(config.map.size);
```

</details>

<a id="error-cc981d"></a>
### Connector "{connector}" does not support write operations.

Thrown from: `Config.add`

This happens when `Config.add(...)` resolved a connector name but that connector does not provide a `write(file, entry, metadata)` function. Add/remove paths require writable connectors.

Step-by-step resolution:
1. Confirm the connector name passed in `options.connector`.
2. Check the connector definition and verify it implements `write`.
3. Switch to a writable connector (`vscode`, `codex`, `cline`, etc.) or add `write` to your custom connector.
4. Add tests that `add` fails on read-only connectors and succeeds on writable ones.

<details>
<summary>Fix Example: use a writable connector for add operations</summary>

```js
await config.add(
  { name: 'local-dev', config: { command: 'node', args: ['./server.js'] } },
  { connector: 'vscode', file: '/workspace/.vscode/mcp.json' }
);
```

</details>

<a id="error-521f1e"></a>
### A connector is required before adding server "{server}".

Thrown from: `Config.add`

This happens when `Config.add(...)` cannot infer which connector should write the server entry. For new servers, you must pass `options.connector`.

Step-by-step resolution:
1. Provide `options.connector` explicitly when adding a new server.
2. If updating an existing server, verify it already has connector metadata.
3. Keep connector names aligned with `findConnector(...)` registrations.
4. Add tests for "missing connector" and "valid connector" add scenarios.

<details>
<summary>Fix Example: include connector metadata during add</summary>

```js
await config.add(
  { name: 'integration', config: { command: 'node', args: ['./mcp.js'] } },
  { connector: 'codex' }
);
```

</details>

<a id="error-d43941"></a>
### A file path is required before adding server "{server}".

Thrown from: `Config.add`

This happens when `Config.add(...)` has a connector but no target file path can be derived. It could not resolve `options.file`, existing server source, or connector-scoped candidate files.

Step-by-step resolution:
1. Pass `options.file` when adding a server that does not already exist in config.
2. Verify `options.scope`/connector combination points to an existing discovered document if you rely on auto-selection.
3. Prefer explicit file paths for deterministic writes in CI and tooling.
4. Add tests for file inference and explicit file override behavior.

<details>
<summary>Fix Example: provide an explicit destination file</summary>

```js
await config.add(
  { name: 'local-dev', config: { command: 'node', args: ['./server.js'] } },
  { connector: 'vscode', file: '/workspace/.vscode/mcp.json' }
);
```

</details>

<a id="error-36c384"></a>
### No parser or inline data was supplied for "{path}".

Thrown from: `Config.consume`

This happens when `Config.consume(candidate)` receives a candidate that has neither parsed `data` nor a `parse(raw, file)` function. The config loader cannot ingest the candidate.

Step-by-step resolution:
1. If creating custom candidates, provide either `data` or `parse`.
2. Confirm candidate objects coming from `locate()` preserve the `parse` function.
3. Use inline `data` only when you already normalized `{ servers, metadata }`.
4. Add candidate-shape tests for both parse-based and data-based ingestion.

<details>
<summary>Fix Example: pass a candidate with a parse function</summary>

```js
await config.consume({
  path: '/workspace/.vscode/mcp.json',
  parse(raw, file) {
    return parseDocument(raw, file);
  }
});
```

</details>

<a id="error-11e7fc"></a>
### Connector "{connector}" does not support write operations.

Thrown from: `Config.remove`

This happens when removing a server whose connector cannot write back changes. `Config.remove` requires connector `write(...)` support to persist the updated document.

Step-by-step resolution:
1. Check which connector is attached to the existing server entry.
2. Verify that connector exports a `write` function.
3. Migrate the server definition to a writable connector/file if necessary.
4. Add remove-path tests for writable and non-writable connector cases.

<details>
<summary>Fix Example: remove servers only from writable connector documents</summary>

```js
const before = config.get('integration');
if (!before?.connector)
  throw new Error('Cannot remove server without connector metadata.');

await config.remove('integration');
```

</details>

<a id="error-700af4"></a>
### Configuration document "{file}" must contain an object with server definitions.

Thrown from: `extractServers`

This happens when the parsed document is not an object (for example `null`, array, number, or string). Server extraction only supports object-based config documents.

Step-by-step resolution:
1. Inspect parser output before `extractServers(...)`.
2. Ensure the config file root is a JSON/TOML/YAML object, not a list/scalar.
3. Keep server definitions under `mcpServers`, `servers`, or top-level keyed objects.
4. Add fixtures that assert invalid root types fail fast.

<details>
<summary>Fix Example: use an object root with server definitions</summary>

```js
{
  "mcpServers": {
    "local-dev": {
      "command": "node",
      "args": ["./server.js"]
    }
  }
}
```

</details>

<a id="error-d927c9"></a>
### Server "{server}" in "{file}" must declare "command", "url", or "endpoint".

Thrown from: `extractServers`

This happens when a strict server node (`mcpServers` or `servers`) contains an entry without any connection primitive. Each server must provide at least one of `command`, `url`, or `endpoint`.

Step-by-step resolution:
1. Locate the `{server}` entry in `{file}`.
2. Add a valid connection shape for that server.
3. Re-run discovery and verify the server appears in `config.map`.
4. Add fixtures for each supported connection mode (`command`, `url`, `endpoint`).

<details>
<summary>Fix Example: declare a concrete connection primitive per server</summary>

```js
{
  "servers": {
    "staging": {
      "url": "https://mcp.example.com/sse"
    }
  }
}
```

</details>

<a id="error-facba7"></a>
### Failed to parse {format} configuration document "{file}": {reason}

Thrown from: `parseDocument`

This happens when `parseDocument(raw, file)` fails to parse according to file extension (`.yaml/.yml` => YAML, everything else => JSON).

Step-by-step resolution:
1. Confirm `{format}` matches the file extension you passed.
2. Validate content with the matching parser (JSON vs YAML), not a different one.
3. Check for format mismatches (YAML content in `.json` file, or vice versa).
4. Add fixtures for invalid JSON and invalid YAML parse failures.

<details>
<summary>Fix Example: keep file extension and payload format aligned</summary>

```js
import YAML from 'yaml';

const file = '/workspace/mcp.yaml';
const raw = await fs.readFile(file, 'utf8');
YAML.parse(raw);
const config = await load(undefined, '/workspace');
console.log(config.map.size);
```

</details>

<a id="error-bb62af"></a>
### Inline configuration must declare at least one server using "mcpServers", "servers", or top-level objects with connection settings

Thrown from: `parseInlineDocument`

This happens when you call `load(document, opts)` with an inline object that declares zero usable servers. Inline mode still requires at least one valid server definition.

Step-by-step resolution:
1. Ensure inline document uses `mcpServers`, `servers`, or valid top-level server entries.
2. Verify at least one server has `command`, `url`, or `endpoint`.
3. Remove placeholder/empty objects from inline docs used in tests.
4. Add inline config tests for empty and valid shapes.

<details>
<summary>Fix Example: pass at least one valid server in inline mode</summary>

```js
const inline = {
  mcpServers: {
    local: { command: 'node', args: ['./server.js'] }
  }
};

const config = await load(inline);
console.log(config.get('local'));
```

</details>

<a id="error-7f7f57"></a>
### Failed to parse JSON file "{file}": {reason}

Thrown from: `vscode.parse`

This happens when VS Code connector parsing fails for `.vscode/mcp.json` (workspace or user-scoped). The file must be strict JSON.

Step-by-step resolution:
1. Confirm which `.vscode/mcp.json` path was discovered (project vs home).
2. Validate JSON strictly (comments and trailing commas are invalid).
3. Verify `servers` is an object and optional `inputs` is an array.
4. Re-run discovery and add fixtures for malformed and corrected VS Code docs.

<details>
<summary>Fix Example: validate VS Code mcp.json before loading</summary>

```js
const raw = await fs.readFile(file, 'utf8');
JSON.parse(raw); // throws immediately with concrete syntax location

const config = await load(undefined, process.cwd());
console.log(config.map.size);
```

</details>

## License

MIT
