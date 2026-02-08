# @mcp-layer/gateway

`@mcp-layer/gateway` provides shared runtime primitives for MCP adapter packages. It centralizes catalog bootstrap, request-scoped session resolution, schema validation, breaker-backed execution, telemetry helpers, and deterministic item mapping so adapter packages (for example REST and GraphQL) stay thin.

## Table of Contents

- [Installation](#installation)
- [When to use this package](#when-to-use-this-package)
- [Usage](#usage)
- [API Reference](#api-reference)
- [Runtime Error Reference](#runtime-error-reference)

## Installation

```sh
pnpm add @mcp-layer/gateway
# or
npm install @mcp-layer/gateway
# or
yarn add @mcp-layer/gateway
```

## When to use this package

Use this package when you are building an interface layer on top of MCP that needs to:

- discover and normalize MCP catalog data once,
- resolve sessions per request (direct session or manager mode),
- validate tool/prompt inputs with trust-aware schema rules,
- execute MCP calls with optional circuit breakers,
- instrument request lifecycles with OpenTelemetry API,
- map MCP item names deterministically for generated operation surfaces.

## Usage

This example demonstrates how adapter packages bootstrap runtime state once and reuse it per request. This matters because repeated catalog extraction and ad-hoc breaker creation quickly cause drift between adapters.

Expected behavior: one runtime context is created per bootstrap session, with a stable prefix/version and reusable resolver/validator/executor primitives.

```js
import { createRuntime, createMap } from '@mcp-layer/gateway';

const runtime = await createRuntime({
  session,
  validation: {
    trustSchemas: 'auto'
  }
}, {
  name: 'my-adapter',
  serviceName: 'my-adapter-runtime'
});

const context = runtime.contexts[0];
const mapping = createMap(context.catalog);

const resolved = await context.resolve(request);
const check = context.validator.validate('tool', 'echo', { text: 'hello', loud: false });
if (!check.valid) {
  throw new Error('Validation failed.');
}

const result = await context.execute(request, 'tools/call', {
  name: 'echo',
  arguments: { text: 'hello', loud: false }
});

console.log(mapping.findField('tool', 'echo'));
console.log(result);

await runtime.close();
```

## API Reference

### `createRuntime(options, meta?)`

Creates shared runtime contexts for adapter plugins.

Signature:

```ts
createRuntime(
  options: {
    session: Session | Session[];
    manager?: { get(request): Promise<Session>; close?(): Promise<void> };
    prefix?: string | ((version, info, sessionName) => string);
    validation?: {
      trustSchemas?: 'auto' | true | false;
      maxSchemaDepth?: number;
      maxSchemaSize?: number;
      maxPatternLength?: number;
      maxToolNameLength?: number;
      maxTemplateParamLength?: number;
    };
    resilience?: {
      enabled?: boolean;
      timeout?: number;
      errorThresholdPercentage?: number;
      resetTimeout?: number;
      volumeThreshold?: number;
    };
    telemetry?: {
      enabled?: boolean;
      serviceName?: string;
      metricPrefix?: string;
      api?: OpenTelemetryApi;
    };
    errors?: {
      exposeDetails?: boolean;
    };
    normalizeError?: (error, instance, requestId, options) => unknown;
  },
  meta?: {
    name?: string;
    serviceName?: string;
  }
): Promise<{
  config;
  contexts: Array<{
    session;
    catalog;
    info;
    version;
    prefix;
    validator;
    telemetry;
    resolve(request): Promise<{ session, breaker }>;
    execute(request, method, params): Promise<Record<string, unknown>>;
    normalize(error, instance, requestId?): unknown;
  }>;
  breakers: Map<string, CircuitBreaker>;
  normalize(error, instance, requestId?): unknown;
  close(): Promise<void>;
}>;
```

Behavior notes:

- `manager` requires a bootstrap `session` (catalog extraction source).
- manager mode does not support `session` arrays.
- `close()` shuts down breaker instances and calls `manager.close()` when available.
- validation registration is preloaded from catalog tool/prompt input schemas.

### `createMap(catalog)`

Builds a deterministic lookup/mapping model for MCP items.

Returns:

- `tools`, `prompts`, `resources`, `templates`: sorted item lists.
- `entries`: generated metadata entries `{ type, root, name, field, item }`.
- `find(type, name)`: lookup item by type/name.
- `findField(type, name)`: lookup generated field name.
- `byType(type)`: return filtered list for a type.

### `deriveApiVersion(info)`

Derives adapter version prefix strings (`v0`, `v1`, etc.) from server version info.

### `resolvePrefix(prefixOption, version, info, sessionName)`

Computes adapter mount prefix from static or callback prefix config.

### `createValidator(config, session)` and `SchemaValidator`

Creates trust-aware JSON-schema validator helpers for tool/prompt inputs.

### `createCircuitBreaker(session, config)` and `executeWithBreaker(...)`

Shared circuit-breaker primitives for MCP methods.

### `createTelemetry(config)` and `createCallContext(config)`

OpenTelemetry API integration and request-span/metric helper utilities.

### `validateRuntimeOptions(opts, meta?)` and `defaults(serviceName)`

Shared adapter option normalization and defaults.

## Runtime Error Reference

This section is written for high-pressure debugging moments. Each entry maps to concrete `createRuntime(...)` option-validation branches in `src/config/validate.js`.

<a id="error-688cda"></a>
### `"{option}" must be a positive number.`

Thrown from: `requirePositiveNumber`

This happens when numeric limits are `<= 0`, `NaN`, or non-finite.

Step-by-step resolution:
1. Read `{option}` in the error message and locate where that config value is built.
2. Coerce external/env values to numbers before calling `createRuntime`.
3. Reject invalid values early (`> 0` only) in your adapter bootstrap.
4. Add tests covering both invalid and valid values for that exact option.

This example shows a preflight guard that fails early before runtime creation. This matters because it prevents startup with invalid resilience values. Expected behavior: invalid numbers throw before adapter registration.

<details>
<summary>Fix Example: sanitize numeric runtime options before createRuntime</summary>

```js
const timeout = Number(process.env.MCP_TIMEOUT_MS ?? 30000);
if (!Number.isFinite(timeout) || timeout <= 0)
  throw new Error('MCP_TIMEOUT_MS must be a positive number');

const runtime = await createRuntime({
  session,
  resilience: { timeout }
});
```

</details>

<a id="error-a103aa"></a>
### `validation.trustSchemas must be "auto", true, or false.`

Thrown from: `trustMode`

This happens when `validation.trustSchemas` is set to an unsupported value.

Step-by-step resolution:
1. Inspect `validation.trustSchemas` at runtime (not only static config).
2. Replace stringified booleans like `"true"` with real booleans.
3. Use `"auto"` unless you have a strict reason to force trust/untrust.
4. Add config tests for all three supported values.

This example demonstrates the allowed trust mode values. This matters because schema trust mode controls whether validation executes for remote catalogs. Expected behavior: runtime initializes without trust-mode validation failures.

<details>
<summary>Fix Example: set trustSchemas to an allowed value</summary>

```js
await createRuntime({
  session,
  validation: {
    trustSchemas: 'auto'
  }
});
```

</details>

<a id="error-a74b20"></a>
### `prefix must be a string or function.`

Thrown from: `validateRuntimeOptions`

This happens when `prefix` is neither a string nor a callback.

Step-by-step resolution:
1. Use a static string prefix for fixed routes.
2. Use a callback for dynamic per-session prefixes.
3. Remove non-supported types from env/config mapping.
4. Add tests for both allowed prefix forms.

This example shows dynamic per-session prefixing. This matters for multi-session adapters that need stable route isolation. Expected behavior: each session resolves to a deterministic mount path.

<details>
<summary>Fix Example: use a valid prefix callback</summary>

```js
await createRuntime({
  session,
  prefix: function prefix(version, info, name) {
    return `/${version}/${name}`;
  }
});
```

</details>

<a id="error-712f62"></a>
### `manager does not support multiple sessions. Register multiple plugins instead.`

Thrown from: `validateRuntimeOptions`

This happens when `manager` is provided with `session` as an array.

Step-by-step resolution:
1. In manager mode, provide exactly one bootstrap session.
2. If you need multiple static sessions, remove manager mode.
3. Register separate adapter instances for each static session surface.
4. Add explicit startup tests for manager mode vs multi-session mode.

This example demonstrates valid manager-mode bootstrapping. This matters because manager mode resolves sessions per request and needs one catalog source at startup. Expected behavior: runtime initializes and delegates per-request resolution through manager.

<details>
<summary>Fix Example: manager mode with one bootstrap session</summary>

```js
await createRuntime({
  session: bootstrapSession,
  manager
});
```

</details>

<a id="error-c773d9"></a>
### `session is required when manager is provided (used for catalog bootstrap).`

Thrown from: `validateRuntimeOptions`

This happens when `manager` is configured without a bootstrap `session`.

Step-by-step resolution:
1. Provide a bootstrap session alongside manager.
2. Ensure bootstrap session connects before runtime creation.
3. Keep bootstrap session aligned with manager-provided session capabilities.
4. Add a startup test that asserts this requirement.

This example shows manager mode with explicit bootstrap catalog source. This matters because the runtime must extract catalog metadata at initialization time. Expected behavior: runtime can build validators and route metadata before serving requests.

<details>
<summary>Fix Example: include bootstrap session when manager is enabled</summary>

```js
await createRuntime({
  session: bootstrapSession,
  manager
});
```

</details>

<a id="error-6e22f2"></a>
### `session or manager option is required.`

Thrown from: `validateRuntimeOptions`

This happens when runtime options include neither `session` nor `manager`.

Step-by-step resolution:
1. Pass a connected `session` for static mode.
2. Or pass `manager` plus a bootstrap `session` for dynamic mode.
3. Add adapter-level assertions before calling `createRuntime`.
4. Add tests that verify startup failure without session sources.

This example demonstrates the minimum static-mode runtime configuration. This matters because all adapter behavior depends on a concrete session source. Expected behavior: runtime boots with one context.

<details>
<summary>Fix Example: provide session source</summary>

```js
await createRuntime({ session });
```

</details>

<a id="error-b78e6d"></a>
### `manager must be an object with a get(request) function.`

Thrown from: `validateRuntimeOptions`

This happens when `manager` is missing or does not implement `get(request)`.

Step-by-step resolution:
1. Ensure manager is an object, not a primitive.
2. Implement `async get(request)` returning a `Session`.
3. Optionally add `close()` for lifecycle cleanup.
4. Add contract tests for malformed manager values.

This example shows the minimum manager contract expected by gateway runtime. This matters because request-scoped session resolution depends on `get(request)`. Expected behavior: each request can resolve a valid session.

<details>
<summary>Fix Example: implement required manager interface</summary>

```js
const manager = {
  async get(request) {
    return resolveSession(request);
  }
};
```

</details>

<a id="error-6fc055"></a>
### `errors must be an object.`

Thrown from: `validateRuntimeOptions`

This happens when `errors` is provided as a primitive instead of an object.

Step-by-step resolution:
1. Ensure `errors` is an object literal.
2. Keep supported keys under `errors` (for example `exposeDetails`).
3. Remove string/boolean shortcuts from config loaders.
4. Add shape tests for valid and invalid `errors` values.

This example demonstrates valid error option shape. This matters because adapters pass error options into normalization paths. Expected behavior: runtime accepts configuration and exposes normalized error behavior.

<details>
<summary>Fix Example: pass errors as an object</summary>

```js
await createRuntime({
  session,
  errors: { exposeDetails: false }
});
```

</details>

<a id="error-349758"></a>
### `validation must be an object.`

Thrown from: `validateRuntimeOptions`

This happens when `validation` is not an object.

Step-by-step resolution:
1. Move validation keys under `validation`.
2. Ensure `validation` is a plain object.
3. Keep limit values typed correctly.
4. Add tests for malformed and valid validation objects.

This example shows valid validation option structure. This matters because the runtime merges these limits before validator construction. Expected behavior: schema limits are applied and runtime starts cleanly.

<details>
<summary>Fix Example: provide validation settings as object</summary>

```js
await createRuntime({
  session,
  validation: {
    maxSchemaDepth: 10,
    maxSchemaSize: 102400,
    maxPatternLength: 1000
  }
});
```

</details>

<a id="error-b72182"></a>
### `normalizeError must be a function.`

Thrown from: `validateRuntimeOptions`

This happens when `normalizeError` exists but is not callable.

Step-by-step resolution:
1. Ensure `normalizeError` is a function reference.
2. Keep signature aligned with runtime usage (`error`, `instance`, `requestId`, `options`).
3. Remove object/string placeholders from config files.
4. Add tests validating custom normalizer wiring.

This example shows a valid runtime normalizer hook. This matters because adapters rely on this hook to shape transport-specific error payloads. Expected behavior: thrown upstream errors are converted to your adapter format.

<details>
<summary>Fix Example: pass callable normalizeError handler</summary>

```js
await createRuntime({
  session,
  normalizeError: function normalizeError(error, instance, requestId, options) {
    return { error, instance, requestId, options };
  }
});
```

</details>

## License

MIT
