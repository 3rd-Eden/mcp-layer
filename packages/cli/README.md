# @mcp-layer/cli

`@mcp-layer/cli` is a CLI framework that turns MCP server schemas into a usable command line. It discovers a server from configuration, connects over stdio, extracts the unified schema from `@mcp-layer/schema`, and renders commands for tools, prompts, resources, and templates. You can also extend it with custom commands.

## Install

```sh
pnpm add @mcp-layer/cli
```

## Quick start

Run the CLI against a configured MCP server:

```sh
mcp-layer servers list
mcp-layer tools list
mcp-layer tools echo --text "hello"
```

## Command surface

The CLI exposes the same schema items for tools, prompts, resources, and templates.

```sh
mcp-layer servers list
mcp-layer tools list
mcp-layer tools <tool>
mcp-layer prompts list
mcp-layer prompts <prompt>
mcp-layer resources list
mcp-layer resources <uri>
mcp-layer templates list
mcp-layer templates <template>
```

Shorthand form:

<details>
<summary>Example</summary>

```sh
mcp-layer tools:echo --text "hello"
mcp-layer prompts:kickoff --json '{"topic":"launch"}'
```
</details>

## Input handling

Inputs come from the MCP schema. You can supply them three ways:

- `--json '{"key":"value"}'` for inline JSON
- `--input ./payload.json` for JSON files
- `--key value` for schema properties (flags are generated from input schema fields)

Array and object inputs support a few additional forms:

- Arrays can be repeated: `--items one --items two`
- Arrays can be JSON: `--items '["one","two"]'`
- Objects can use dot notation: `--meta.tag alpha`
- Objects can be JSON: `--meta '{"tag":"alpha"}'`
- Scalar values are coerced using the schema type (e.g., `--count 5`, `--enabled true`).

If a parameter clashes with a CLI flag (like `--help`), pass tool arguments after `--`:

<details>
<summary>Example</summary>

```sh
mcp-layer tools echo -- --help "not a real help flag"
```
</details>

## Output formatting

The CLI formats MCP responses for readability by default:

- Text content prints as plain text.
- Markdown content renders as ANSI Markdown when stdout is a TTY (pipes receive plain text).
- Images and audio show a short hint with MIME type and size.
- Resource links show name, description, and URI.
- Unsupported content types render as a labeled JSON fallback.

Use `--raw` to emit raw MCP payloads (plain text or binary bytes when a single payload is returned). If multiple content items are present, `--raw` returns JSON. This makes piping to files straightforward:

```sh
mcp-layer tools <tool> --raw > output.json
mcp-layer tools <tool> --raw > payload.bin
```

For single resource payloads, `--raw` emits the unrendered text content (or binary bytes), which makes it easy to pipe markdown or plain text into a file:

<details>
<summary>Example</summary>

```sh
mcp-layer resources resource://manual --raw > manual.md
```
</details>

Disable markdown rendering with `--no-markdown`.

Server-provided text is sanitized to strip ANSI escape sequences by default. If you trust the server and want to preserve ANSI output, pass `--allow-ansi`.

Example:

<details>
<summary>Example</summary>

```sh
mcp-layer tools <tool> --allow-ansi
```
</details>

## Color output

Color output is enabled by default when stdout is a TTY. Disable it with `--no-color` or by setting `NO_COLOR=1`. You can customize the colors via `accent` and `subtle` in `cli()` options.

## Per-command help

Use `--help` after a command to see its flags and examples:

```sh
mcp-layer tools echo --help
mcp-layer prompts kickoff --help
```

When a server is selected, help output uses the server name/version and lists all discovered tools, prompts, resources, and templates for that server.

Custom commands registered via `cli().command()` are included in the main help output and have their own `--help` rendering.

Example:

<details>
<summary>Example</summary>

```js
import { cli } from '@mcp-layer/cli';

await cli({ name: 'acme-mcp' })
  .command(
    {
      name: 'status',
      description: 'Show CLI status.'
    },
    async function statusCommand(argv) {
      process.stdout.write(JSON.stringify({ ok: true }, null, 2));
    }
  )
  .render();
```
</details>

## Output formats

List commands support JSON output:

```sh
mcp-layer tools list --format json
mcp-layer resources list --format json
```

Run/read/render commands render formatted output by default. Use `--raw` for JSON (or binary bytes when a single binary payload is returned).

## Configuration and server selection

`@mcp-layer/cli` uses `@mcp-layer/config` to discover MCP server definitions. When multiple servers are configured, choose one with `--server`:

```sh
mcp-layer tools list --server demo
```

Control server listing in help output via `showServers`:

- `showServers: true` always renders the Servers section.
- `showServers: false` always hides the Servers section.
Default: `true`.

You can also point at a specific config file or directory:

<details>
<summary>Example</summary>

```sh
mcp-layer tools list --config ./mcp.json
mcp-layer tools list --config ~/configs
```
</details>

## Embedding and custom commands

You can embed the CLI and add custom commands using the same parser and help renderer.

<details>
<summary>Example</summary>

```js
import { cli } from '@mcp-layer/cli';

/**
 * Render the CLI with a custom command.
 * @returns {Promise<void>}
 */
async function main() {
  await cli({ name: 'acme-mcp', description: 'Acme MCP CLI' })
    .command(
      {
        name: 'status',
        description: 'Report CLI configuration state.'
      },
      async function statusCommand(argv, helpers) {
        const verbose = Boolean(argv.verbose);
        const done = helpers.spinner('Loading status');
        process.stdout.write(JSON.stringify({ ok: true, verbose }, null, 2));
        done();
      }
    )
    .render();
}

main();
```
</details>

## API

### `cli(options)`

Creates a CLI instance.

Options:

- `name`: CLI name displayed in help output.
- `version`: CLI version string.
- `description`: CLI description for help output.
- `colors`: enable or disable color output.
- `accent`: hex color for headings (default `#FFA500`).
- `subtle`: hex color for flag names (default `#696969`).
- `spinner`: enable the loading spinner.
- `markdown`: enable markdown rendering for text output.
- `ansi`: allow ANSI escape sequences in server-provided text.
- `server`: default server name.
- `config`: default config path.
- `showServers`: show or hide the Servers section in help output.

### `cli().command(options, handler)`

Registers a custom command.

- `options.name`: command name.
- `options.description`: summary for help output.
- `handler(argv, helpers)`: async handler invoked with parsed args.
- `helpers.spinner(text)`: start a spinner and return a `stop()` function.

### `cli().render([argv])`

Executes the CLI. If `argv` is omitted, it uses `process.argv`.

## Global flags

- `--server <name>`: select a configured server.
- `--config <path>`: point at a config file or directory.
- `--format <json>`: use JSON for list output.
- `--json <string>`: supply inline JSON input.
- `--input <path>`: supply JSON input from a file.
- `--raw`: emit raw JSON (or binary bytes for a single binary payload).
- `--no-markdown`: disable markdown rendering.
- `--allow-ansi`: preserve ANSI escape sequences from server text.
- `--no-spinner`: disable the loading spinner.
- `--no-color`: disable color output.

## Development

<details>
<summary>Example</summary>

```sh
pnpm test --filter @mcp-layer/cli
```
</details>
