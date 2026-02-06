# @mcp-layer/schema

`@mcp-layer/schema` extracts MCP server definitions (tools, resources, prompts, templates, and MCP Apps metadata) and normalizes them into a unified Zod-backed schema. The output is designed for downstream generators that need a single contract to build CLIs, REST endpoints, UI renderers, or additional MCP layers without re-parsing the MCP protocol surface.

## Installation

```sh
pnpm add @mcp-layer/schema
# or
npm install @mcp-layer/schema
# or
yarn add @mcp-layer/schema
```

## Usage

```js
import { load } from '@mcp-layer/config';
import { connect } from '@mcp-layer/connect';
import { extract } from '@mcp-layer/schema';

const config = await load(undefined, process.cwd());
const session = await connect(config, 'demo');
const output = await extract(session);

console.log(output.server.info);
console.log(output.items[0]);
await session.close();
```

## What this package does

1) Reads the MCP server capabilities and metadata from the live client connection.
2) Calls MCP list endpoints (`tools/list`, `resources/list`, `resources/templates/list`, `prompts/list`) using pagination.
3) Normalizes everything into a unified, type-discriminated schema so generators can consume a single list.
4) Wraps tool input/output JSON Schemas into Zod validators backed by Ajv, while preserving the original JSON Schema.
5) Converts prompt arguments into a lightweight JSON Schema so prompts and tools share the same `detail.input` shape.

## Output shape (authoritative)

The package returns:

```js
{
  server: {
    info,          // initialize.serverInfo
    capabilities,  // initialize.capabilities
    instructions   // initialize.instructions (optional)
  },
  items: [
    {
      type,         // "tool" | "resource" | "resource-template" | "prompt"
      name,
      title,
      description,
      meta,         // icons, annotations, _meta
      detail        // type-specific data
    }
  ]
}
```

Type discriminator:
- `tool`, `resource`, `resource-template`, `prompt`
- MCP Apps do not introduce a new `type`; tools remain `tool` and UI resources remain `resource`.

### detail: tools

```js
detail: {
  input: {
    schema, // Zod schema (Ajv-backed)
    json,   // original JSON Schema
    error   // optional Ajv compile error message
  },
  output: { schema, json, error }, // only when the tool advertises outputSchema
  ui: { resourceUri, csp, permissions } // when _meta.ui is present (MCP Apps)
}
```

### detail: resources

```js
detail: {
  uri,
  mimeType,
  size,
  ui: { resourceUri, csp, permissions } // when _meta.ui is present (MCP Apps)
}
```

### detail: resource templates

```js
detail: {
  uriTemplate,
  mimeType
}
```

### detail: prompts

```js
detail: {
  input: {
    schema, // Zod schema derived from prompt arguments
    json,   // JSON Schema derived from prompt arguments
    error   // optional Ajv compile error message
  }
}
```

## MCP Apps support

If a server exposes MCP Apps metadata:
- Tools may include `_meta.ui.resourceUri` pointing to a `ui://` resource.
- UI resources may include `_meta.ui` with CSP and permissions.

This package normalizes those fields into `detail.ui` so generators can:
- Detect which tools expect UI rendering.
- Resolve and render the `ui://` resource.
- Apply CSP and permissions when hosting the UI in a webview or browser sandbox.

## Generator guidance

Suggested uses for the unified schema:
- CLI: Use `name`, `description`, and `detail.input` to build flags and help text.
- REST: Use `name` for endpoints, `detail.input.json` for request validation, and `detail.output` for response schema.
- UI: Use `detail.ui.resourceUri` to locate the UI and read `detail.ui.csp` / `permissions`.

## Responsibilities and lifecycle

- This package does not open or close connections. It expects a live `Session` from `@mcp-layer/connect` or `@mcp-layer/attach`.
- You are responsible for calling `session.close()` after extraction.
- If the server doesn't advertise a capability (tools/resources/prompts), extraction skips that surface.

## Error handling

- Schema compilation uses Ajv under the hood. If a tool exposes an invalid JSON Schema, extraction still succeeds but `detail.input.error` or `detail.output.error` will be populated for that item.
- Servers that return empty lists produce an empty `items` array (not an error).
- Servers that support resources but not resource templates are treated as having zero templates.

## JSON Schema vs Zod

Zod validators are produced to allow direct runtime validation, but the original JSON Schema is preserved in `detail.input.json` and `detail.output.json` so generators can emit OpenAPI, JSON Schema, or other schema formats without losing fidelity.

## Runtime Error Reference

This section is written for high-pressure debugging moments. Each entry maps directly to schema extraction preconditions.

<a id="error-49ae61"></a>
### Expected a Session instance.

Thrown from: `extract`

This happens when `extract(link)` is called without a connected `Session` object (or with an object that does not expose `.client`). The extractor relies on MCP client capabilities and list calls.

Step-by-step resolution:
1. Verify you are passing the `Session` returned by `connect(...)` or `attach(...)`.
2. Confirm session setup completed and `session.client` is available.
3. Avoid passing raw MCP client objects directly; wrap flows around `Session`.
4. Add an integration test that extracts from a real connected session.

<details>
<summary>Fix Example: extract schemas from a connected Session</summary>

```js
const session = await connect(config, 'local-dev');
const catalog = await extract(session);
console.log(catalog.items.length);
await session.close();
```

</details>
