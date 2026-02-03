# @mcp-layer/test-server

`@mcp-layer/test-server` is a feature-complete MCP server used for integration tests and local experiments. It mirrors the tool, resource, prompt, sampling, elicitation, notification, and MCP Apps features expected by the official SDK so clients can validate end-to-end behavior against a single, real server.

## Why this exists

The rest of this workspace depends on a real MCP server to validate protocols. This server:
- Runs over stdio (and optional HTTP/SSE transports)
- Exercises all major MCP capabilities
- Exposes stable fixtures for tests and demos

## Installation

```bash
# npm
npm install @mcp-layer/test-server
# pnpm
pnpm add @mcp-layer/test-server
# yarn
yarn add @mcp-layer/test-server
```

Requirements: Node.js 20+ (or Deno/Bun with Node compatibility).

## Quick start

### Stdio transport

```bash
npx mcp-test-server
```

### Streamable HTTP + SSE transport

```bash
npx mcp-test-server-http --port 3333
```

This exposes:
- Streamable HTTP on `/mcp`
- SSE compatibility on `/sse` and `/sse/messages`

## What it provides

### Tools

- `echo` -- returns text, structured output
- `add` -- arithmetic + structured output
- `annotated` -- tool annotations + `_meta` coverage
- `dashboard` -- MCP Apps UI metadata via `_meta.ui`
- `files` -- emits `resource_link` payloads
- `present` -- mixed content types (text/markdown/image/audio/resource/resource_link)
- `summaries` -- sampling support
- `booking` -- elicitation support
- `roots` -- roots capability
- `note-update` -- mutable resources
- `logs` -- logging notifications
- `progress` -- progress notifications
- `rebalance` -- debounced list updates

### Resources

- `resource://manual` -- markdown manual
- `note://{topic}/{detail}` -- template-backed resources with completions
- `ui://dashboard/app.html` -- MCP Apps HTML UI

### Prompts

- `welcome` -- prompt arguments with completions

### MCP Apps

- `dashboard` tool advertises `_meta.ui.resourceUri`
- `ui://dashboard/app.html` serves HTML and `_meta.ui` settings (`csp`, `permissions`)

## Structure

- `src/tools/*` -- tool implementations
- `src/resources/*` -- resource + template handlers
- `src/prompts/*` -- prompt definitions
- `src/data/*` -- shared manual text and fixtures
- `src/shared/*` -- utilities and capability checks

## Spec support matrix

| Feature | Status | Notes |
| --- | --- | --- |
| Tools (structured outputs, resource links) | yes | `echo`, `add`, `files`, `summaries`, `booking`, `roots`, `logs`, `progress`, `rebalance`. |
| Tool annotations + metadata | yes | `annotated` exposes `annotations` + `_meta`. |
| MCP Apps (UI resources) | yes | `dashboard` tool exposes `_meta.ui.resourceUri`, `ui://dashboard/app.html` serves HTML. |
| Mixed content outputs | yes | `present` emits text/markdown/image/audio/resource/resource_link. |
| Resources & dynamic templates | yes | `resource://manual`, `note://{topic}/{detail}` with completions. |
| Prompts & completion API | yes | `welcome` prompt + `completion/complete`. |
| Sampling (`sampling/createMessage`) | yes | `summaries` tool proxies sampling and validates responses. |
| Elicitation (`elicitation/create`) | yes | `booking` tool requests alternate booking info. |
| Roots (`roots/list`) | yes | `roots` tool lists file URIs from capable clients. |
| Resource subscriptions/updates | yes | `resources/subscribe` + `note-update` tool emit `notifications/resources/updated`. |
| Logging notifications | yes | `logs` tool emits `notifications/message`. |
| Progress notifications | yes | `progress` tool streams `notifications/progress`. |
| Debounced list notifications | yes | `rebalance` tool coalesces updates. |
| Alternate transports (Streamable HTTP / SSE) | yes | `mcp-test-server-http` bootstraps both. |
| Auth/OAuth proxying | no | Out of scope for this fixture. |

## Usage in tests

Use it as the real server target for integration tests:

```js
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [require.resolve('@mcp-layer/test-server/src/bin.js')]
});

const client = new Client({ name: 'demo', version: '0.0.0' });
await client.connect(transport);
```

## Testing

```bash
pnpm test --filter @mcp-layer/test-server
```

The suite boots the real binary, exercises all tools/resources/prompts, verifies notifications, and asserts MCP Apps metadata so this fixture remains trustworthy.

## Extending the server

When adding capabilities:
1) Implement the feature in `src/*`.
2) Add or update a test in `test/index.test.js`.
3) Document it in this README.

## License

MIT
