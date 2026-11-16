# @mcp-layer/profiles

Capture the public identity an MCP client actually sends, derive a reproducible profile, and apply that identity to an application using the official MCP SDK or native `fetch`.

Profiles describe software. They never establish who a user is or what a request may access. HTTP identity headers and MCP `clientInfo` are caller-controlled; matching is advisory. Keep authentication and authorization in the SDK and your application.

The bundled catalog contains one independently reproduced native capture of Claude Code 2.1.325 on `darwin-arm64`. Its 24 sanitized observations cover discovery, dynamic registration, browser consent, authorization-code exchange, automatic token refresh, token revocation, and MCP requests. The issuer was a temporary local server configured with a one-second access-token lifetime; Claude Code completed login through its native headless consent flow, then refreshed and used the authenticated MCP connection. No Anthropic account login or model request was performed. The captured `server/discover` request reports protocol revision `2026-07-28`; the connection then falls back to the supported `2025-11-25` initialize handshake. These are evidence only: `apply()` never forces protocol negotiation. The capture shows `claude-code/2.1.325 (sdk-cli)` on MCP requests, Bun's user agent for SDK OAuth requests, and Axios for revocation; `apply()` selects those phase-specific values only for requests passing through its owned fetch wrapper.

The issuer-bound client ID, redirect URI, token endpoint authentication method, and `client_name` (`Claude Code (mcp-layer-capture)`) come from that temporary test issuer. The ID is usable only with the exact captured loopback issuer; it is not a Claude Code registration for another server. The name is the local issuer's configured registration label and serves only as a fallback when the runtime provider omits that field. Runtime provider metadata and credentials retain precedence. Test fixtures describe synthetic software and are not catalog entries. You can use your own captures immediately with `derive()` and `apply(profile)`.

## Scope and reuse

The package owns sanitization, evidence selection, profile validation, identity composition, and advisory matching. It uses native `Headers`, `URL`, `URLSearchParams`, and `fetch`, and validates public client fields with the [official SDK schemas](https://github.com/modelcontextprotocol/typescript-sdk/tree/v1.x/src). Existing analytics and authentication-profile libraries serve different purposes: collecting usage or storing credentials. Neither provides this evidence-backed public identity contract.

Transport framing, protocol negotiation, session handling, OAuth discovery, PKCE, token exchange, refresh, and credential storage remain with the [official TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk/tree/v1.x) and `@mcp-layer/forward`. This package also provides a standalone capture utility that composes those official SDK transports and forwarding APIs; it writes portable sanitized capture/profile JSON and never writes MCP configuration files or OAuth credentials into those artifacts.

The integration suite exercises SDK 1.32.2 and its [2025-11-25 lifecycle](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle), [Streamable HTTP transport](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports), and [authorization contract](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization). Captures also recognize request metadata under `io.modelcontextprotocol/clientInfo`; observing a field does not add transport support for a newer protocol revision. Your SDK chooses its supported protocol version and capabilities.

## Installation

Use Node.js 22 or newer with native Fetch APIs. Install the package and, when creating MCP clients or servers yourself, the SDK. The expected result is two ESM packages available to your application.

```sh
pnpm add @mcp-layer/profiles @modelcontextprotocol/sdk
```

## Capture utility and artifacts

The standalone `mcp-layer-profiles` command captures a real SDK client, builds deterministic profiles from sanitized capture JSON, and inspects bundled or local profiles. This is useful when you need a reproducible local endpoint for collecting the identity a client actually sends; the command prints its endpoint to stderr, serves the harmless `probe` tool, and writes the capture only after shutdown.

Install the package with its SDK and run `mcp-layer-profiles --help` to see all commands. The examples below expect `capture.json` to contain only the recorder's sanitized output and `profile.json` to contain a validated profile.

```sh
mcp-layer-profiles capture --output ./capture.json --transport http
mcp-layer-profiles build ./capture.json --output ./profile.json
mcp-layer-profiles show ./profile.json --format json
mcp-layer-profiles list --format json
```

`list` and `show` print compact tables by default and emit JSON with `--format json`; `build` writes the derived profile file and `capture` prints its URL to stderr until shutdown. `capture` supports `--transport http|sse|stdio`, `--host`, `--port`, `--base-url`, paired `--client-name` and `--client-version`, `--allow-headers`, and `--upstream`. A controlled server supports HTTP, SSE, and stdio; forwarding supports HTTP and stdio, while controlled OAuth requires HTTP. With `--oauth`, the local issuer is backed by `cli-storage`; use `--storage-dir` and `--storage-backend auto|native|file` to select its persistence behavior. For upstream capture, `--profile` and `--profile-parts http,mcp,oauth` apply selected identity parts to upstream SDK traffic. OAuth runtime options include `--client-id`, `--issuer`, `--scope`, `--resource`, `--callback-url`, `--callback-port`, and `--auth-timeout`.

Transport combinations follow the [official MCP transport specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports); OAuth discovery and authorization follow the [official MCP authorization specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization).

`--client-name` and `--client-version` declare the local capture client identity; they do not set OAuth registration metadata. `--client-id` selects a caller-supplied OAuth registration and is never treated as `software_id`. Captured OAuth metadata is applied only when the `oauth` profile part is selected; issuer-bound registration constraints additionally require the matching registration and a `--issuer` URL whose normalized full `href` matches the captured issuer. This accepts root trailing-slash equivalents while preserving issuer paths. The programmatic `apply()` issuer fallback continues to compare exact strings, including trailing slashes. Explicit runtime OAuth options take precedence. Captured redirect URIs are passed only as SDK validation constraints for that matching registration; they do not replace or initiate the runtime callback.

OAuth records belong to `cli-storage` through the official `@mcp-layer/forward` provider. `--output` stores only sanitized capture JSON; `build` writes a public profile JSON artifact. Those files are portable evidence artifacts, not credential storage. HTTP capture defaults to an unauthenticated probe. Forwarded SSE is unsupported; use HTTP or stdio forwarding.

`listen(options)` is the library lifecycle for this capture server/gateway. It uses the official SDK server transports, preserves separate downstream/upstream observations when forwarding, and returns `{url, close, closed, finish}`. Controlled captures support HTTP, SSE, and stdio; forwarded captures support HTTP and stdio, and controlled OAuth requires HTTP. Call `close()` during teardown and await `closed`; `finish()` returns an independent sanitized snapshot. The command runner is also embeddable:

```js
import { run } from '@mcp-layer/profiles/cli';

await run(['build', './capture.json', '--output', './profile.json']);
```

This example runs the same offline build command inside a test harness or another application. `run(argv, {open})` accepts arguments without the Node/script prefix and an optional async browser opener used for OAuth; it resolves only after the command completes or a hosted listener closes. The public `load(selector?)` function accepts a bundled profile ID/family, an explicit JSON path, or a `Profile` value and returns a sanitized, revalidated profile.

## Record and derive

This example records identity for an application you own. Recording at your existing HTTP and RPC boundaries lets the SDK continue to handle the protocol. `observe()` returns sanitized evidence immediately; `finish()` returns an independent capture; `derive()` returns a validated reusable profile. The saved JSON contains public identity and redaction markers, with no bearer token or OAuth session state.

```js
import { writeFile } from 'node:fs/promises';
import { capture, derive } from '@mcp-layer/profiles';

const recorder = capture({
  id: 'my-client-1.0.0',
  client: { name: 'my-client', version: '1.0.0', platform: 'darwin' },
});

recorder.observe({
  phase: 'mcp',
  perspective: 'downstream',
  method: 'POST',
  url: 'https://mcp.example/mcp',
  headers: {
    'user-agent': 'my-client/1.0.0',
    authorization: 'Bearer example-session-token',
  },
  message: {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-11-25',
      clientInfo: { name: 'my-client', version: '1.0.0' },
      capabilities: {},
    },
  },
  provenance: { source: 'application', role: 'client' },
});

const recorded = recorder.finish();
const profile = derive(recorded);
await writeFile('my-client.capture.json', JSON.stringify(recorded, null, 2));
await writeFile('my-client.profile.json', JSON.stringify(profile, null, 2));
```

Treat `client`, `id`, `provenance.source`, public identity headers, and explicit allowlist values as public labels. Supply software metadata there, never credentials or private user data. Raw observations should be passed directly to `observe()` before logging or persisting anything. The recorder API does not read request streams, launch clients, or log raw data. The optional `listen()` API owns a local SDK server or forwarding gateway, observes protocol boundaries, and can open the browser through the official forwarding provider when OAuth is enabled.

## Use native fetch

This example reads the saved profile and applies its HTTP identity to a normal request. Runtime headers take precedence over captured defaults; the returned response remains a native streaming `Response`. A typical JSON endpoint returns the same body as an unwrapped fetch call.

```js
import { readFile } from 'node:fs/promises';
import { apply } from '@mcp-layer/profiles';

const profile = JSON.parse(await readFile('my-client.profile.json', 'utf8'));
const runtime = apply(profile, {
  parts: ['http'],
  headers: { 'x-request-purpose': 'integration-check' },
});
const response = await runtime.fetch('https://mcp.example/health', {
  signal: AbortSignal.timeout(5000),
});
console.log(response.status);
```

Header precedence, from lowest to highest, is profile identity, `apply(..., {headers})`, a native input `Request`'s headers, and per-call `init.headers`. Header names are case-insensitive. `Request` headers are retained when `init.headers` supplies only an override subset. This is the wrapper's merge policy; native Fetch normally replaces the `Request` header collection when `init.headers` is provided.

Only profile identity headers are injected. Captured `Authorization`, cookies, sessions, `Accept`, `Content-Type`, and `MCP-Protocol-Version` are never reusable defaults. Live credentials and SDK-generated headers passed with a request survive unchanged. The wrapper forwards the original input, body, abort signal, duplex option, and other request options and never reads, clones, buffers, or parses response bodies. The SDK remains responsible for the [HTTP transport contract](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports).

## Use an SDK client

The following client uses all profile parts by default. `runtime.info` supplies the client implementation identity, while `runtime.fetch` applies HTTP defaults to the SDK's own requests. The SDK negotiates capabilities and the protocol and returns the server's tools. Close the client when finished to release the connection. These fields follow the [MCP lifecycle](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle) and [Streamable HTTP specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports).

```js
import { readFile } from 'node:fs/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { apply } from '@mcp-layer/profiles';

const profile = JSON.parse(await readFile('my-client.profile.json', 'utf8'));
const runtime = apply(profile);
const client = new Client(runtime.info, { capabilities: {} });
const transport = new StreamableHTTPClientTransport(
  new URL('https://mcp.example/mcp'),
  { fetch: runtime.fetch, authProvider: runtime.authProvider },
);

try {
  await client.connect(transport);
  const result = await client.listTools();
  console.log(result.tools);
} finally {
  await client.close();
}
```

`mcp.observed.protocolVersions` and `mcp.observed.capabilities` document the original capture only. `apply()` never advertises those capabilities or forces a protocol version: your application must implement every capability it advertises. An SDK stdio client can use the same `runtime.info`; the HTTP and OAuth fields have no effect on stdio.

## OAuth identity and runtime providers

Pass your existing SDK `OAuthClientProvider` as `authProvider`. The returned decorator fills missing public metadata from the profile and binds every delegated method to the original provider, including implementations with private class fields. Runtime metadata wins on every field, including `client_name`, redirect URIs, authentication method, scopes, and resources. Tokens, secrets, verifiers, state, discovery caches, refresh behavior, and custom authentication methods stay in that provider. No credential store is created. See the [SDK provider interface](https://github.com/modelcontextprotocol/typescript-sdk/blob/v1.x/src/client/auth.ts) and [MCP authorization specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization).

An observed public `client_id` is stored only with `provenance.issuer`. Issuers compare as exact strings, including trailing slashes and issuer paths. It is never inferred from the origin of a registration or token URL. To use such a public registration fallback, pass `issuer` explicitly. `clientInformation()` first returns the runtime provider's registration; only when that is `undefined` may the selected issuer's captured public ID be returned. The fallback contains `{client_id, issuer}` and no secret. Without an issuer, or with a different issuer, no captured ID is returned. A secret-bearing registration must come from the runtime provider.

Captured redirect URIs stay only in issuer-bound public registration constraints used by SDK validation; they are never replayed as runtime callbacks. Captured resources remain evidence and are not substituted for the current MCP server. Browser authorization requests keep their own provenance and cannot supply reusable HTTP identity. The SDK handles authorization redirects, resource validation, PKCE generation, token exchange, and refresh under the [authorization specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization).

<details>
<summary>Compose profile identity with the forwarding OAuth provider</summary>

This example applies the bundled profile's public defaults while keeping registration, tokens, refresh and callback state in `cli-storage` through `@mcp-layer/forward`. Replace the target placeholder with an OAuth-protected MCP server you are authorized to access. The provider discovers that server's issuer and creates or reuses a registration for that runtime; the example does not reuse the bundled capture's issuer-bound client ID. On first access, expect browser consent and a returned list of the server's tools.

```js
import open from 'open';
import { Storage } from 'cli-storage';
import { authorize } from '@mcp-layer/forward';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { apply, get } from '@mcp-layer/profiles';

/** @param {URL} url SDK authorization destination. @returns {Promise<void>} Open the authorization page. */
async function launch(url) { await open(url.href); }

const profile = get('claude-code');
const target = 'https://mcp.example.com/mcp';
const defaults = apply(profile);
const provider = authorize({
  target,
  storage: new Storage({ namespace: 'my-client.oauth' }),
  clientMetadata: profile.oauth.metadata,
  fetch: defaults.fetch,
  open: launch,
});
const runtime = apply(profile, { authProvider: provider, fetch: provider.fetch });
const client = new Client(runtime.info);
try {
  await client.connect(new StreamableHTTPClientTransport(new URL(target), {
    authProvider: runtime.authProvider,
    fetch: runtime.fetch,
  }));
  console.log(await client.listTools());
} finally {
  await client.close();
  await provider.close();
}
```

</details>

## Observe clients at an SDK server boundary

Servers can use sanitized inbound evidence to select diagnostics or compatibility messaging. The following complete loopback server passes requests to the official SDK transport after recording them. It reports only the advisory status, without logging raw requests or tokens. The bundled catalog includes only independently verified captures; load additional profiles and pass `{profiles}` to match against your own catalog. Authentication middleware must validate access independently before the transport receives a request. The SDK owns [transport/session handling](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports) and [authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization).

```js
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { capture, match } from '@mcp-layer/profiles';

const recorder = capture();
const server = new Server({ name: 'local-observer', version: '1.0.0' });
const transport = new StreamableHTTPServerTransport({
  sessionIdGenerator: randomUUID,
  enableJsonResponse: true,
});
await server.connect(transport);

/**
 * Record original inbound evidence and let the SDK handle the actual request.
 * @param {import('node:http').IncomingMessage} request - Local HTTP request.
 * @param {import('node:http').ServerResponse} response - Local HTTP response.
 * @returns {Promise<void>} SDK request handling completion.
 */
async function handle(request, response) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString('utf8');
  const message = text ? JSON.parse(text) : undefined;
  const observation = {
    phase: 'mcp', perspective: 'downstream',
    method: request.method, headers: request.headers, message,
    provenance: { source: 'local-http', role: 'client' },
  };
  recorder.observe(observation);
  console.log(match(observation).status);
  await transport.handleRequest(request, response, message);
}

const listener = createServer(handle);
listener.listen(3000, '127.0.0.1');

/** @returns {Promise<void>} Closes the SDK and listening socket on shutdown. */
async function close() {
  await server.close();
  listener.closeAllConnections();
  listener.close();
}
process.once('SIGINT', close);
```

This example creates one SDK session for a local experiment. A service handling multiple clients should allocate transports per session using the [SDK server examples](https://github.com/modelcontextprotocol/typescript-sdk/tree/v1.x/src/examples/server), enforce request-body limits, and handle HTTP errors in its normal middleware. Parsing a body for observation does not replace the SDK's protocol validation.

<details>
<summary>An MCP server making outbound MCP calls</summary>

An MCP server can also be a client of another server. Apply the selected profile when creating that outbound SDK client, then register a normal server handler that calls it. This example exposes a tool returning the upstream tool list; the outbound connection uses profile identity and the SDK still performs its own negotiation and authorization. The inbound server's advertised identity remains its own. See the [lifecycle](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle) and [transport](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports) contracts.

```js
import { readFile } from 'node:fs/promises';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { apply } from '@mcp-layer/profiles';

const profile = JSON.parse(await readFile('my-client.profile.json', 'utf8'));
const runtime = apply(profile);
const upstream = new Client(runtime.info, { capabilities: {} });
await upstream.connect(new StreamableHTTPClientTransport(
  new URL('https://mcp.example/mcp'), { fetch: runtime.fetch },
));
const server = new McpServer({ name: 'tool-directory', version: '1.0.0' });

/** @returns {Promise<{content: {type: 'text', text: string}[]}>} Upstream tool descriptions as text. */
async function tools() {
  const result = await upstream.listTools();
  return { content: [{ type: 'text', text: JSON.stringify(result.tools) }] };
}
server.registerTool('upstream-tools', { description: 'List upstream tools' }, tools);
await server.connect(new StdioServerTransport());

/** @returns {Promise<void>} Closes both sides when the host terminates this server. */
async function close() {
  await server.close();
  await upstream.close();
}
process.once('SIGINT', close);
```

When collecting a capture of the original host, record its inbound observations as `downstream` with role `client`, and record this server's outbound requests as `upstream` with role `bridge`. `derive()` retains both as evidence and uses only actual downstream client identity for reusable fields.

</details>

## Sanitization and derivation rules

Sanitization happens inside `observe()`, before it returns or stores an observation. The recorder holds sanitized data only. Imported captures are sanitized again by `derive()`. `apply()` and custom-catalog matching reconstruct and validate reusable fields against the sanitized evidence rather than accepting arbitrary replay fields.

| Input | Exported evidence | Reusable behavior |
| --- | --- | --- |
| `Authorization`, cookies, API-key and secret headers | `[redacted]` plus classification; recognized Basic/Bearer scheme | Never replayed |
| HTTP Basic OAuth client credentials | Scheme and decoded public username as `clientId`; no password or encoded header | Public ID only with explicit issuer |
| MCP/session headers, session IDs, RPC request IDs | `[redacted]` with session/identifier classification | Never replayed |
| Access, refresh and ID tokens; client secrets; code; state; PKCE verifier and challenge | `[redacted]` recursively in query, form, and JSON | Never replayed |
| Public OAuth client metadata | Documented safe fields; URLs sanitized | Metadata fills runtime-provider gaps |
| Redirects and resources | Sanitized public evidence | Current runtime values always govern |
| Unknown headers and arbitrary RPC/tool/result values | Presence/structure and redaction markers | Never copied as identity |
| MCP protocol version and capabilities | Observed values with sanitized capability structure | Evidence only; SDK/application chooses |
| Original client identity headers | Public values | Reused only from eligible downstream evidence |
| Browser or bridge wire identity | Sanitized evidence with perspective/role | Never reused as original client identity |

Structured OAuth bodies may be objects, `URLSearchParams`, JSON text, or URL-encoded form text. Streams and multipart bodies are outside the observation API; parse them at an existing application boundary if that boundary already has access. URL userinfo and fragments are removed, private query values are redacted, and path IDs following `session(s)` or `token(s)` are redacted. Only known public query fields (`client_id`, `response_type`, `grant_type`, `scope`, `redirect_uri`, `resource`, `code_challenge_method`) retain values. Unclassified values are redacted conservatively.

URL-form client IDs, including IDs decoded from HTTP Basic usernames, are checked for embedded credentials and private query values. An ID requiring URL redaction is removed in full so a modified identifier cannot be reused as if it were the original public ID.

The default reusable HTTP allowlist is `user-agent`, `x-client-name`, `x-client-version`, `x-client-platform`, `x-mcp-client-name`, `x-mcp-client-version`, `x-mcp-client-platform`, `x-stainless-lang`, `x-stainless-package-version`, `x-stainless-os`, `x-stainless-arch`, `x-stainless-runtime`, and `x-stainless-runtime-version`. `allowHeaders` explicitly adds public identity headers for another client; it cannot enable credential, session, or protocol headers. Unknown headers otherwise retain presence only. Review the values before declaring a custom header public.

Reusable fields come from `downstream` observations whose role is absent or `client`. Browser, bridge, server, and upstream observations remain evidence. Authorization-phase HTTP headers are also excluded because they commonly describe the browser. MCP identity is inferred from `initialize.params.clientInfo` or request metadata; a declared `client` can cover captures lacking an initialize exchange. Conflicting downstream identities, reusable headers, or public OAuth metadata fail derivation rather than selecting a last value. Protocol-version and capability differences are retained as observations.

## API Reference

The package exports named functions and the types below, plus `run()` from `@mcp-layer/profiles/cli`. There are no default exports. JavaScript is the source; declarations are generated with `pnpm --filter @mcp-layer/profiles build:types`.

### `capture(options?: CaptureOptions): Recorder`

| Option | Type / default | Meaning |
| --- | --- | --- |
| `id` | Optional string | Explicit profile ID matching `[a-z0-9][a-z0-9._-]*`, case-insensitive |
| `client` | Optional `Identity` | Public SDK implementation metadata and optional platform; name/version must agree with observed MCP identity |
| `capturedAt` | Optional date string / current time | Normalized ISO timestamp; imported captures must already contain a valid timestamp |
| `allowHeaders` | `string[]` / `[]` | Additional explicitly public identity headers; normalized and sorted |

`Identity` is the official SDK `Implementation` shape (`name`, `version`, and optional `title`, `description`, `websiteUrl`, and `icons`) with an additional optional `platform` string. Name and version must be non-empty. Optional metadata is accepted only when it passes the SDK's `ImplementationSchema`; URLs are sanitized and any URL changed by secret removal is omitted from reusable identity. Unknown extension fields are dropped. `Recorder.observe(observation: Observation): Evidence` sanitizes and appends one observation and returns an independent copy. `Recorder.finish(): Capture` closes the recorder and returns an independent copy; repeated `finish()` calls are allowed. Subsequent `observe()` calls fail with `ERR_PROFILES_FINISHED`. Invalid options or observations throw documented `LayerError` instances.

### `Observation`, `Evidence`, `Provenance`, and `Redaction`

| Observation field | Type | Meaning |
| --- | --- | --- |
| `phase` | Required `Phase` | `discovery`, `registration`, `authorization`, `token`, `refresh`, `revocation`, or `mcp` |
| `perspective` | Required `Perspective` | `downstream` for original-client traffic; `upstream` for relay-origin traffic |
| `headers` | Optional `HeadersInit` | Native `Headers`, record, or header tuples |
| `url` | Optional `string \| URL` | HTTP(S) request URL |
| `method` | Optional string | HTTP method, stored uppercase |
| `message` | Optional structured value or JSON text | Observed JSON-RPC message; IDs and non-identity payloads are redacted |
| `body` | Optional structured value, JSON/form text, or `URLSearchParams` | Observed OAuth/discovery body |
| `status` | Optional integer 100–599 | HTTP response status |
| `provenance` | Optional `Provenance` | `{source?: string, role?: 'client' \| 'browser' \| 'bridge' \| 'server', issuer?: string}` |

`Evidence` has the same phase and perspective, always contains `headers: Record<string,string>` and `redactions: Redaction[]`, and retains supplied optional fields in sanitized form. `message` and `body` are JSON-compatible sanitized values. A `Redaction` is `{path, kind, scheme?, clientId?}`; `kind` is `credential`, `session`, `oauth`, `identifier`, or `unclassified`. Optional `scheme` is `Basic` or `Bearer`; optional `clientId` is a Basic username. Redaction markers never contain the removed value.

### `Capture`

The complete persisted capture shape is `{schema: 1, id?: string, client?: Identity, capturedAt: string, allowHeaders: string[], observations: Evidence[]}`. It contains sanitized evidence and public provenance only. The timestamp belongs to the capture, allowing deterministic derivation after importing JSON. It is a package artifact, not an MCP client configuration schema.

### `listen(options?: ListenOptions): Promise<{url: string | undefined, close(): Promise<void>, closed: Promise<void>, finish(): Capture}>`

Hosts an SDK controlled probe or observes a forwarding gateway. It returns `url` (undefined for stdio), idempotent asynchronous `close()`, a `closed` promise that settles after transport shutdown and optional artifact write, and `finish()` for the sanitized snapshot. Options include `client`, `capturedAt`, `allowHeaders`, `transport`, `host`, `port`, `baseUrl`, `oauth`, `storage`, `upstream`, `authorization`, `authProvider`, `headers`, `info`, `fetch`, `output`, and `signal`. Controlled OAuth requires caller-supplied `cli-storage`; the package creates no private store inside the listen API. Forwarded OAuth stays inside `@mcp-layer/forward`, which receives the recorder observation callback. Invalid transports or missing controlled OAuth storage throw a `LayerError` from `@mcp-layer/profiles`; SDK and forwarding errors retain their owning package errors.

The controlled and forwarded transports use the [official MCP transport specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports); controlled OAuth uses the [official MCP authorization specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization) and SDK provider interfaces.

| Option | Type / default | Meaning |
| --- | --- | --- |
| `client`, `capturedAt`, `allowHeaders` | `Identity`, date string, `string[]` | Recorder declaration, timestamp, and public header additions. |
| `transport`, `host`, `port`, `baseUrl` | `http|sse|stdio`, `127.0.0.1`, `0`, optional origin | SDK probe transport and local/public listener addresses. |
| `oauth`, `storage` | `boolean | issuer options`, required for controlled OAuth | Configures the local official SDK issuer using caller storage. |
| `upstream`, `authorization`, `authProvider` | URL, forward OAuth options, SDK provider | Enables observation through the official forward gateway. |
| `headers`, `info`, `fetch` | Native header input, SDK Implementation, fetch | Identity overrides for forwarded upstream traffic. |
| `output`, `signal` | Optional path and `AbortSignal` | Write a sanitized artifact on close or close on abort. |

### `load(value?: string | Profile): Promise<Profile | undefined>`

Loads a bundled profile ID/family, an explicit JSON path, or an in-memory profile. Every supplied profile is reconstructed from its sanitized evidence before return, so untrusted top-level reusable fields are never accepted as-is. Unknown IDs, invalid evidence, and unreadable files throw documented `LayerError` instances.

### `run(argv: string[], options?: {open?: (url: URL) => Promise<void>}): Promise<void>` from `@mcp-layer/profiles/cli`

Runs `capture`, `build`, `list`, `show`, or help without loading MCP client configuration. `argv` excludes the executable and script path. `options` is `{open?: (url: URL) => Promise<void>}`; `open(url)` performs the application's OAuth browser handoff, while the existing `open` package launches the browser when omitted. The promise resolves when the command completes or after a hosted runtime closes. File read/write errors use `ERR_PROFILES_ARTIFACT`; missing command inputs use `ERR_PROFILES_INPUT`; unknown commands use `ERR_PROFILES_COMMAND`. The standalone runner rejects an upstream profile that requires confidential OAuth client authentication because it has no runtime secret input; use a runtime SDK provider with `listen()` for confidential authentication.

### `derive(capture: Capture): Profile`

Resanitizes the capture, selects downstream client evidence, validates public identity through the official SDK schemas, and returns the profile below. No network or filesystem access occurs. An explicit capture ID is retained as a caller-assigned label; otherwise the ID is a client/version slug plus 12 hexadecimal SHA-256 characters over the complete canonical sanitized capture, excluding its ID field. The fingerprint includes declared client metadata, capture time, allowlist, every sanitized observation, provenance, and coverage evidence such as protocol versions and capabilities. Object key order does not affect it; observation order and capture time are part of the identity.

| Profile field | Shape / behavior |
| --- | --- |
| `schema` | Exactly `1` |
| `id` | Non-empty deterministic or caller-supplied profile identifier |
| `client` | `Identity` |
| `capturedAt` | ISO capture timestamp |
| `evidence` | All sanitized `Evidence[]`, including excluded perspectives and roles |
| `coverage` | `{phases: Phase[], perspectives: Perspective[], identity: 'observed' \| 'declared', observations: number}` |
| `http` | `{headers: Record<string,string>, phases?: Partial<Record<Exclude<Phase,'mcp'>, Record<string,string>>>, allowHeaders: string[]}`; public reusable identity only. `headers` is the MCP/default identity. A phase entry is the complete reusable header set observed for that non-MCP phase and replaces the default set when selected. |
| `mcp` | `{clientInfo: Implementation, observed: {protocolVersions: string[], capabilities: object[]}}`; clientInfo retains safe standard optional metadata |
| `oauth` | `{metadata: Metadata, clients: Registration[]}` |

`Metadata` has optional string fields `client_name`, `software_id`, `software_version`, `client_uri`, `logo_uri`, `tos_uri`, `policy_uri`, and `token_endpoint_auth_method`, following [RFC 7591 client metadata](https://www.rfc-editor.org/rfc/rfc7591#section-2). `Registration` is `{issuer: string, clientId: string, redirectUris?: string[], authMethod?: string}`. Optional constraints are retained only from sanitized downstream registration evidence whose body contains the public `client_id` and the corresponding metadata. The client ID remains usable when constraints were not observed; URL values changed by redaction are omitted. Repeated evidence for an issuer and client ID merges newly observed constraints and fails with `ERR_PROFILES_REGISTRATION` if declarations conflict. Multiple public registrations may be observed for one issuer; applications should keep the desired current registration in their provider. The explicit issuer fallback is used only when exactly one public registration matches that issuer.

Missing identity throws `ERR_PROFILES_IDENTITY`; contradictory identity throws `ERR_PROFILES_CONFLICT`. Unsupported/incomplete capture schemas and invalid SDK identity fields throw `ERR_PROFILES_CAPTURE`. Invalid contained options and observations retain the capture API's error codes.

### `list(): Profile[]` and `get(id: string): Profile`

`list()` returns independent copies of bundled verified profiles. An exact ID passed to `get()` pins that capture. A client family name such as `get('claude-code')` resolves to its newest verified capture by `capturedAt`, with IDs breaking equal-timestamp ties. Unknown IDs or families throw `ERR_PROFILES_UNKNOWN`. The verified entry is `claude-code-2-1-325-49a14191cdf6`. Custom profile files use `derive(capture)` or `apply(profile)` and are never silently registered in the bundled catalog. See [CONTRIBUTING.md](./CONTRIBUTING.md) for the real-capture admission process.

### `match(observation: Observation, options?: MatchOptions): Match`

`MatchOptions` is `{profiles?: Profile[]}`, defaulting to the bundled verified catalog. Caller-owned profiles must validate against their own sanitized evidence. The result is `{status: 'matched' | 'ambiguous' | 'unknown', evidence: Evidence[], candidates: Candidate[]}`; each `Candidate` is `{id: string, signals: string[]}`. Signals name matched public fields such as `mcp.clientInfo` or `http.headers.user-agent`.

An observed MCP identity must exactly match name and version. Every supplied reusable header present in the profile's effective header set for the observation phase must agree; at least one public signal must match. Missing signals do not count as a match or contradiction. Multiple candidates produce `ambiguous`; zero produce `unknown`. Browser/bridge/upstream evidence and authorization-phase browser headers never match original-client identity. Candidates sort by ID. Evidence is sanitized even when no candidate matches. This result must never grant access or replace token validation.

### `apply(profileOrId: Profile | string, options?: ApplyOptions): Applied`

| Option | Type / default | Meaning |
| --- | --- | --- |
| `parts` | `Part[]` / `['http','mcp','oauth']` | Apply a subset; `[]` applies no profile defaults |
| `phase` | Optional `Phase` | Select a fixed HTTP phase for `Applied.headers` and as fallback for requests the fetch wrapper cannot classify |
| `headers` | Optional `HeadersInit` | Explicit runtime HTTP defaults overriding profile identity |
| `info` | Optional object with optional `name`, `version`, and SDK implementation fields | Runtime MCP identity fields overriding the profile |
| `fetch` | Native-compatible fetch function / `globalThis.fetch` | Real underlying HTTP implementation |
| `authProvider` | Optional SDK `OAuthClientProvider` | Current application/session provider to decorate |
| `issuer` | Optional exact issuer string | Opt into that issuer's captured public registration fallback |

`Part` is `http | mcp | oauth`. `Applied` is `{headers: Headers, info: Implementation | undefined, fetch: typeof fetch, authProvider: OAuthClientProvider | undefined}`. The `headers` object holds merged runtime defaults for the selected phase and is also used by the returned fetch function. The wrapper recognizes standard OAuth discovery paths, registration JSON containing a `redirect_uris` array, and a materialized `grant_type` form field (`refresh_token` selects `refresh`; other values select `token`). A URL-encoded form containing `token` without a grant is classified as `revocation`. Only `init.body` strings and `URLSearchParams` are inspected. The wrapper never reads or clones a `Request` body or consumes a stream; provide `phase` when an OAuth request uses a stream body. A recognized request phase selects that phase's complete header set; otherwise `options.phase` is used, then the MCP/default set. Profile phase defaults are selected before explicit runtime defaults and caller request headers. Caller `init.headers` take precedence over `Request.headers`, which take precedence over profile defaults. `info` is the merged SDK implementation identity, or explicit `options.info` when the MCP part is excluded, or `undefined` when neither applies. Supply a complete name/version if using explicit info without the MCP part. The provider is `undefined` when none is supplied, the original provider when OAuth is excluded, and a delegating decorator otherwise. For an exact issuer match, a captured public registration is used only when the provider has no runtime client information; the runtime provider's `redirectUrl` must match a known callback. Loopback port matching follows the official SDK's [`redirectUriMatches`](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/packages/server/src/auth/handlers/authorize.ts) implementation and [RFC 8252 §7.3](https://www.rfc-editor.org/rfc/rfc8252#section-7.3). The fallback returns observed `redirect_uris` and `token_endpoint_auth_method` as SDK client information for SDK validation. Client secret values are never captured; configure matching runtime authentication credentials or `addClientAuthentication` for secret-bearing methods. Explicit overrides still work when their corresponding profile part is excluded.

Phase-specific HTTP identity applies only to requests made through the application's owned fetch wrapper. Browser traffic and requests owned by other runtimes remain outside its control.

Profiles are reconstructed from sanitized evidence and checked against their stored HTTP, MCP, OAuth, and coverage fields before application. Edited or unsupported fields throw `ERR_PROFILES_PROFILE`; rederive a changed capture instead of editing reusable profile fields. Unknown IDs throw `ERR_PROFILES_UNKNOWN`. Invalid parts or runtime options throw `ERR_PROFILES_OPTIONS`. Network errors and delegated provider failures preserve the underlying implementation's error behavior. An incompatible issuer-bound callback or authentication method, or conflicting constraints declared for one issuer and client ID, throws `ERR_PROFILES_REGISTRATION`.

<a id="error-101e96"></a>
**`ERR_PROFILES_OAUTH_CREDENTIALS` — `run` (`#101E96`)**: the standalone runner cannot use a captured confidential OAuth client binding because it has no runtime secret input.

Step-by-step resolution: use a public client binding with token endpoint authentication method `none`, or call `listen()` with an SDK provider that owns the required runtime authentication credentials.

<a id="error-a4d796"></a>
**`ERR_PROFILES_LISTEN_TRANSPORT` — `listen` (`#A4D796`)**: controlled capture accepts `http`, `sse`, or `stdio`; forwarding accepts only `http` or `stdio`, and controlled OAuth requires HTTP.

Step-by-step resolution: set `transport` to a supported combination. To capture a forwarded SSE service, use its Streamable HTTP endpoint or configure a stdio bridge; this package does not translate forwarded SSE.

<a id="error-10d914"></a>
**`ERR_PROFILES_LISTEN_STORAGE` — `listen` (`#10D914`)**: supply an application-owned `cli-storage` instance when enabling controlled OAuth.

Step-by-step resolution: construct `Storage` with an isolated namespace and pass it as `storage`. The library does not create a credential store implicitly.

<a id="error-06897c"></a>
**`ERR_PROFILES_INPUT` — `run` (`#06897C`)**: provide a profile selector for `show`.

Step-by-step resolution: pass a bundled profile ID, family name, or JSON path to `show`.

<a id="error-3f2b94"></a>
**`ERR_PROFILES_INPUT` — `run` (`#3F2B94`)**: provide the required command input path and output path.

Step-by-step resolution: pass a capture JSON path to `build` and `--output <profile.json>`.

<a id="error-ffe78a"></a>
**`ERR_PROFILES_INPUT` — `run` (`#FFE78A`)**: provide `--output <capture.json>` for a capture command.

Step-by-step resolution: choose a writable output path and pass it with `--output`.

<a id="error-05ed32"></a>
**`ERR_PROFILES_COMMAND` — `run` (`#05ED32`)**: choose `capture`, `build`, `list`, or `show`.

Step-by-step resolution: run `mcp-layer-profiles --help` and use one of the documented commands.

<a id="error-6804e3"></a>
**`ERR_PROFILES_ARTIFACT` — `read` (`#6804E3`)**: provide readable, valid JSON artifact input.

Step-by-step resolution: check the path and JSON syntax, and use a sanitized capture for `build` or an evidence-backed profile for `show`.

<a id="error-20163d"></a>
**`ERR_PROFILES_ARTIFACT` — `write` (`#20163D`)**: provide a writable file path for the sanitized artifact.

Step-by-step resolution: choose a writable output file and ensure its parent directory exists.

## Errors

Package-generated errors are `LayerError` instances from `@mcp-layer/error`. They carry `package: '@mcp-layer/profiles'`, `method`, stable `reference`, generated `docs` URL, and machine-readable `code`. Messages never interpolate observed headers, bodies, or credential values. Branch on `code`; use `docs` for the specific remedy.

<a id="error-55d5e0"></a>
**`ERR_PROFILES_OPTIONS` — `capture` (`#55D5E0`)**: supply valid public name/version, timestamp, ID, and header allowlist. Credential, session, and protocol headers cannot be allowlisted.

Step-by-step resolution: check `name` and `version`, use an ISO date string for `capturedAt`, and remove credentials from identity labels or allowlists.

<details><summary>Valid recorder options</summary>

```js
const recorder = capture({ client: { name: 'my-client', version: '1.0.0' }, allowHeaders: ['x-client-flavor'] });
```
</details>

<a id="error-d6909c"></a>
**`ERR_PROFILES_OBSERVATION` — `capture.observe` (`#D6909C`)**: provide a supported phase/perspective, valid headers, method, response status, and provenance role.

Step-by-step resolution: select one documented phase and perspective, use valid HTTP metadata, and identify whether the sender is a client, browser, bridge, or server.

<details><summary>Valid observation</summary>

```js
recorder.observe({ phase: 'mcp', perspective: 'downstream', method: 'POST', provenance: { role: 'client' } });
```
</details>

<a id="error-fd5643"></a>
**`ERR_PROFILES_FINISHED` — `capture.observe` (`#FD5643`)**: a finished capture cannot be extended.

Step-by-step resolution: create a new recorder for additional observations, then call `finish()` after recording is complete.

<details><summary>Start a fresh capture</summary>

```js
const nextRecorder = capture();
```
</details>

<a id="error-c2d85b"></a>
**`ERR_PROFILES_CAPTURE` — `derive` (`#C2D85B`)**: provide schema `1`, a valid capture timestamp, and an observations array.

Step-by-step resolution: export a complete capture with `capture().finish()` or restore the required schema, timestamp, and observation fields before calling `derive()`.

<details><summary>Derive an exported capture</summary>

```js
const profile = derive(JSON.parse(await readFile('client.capture.json', 'utf8')));
```
</details>

<a id="error-c4ef60"></a>
**`ERR_PROFILES_CAPTURE` — `derive` (`#C4EF60`)**: public identity must satisfy official SDK implementation and OAuth metadata schemas.

Step-by-step resolution: retain only standard SDK implementation fields and valid OAuth metadata; remove malformed values and rederive from sanitized evidence.

<details><summary>Use standard identity fields</summary>

```js
const capture = recorder.finish();
const profile = derive(capture);
```
</details>

<a id="error-531138"></a>
**`ERR_PROFILES_IDENTITY` — `derive` (`#531138`)**: record actual downstream MCP client identity, or explicitly declare the public client name and version.

Step-by-step resolution: capture the `initialize` `clientInfo` or `io.modelcontextprotocol/clientInfo` request metadata from the downstream client, or provide an explicit public client declaration.

<details><summary>Declare a known client</summary>

```js
const recorder = capture({ client: { name: 'my-client', version: '1.0.0' } });
```
</details>

<a id="error-685650"></a>
**`ERR_PROFILES_CONFLICT` — `derive` (`#685650`)**: conflicting downstream client identities, reusable headers within one phase, and public OAuth metadata are never silently selected. Different phases may use different HTTP identities.

Step-by-step resolution: keep evidence from one client/version in each capture, then correct browser or bridge provenance so only actual downstream client identity is selected.

<a id="error-471c1b"></a>
**`ERR_PROFILES_REGISTRATION` — `derive` (`#471C1B`)**: one issuer and public client ID has incompatible declared registration constraints.

Step-by-step resolution: retain evidence from one registration, or recapture consistent callback URLs and token endpoint authentication metadata for that issuer and client ID.

<details><summary>Start a separate capture</summary>

```js
const recorder = capture({ client: { name: 'my-client', version: '1.0.0' } });
```
</details>

<a id="error-5a9349"></a>
**`ERR_PROFILES_PROFILE` — `apply` (`#5A9349`)**: use a complete supported profile derived from its own sanitized evidence.

Step-by-step resolution: do not edit replay fields directly; modify the source capture and call `derive()` again, or load the original profile artifact.

<details><summary>Rebuild from evidence</summary>

```js
const profile = derive(captureData);
const runtime = apply(profile);
```
</details>

<a id="error-4f6951"></a>
**`ERR_PROFILES_UNKNOWN` — `get` (`#4F6951`)**: use `list()` to find a verified bundled ID or supply your own derived profile object.

Step-by-step resolution: call `list()` and copy an exact ID, or pass your own profile to `apply()`; custom profiles are not added to the bundle.

<details><summary>Choose a bundled profile</summary>

```js
const profile = get(list()[0].id);
```
</details>

<a id="error-7aef84"></a>
**`ERR_PROFILES_OPTIONS` — `match` (`#7AEF84`)**: supply an array of complete evidence-backed profiles.

Step-by-step resolution: derive or load each candidate profile, then pass the array through `profiles`.

<details><summary>Match against owned profiles</summary>

```js
const result = match(observation, { profiles: [profile] });
```
</details>

<a id="error-cbb78e"></a>
**`ERR_PROFILES_OPTIONS` — `apply` (`#CBB78E`)**: use only `http`, `mcp`, and `oauth` parts, native-compatible runtime headers/fetch, valid info fields, and a real SDK OAuth provider.

Step-by-step resolution: check the selected parts, make runtime identity complete when supplying it, and use a standards-compatible fetch function and SDK provider.

<details><summary>Apply selected profile parts</summary>

```js
const runtime = apply(profile, { parts: ['http', 'mcp'] });
```
</details>

<a id="error-7c6233"></a>
**`ERR_PROFILES_REGISTRATION` — `apply` (`#7C6233`)**: the captured public registration does not satisfy the runtime provider's callback or token authentication method.

Step-by-step resolution: use a provider callback that matches a captured `redirectUris` entry, set a matching token endpoint authentication method and runtime credentials, provide `addClientAuthentication` for custom runtime authentication, or complete a new registration with the issuer.

<details><summary>Inspect the public registration requirements</summary>

This inspection prints the issuer, registered callbacks, and authentication method without credentials. Configure the runtime provider with a matching loopback host and path and a freshly selected port, then retry. A provider that performs a new SDK registration supplies its own client information and takes precedence over this fallback.

```js
const [registration] = profile.oauth.clients;
console.log(registration);
```

</details>

## Validation

Run the package's type generation and Node test suite from the workspace. Tests cover redaction before export, recursive OAuth/RPC bodies, imported-capture validation, deterministic identities, browser/bridge exclusion, ambiguity, overrides, private-field provider delegation, native request/response streaming, SDK client/server traffic, and real OAuth discovery, registration, PKCE, exchange, refresh, and revocation. All HTTP and provider tests use real implementations and close their resources.

```sh
pnpm --filter @mcp-layer/profiles build:types
pnpm --filter @mcp-layer/profiles test
```

## License

MIT
