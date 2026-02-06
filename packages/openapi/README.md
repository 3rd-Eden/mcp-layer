# @mcp-layer/openapi

OpenAPI 3.1 specification generator for MCP servers.

This package converts the MCP catalog produced by `@mcp-layer/schema` into a plain JavaScript object that matches the OpenAPI 3.1 JSON schema. It does not run a server or write files; you decide how to store or serve the generated document.

The public API uses short names (`spec`, `path`, `uri`) to match the project convention of single-word exports where possible.

## Installation

```sh
pnpm add @mcp-layer/openapi
# or
npm install @mcp-layer/openapi
# or
yarn add @mcp-layer/openapi
```

## Usage

Use this package when you need a stable OpenAPI document that mirrors your MCP-exposed REST surface. The output is designed to be consumed by API documentation tooling (Swagger UI, Redoc), client generators, and API gateways that want an OpenAPI 3.1 document as input. Because the generator returns a plain object, you can serve it directly, serialize it to JSON, or post-process it before publishing.

### Generate a spec from a catalog

```js
import { spec } from '@mcp-layer/openapi';
import { extract } from '@mcp-layer/schema';

const catalog = await extract(session);
const doc = spec(catalog, {
  title: 'My MCP API',
  version: '1.0.0',
  prefix: '/mcp/v1'
});

const json = JSON.stringify(doc, null, 2);
```

`doc` is a plain object, not a string. That makes it easy to pass directly to a Fastify route, serialize to JSON, or merge additional metadata before publishing.

### Resource URI mapping

Use the mapping helpers when you need deterministic, reversible routes for MCP resource URIs. They are especially useful if you want to precompute route tables, generate docs, or build your own router outside of the provided REST plugin.

```js
import { path, tpath, uri } from '@mcp-layer/openapi';

path('ui://dashboard/index.html');
// => '/ui/dashboard/index.html'

uri('/ui/dashboard/index.html');
// => 'ui://dashboard/index.html'

tpath('ui://dashboard/{name}');
// => '/ui/dashboard/{name}'
```

## API Reference

### `spec(catalog, options?)`

Generate an OpenAPI 3.1 specification from an MCP catalog.

`catalog` is the object returned by `@mcp-layer/schema` (`{ server, items }`).

Options:

| Option | Type | Default | Notes |
| --- | --- | --- | --- |
| `title` | `string` | server name or `REST API` | Human-friendly title for the API. |
| `version` | `string` | server version or `1.0.0` | Used in `info.version`. |
| `prefix` | `string` | `/v1` | Route prefix used when building paths. |
| `description` | `string` | server description or instructions | Long-form description. |
| `contact` | `object` | `undefined` | OpenAPI contact object. |
| `license` | `object` | `undefined` | OpenAPI license object. |
| `maxNameLength` | `number` | `undefined` | Optional max length for tool/prompt names. |

Returns a plain OpenAPI 3.1 JSON object.

### `path(uri, encode?)`

Map MCP resource URIs to HTTP route paths.

Rules:

- Absolute paths stay absolute (`/docs/readme.md`).
- Scheme URIs map to `/scheme/authority/path` with `_` when missing a path.
- Relative URIs are prefixed with `/`.

`encode` controls percent-encoding (default: `true`).

### `uri(path)`

Convert a mapped HTTP path back to its MCP URI.

### `tpath(template, encode?)`

Map MCP resource URI templates to HTTP route paths.

Rules:

- Template segments remain `{name}` placeholders.
- Scheme URIs map to `/scheme/authority/path`.
- Static-only templates use the same `_` sentinel as fixed resources.

### `schemas`

Shared JSON Schemas:

- `ProblemDetails` (RFC 9457)
- `ToolResponse`
- `PromptResponse`

<details>
<summary>Advanced: Mapping examples</summary>

| MCP Resource URI | HTTP Path |
| --- | --- |
| `/docs/readme.md` | `/docs/readme.md` |
| `ui://dashboard/index.html` | `/ui/dashboard/index.html` |
| `ui://` | `/ui/_` |
| `test://config` | `/test/config/_` |
| `notes/intro` | `/notes/intro` |
| `db://postgres/users/123` | `/db/postgres/users/123` |

</details>

## License

MIT

## Runtime Error Reference

This section is written for high-pressure debugging moments. Each entry maps to a specific URI/template normalization guard used during OpenAPI path generation.

<a id="error-432db9"></a>
### Item name "{name}" exceeds maximum length of {maxLength}.

Thrown from: `assertName`

This happens when an item name (tool/resource/prompt identifier) is longer than the configured limit used by OpenAPI route generation (`maxNameLength`/`maxToolNameLength` path constraints).

Step-by-step resolution:
1. Check the effective max length value passed into OpenAPI/REST config.
2. Inspect the offending item name from the schema/catalog source.
3. Shorten the identifier or increase the max length setting intentionally.
4. Add a preflight check in item registration so overlong names fail before spec generation.

<details>
<summary>Fix Example: enforce identifier length before building routes</summary>

```js
const max = 64;
if (name.length > max)
  throw new Error(`Tool name "${name}" exceeds ${max} characters.`);

register(name);
```

</details>

<a id="error-c551d0"></a>
### Item name "{name}" must be URL-safe (letters, digits, ".", "_", "-").

Thrown from: `assertName`

This happens when an item name contains characters that cannot safely map into URL path segments for generated routes.

Step-by-step resolution:
1. Compare the value against the allowed pattern: letters, digits, `.`, `_`, `-`.
2. Remove spaces, slashes, colons, and other punctuation from names.
3. Keep a stable slug distinct from display title/description text.
4. Add tests that reject invalid names and accept normalized slugs.

<details>
<summary>Fix Example: keep route slug separate from human title</summary>

```js
const slug = title.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9._-]/g, '');
if (!slug)
  throw new Error('Generated slug is empty after normalization.');

registerTool({ name: slug, title });
```

</details>

<a id="error-4b0f3e"></a>
### Template expression "{expression}" is not supported.

Thrown from: `assertSimpleTemplate`

This happens when a URI template expression uses unsupported RFC 6570 operators (for example `{+id}`, `{?q}`, `{/segments*}`) or composite forms. OpenAPI routing here supports simple `{name}` placeholders only.

Step-by-step resolution:
1. Inspect the failing `{expression}` from the URI template.
2. Replace operator-based expressions with plain placeholders.
3. Move query expansion logic out of template syntax and into handler/query processing.
4. Add template validation tests that reject operator expressions.

<details>
<summary>Fix Example: convert operator templates to simple placeholders</summary>

```js
// Unsupported: mcp://docs/{+slug}
const template = 'mcp://docs/{slug}';
registerTemplate(template);
```

</details>

<a id="error-dac92e"></a>
### Template parameter "{parameter}" must be URL-safe.

Thrown from: `assertSimpleTemplate`

This happens when a placeholder name inside a template contains invalid path characters (for example spaces, punctuation, or braces in the parameter identifier).

Step-by-step resolution:
1. Inspect placeholder names in the template (`{...}`).
2. Rename placeholders to route-safe tokens (`[A-Za-z0-9._-]+`).
3. Keep display labels outside placeholder names.
4. Add tests for invalid and valid template parameter names.

<details>
<summary>Fix Example: use URL-safe placeholder identifiers</summary>

```js
// Unsupported: mcp://docs/{team name}
const template = 'mcp://docs/{team_name}';
registerTemplate(template);
```

</details>

<a id="error-bfc7a5"></a>
### Expected resource URI to be a non-empty string.

Thrown from: `path`

This happens when `path(uri)` is called with an empty/non-string value. The mapper cannot translate undefined/null input into a deterministic HTTP route.

Step-by-step resolution:
1. Trace where resource URIs are sourced before passing into `path(...)`.
2. Reject empty values at the integration boundary.
3. Keep URI fields distinct from optional descriptions/labels.
4. Add tests for undefined/empty URI inputs.

<details>
<summary>Fix Example: guard URI inputs before mapping</summary>

```js
if (typeof uri !== 'string' || uri.length === 0)
  throw new Error('Resource URI is required.');

const route = path(uri);
console.log(route);
```

</details>

<a id="error-98bf47"></a>
### Expected resource URI template to be a non-empty string.

Thrown from: `tpath`

This happens when `tpath(template)` receives a missing/blank template string. Template routes require a valid URI template value.

Step-by-step resolution:
1. Verify the server/template catalog actually includes `uriTemplate`.
2. Reject empty template values before route registration.
3. Ensure template metadata serialization preserves `uriTemplate`.
4. Add tests that fail on empty templates and pass on valid ones.

<details>
<summary>Fix Example: require uriTemplate before tpath conversion</summary>

```js
if (typeof tmpl !== 'string' || tmpl.length === 0)
  throw new Error('uriTemplate is required.');

const route = tpath(tmpl);
console.log(route);
```

</details>

<a id="error-029cbf"></a>
### Expected path to be a non-empty string.

Thrown from: `uri`

This happens when `uri(path)` is called with a missing/blank HTTP path. Reverse mapping requires a concrete route string.

Step-by-step resolution:
1. Verify the incoming route/path value from Fastify params is present.
2. Normalize path values before conversion (string, non-empty).
3. Avoid calling `uri(...)` for routes that are not MCP resource paths.
4. Add tests for invalid path inputs and valid reverse-mapping cases.

<details>
<summary>Fix Example: validate path before reverse mapping</summary>

```js
if (typeof route !== 'string' || route.length === 0)
  throw new Error('Mapped HTTP path is required.');

const originalUri = uri(route);
console.log(originalUri);
```

</details>
