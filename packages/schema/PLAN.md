# @mcp-layer/schema - Schema Extraction Plan

## Purpose
Create a package that connects to an MCP server and extracts the exposed tool and resource schemas, normalizing them into a consistent Zod-based format that downstream generators (CLI, REST, other MCP layers) can rely on.

## Scope (Phase 1 - Now)
1) Review existing packages (`@mcp-layer/config`, `@mcp-layer/connect`) to align naming, I/O shapes, and transport expectations.
2) Define the public API and the normalized Zod schema targets for tools and resources, including explicit mapping rules from MCP protocol payloads to the standard output.

## Research Notes (Initial)
- `@mcp-layer/connect` already provides a stable `connect(source, name)` wrapper that returns a live MCP `Client` and transport details. This is the preferred integration point for live schema extraction.
- `@mcp-layer/config` already normalizes config lookup and server metadata; the new package should accept the same config sources to remain consistent.
- MCP servers expose tools and resources via protocol listing calls; this package will rely on those list endpoints to construct the standardized schema output.

## Proposed Package Shape
- Package name: `@mcp-layer/schema` (placeholder, can be renamed if needed).
- Source layout mirrors other packages: `packages/schema/src`, tests under `packages/schema/test`.
- Primary exports:
  - `extract(link)` -> returns normalized schema object for tools/resources/prompts/templates from a `@mcp-layer/connect` Link.
  - `normalizeTools(list)` -> Zod schema set for tools.
  - `normalizeResources(list)` -> Zod schema set for resources.

## Normalization Targets (Zod)
The output should be a small, stable contract that downstream generators can use without custom MCP parsing.

### Unified schema (normalized)
To avoid separate consumers for tools/resources/prompts/templates, normalize everything into a single schema with a `type` discriminator and a shared base shape. Type-specific data is nested under `detail`.

Base shape (shared):
- `type` (string) one of `tool`, `resource`, `prompt`, `resource-template`
- `name` (string)
- `title` (string | undefined)
- `description` (string | undefined)
- `meta` (object) for icons/annotations/vendor extensions
- `detail` (object) for type-specific fields

Type-specific `detail` examples:
- `tool`: `{ input, output, ui }` where `input`/`output` are Zod schemas derived from MCP JSON Schema and `ui` exposes MCP Apps metadata
- `resource`: `{ uri, mimeType, size, ui }`
- `resource-template`: `{ uriTemplate, mimeType }`
- `prompt`: `{ arguments }` (prompt argument definitions)

### Tool schema (normalized)
- `name` (string)
- `description` (string | undefined)
- `input` (Zod schema) derived from MCP tool input schema
- `output` (Zod schema | undefined) if the server exposes output schema
- `meta` (object) for MCP-specific fields (vendor extensions, annotations)

### Resource schema (normalized)
- `uri` (string)
- `name` (string | undefined)
- `description` (string | undefined)
- `mimeType` (string | undefined)
- `meta` (object) for MCP-specific fields (vendor extensions, annotations)

### Prompt schema (normalized)
- `name` (string)
- `title` (string | undefined)
- `description` (string | undefined)
- `arguments` (array) derived from MCP prompt arguments (name/type/description/required)
- `meta` (object) for MCP-specific fields (icons, annotations)

### Resource template schema (normalized)
- `uriTemplate` (string)
- `name` (string | undefined)
- `title` (string | undefined)
- `description` (string | undefined)
- `mimeType` (string | undefined)
- `meta` (object) for MCP-specific fields (icons, annotations)

### Server metadata (normalized)
- `serverInfo` (object) from initialize (name/title/version/description/icons/websiteUrl)
- `capabilities` (object) from initialize (feature gating for tools/resources/prompts/completions)
- `instructions` (string | undefined)

## Open Questions
- Do we need to surface tool output schemas when they are present, or keep output optional?
- Should resource schemas include template variables (if exposed) or keep a minimal URI-only view?
- Should we enforce a version field on the normalized output for future schema evolution?
- Do we want to normalize prompt templates as first-class schema targets in v1, or keep them optional?
- Should we include completion endpoints as optional metadata for generators (e.g., CLI autocompletion)?
- Should the unified schema be the only export, or should we also export typed helpers per MCP surface?

## Decision (Current)
Use the unified schema as the primary export. Keep type-specific normalizers as internal helpers (or secondary exports if needed later) so consumers only need to handle one shape unless they explicitly opt in to per-type utilities.

## Phase 2+ (Planned, not executed yet)
3) Write tests first using `node:test` with real protocol payload fixtures (no mocks) for tools/resources and edge cases.
4) Implement extraction logic and Zod schema generation with named functions, full JSDoc, and minimal exports.
5) Wire the package into the workspace (package.json, exports, README updates) to match existing packages.

## Success Criteria
- A single normalized output object that includes tools and resources with Zod schemas.
- Fixtures covering tool/resource listing shapes and configuration fallbacks.
- API and package wiring consistent with `@mcp-layer/config` and `@mcp-layer/connect`.
