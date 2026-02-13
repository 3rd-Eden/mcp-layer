# @mcp-layer/plugin

`@mcp-layer/plugin` provides the shared plugin pipeline used by `@mcp-layer/gateway` and `@mcp-layer/cli`. It wraps [supply](https://www.npmjs.com/package/supply) and exposes deterministic middleware phases for transport, schema, and operation execution.

## What this package demonstrates

This package demonstrates how to centralize policy and extension logic once, then apply it consistently across CLI, REST, and GraphQL surfaces.

Expected behavior: plugin hooks run in stable phase order, context mutations flow into later phases, and failures/timeouts fail closed with stable error codes.

## Installation

```sh
pnpm add @mcp-layer/plugin
```

## API Reference

### `definePlugin(input)`

Normalizes and validates a plugin definition.

Accepted hook names:
- `transport(context)`
- `schema(context)`
- `before(context)`
- `after(context)`
- `error(context)`

All hooks are optional. `name` is required.

### `createPipeline(options?)`

Builds a pipeline with all phases.

`options`:
- `plugins?: Array<Record<string, unknown>>`
- `timeoutMs?: number` (default `2000`)
- `trace?: { enabled?: boolean, collect?: boolean, sink?: (event) => void }`

Returns:
- `transport`
- `schema`
- `before`
- `after`
- `error`
- `plugins`
- `timeoutMs`
- `trace`

`trace` behavior:
- `enabled`: enables per-plugin phase tracing. Defaults to `true` when `MCP_LAYER_DEBUG=1|true|yes`, otherwise `false`.
- `collect`: when `true`, hook trace events are appended to `context.meta.pluginTrace`.
- `sink`: optional callback for external trace handling.

### `runTransport(pipeline, context)`

Runs only the `transport` phase. Use this before creating or selecting connections.

### `runSchema(pipeline, context)`

Runs only the `schema` phase. Use this after catalog extraction and before route/schema registration.

### `runPipeline(pipeline, context, execute)`

Runs operation phases:
1. `before`
2. `execute(context)`
3. `after` on success
4. `error` on failure

Returns the final mutable context.

## Context Contract

The pipeline does not enforce a strict schema, but runtime integrations in this repo pass:
- `operationId`
- `surface`
- `method`
- `sessionId`
- `serverName`
- `params`
- `result`
- `error`
- `meta`

Plugins should preserve fields they do not own.

### Phase responsibilities

| Phase | When it runs | Typical use | Safe mutation targets |
| --- | --- | --- | --- |
| `transport` | Before connection selection/execution setup | transport override, per-surface routing metadata | `params.transport`, `session`, `breaker`, `meta` |
| `schema` | After catalog extraction | hide/annotate catalog items, normalize schema metadata | `catalog`, `meta` |
| `before` | Before operation execution | allow/deny checks, payload shaping, telemetry tags | `method`, `params`, `meta`, `session`, `breaker` |
| `after` | After successful execution | response shaping/redaction, audit metadata | `result`, `meta` |
| `error` | After execution failure | error remap/enrichment, audit hooks | `error`, `meta` |

### Merge semantics

Hook functions can either mutate `context` directly or return a patch object:

- Non-object returns are ignored.
- For `meta`, patches are shallow-merged (`{ ...oldMeta, ...patchMeta }`).
- For all other keys, patch writes replace existing values.
- Later plugins in the same phase observe previous mutations/patches.
- With tracing enabled and `collect: true`, hook events are written to `meta.pluginTrace` with `operationId`, `plugin`, `phase`, `status`, and `durationMs`.

This means plugin ordering is part of the contract. Register plugins in deterministic order when two plugins may touch the same key.

### Conflict handling and ordering

- Phase order is fixed: `transport` -> `schema` -> `before` -> execute -> `after`/`error`.
- Within a phase, plugins run in array registration order.
- Last write wins for conflicting non-`meta` keys.
- Guardrails and policy plugins should run before transformation plugins so denials occur on unmodified intent.

### Transport and schema manipulation examples

This example demonstrates transport selection + schema pruning in one pipeline. This matters when the same policy should affect CLI, REST, and GraphQL surfaces without forking adapter code. Expected behavior: remote surfaces force `streamable-http`, and catalog output excludes denied tools.

```js
import { createPipeline, runSchema, runTransport } from '@mcp-layer/plugin';

function transportGate(context) {
  if (context.surface !== 'tools') return;
  return {
    params: {
      ...context.params,
      transport: 'streamable-http'
    }
  };
}

function schemaGate(context) {
  const list = Array.isArray(context.catalog?.items) ? context.catalog.items : [];
  const next = list.filter(function keep(item) {
    return !(item.type === 'tool' && item.name === 'shell_exec');
  });

  return {
    catalog: {
      ...context.catalog,
      items: next
    }
  };
}

const pipeline = createPipeline({
  plugins: [{
    name: 'gateway-policy',
    transport: transportGate,
    schema: schemaGate
  }]
});

const transport = await runTransport(pipeline, {
  surface: 'tools',
  method: 'transport/connect',
  params: {},
  meta: {}
});

const shaped = await runSchema(pipeline, {
  surface: 'schema',
  method: 'schema/extract',
  catalog,
  meta: {}
});
```

### Plugin tracing and profiling

This example demonstrates pipeline trace collection for hook latency diagnostics. This matters when policy stacks grow and you need concrete timing data per phase. Expected behavior: each hook execution appends a trace record into `meta.pluginTrace`.

```js
import { createPipeline, runPipeline } from '@mcp-layer/plugin';

const pipeline = createPipeline({
  trace: {
    enabled: true,
    collect: true
  },
  plugins: [{
    name: 'timed',
    before: function before(context) {
      return context;
    }
  }]
});

const output = await runPipeline(
  pipeline,
  { method: 'tools/call', params: {}, meta: {} },
  async function execute() {
    return { ok: true };
  }
);

console.log(output.meta.pluginTrace);
```

For CLI-local debugging, set `MCP_LAYER_DEBUG=1` to emit trace lines to `stderr`.

## Runtime Error Reference

All runtime errors are `LayerError` from `@mcp-layer/error`.

<a id="error-886dc6"></a>
### Plugin "{plugin}" {hook} handler must be a function.

Thrown from: `definePlugin`

Step-by-step resolution:
1. Inspect the plugin object and verify each hook value is callable or omitted.
2. Keep only supported hook names: `transport`, `schema`, `before`, `after`, `error`.
3. Export named functions for hooks instead of literal non-function values.
4. Rebuild the pipeline and rerun the failing command.

<details>
<summary>Fix Example: valid plugin hook shapes</summary>

```js
createPipeline({
  plugins: [{
    name: 'sample',
    before: function before(context) {
      return context;
    }
  }]
});
```

</details>

<a id="error-ecafd1"></a>
### Plugin definition must be an object.

Thrown from: `definePlugin`

Step-by-step resolution:
1. Verify every entry in `plugins` is a plain object.
2. Remove scalar values, arrays, and `null` from plugin arrays.
3. Confirm plugin factories return object values before passing to `createPipeline`.
4. Re-run pipeline construction.

<details>
<summary>Fix Example: pass a concrete plugin object</summary>

```js
const plugin = { name: 'guard', before: function before() {} };
createPipeline({ plugins: [plugin] });
```

</details>

<a id="error-c7131d"></a>
### Plugin name must be a non-empty string.

Thrown from: `definePlugin`

Step-by-step resolution:
1. Ensure each plugin object has `name` set.
2. Use stable string identifiers for plugin names.
3. Avoid empty strings and derived undefined values.
4. Recreate the pipeline with corrected plugin metadata.

<details>
<summary>Fix Example: define a stable plugin name</summary>

```js
createPipeline({
  plugins: [{
    name: 'policy-redaction',
    before: function before(context) { return context; }
  }]
});
```

</details>

<a id="error-5a822b"></a>
### Plugin "{plugin}" timed out in "{phase}" phase after {timeout}ms.

Thrown from: `runPipeline`

Step-by-step resolution:
1. Identify the plugin and phase from the error variables.
2. Reduce hook work or move heavy operations outside request paths.
3. Increase `timeoutMs` only when the slow behavior is expected and safe.
4. Re-run with timing instrumentation around plugin hooks.

<details>
<summary>Fix Example: raise timeout for heavy but expected work</summary>

```js
createPipeline({
  timeoutMs: 5000,
  plugins
});
```

</details>

<a id="error-46366c"></a>
### Plugin "{plugin}" failed in "{phase}" phase.

Thrown from: `runPipeline`

Step-by-step resolution:
1. Read the wrapped `cause` to identify the original failure.
2. Verify the plugin mutates only fields it owns and preserves context shape.
3. Add targeted tests for the specific phase path.
4. Redeploy after plugin fix.

<details>
<summary>Fix Example: harden plugin hook logic</summary>

```js
function before(context) {
  if (!context.params || typeof context.params !== 'object') return;
  context.params = { ...context.params };
}
```

</details>

<a id="error-ddcab2"></a>
### Pipeline instance is required.

Thrown from: `runPipeline`

Step-by-step resolution:
1. Ensure `createPipeline(...)` is called before executing hooks.
2. Pass the returned pipeline object to `runTransport`, `runSchema`, and `runPipeline`.
3. Do not pass raw plugin arrays where a pipeline instance is expected.
4. Retry execution after wiring correction.

<details>
<summary>Fix Example: always execute through a created pipeline</summary>

```js
const pipeline = createPipeline({ plugins });
await runPipeline(pipeline, context, execute);
```

</details>

<a id="error-6767a8"></a>
### Pipeline execute callback is required.

Thrown from: `runPipeline`

Step-by-step resolution:
1. Pass a function as the third argument to `runPipeline`.
2. Ensure callback returns a promise or value for operation result.
3. Keep callback signature as `execute(context)`.
4. Re-run operation flow.

<details>
<summary>Fix Example: provide an operation executor</summary>

```js
await runPipeline(pipeline, context, async function execute(input) {
  return callMcp(input.method, input.params);
});
```

</details>

Pass-through codes (not rewrapped): `GUARDRAIL_DENIED`, `EGRESS_POLICY_DENIED`, `APPROVAL_REQUIRED`, `RATE_LIMITED`.

## Testing

```sh
pnpm --filter @mcp-layer/plugin test
```

Tests use `node:test` and verify phase order, mutation flow, timeout behavior, and pass-through policy denial behavior.
