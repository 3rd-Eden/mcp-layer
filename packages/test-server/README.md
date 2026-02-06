# @mcp-layer/test-server

`@mcp-layer/test-server` is a feature-complete MCP server used for integration tests and local experiments. It mirrors the tool, resource, prompt, sampling, elicitation, notification, and MCP Apps features expected by the official SDK so clients can validate end-to-end behavior against a single, real server.


The rest of this workspace depends on a real MCP server to validate protocols. This server:
- Runs over stdio (and optional HTTP/SSE transports)
- Exercises all major MCP capabilities
- Exposes stable fixtures for tests and demos

## Table of Contents

- [Installation](#installation)
- [Quick start](#quick-start)
- [What it provides](#what-it-provides)
- [Structure](#structure)
- [Spec support matrix](#spec-support-matrix)
- [Usage in tests](#usage-in-tests)
- [Testing](#testing)
- [Extending the server](#extending-the-server)
- [Runtime Error Reference](#runtime-error-reference)

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

## Runtime Error Reference

This section is written for high-pressure debugging moments. These errors are intentionally emitted by the test server to exercise client and REST error-handling paths.

<a id="error-56fd38"></a>
### Protocol failure

Thrown from: `registerCrash.crashTool`

This error is intentionally thrown by the `crash` tool. It simulates an MCP tool that fails at protocol/runtime level so downstream layers can validate error mapping and HTTP problem responses.

Step-by-step resolution:
1. Confirm you actually invoked the `crash` tool (`tools crash exec`) and not a production tool.
2. If this appeared unexpectedly, verify test fixture/tool name selection.
3. In integration tests, assert the expected failure shape (`isError`/problem details) instead of treating it as an infra bug.
4. Use a non-crashing test tool when validating success paths.

<details>
<summary>Fix Example: separate crash-path tests from success-path tests</summary>

```js
await t.test('error mapping', async function errorCase() {
  await assert.rejects(client.callTool({ name: 'crash', arguments: {} }));
});

await t.test('success path', async function successCase() {
  const result = await client.callTool({ name: 'slow', arguments: {} });
  assert.equal(result.isError, false);
});
```

</details>

<a id="error-990eaa"></a>
### first failure

Thrown from: `registerFlap.flapTool`

This error is intentionally thrown on the first invocation of the `flap` tool. The second and later calls succeed, which is useful for circuit-breaker recovery tests.

Step-by-step resolution:
1. Confirm this is the first call in the process lifetime; first-call failure is expected behavior.
2. If you need deterministic success, warm up the tool once before the measured assertion.
3. For resilience tests, assert both phases: failure first, success next.
4. Reset server state between test cases when first-call semantics matter.

<details>
<summary>Fix Example: account for flap tool's first-call failure contract</summary>

```js
await assert.rejects(client.callTool({ name: 'flap', arguments: {} }));
const ok = await client.callTool({ name: 'flap', arguments: {} });
assert.equal(ok.isError, false);
```

</details>

<a id="error-d1ff05"></a>
### progress tool aborted

Thrown from: `registerProgress.progressTool`

This error is raised when the progress tool sees `extra.signal.aborted` before or during loop processing. It represents explicit cancellation of long-running MCP work.

Step-by-step resolution:
1. Check client/request timeout and cancellation behavior for this call.
2. Confirm you did not pass an already-aborted signal into the tool execution context.
3. Increase timeout or delay cancellation if you expect completion.
4. For cancellation tests, assert abort behavior explicitly instead of treating this as unexpected.

<details>
<summary>Fix Example: avoid premature cancellation for progress runs</summary>

```js
const controller = new AbortController();
const result = await client.callTool({
  name: 'progress',
  arguments: { steps: 3, delayMs: 20 },
  signal: controller.signal
});
assert.equal(result.isError, false);
```

</details>

<a id="error-c9d511"></a>
### progress tool aborted

Thrown from: `registerProgress.progressTool.sleep`

This error is raised when cancellation occurs while `progress` is sleeping between step notifications. It is the mid-flight cancellation branch of the same tool.

Step-by-step resolution:
1. Correlate abort timing with `delayMs` and `steps` in the progress request.
2. If completion is required, avoid cancelling during the sleep interval.
3. If cancellation is expected, assert this specific branch so tests remain intentional.
4. Tune `delayMs` in tests to make cancel timing deterministic.

<details>
<summary>Fix Example: deterministic cancellation test for sleep-abort path</summary>

```js
const controller = new AbortController();
const pending = client.callTool({
  name: 'progress',
  arguments: { steps: 5, delayMs: 100 },
  signal: controller.signal
});

setTimeout(function abortLater() {
  controller.abort();
}, 30);

await assert.rejects(pending);
```

</details>

## License

MIT
