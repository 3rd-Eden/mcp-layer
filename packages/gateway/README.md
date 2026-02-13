# @mcp-layer/gateway

`@mcp-layer/gateway` provides shared runtime primitives for MCP adapter packages. It centralizes catalog bootstrap, request-scoped session resolution, schema validation, breaker-backed execution, telemetry helpers, and deterministic item mapping so adapter packages (for example REST and GraphQL) stay thin.

It also applies the shared plugin pipeline (`@mcp-layer/plugin`) and first-party guardrails (`@mcp-layer/guardrails`) so adapter surfaces evaluate the same runtime policies.

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
    plugins?: Array<Record<string, unknown>>;
    guardrails?: Record<string, unknown>;
    pipeline?: {
      trace?: {
        enabled?: boolean;
        collect?: boolean;
        sink?: (event: Record<string, unknown>) => void;
      };
    };
    policy?: {
      lock?: boolean;
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
    execute(request, method, params, meta?): Promise<Record<string, unknown>>;
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
- default guardrail profile is `strict` unless explicitly overridden.
- plugin phases run in this order:
  - `transport` before request execution setup,
  - `schema` after catalog extraction,
  - `before`/`after`/`error` around method execution.
- guardrail profiles are runtime options; shared MCP config files are not extended with custom persisted keys.
- `policy.lock=true` enables locked mode:
  - requires `guardrails.profile === 'strict'`,
  - rejects custom `plugins`.
- `pipeline.trace` forwards plugin trace controls into `@mcp-layer/plugin` for runtime-level diagnostics.

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

<a id="error-4ec917"></a>
### `plugins must be an array.`

Thrown from: `validateRuntimeOptions`

This happens when `plugins` is provided with a non-array value.

Step-by-step resolution:
1. Pass `plugins` as an array of plugin definitions.
2. Remove object/scalar placeholder values from runtime config.
3. Ensure each plugin entry has a valid `name` and hook functions.
4. Re-run runtime creation after config correction.

This example shows valid runtime plugin array configuration. This matters because transport/schema/operation hook chains are assembled from this list. Expected behavior: runtime starts and executes with deterministic plugin order.

<details>
<summary>Fix Example: provide plugins as array</summary>

```js
await createRuntime({
  session,
  plugins: [{
    name: 'trace',
    before: function before(context) {
      return context;
    }
  }]
});
```

</details>

<a id="error-cf074f"></a>
### `guardrails must be an object.`

Thrown from: `validateRuntimeOptions`

This happens when `guardrails` is provided with a non-object value.

Step-by-step resolution:
1. Provide `guardrails` as an object.
2. Pass profile/settings keys inside that object.
3. Remove string/array placeholders from adapter config.
4. Re-run runtime initialization.

This example shows valid guardrails configuration. This matters because first-party policy plugins are generated from this object. Expected behavior: runtime composes guardrail plugins before user plugins.

<details>
<summary>Fix Example: provide guardrails as object</summary>

```js
await createRuntime({
  session,
  guardrails: {
    profile: 'strict'
  }
});
```

</details>

<a id="error-38a31b"></a>
### `pipeline must be an object.`

Thrown from: `validateRuntimeOptions`

This happens when `pipeline` is provided as a non-object value.

Step-by-step resolution:
1. Provide `pipeline` as an object.
2. Move trace controls into `pipeline.trace`.
3. Remove scalar placeholders from runtime config.
4. Re-run runtime initialization.

<details>
<summary>Fix Example: provide pipeline trace configuration as object</summary>

```js
await createRuntime({
  session,
  pipeline: {
    trace: {
      enabled: true,
      collect: false
    }
  }
});
```

</details>

<a id="error-3bb796"></a>
### `policy must be an object.`

Thrown from: `validateRuntimeOptions`

This happens when `policy` is provided as a non-object value.

Step-by-step resolution:
1. Provide `policy` as an object.
2. Move lock settings under `policy.lock`.
3. Remove scalar placeholders from runtime config.
4. Re-run runtime initialization.

<details>
<summary>Fix Example: provide policy configuration as object</summary>

```js
await createRuntime({
  session,
  policy: {
    lock: true
  }
});
```

</details>

<a id="error-7adf99"></a>
### `pipeline.trace must be an object.`

Thrown from: `validateRuntimeOptions`

This happens when `pipeline.trace` is not a plain object.

Step-by-step resolution:
1. Provide trace settings as an object under `pipeline.trace`.
2. Remove scalar/array placeholders from trace config.
3. Keep only supported keys (`enabled`, `collect`, `sink`).
4. Re-run runtime initialization.

<details>
<summary>Fix Example: provide trace object shape</summary>

```js
await createRuntime({
  session,
  pipeline: {
    trace: {
      enabled: true
    }
  }
});
```

</details>

<a id="error-af9d4b"></a>
### `pipeline.trace.enabled must be a boolean.`

Thrown from: `validateRuntimeOptions`

This happens when `pipeline.trace.enabled` is not a boolean value.

Step-by-step resolution:
1. Convert string/number environment inputs to booleans before runtime creation.
2. Keep `enabled` strictly `true` or `false`.
3. Validate config parsing logic before calling `createRuntime`.
4. Re-run runtime initialization.

<details>
<summary>Fix Example: strict boolean trace enabled flag</summary>

```js
await createRuntime({
  session,
  pipeline: {
    trace: {
      enabled: true
    }
  }
});
```

</details>

<a id="error-da2f49"></a>
### `pipeline.trace.collect must be a boolean.`

Thrown from: `validateRuntimeOptions`

This happens when `pipeline.trace.collect` is not a boolean value.

Step-by-step resolution:
1. Convert external config values to booleans before runtime creation.
2. Keep `collect` strictly `true` or `false`.
3. Use `collect=true` only when context trace arrays are desired.
4. Re-run runtime initialization.

<details>
<summary>Fix Example: strict boolean trace collect flag</summary>

```js
await createRuntime({
  session,
  pipeline: {
    trace: {
      enabled: true,
      collect: false
    }
  }
});
```

</details>

<a id="error-3a06fc"></a>
### `pipeline.trace.sink must be a function.`

Thrown from: `validateRuntimeOptions`

This happens when `pipeline.trace.sink` is provided as a non-function value.

Step-by-step resolution:
1. Pass a callable function for `sink`.
2. Ensure sink handlers are side-effect safe and fast.
3. Avoid passing logger configuration objects directly as sink values.
4. Re-run runtime initialization.

<details>
<summary>Fix Example: valid trace sink callback</summary>

```js
function sink(event) {
  console.log(event);
}

await createRuntime({
  session,
  pipeline: {
    trace: {
      enabled: true,
      sink
    }
  }
});
```

</details>

<a id="error-43d120"></a>
### `policy.lock must be a boolean.`

Thrown from: `validateRuntimeOptions`

This happens when `policy.lock` is provided as a non-boolean value.

Step-by-step resolution:
1. Convert external lock flags to booleans during config loading.
2. Keep lock mode strictly `true` or `false`.
3. Avoid using string flags like `"true"` directly.
4. Re-run runtime initialization.

<details>
<summary>Fix Example: strict boolean lock flag</summary>

```js
await createRuntime({
  session,
  policy: {
    lock: true
  }
});
```

</details>

<a id="error-0109d5"></a>
### `guardrails.profile must be "baseline" or "strict".`

Thrown from: `validateRuntimeOptions`

This happens when `guardrails.profile` uses an unsupported value.

Step-by-step resolution:
1. Set profile to `baseline` or `strict`.
2. Avoid custom profile labels in runtime config.
3. If custom behavior is needed, use explicit guardrail options with a valid profile.
4. Re-run runtime initialization.

<details>
<summary>Fix Example: supported guardrail profile value</summary>

```js
await createRuntime({
  session,
  guardrails: {
    profile: 'strict'
  }
});
```

</details>

<a id="error-306cc6"></a>
### `policy.lock requires guardrails.profile to be "strict".`

Thrown from: `validateRuntimeOptions`

This happens when policy lock mode is enabled with a non-strict guardrail profile.

Step-by-step resolution:
1. Set `guardrails.profile` to `strict`.
2. Keep `policy.lock` enabled only in production policies.
3. Re-run runtime initialization and verify policy lock passes.
4. Add tests that assert strict mode under lock.

<details>
<summary>Fix Example: strict guardrails with policy lock enabled</summary>

```js
await createRuntime({
  session,
  policy: { lock: true },
  guardrails: { profile: 'strict' }
});
```

</details>

<a id="error-b7dc10"></a>
### `policy.lock forbids custom runtime plugins.`

Thrown from: `validateRuntimeOptions`

This happens when custom plugins are passed while policy lock mode is enabled.

Step-by-step resolution:
1. Remove `plugins` from locked runtime config.
2. Move required policy behavior into first-party guardrails.
3. Keep lock mode for hardened production profiles only.
4. Re-run runtime initialization and verify no plugin policy conflict.

<details>
<summary>Fix Example: locked runtime without custom plugins</summary>

```js
await createRuntime({
  session,
  policy: { lock: true },
  guardrails: { profile: 'strict' }
});
```

</details>

## License

MIT
