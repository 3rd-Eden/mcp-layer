# @mcp-layer/test-server

Feature-complete MCP server used by the workspace integration tests. It mirrors the tooling, resource, prompt, sampling, elicitation, and notification capabilities documented in the [Model Context Protocol TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk), giving clients a single target that exercises the entire stack end to end.

## Provided capabilities

- **Tools** – `echo`, `add`, `files`, `summaries`, `booking`, `roots`, `note-update`, `logs`, `progress`, and `rebalance` cover plain IO, structured output, `resource_link` payloads, sampling, elicitation, roots, mutable resources, logging notifications, progress updates, and notification debouncing.
- **Resources** – `resource://manual` ships a markdown manual and the `note://{topic}/{detail}` template lists per-feature notes plus context-aware completions.
- **Prompts & completions** – The `welcome` prompt exposes named/tone arguments with `completable` helpers so completion/complete requests return rich suggestions.
- **Sampling & elicitation** – `summaries` calls `sampling/createMessage` when the client declares support, while `booking` requests input through `elicitation/create`.
- **Notification debouncing** – `rebalance` rapidly toggles tool registrations to assert that only a single `notifications/tools/list_changed` event is emitted for a batch.

## Structure

- `src/tools/*` — feature folders for each tool implementation.
- `src/resources/*` — manual and note resources plus their completion helpers.
- `src/prompts/*` — prompt definitions such as the completable welcome prompt.
- `src/data/*` — shared manual text, references, and note metadata.
- `src/shared/*` — reusable utilities like the capability checker.

## Spec support matrix

| Feature | Status | Notes |
| --- | --- | --- |
| Tools (structured outputs, resource links) | ✅ | `echo`, `add`, `files`, `summaries`, `booking`, `roots`, `logs`, `progress`, `rebalance`. |
| Resources & dynamic templates | ✅ | `resource://manual`, `note://{topic}/{detail}` with completions. |
| Prompts & completion API | ✅ | `welcome` prompt plus `completable` args; `completion/complete` exercised in tests. |
| Sampling (`sampling/createMessage`) | ✅ | `summaries` tool proxies sampling and validates responses. |
| Elicitation (`elicitation/create`) | ✅ | `booking` tool requests alternate booking info. |
| Roots (`roots/list`) | ✅ | `roots` tool lists file URIs from capable clients. |
| Resource subscriptions/updates | ✅ | `resources/subscribe` + `note-update` tool emit `notifications/resources/updated`. |
| Logging notifications | ✅ | `logs` tool emits `notifications/message`, README explains setLevel usage. |
| Progress notifications | ✅ | `progress` tool requires `_meta.progressToken` and streams `notifications/progress`. |
| Debounced list notifications | ✅ | `rebalance` tool toggles registrations to coalesce events. |
| Alternate transports (Streamable HTTP / SSE) | ✅ | `mcp-test-server-http` boots Express with Streamable HTTP + SSE endpoints. |
| Auth/OAuth proxying | ⛔️ | Out of scope for this test fixture. |

## Installation

```bash
# npm
npm install @mcp-layer/test-server
# pnpm
pnpm add @mcp-layer/test-server
# yarn
yarn add @mcp-layer/test-server
```

Requirements: Node.js 20+ (or Deno/Bun with Node compatibility) so the included binaries and ESM modules run without flags.

## Usage

### Stdio transport

```bash
npx mcp-test-server
```

This command launches the server over stdio, which is what most MCP clients expect when spawning local tools. For example, with Claude Code or VS Code MCP configuration you can point the client at the binary:

```json
{
  "name": "mcp-layer-test-server",
  "type": "stdio",
  "command": "npx",
  "args": ["mcp-test-server"]
}
```

### Streamable HTTP + SSE transport

```bash
npx mcp-test-server-http --port 3333
```

This starts the Express-based Streamable HTTP endpoint on `/mcp` and SSE compatibility endpoints on `/sse` + `/sse/messages`. Configure MCP clients that support HTTP transports (Claude Desktop, VS Code, Cursor, MCP Inspector, etc.) to point at `http://localhost:3333/mcp`.

Both binaries emit server `info` and `instructions` metadata so clients immediately learn which tools/resources/prompts are available.

## Testing

```bash
pnpm test --filter @mcp-layer/test-server
```

The `node:test` suite boots the published binary, configures real MCP clients (including sampling and elicitation handlers), exercises every tool/resource/prompt, and asserts completions plus notification debouncing so coverage remains aligned with the upstream SDK README.
