# @mcp-layer/cli

`@mcp-layer/cli` is a CLI framework that turns MCP server schemas into a usable command line. It discovers a server from configuration, connects with the transport defined for that server (`stdio`, Streamable HTTP, or SSE), extracts the unified schema from `@mcp-layer/schema`, and renders commands for tools, prompts, resources, and templates. It applies public client profiles at runtime and hosts OAuth-aware HTTP or stdio forwarding gateways. You can extend it with custom commands.

The package owns command-line composition and process lifecycle. The official MCP SDK owns transports and OAuth protocol handling; [`@mcp-layer/profiles`](../profiles/README.md) owns profile capture, building, inspection, and runtime profile loading; `@mcp-layer/forward` owns authorization and forwarding; `cli-storage` owns persistence. Browser launching uses the existing `open` package.

## Table of Contents

- [Install](#install)
- [Quick start](#quick-start)
- [Command surface](#command-surface)
- [Runtime client profiles](#runtime-client-profiles)
- [OAuth and private storage](#oauth-and-private-storage)
- [Forwarding](#forwarding)
- [Input handling](#input-handling)
- [Output formatting](#output-formatting)
- [Color output](#color-output)
- [Per-command help](#per-command-help)
- [Output formats](#output-formats)
- [Configuration and server selection](#configuration-and-server-selection)
- [Embedding and custom commands](#embedding-and-custom-commands)
- [API Reference](#api-reference)
- [Global flags](#global-flags)
- [Development](#development)
- [Runtime Error Reference](#runtime-error-reference)

## Install

Install the CLI package to get the `mcp-layer` executable and embedding API. This makes the commands below available in your project.

```sh
pnpm add @mcp-layer/cli
```

## Quick start

Run the CLI against a configured MCP server to discover available tools and call `echo`. The listing prints discovered schema items; the invocation prints the server response:

```sh
mcp-layer servers list
mcp-layer tools list
mcp-layer tools echo --text "hello"
```

Select a configured remote server to use the same discovery and execution workflow over HTTP. The transport is inferred from its `url`/`endpoint`, and the output has the same shape as the local commands:

```sh
mcp-layer tools list --server remote
mcp-layer tools echo --server remote --text "hello"
```

## Command surface

Use these forms to discover or invoke each MCP schema surface. List commands print available items; invocation commands print the selected server response.

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

The colon shorthand selects the same tool or prompt with fewer positional arguments. These commands execute `echo` or `kickoff` and print their results:

<details>
<summary>Example</summary>

```sh
mcp-layer tools:echo --text "hello"
mcp-layer prompts:kickoff --json '{"topic":"launch"}'
```
</details>

## Runtime client profiles

The CLI applies public identity defaults from a bundled profile or a validated JSON profile file. Profiles may supply HTTP headers, MCP `clientInfo`, and public OAuth registration metadata. Runtime selection does not add keys to MCP configuration files.

Use a profile when you need the CLI to present a known client's public identity to a server. OAuth identity defaults are used when the target requires authorization; an open endpoint connects without registration. Explicit OAuth flags and runtime overrides continue to control authorization:

```sh
mcp-layer tools list --server remote --profile ./profile.json
mcp-layer tools list --server remote --profile ./profile.json --profile-parts http,mcp
```

`--profile` accepts a bundled profile ID or a JSON path containing `/`, `\` or a `.json` suffix. `--profile-parts` selects comma-separated `http`, `mcp`, and `oauth`; all three are selected by default. Files are validated against their sanitized evidence before use. Profile settings apply to catalog loading, detailed target help, and general help; general help never initiates login.

To capture a client, build a profile, inspect the catalog, or use the profiles API, see [`@mcp-layer/profiles` tooling and API reference](../profiles/README.md). Profile artifacts contain public identity evidence only; credential and session values are sanitized by that package.

Profile selection composes the [official MCP transports](https://modelcontextprotocol.io/specification/latest/basic/transports), [authorization specification](https://modelcontextprotocol.io/specification/latest/basic/authorization), and [official TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk). The CLI keeps profile flags as runtime options and does not persist additional MCP configuration keys.

## OAuth and private storage

`--oauth` enables upstream authorization for normal remote commands. A profile's observed OAuth metadata or issuer-bound public client IDs also enable it when the `oauth` part is selected. `--no-oauth` disables authorization explicitly. Local stdio server connections continue to use the configured process transport.

Run a remote command with OAuth to authorize in your browser and reuse the resulting grant on later invocations. The browser deadline defaults to 300000 ms. Authorization completes before the separate MCP initialization `--timeout` begins, so a short handshake deadline does not cut off browser consent:

```sh
mcp-layer tools list --server remote --oauth --auth-timeout 300000 --timeout 30000
mcp-layer tools list --server remote --oauth
```

Public metadata is passed into the authorization provider before registration. An observed public client ID is eligible only for its matching discovered or explicitly selected issuer. Known registered redirects and client authentication methods remain attached to that ID. Multiple IDs for the same issuer are ambiguous and are not selected automatically. `--client-id` always takes precedence; `--issuer`, `--scope`, `--resource`, `--callback-url`, `--callback-port` and `--auth-timeout` are runtime overrides. Use `--callback-url` when a registration requires a particular loopback host or path; port zero still chooses a live available port. The SDK performs discovery, PKCE and token exchange. Selecting public identity does not confer access; the server still decides authorization.

The CLI constructs `cli-storage` with the `mcp-layer` namespace. Forward owns every OAuth business record; the CLI stores no tokens or state itself. The default `auto` backend uses the storage package's platform selection and persists that choice. `--storage-backend native|file|auto` selects the initial preference; `--storage-dir` isolates the storage root. The `file` backend stores plaintext private records, and storage diagnostics report that limitation. See [`cli-storage`](https://www.npmjs.com/package/cli-storage) for platform behavior and encryption/native requirements.

Inspect authorization state when debugging storage or registration. This command performs discovery and passive storage reads, prints credential-free diagnostics, and never opens a browser, registers a client, initializes storage, or starts a gateway. Target and issuer output contains only URL origins; paths, credentials, query parameters, and fragments are omitted:

```sh
mcp-layer forward https://example.com/mcp --status --format json
```

General help never initiates login. Normal command teardown and failed connection attempts close every owned OAuth callback listener. Tokens remain bound to upstream resource, issuer, scope, registration and identity settings; changing those settings can require a separate grant.

Authorization follows the [MCP OAuth contract](https://modelcontextprotocol.io/specification/latest/basic/authorization) and the [SDK client provider interface](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/src/client/auth.ts). None of these CLI options is written into [host-managed MCP config](https://code.visualstudio.com/docs/copilot/customization/mcp-servers).

## Forwarding

`forward [url]` hosts a streaming gateway to an upstream Streamable HTTP endpoint. If the URL is omitted, `--server`/`--config` select a remote entry. HTTP is the default downstream transport, binding loopback on an available port; the `/mcp` URL prints to stderr. OAuth is enabled by default: the gateway exposes its own SDK issuer and explicit consent, while upstream tokens are stored and refreshed separately. A downstream bearer token is not passed upstream.

Use a profile to present captured public identity upstream while exposing a local gateway to another client. The first downstream consent can trigger upstream browser authorization. Ctrl-C or SIGTERM closes the listener, proxy sockets and authorization callbacks:

```sh
mcp-layer forward https://example.com/mcp --profile ./profile.json
```

Use stdio when a host launches MCP servers as child processes. Stdout contains protocol frames only; EOF, Ctrl-C and SIGTERM stop the bridge and release its upstream connection. `--no-oauth` is available for an explicitly unauthenticated upstream:

```sh
mcp-layer forward https://example.com/mcp --transport stdio
mcp-layer forward http://127.0.0.1:4000/mcp --no-oauth
```

For guidance on recording original and bridged client identity while forwarding, see [`@mcp-layer/profiles`](../profiles/README.md). The gateway uses [SDK transports](https://modelcontextprotocol.io/specification/latest/basic/transports) and [SDK OAuth middleware](https://github.com/modelcontextprotocol/typescript-sdk/tree/main/src/server/auth); its bind and identity options are runtime settings, not shared MCP configuration keys.

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

If a parameter clashes with a CLI flag (like `--help`), pass tool arguments after `--`. The example sends `help` to the tool instead of opening CLI help:

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

For trusted server output, explicitly preserve ANSI formatting. The response retains its escape sequences instead of passing through the default sanitizer.

<details>
<summary>Preserve trusted formatting</summary>

```sh
mcp-layer tools <tool> --allow-ansi
```
</details>

## Color output

Color output is enabled by default when stdout is a TTY. Disable it with `--no-color` or by setting `NO_COLOR=1`. You can customize the colors via `accent` and `subtle` in `cli()` options.

## Per-command help

Use `--help` after a command to discover schema-derived flags before invoking it. These commands print the selected tool or prompt description and expected arguments:

```sh
mcp-layer tools echo --help
mcp-layer prompts kickoff --help
```

When a server is selected, help output uses the server name/version and lists all discovered tools, prompts, resources, and templates for that server.

Custom commands registered via `cli().command()` are included in the main help output and have their own `--help` rendering.

Register a custom status command when embedding the CLI. The builder adds its metadata to main help and prints command-specific flags and examples on `--help`:

<details>
<summary>Register a command</summary>

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

Request JSON when another process needs to consume a listing. These commands print arrays of discovered tool or resource schema items:

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

When multiple servers are configured, choose one with `--server`. This command connects only to `demo` and prints its tools:

```sh
mcp-layer tools list --server demo
```

Control server listing in help output via `showServers`:

- `showServers: true` always renders the Servers section.
- `showServers: false` always hides the Servers section.
Default: `true`.

Point at a specific config file or discovery directory when the desired server is outside the current project. Both commands discover configuration from that location and list its tools:

<details>
<summary>Example</summary>

```sh
mcp-layer tools list --config ./mcp.json
mcp-layer tools list --config ~/configs
```
</details>

## Embedding and custom commands

Embed the CLI to provide application-specific commands alongside MCP discovery. In this example, running `status --verbose` prints a JSON status record and stops its spinner.

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

## API Reference

### `cli(options)`

Signature: `cli(options?: CliOptions): { command(options, handler), render(argv?): Promise<void> }`. Creates a builder without connecting or opening a browser.

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
- `timeout`: fail if MCP initialization exceeds the timeout in milliseconds (opt-in only).
- `open(url: URL): Promise<void>`: application-owned OAuth browser callback. Defaults to the `open` package. It receives the SDK-generated URL; resolving it launches or completes the interaction, while forward waits for the loopback callback.

### `cli().command(options, handler)`

Registers a custom command.

- `options.name`: command name.
- `options.description`: summary for help output.
- `handler(argv, helpers)`: async handler invoked with parsed args.
- `helpers.spinner(text)`: start a spinner and return a `stop()` function.

### `cli().render([argv])`

Signature: `render(argv?: string[]): Promise<void>`. Executes one invocation; omitted `argv` uses `process.argv.slice(2)`. Hosted forwarding commands remain pending until shutdown. Errors reject the promise; the executable prints the message to stderr and exits nonzero. MCP, OAuth, profile and storage failures retain their originating package error fields.

## Global flags

- `--server <name>`: select a configured server.
- `--config <path>`: point at a config file or directory.
- `--transport <mode>`: override transport at runtime (`stdio`, `streamable-http`, or `sse`).
- `--timeout <ms>`: fail if MCP initialization exceeds the timeout in milliseconds (opt-in).
- `--profile <id|file>`: apply a verified public profile.
- `--profile-parts <parts>`: select comma-separated `http,mcp,oauth` (default all).
- `--oauth` / `--no-oauth`: enable/disable upstream OAuth; forwarding defaults to enabled.
- `--client-id <id>`: explicitly select public OAuth client registration.
- `--issuer <url>`: explicitly select the authorization server.
- `--scope <scopes>`: override the space-separated OAuth scope string.
- `--resource <url>`: override the OAuth resource indicator.
- `--callback-port <port>`: choose a loopback callback port (default `0`).
- `--callback-url <url>`: choose the registered HTTP loopback host and path (default `http://127.0.0.1:0/callback`). The SDK accepts port changes for the same loopback host, path, and query; `--callback-port` overrides the URL's port.
- `--auth-timeout <ms>`: browser interaction deadline (default `300000`).
- `--storage-dir <path>`: isolate private credentials in a storage directory.
- `--storage-backend <auto|native|file>`: initial cli-storage backend preference.
- `--format <json>`: use JSON for list and status output.
- `--json <string>`: supply inline JSON input.
- `--input <path>`: supply JSON input from a file.
- `--raw`: emit raw JSON (or binary bytes for a single binary payload).
- `--no-markdown`: disable markdown rendering.
- `--allow-ansi`: preserve ANSI escape sequences from server text.
- `--no-spinner`: disable the loading spinner.
- `--no-color`: disable color output.

## Development

Run the package integration suite to exercise real SDK transports, OAuth consent, persistent credentials, subprocess shutdown and existing schema commands. A passing run verifies these paths without mocks:

<details>
<summary>Example</summary>

```sh
pnpm --filter @mcp-layer/cli test
```
</details>

## Runtime Error Reference

Every library `LayerError` includes its package, method, stable reference and generated documentation URL; machine-readable codes are preserved. Runtime profile selection and forwarding errors are listed below.

<a id="error-53a24b"></a>
### `ERR_CLI_PROFILE_PARTS`

`globals` accepts only comma-separated `http,mcp,oauth` parts. Correct the flag before retrying; validation happens before any connection.

<a id="error-5f7140"></a>
### `ERR_CLI_PROFILE_OAUTH_CLIENT_AUTH`

`settings` will not select a captured OAuth registration that requires a client secret or another confidential authentication method. Profiles contain public identity data and never credentials. Use `--client-id` to perform a public registration, or capture a client registered with `token_endpoint_auth_method=none`.

<a id="error-5e0fba"></a>
### `ERR_CLI_OAUTH_PROBE_TIMEOUT`

`settings` exceeded `--auth-timeout` while checking whether a profile-enabled resource requires OAuth. Check that the resource responds to HTTP requests or increase `--auth-timeout`. Caller cancellation remains an abort and is not reported as a timeout.

<a id="error-2b6339"></a>
### `ERR_CLI_REMOTE`

`remote` could not find an HTTP URL on the selected server. Supply `forward <url>` or select a configured remote server.

<a id="error-c65a4c"></a>
<a id="error-7b7bdc"></a>
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
