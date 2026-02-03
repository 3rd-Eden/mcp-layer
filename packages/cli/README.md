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

```sh
mcp-layer tools:echo --text "hello"
mcp-layer prompts:kickoff --json '{"topic":"launch"}'
```

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

If a parameter clashes with a CLI flag (like `--help`), pass tool arguments after `--`:

```sh
mcp-layer tools echo -- --help "not a real help flag"
```

## Color output

Color output is enabled by default when stdout is a TTY. Disable it with `--no-color` or by setting `NO_COLOR=1`. You can customize the colors via `accent` and `subtle` in `cli()` options.

## Per-command help

Use `--help` after a command to see its flags and examples:

```sh
mcp-layer tools echo --help
mcp-layer prompts kickoff --help
```

When a server is selected, help output uses the server name/version and lists all discovered tools, prompts, resources, and templates for that server.

## Output formats

List commands support JSON output:

```sh
mcp-layer tools list --format json
mcp-layer resources list --format json
```

Run/read/render commands return the raw MCP JSON result. For resources, non-JSON output will print the text content when available.

## Configuration and server selection

`@mcp-layer/cli` uses `@mcp-layer/config` to discover MCP server definitions. When multiple servers are configured, choose one with `--server`:

```sh
mcp-layer tools list --server demo
```

You can also point at a specific config file or directory:

```sh
mcp-layer tools list --config ./mcp.json
mcp-layer tools list --config ~/configs
```

## Embedding and custom commands

You can embed the CLI and add custom commands using the same parser and help renderer.

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
      async function statusCommand(argv) {
        const verbose = Boolean(argv.verbose);
        process.stdout.write(JSON.stringify({ ok: true, verbose }, null, 2));
      }
    )
    .render();
}

main();
```

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
- `server`: default server name.
- `config`: default config path.

### `cli().command(options, handler)`

Registers a custom command.

- `options.name`: command name.
- `options.description`: summary for help output.
- `handler(argv)`: async handler invoked with parsed args.

### `cli().render([argv])`

Executes the CLI. If `argv` is omitted, it uses `process.argv`.

## Development

```sh
pnpm test --filter @mcp-layer/cli
```
