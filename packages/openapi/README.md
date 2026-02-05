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
