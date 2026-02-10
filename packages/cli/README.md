# @mcp-layer/cli

`@mcp-layer/cli` is the API package for building MCP-aware command-line applications. It discovers a server from configuration, connects with the transport defined for that server (`stdio`, Streamable HTTP, or SSE), extracts the unified schema from `@mcp-layer/schema`, and renders commands for tools, prompts, resources, and templates. You can also extend it with custom commands.

## Table of Contents

- [Install](#install)
- [CLI executable package](#cli-executable-package)
- [Quick start](#quick-start)
- [Command surface](#command-surface)
- [Input handling](#input-handling)
- [Output formatting](#output-formatting)
- [Color output](#color-output)
- [Per-command help](#per-command-help)
- [Output formats](#output-formats)
- [Configuration and server selection](#configuration-and-server-selection)
- [Embedding and custom commands](#embedding-and-custom-commands)
- [API](#api)
- [Global flags](#global-flags)
- [Development](#development)
- [Runtime Error Reference](#runtime-error-reference)

## Install

```sh
pnpm add @mcp-layer/cli
```

## CLI executable package

Install [`mcpcli`](../mcpcli/README.md) when you want the shipped standalone CLI binary (`mcpcli`) without writing your own entrypoint:

```sh
pnpm add mcpcli
```

## Quick start

Use this package directly by creating a short executable wrapper:

```js
#!/usr/bin/env node
import { cli } from '@mcp-layer/cli';

await cli({ name: 'mcp-layer' }).render();
```

When `mcpcli` is installed, run the CLI against a configured MCP server:

```sh
mcpcli servers list
mcpcli tools list
mcpcli tools echo --text "hello"
```

Run the same commands against a remote server by selecting a config entry that uses `url`/`endpoint`:

```sh
mcpcli tools list --server remote
mcpcli tools echo --server remote --text "hello"
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

`@mcp-layer/cli` uses `@mcp-layer/config` to discover MCP server definitions. Transport is selected automatically from the chosen server entry through `@mcp-layer/connect`.

The MCP spec defines available transports, but config keys are host-tool specific. References:
- MCP transport protocol: [MCP Transports](https://modelcontextprotocol.io/specification/latest/basic/transports)
- Example host config schemas: [VS Code MCP config](https://code.visualstudio.com/docs/copilot/customization/mcp-servers), [Claude Code MCP config](https://docs.claude.com/en/docs/claude-code/mcp)
- Connector coverage in this repo: [`@mcp-layer/config` connectors](../config/README.md#connectors-discovery-parsing)

Selection order below is `@mcp-layer/connect` behavior:

Automatic selection behavior:
- `command` entries connect over stdio.
- `url`/`endpoint` entries connect over Streamable HTTP by default.
- `--transport sse` (runtime override) forces legacy SSE for URL-based entries.

Use `--transport` when you need an explicit runtime override (for example, forcing SSE against a legacy endpoint) without adding non-standard keys to shared config files.

When multiple servers are configured, choose one with `--server`:

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
- `--transport <mode>`: override transport at runtime (`stdio`, `streamable-http`, or `sse`).
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

## Runtime Error Reference

This section is written for high-pressure debugging moments. Each entry maps directly to the CLI's MCP discovery and invocation paths.

<a id="error-876b63"></a>
### Unknown "{targetType}" target "{targetName}".

Thrown from: `cli.render`

This happens when you run contextual help for a specific target (`tools <name> --help`, `prompts <name> --help`, `resources <uri> --help`, `templates <uri> --help`) and that target is not in the MCP catalog returned by the selected server.

Step-by-step resolution:
1. Confirm which server the CLI selected: run `mcp-layer servers list` or pass `--server <name>` explicitly.
2. List the available targets from that exact server: `mcp-layer tools list`, `mcp-layer prompts list`, `mcp-layer resources list`, or `mcp-layer templates list`.
3. Compare the failing target value character-for-character with list output (case and punctuation must match).
4. If the target should exist but does not, check the MCP server implementation for that capability and restart/reload the server.

<details>
<summary>Fix Example: inspect live MCP catalog before target-specific help</summary>

```sh
mcp-layer --server dev tools list
mcp-layer --server dev tools weather.get --help
```

</details>

<a id="error-9417af"></a>
### Unknown command "{command}".

Thrown from: `cli.render`

This happens when the first positional token does not match any built-in CLI surface (`tools`, `prompts`, `resources`, `templates`, `servers`, `help`) and does not match a registered custom command.

Step-by-step resolution:
1. Run `mcp-layer --help` and verify the exact command name and shape.
2. Check for typos or singular/plural mixups (`tool` vs `tools`).
3. If you expected a custom command, confirm it was registered before calling `cli().render(...)`.
4. Re-run with the exact command shown by help output.

<details>
<summary>Fix Example: use a valid CLI command surface</summary>

```sh
# Wrong: tool list
mcp-layer tools list
```

</details>

<a id="error-47dc57"></a>
### Unknown prompt "{promptName}".

Thrown from: `cli.render`

This happens on `prompts <name> exec` when the connected MCP server does not expose a prompt with that `name` in `prompts/list`.

Step-by-step resolution:
1. Run `mcp-layer prompts list --server <name>` and copy the prompt name directly.
2. Confirm the same `--server` and `--config` values are used between list and exec commands.
3. Verify the MCP server currently loaded the prompt in its handler registry.
4. Retry `prompts <name> exec` with the exact listed name.

<details>
<summary>Fix Example: list prompt names before execution</summary>

```sh
mcp-layer --server dev prompts list
mcp-layer --server dev prompts summarize.exec exec --topic "release notes"
```

</details>

<a id="error-5aa245"></a>
### Unknown resource "{resourceUri}".

Thrown from: `cli.render`

This happens on `resources <uri> exec` when no resource with that URI exists in the connected MCP server's `resources/list` catalog.

Step-by-step resolution:
1. Run `mcp-layer resources list --server <name>` to retrieve valid URIs.
2. Copy the URI exactly; resource URIs are protocol-level identifiers and are strict.
3. Ensure you are querying the same MCP server/environment where that URI is expected to exist.
4. Re-run the read command with the exact URI from list output.

<details>
<summary>Fix Example: read a listed resource URI</summary>

```sh
mcp-layer --server dev resources list
mcp-layer --server dev resources mcp://docs/changelog exec
```

</details>

<a id="error-d978d4"></a>
### Unknown template "{templateUri}".

Thrown from: `cli.render`

This happens on `templates <uriTemplate> exec` when the specified URI template is not present in the server's `resources/templates/list` response.

Step-by-step resolution:
1. Run `mcp-layer templates list --server <name>`.
2. Copy the URI template exactly from output (including placeholder names).
3. Confirm the template is registered on the server instance you are connected to.
4. Retry with the exact listed template and required parameters.

<details>
<summary>Fix Example: execute a known template from list output</summary>

```sh
mcp-layer --server dev templates list
mcp-layer --server dev templates mcp://docs/{slug} exec --slug release-2026-02
```

</details>

<a id="error-95b2a5"></a>
### Unknown tool "{toolName}".

Thrown from: `cli.render`

This happens on `tools <name> exec` when the name is missing from the server's `tools/list` response.

Step-by-step resolution:
1. Run `mcp-layer tools list --server <name>`.
2. Use the exact tool name from list output.
3. If missing unexpectedly, inspect server startup logs to verify tool registration completed.
4. Re-run execution with the exact name and required arguments.

<details>
<summary>Fix Example: execute only tools exposed by the current MCP server</summary>

```sh
mcp-layer --server dev tools list
mcp-layer --server dev tools weather.get exec --city London
```

</details>

<a id="error-098879"></a>
### Invalid integer for "{parameter}": "{value}".

Thrown from: `coercenumber`

This happens while validating tool/prompt/template arguments against the MCP JSON Schema. The target field is typed as `integer`, but the CLI received a non-integer value (for example `3.14`, `1e2`, or text).

Step-by-step resolution:
1. Inspect the input schema (`detail.input.json`) for the failing parameter and confirm it is `type: "integer"`.
2. Check the CLI value source: direct flag (`--count`), `--json`, or `--input` file.
3. Pass an integer literal only (no decimals, no unit suffixes).
4. Add a command-level validation test covering both rejected (`3.5`) and accepted (`3`) values.

<details>
<summary>Fix Example: pass an integer that matches the MCP input schema</summary>

```sh
# Wrong
mcp-layer tools batch.run exec --count 2.5

# Correct
mcp-layer tools batch.run exec --count 2
```

</details>

<a id="error-d25fd2"></a>
### Invalid number for "{parameter}": "{value}".

Thrown from: `coercenumber`

This happens while coercing CLI argument values for a schema field typed as `number` or `integer`; the received string cannot be parsed to a JavaScript number at all (for example `ten`, `10ms`, or an empty string).

Step-by-step resolution:
1. Identify where the value came from (`--json`, `--input`, or CLI flags).
2. Ensure the payload value is numeric JSON (`42`, `3.14`) and not decorated text (`"42ms"`).
3. If using shell flags, quote safely so the shell does not alter the token.
4. Re-run with a pure numeric value and add a regression test for the bad literal.

<details>
<summary>Fix Example: send numeric JSON instead of decorated strings</summary>

```sh
# Wrong
mcp-layer tools stats.query exec --threshold ten

# Correct
mcp-layer tools stats.query exec --threshold 10
```

</details>

<a id="error-fdcdee"></a>
### Required parameter "{parameter}" is missing.

Thrown from: `inputs`

This happens after the CLI loads an MCP item's input schema and sees that a field listed in `required` is absent from resolved arguments.

Step-by-step resolution:
1. Inspect the tool/prompt/template schema and locate `required` fields.
2. Provide the missing value using the right input channel:
3. Use `--<name> <value>` for simple values.
4. Use `--json '{"name":"value"}'` or `--input payload.json` for structured payloads.
5. Re-run and verify all required keys are present.

<details>
<summary>Fix Example: include required MCP tool arguments</summary>

```sh
# Tool schema requires "city"
mcp-layer tools weather.get exec --city Paris
```

</details>

<a id="error-8e53d1"></a>
### Invalid JSON for "{parameter}": {reason}

Thrown from: `parsejson`

This happens when a schema field is an `object` or `array` and the CLI attempts to parse the provided string as JSON, but parsing fails. Typical sources are single quotes, trailing commas, or shell-escaped payload corruption.

Step-by-step resolution:
1. Identify which argument name the error reports in `{parameter}`.
2. Validate the raw JSON snippet with `node -e 'JSON.parse(...)'` before passing it to CLI.
3. Prefer `--input payload.json` for complex nested JSON to avoid shell escaping issues.
4. Re-run and keep payload examples in docs/tests for that command.

<details>
<summary>Fix Example: use valid JSON for object/array inputs</summary>

```sh
# Wrong (single quotes are not valid JSON content)
mcp-layer tools repo.search exec --filters '{tag: "api"}'

# Correct
mcp-layer tools repo.search exec --filters '{"tag":"api"}'
```

</details>

<a id="error-274558"></a>
### Template parameter "{parameter}" is required but was not provided.

Thrown from: `render`

This happens when executing a resource template and at least one `{placeholder}` in `uriTemplate` has no matching argument in CLI input.

Step-by-step resolution:
1. Inspect the template string from `templates list` and enumerate placeholders.
2. Pass each placeholder as a flag with the exact same parameter name.
3. If arguments are provided via `--json`/`--input`, verify key names exactly match template placeholder names.
4. Re-run after all placeholders are bound.

<details>
<summary>Fix Example: provide every URI template placeholder</summary>

```sh
# Template: mcp://docs/{team}/{slug}
mcp-layer templates mcp://docs/{team}/{slug} exec --team api --slug auth-flow
```

</details>

<a id="error-c34e6a"></a>
### Template URI is missing.

Thrown from: `render`

This happens when template execution reaches URI rendering without a `uriTemplate` value in the selected catalog item. In practice this indicates malformed/partial template metadata from the server.

Step-by-step resolution:
1. Run `mcp-layer templates list --format json` and inspect `detail.uriTemplate` for the failing entry.
2. Confirm the server returns a valid MCP resource template object, including `uriTemplate`.
3. Fix the server-side template registration payload.
4. Restart the server and verify template metadata again before exec.

<details>
<summary>Fix Example: return complete MCP template metadata from server</summary>

```js
{
  name: 'docs-by-slug',
  description: 'Read docs by slug',
  uriTemplate: 'mcp://docs/{slug}'
}
```

</details>

<a id="error-03f4bd"></a>
### Multiple servers found. Provide --server <name>.

Thrown from: `select`

This happens when configuration discovery yields more than one server and no `--server` flag (or default `server` setting) is provided, so CLI cannot safely infer which MCP endpoint to use.

Step-by-step resolution:
1. Run `mcp-layer servers list` to see discovered server names.
2. Pick the intended server explicitly with `--server <name>`.
3. Optionally set a default server in CLI config to avoid repeating the flag.
4. Re-run the original command with explicit server selection.

<details>
<summary>Fix Example: disambiguate server selection</summary>

```sh
mcp-layer servers list
mcp-layer --server local-dev tools list
```

</details>

<a id="error-c4d5b8"></a>
### Server "{server}" was not found.

Thrown from: `select`

This happens when `--server <name>` (or configured default) does not match any server key in the loaded MCP configuration documents.

Step-by-step resolution:
1. Run `mcp-layer servers list` and verify the actual configured names.
2. Check that `--config` points to the config file/directory you intended.
3. Update command/config to use an existing server key exactly.
4. If the server should exist, add it to config and rerun.

<details>
<summary>Fix Example: align --server with discovered configuration keys</summary>

```sh
mcp-layer --config ./mcp.json servers list
mcp-layer --config ./mcp.json --server integration tools list
```

</details>

## License

MIT
