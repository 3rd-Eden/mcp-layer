# mcpcli

`mcpcli` is a standalone command-line interface for interacting with Model Context Protocol (MCP) servers. It discovers configured servers, connects over supported MCP transports, and exposes tools, prompts, resources, and resource templates from live server catalogs.

## Table of Contents

- [Install](#install)
- [Quick Start](#quick-start)
- [How It Works](#how-it-works)
- [Command Surface](#command-surface)
- [Global Flags](#global-flags)
- [Input Handling](#input-handling)
- [Output Behavior](#output-behavior)
- [Server Discovery and Selection](#server-discovery-and-selection)
- [Transport Behavior](#transport-behavior)
- [API Reference](#api-reference)
- [Common Errors](#common-errors)
- [Development](#development)
- [License](#license)

## Install

This command installs `mcpcli` globally so you can run it from any shell session. After installation, `mcpcli --version` should return the installed version.

```sh
npm install -g mcpcli
```

This command installs `mcpcli` in a project when you prefer running it via workspace scripts. After installation, run it with `pnpm exec mcpcli` (or your package manager equivalent).

```sh
pnpm add mcpcli
```

## Quick Start

This first command verifies that the executable is installed and available on your `PATH`. The expected output format is `mcpcli <version>`.

```sh
mcpcli --version
```

This command lists discovered MCP servers and where each server entry was loaded from. You should see at least one server row before executing tools or prompts.

```sh
mcpcli servers list
```

This command lists tools for a selected server. You should see a table (or JSON when requested) containing tool names and descriptions.

```sh
mcpcli tools list --server demo
```

This command executes a tool with schema-driven arguments. You should receive formatted output from the MCP server response.

```sh
mcpcli tools echo --server demo --text "hello"
```

## How It Works

`mcpcli` runs the same execution flow for every command surface:

1. Load MCP configuration from discovery locations or a user-provided path.
2. Resolve a target server from `--server` or from a single discovered entry.
3. Connect to the server using the selected transport.
4. Extract the live MCP catalog (tools, prompts, resources, templates).
5. Execute the requested command and render output.
6. Close the session and transport.

This lifecycle means command output always reflects the currently running MCP server, not static cached schema files.

## Command Surface

This command group lists or executes tools exposed by the selected MCP server.

```sh
mcpcli tools list
mcpcli tools <tool-name>
```

This command group lists or executes prompts exposed by the selected MCP server.

```sh
mcpcli prompts list
mcpcli prompts <prompt-name>
```

This command group lists resources and reads resource payloads by URI.

```sh
mcpcli resources list
mcpcli resources <resource-uri>
```

This command group lists resource templates and renders template URIs with arguments before reading resources.

```sh
mcpcli templates list
mcpcli templates <template-uri>
```

This command lists discovered server names and source files, which is useful for debugging config precedence.

```sh
mcpcli servers list
```

This shorthand form executes tools/prompts/resources/templates with `surface:target` syntax. The expected behavior is identical to the two-token form.

```sh
mcpcli tools:echo --text "hello"
mcpcli prompts:kickoff --json '{"topic":"launch"}'
```

## Global Flags

These flags are available across command surfaces:

| Flag | Description |
| --- | --- |
| `--help`, `-h` | Render help output. |
| `--version` | Print CLI version. |
| `--server <name>` | Select a server from discovered config. |
| `--config <path>` | Load config from a file or discovery directory. |
| `--transport <mode>` | Runtime transport override (`stdio`, `streamable-http`, `sse`). |
| `--format json` | Emit JSON for list commands. |
| `--json <string>` | Provide JSON arguments inline. |
| `--input <path>` | Provide JSON arguments from a file. |
| `--raw` | Emit raw output payloads when possible. |
| `--no-markdown` | Disable markdown rendering in text output. |
| `--allow-ansi` | Preserve ANSI control sequences from server text. |
| `--no-spinner` | Disable spinner output for non-interactive environments. |
| `--no-color` | Disable colored terminal output. |

## Input Handling

This command demonstrates the three primary input paths (`--json`, `--input`, and field flags). The expected behavior is the same regardless of input source if payload values are equivalent.

```sh
mcpcli tools weather.get --json '{"city":"Paris"}'
mcpcli tools weather.get --input ./payload.json
mcpcli tools weather.get --city Paris
```

This command demonstrates array and object argument forms. Arrays support repeated flags and JSON arrays; objects support dot notation and JSON objects.

```sh
mcpcli tools batch --items one --items two --meta.tag alpha
mcpcli tools batch --items '["one","two"]' --meta '{"tag":"alpha"}'
```

This command demonstrates argument passthrough after `--` when a schema field name collides with a CLI global flag. The expected behavior is that arguments after `--` are treated as command input, not CLI globals.

```sh
mcpcli tools echo -- --help "literal field value"
```

## Output Behavior

This command demonstrates JSON list output using `--format json`. The expected output is a JSON array suitable for machine parsing.

```sh
mcpcli tools list --format json
```

This command demonstrates raw payload output. When a single plain-text payload is returned, output is written directly; otherwise raw JSON is emitted.

```sh
mcpcli resources resource://manual --raw
```

This command demonstrates ANSI passthrough mode. Use it only when you trust server-provided ANSI sequences.

```sh
mcpcli tools present --allow-ansi
```

## Server Discovery and Selection

By default, `mcpcli` uses connector-based config discovery for common MCP host tool locations. Use `mcpcli servers list` to inspect exactly which server entries were discovered and which files they came from.

This command demonstrates explicit config path usage when you need deterministic behavior in CI or scripting. The expected output is constrained to the specified file or directory scope.

```sh
mcpcli servers list --config ./mcp.json
mcpcli tools list --config ./mcp.json --server demo
```

When multiple servers are discovered, pass `--server <name>` to avoid ambiguity.

## Transport Behavior

`mcpcli` follows MCP transport semantics and selects transport from runtime options plus server config shape.

| Server entry shape | Default transport |
| --- | --- |
| `command` + optional `args` | `stdio` |
| `url` or `endpoint` | `streamable-http` |

`--transport` can override this choice at runtime (for example, `--transport sse` for legacy endpoints) without mutating shared config files.

Specification and host-schema references:

- MCP transport specification: [MCP transports](https://modelcontextprotocol.io/specification/latest/basic/transports)
- VS Code MCP config schema: [VS Code MCP servers](https://code.visualstudio.com/docs/copilot/customization/mcp-servers)
- Claude Code MCP config schema: [Claude Code MCP](https://docs.claude.com/en/docs/claude-code/mcp)

## API Reference

`mcpcli` does not export JavaScript modules. Its public API is the executable command surface.

### Command Signatures

- `mcpcli [--help] [--version]`
- `mcpcli servers list [--format json] [--config <path>]`
- `mcpcli tools list [global flags]`
- `mcpcli tools <tool-name> [input flags] [global flags]`
- `mcpcli prompts list [global flags]`
- `mcpcli prompts <prompt-name> [input flags] [global flags]`
- `mcpcli resources list [global flags]`
- `mcpcli resources <resource-uri> [global flags]`
- `mcpcli templates list [global flags]`
- `mcpcli templates <template-uri> [input flags] [global flags]`

### Exit Behavior

- Exit code `0`: command completed successfully.
- Exit code `1`: command failed (validation, config, connection, or execution error).

## Common Errors

These examples cover common operator-facing failures and the fastest recovery steps.

- `Multiple servers found. Provide --server <name>.`:
  Run `mcpcli servers list` and retry with `--server <name>`.
- `Server "<name>" was not found.`:
  Validate exact server key spelling and config scope (`--config`).
- `Unknown tool "<tool>".`:
  Run `mcpcli tools list --server <name>` and use an exact tool name from output.
- `Invalid JSON for "<parameter>"`:
  Validate JSON syntax and prefer `--input` for complex nested payloads.

## Development

This command runs the `mcpcli` package test suite. The expected result is a passing Node test run that validates version/help rendering and command execution behavior.

```sh
pnpm --filter mcpcli test
```

## License

MIT
