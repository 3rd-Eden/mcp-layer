# @mcp-layer/forward

`@mcp-layer/forward` relays MCP traffic and handles OAuth for one local developer. It exposes an HTTP gateway and a stdio-to-Streamable HTTP bridge, plus reusable official SDK OAuth client and authorization-server providers.

The package owns OAuth business decisions: record identities, registration, consent, token refresh, and invalidation. Every stored record and every process lock goes through an injected [`cli-storage`](https://github.com/3rd-Eden/cli-storage) instance. Serialization, files, encryption, native credentials, backend selection, atomic writes, and locking belong to that independent package. There is no built-in memory, filesystem, or keychain credential store here.

## Scope and standards

The HTTP gateway uses separate downstream grants and upstream credentials. A downstream access token is accepted only for the gateway's resource; it is never sent to the upstream server. Local consent is required before granting each downstream authorization. This is a single-developer gateway, not a hosted multi-user identity service.

The official SDK owns MCP transports, OAuth discovery, registration wire formats, PKCE, token requests, redirect validation, and bearer authentication. HTTP proxying uses `http-proxy-middleware` and keeps response streams unbuffered. The stdio bridge relays SDK messages without creating an additional `Client` initialization.

Relevant contracts are [MCP transports](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports), [MCP authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization), [token audience and passthrough requirements](https://modelcontextprotocol.io/specification/2025-11-25/basic/security_best_practices), and the [official TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk/tree/v1.x).

Upstream authorization supports the SDK's dynamic registration, preregistered clients, and client ID metadata documents. The downstream issuer advertises dynamic registration and supports configured clients. It does not advertise client ID metadata-document resolution. Legacy HTTP+SSE and other transport-bridge combinations are outside this package's first release.

## Installation

Install the forwarding package and the storage implementation together. This makes the same API usable from a CLI, a Node service, or an SDK MCP server that connects to another server.

```sh
pnpm add @mcp-layer/forward cli-storage @modelcontextprotocol/sdk
```

## An HTTP relay without OAuth

Use an explicitly unauthenticated relay when the upstream server handles its own credentials or a test endpoint requires none. The returned URL is the downstream `/mcp` endpoint; closing the handle releases proxy sockets and listeners.

```js
import { forward } from '@mcp-layer/forward';

const runtime = await forward({
  target: 'http://127.0.0.1:3000/mcp',
  auth: false,
  port: 0,
});
console.log(runtime.url);
// Connect a client to the printed URL, then release the runtime.
await runtime.close();
await runtime.closed;
```

In this explicit transparent mode, the relay does not act as an OAuth resource server or validate upstream bearer tokens. OAuth gateway mode is the default and requires storage.

## Authenticate an SDK client

This example uses SDK discovery, browser consent, and a loopback callback to obtain upstream credentials. Later runs reuse stored registrations and tokens. The provider's Fetch wrapper supplies fresh tokens and retries one rejected request; the SDK still performs the MCP handshake.

```js
import open from 'open';
import { Storage } from 'cli-storage';
import { authorize } from '@mcp-layer/forward';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const storage = new Storage({ namespace: 'my-tool.oauth' });
/** Open the SDK-generated login URL. @param {URL} url - Login URL. @returns {Promise<void>} */
async function browser(url) { await open(url.href); }
const provider = authorize({
  target: 'https://mcp.example.com/mcp',
  storage,
  open: browser,
});
const client = new Client({ name: 'my-tool', version: '1.0.0' });
try {
  await client.connect(new StreamableHTTPClientTransport(new URL('https://mcp.example.com/mcp'), {
    authProvider: provider,
    fetch: provider.fetch,
  }));
  console.log(await client.listTools());
} finally {
  await client.close();
  await provider.close();
}
```

Install `open` for that example, or supply your application's own `open(url)` callback. For headless execution, the callback can print the authorization URL and return immediately; the provider waits for the loopback callback. The callback host/path must be permitted by the upstream registration. Use `callbackPort` for registrations requiring a fixed port. A public captured `client_id` does not override an issuer's registration or redirect constraints.

## Local OAuth gateway

A gateway lets an HTTP client authorize against the local issuer while the broker performs a separate upstream login. Both grants require consent. The same storage instance can serve multiple gateways because record identities include the issuer and resource. Each downstream grant remains separate.

```js
import open from 'open';
import { Storage } from 'cli-storage';
import { forward } from '@mcp-layer/forward';

/** Open the upstream authorization URL. @param {URL} url - Login URL. @returns {Promise<void>} */
async function browser(url) { await open(url.href); }
const runtime = await forward({
  target: 'https://mcp.example.com/mcp',
  storage: new Storage({ namespace: 'my-gateway.oauth' }),
  oauth: { open: browser },
});
console.log(runtime.url);
await runtime.closed;
```

Call `runtime.close()` on application shutdown. With `transport: 'stdio'`, the runtime instead exposes an SDK stdio server backed by the upstream Streamable HTTP transport; keep stdout exclusively for MCP messages. Its HTTP fingerprint belongs to the bridge. Apply identity settings explicitly through `headers`, `info`, and OAuth metadata, or compose them using [`@mcp-layer/profiles`](../profiles/README.md).

## API reference

### `authorize(options): Authorization`

Returns an SDK-compatible `OAuthClientProvider` with these additional methods:

| Method | Result and behavior |
| --- | --- |
| `access({ rejected?: string }?): Promise<string>` | Return a valid upstream token. A rejected token triggers one serialized refresh or reauthorization; a newer token written by another process is reused. |
| `fetch(input: RequestInfo \| URL, init?: RequestInit): Promise<Response>` | Authenticated Fetch for the configured upstream origin. Preserves Request bodies and signals and the response stream; retries at most once after HTTP 401. Bound to the provider and safe to pass as a callback. |
| `discover(): Promise<{ key: string, state: object }>` | SDK discovery metadata and the hashed business-record identity. Performs network discovery but does not create credentials or open a browser. |
| `status(): Promise<object>` | Safe target/issuer, registration presence, expiry, refresh availability, and storage diagnostics. No token values or login, refresh, or record creation. |
| `close(): Promise<void>` | Cancel pending interaction and close the callback listener. |

SDK methods are `clientInformation`, `saveClientInformation`, `tokens`, `saveTokens`, `state`, `saveCodeVerifier`, `codeVerifier`, `discoveryState`, `saveDiscoveryState`, `invalidateCredentials`, and `redirectToAuthorization`. `clientMetadata`, `clientMetadataUrl`, and `redirectUrl` expose SDK registration settings. Use `provider.fetch` for the complete automatic browser/callback flow; consumers using only the SDK provider interface must own their transport's `finishAuth`/redirect lifecycle as described in the SDK documentation.

Options:

| Field | Contract |
| --- | --- |
| `target` | Required HTTP(S) upstream MCP URL. |
| `storage` | Required `cli-storage` instance. |
| `clientMetadata` | Public SDK OAuth registration metadata; the live callback replaces captured redirect URIs. Defaults to client name `mcp-layer`, authorization-code/refresh grants, and public-client authentication. |
| `clientInformation` | Optional preregistered SDK client information, including `client_id`, optional secret, issuer binding, and known `redirect_uris`/`token_endpoint_auth_method` constraints. Runtime credentials take precedence over profile defaults. Known callbacks are checked with the SDK's RFC 8252 loopback-port matching before consent opens. |
| `clientMetadataUrl` | Optional HTTPS client ID metadata document used by SDK discovery. |
| `issuer`, `resource`, `scope` | Optional explicit authorization-server, audience, and scope overrides; otherwise use SDK discovery. Scope sets are normalized for credential identity. |
| `redirectUrl`, `callbackPort` | HTTP loopback callback. Default `http://127.0.0.1:0/callback` chooses an available port. |
| `authTimeout` | Browser-interaction and lock-acquisition timeout in milliseconds; default `300000`. |
| `open` | Named `(url: URL) => Promise<void>` browser/URL-display callback. Required when interactive login is necessary. |
| `fetch` | Native Fetch-compatible implementation for upstream OAuth/MCP requests. |
| `observe` | Optional request-identity callback. Treat request observations as sensitive until sanitized by the profiles recorder. |
| `signal` | AbortSignal for authorization and lock acquisition. |

Missing tokens or near-expiry tokens enter the SDK authorization flow under the storage lease. Successful exchange records the SDK's issuer binding and expiry, retains an unrotated refresh token, and clears completed state/PKCE fields. Diagnostics never call `access()`.

### `issuer(options): OAuthServerProvider`

Returns an official SDK provider with `url`, `resource`, `scopes`, `clientsStore`, and the SDK provider methods. Mount it using `mcpAuthRouter`; protect resources with `requireBearerAuth` and `expectedResource`. This is also the issuer used by the capture runner.

Required options are `url` (issuer origin) and `storage`. `resource` defaults to `/mcp` on that origin. `scopes` defaults to `['mcp']`. `clients` optionally supplies preregistered SDK client records. `grant({ client, params })` optionally performs application authorization after local consent, outside the storage lock; its returned JSON object becomes `AuthInfo.extra`. `observe(event)` receives credential-free operation metadata. Lifetimes in seconds are `accessTtl` (3600), `refreshTtl` (2592000), and `codeTtl` (300, also used for consent).

The SDK validates client authentication, redirect URIs, and PKCE. The provider binds single-use codes to client, redirect, scopes, and resource, rotates refresh tokens atomically, rejects scope expansion, and revokes all tokens belonging to the revoked grant. Consent pages HTML-escape metadata and require a short-lived, single-use confirmation bound to the authorization request. All issuer records are stored through `cli-storage`.

### `forward(options): Promise<Runtime>`

Required `target` is an upstream Streamable HTTP URL. `transport` is `http` (default) or `stdio`. `auth` defaults to `true`; storage is required when enabled. `auth: false` selects an explicit transparent relay. `authProvider` can supply a provider returned by `authorize`; otherwise `oauth` contains the options forwarded to `authorize`. A supplied provider used by the runtime must offer `access`, `fetch`, `discover`, `status`, and `close` in addition to its SDK interface.

HTTP listeners default to `host: '127.0.0.1'`, `port: 0`. `baseUrl` explicitly advertises the origin behind an existing public HTTPS endpoint; the package does not create tunnels or terminate TLS. The SDK applies host-header validation. The public MCP endpoint is `/mcp`.

`headers` supplies reusable upstream identity headers. It cannot replace gateway authorization, cookies, MCP session/protocol headers, content framing, or negotiation headers. `info` optionally replaces initialize `clientInfo` without advertising captured capabilities or forcing a protocol version. `fetch` supplies upstream OAuth and stdio HTTP requests; HTTP relay traffic uses the native proxy. `observe` receives original/downstream and forwarded/upstream observations. Use the profiles recorder to sanitize them before exports or logs. `signal` closes the runtime when aborted.

The return shape is `{ url, close, closed, status }`: `url` is the HTTP `/mcp` endpoint, or undefined for stdio; `close(): Promise<void>` is idempotent; `closed: Promise<void>` settles when shutdown finishes; `status(): Promise<object>` reports safe authorization state. HTTP failures return safe 502 responses; SDK OAuth endpoint failures retain standard OAuth responses.

## Testing

Run the focused suite to exercise the public providers against actual SDK OAuth routers and MCP servers, real `cli-storage` files, and independent Node processes. It covers both grant legs, token audience separation, consent/PKCE, refresh rotation, rejected-token retry, stdio subprocesses, and teardown.

```sh
pnpm --filter @mcp-layer/forward test
```

## Runtime Error Reference

Setup and runtime failures use `LayerError`, including package, method, reference, documentation URL, and a stable `code`. SDK OAuth errors retain their standard protocol code and carry the corresponding LayerError metadata and cause. Storage errors retain their `cli-storage` code. Use `status()` for support output; do not serialize providers or credential records.

### Authorization configuration

<a id="error-25fa39"></a>
<a id="error-f3d7f6"></a>
<a id="error-ea0fd1"></a>
<a id="error-68f255"></a>
<a id="error-b25795"></a>
<a id="error-a7b30d"></a>
<a id="error-2ddfaf"></a>

These errors originate in `authorize` before or during provider setup.

| Code | Cause and remedy |
| --- | --- |
| `ERR_STORAGE_REQUIRED` | Inject a `cli-storage` instance with the documented asynchronous API. |
| `ERR_TARGET` | Supply an absolute HTTP or HTTPS MCP URL without embedded credentials or a fragment. |
| `ERR_CALLBACK` | Use an HTTP loopback callback at `127.0.0.1`, `localhost`, or `[::1]`, without credentials or a fragment. `callbackPort` must be an integer from 0 through 65535; zero chooses an available port. |
| `ERR_OAUTH_OPTIONS` | Set `authTimeout` to a positive finite number of milliseconds. The default is 300000. |
| `ERR_OAUTH_ISSUER` | The supplied registration belongs to another issuer. Select a registration issued by the discovered authorization server, or remove it and permit supported SDK registration. |
| `ERR_OAUTH_INTERACTION` | Supply `open(url)` so the resource owner can complete authorization. Cached credentials do not require interaction until renewal fails. |
| `ERR_OAUTH_REGISTRATION` | The current callback conflicts with known registered redirects. Use the registered host and path or obtain a new registration. The SDK permits loopback port changes while preserving host, path, and query constraints. |

Step-by-step resolution:

1. Validate the upstream and callback URLs against the issuer's registered redirect requirements.
2. Supply storage and an application-owned browser opener. Keep the same namespace when restarting.
3. Resolve any issuer mismatch before retrying; a captured public client ID cannot be reassigned to another issuer.

<details>
<summary>Configure an interactive provider</summary>

This example creates a loopback callback and delegates browser launch to `open`. Calling `access()` completes authorization and saves the resulting record through `cli-storage`; the `finally` block closes any callback listener.

```js
import { Storage } from 'cli-storage';
import open from 'open';
import { authorize } from '@mcp-layer/forward';

const provider = authorize({
  target: 'https://mcp.example.com/mcp',
  storage: new Storage({ namespace: 'example-mcp' }),
  callbackPort: 0,
  authTimeout: 300000,
  open,
});
try {
  await provider.access();
} finally {
  await provider.close();
}
```

</details>

### Authorization lifecycle

<a id="error-7e628c"></a>
<a id="error-4595a1"></a>
<a id="error-42e38a"></a>
<a id="error-0e4089"></a>
<a id="error-0fddb1"></a>

These errors originate in `authorize` while interacting with an issuer or fetching an upstream resource.

| Code | Cause and remedy |
| --- | --- |
| `ERR_OAUTH_DENIED` | The issuer returned a valid state-bound OAuth error. Inspect `oauthCode`, correct the issuer policy or requested scope, then begin a fresh interaction if the owner wants to retry. |
| `ERR_OAUTH_TIMEOUT` | Consent or lock acquisition exceeded the interaction deadline. Check browser/callback connectivity and retry, increasing `authTimeout` when the interaction needs longer. |
| `ERR_OAUTH_TOKENS` | SDK authorization completed without a usable access token. Inspect the issuer's token response and registration compatibility; restart authorization after correcting them. |
| `ERR_OAUTH_ORIGIN` | `provider.fetch()` was called for a different origin. Use an independently configured provider for that resource so credentials remain bound to their upstream. |
| `ERR_OAUTH_CLOSED` | Shutdown interrupted a pending interaction. Create a provider for a new operation rather than continuing the cancelled callback. |

Step-by-step resolution:

1. Inspect the error code and, for a denial, `oauthCode`; do not print token responses or callback query strings.
2. Check callback reachability, requested scopes, and the issuer's client allow list.
3. Close the failed provider before starting a fresh operation. Reuse the same storage namespace so valid persisted credentials remain available.

<details>
<summary>Report an authorization failure safely</summary>

The following handler reports machine-readable diagnostics and always closes the provider. `status()` inspects persisted state without starting a login.

```js
try {
  await provider.access();
} catch (error) {
  console.error({ code: error.code, oauthCode: error.oauthCode, status: await provider.status() });
} finally {
  await provider.close();
}
```

</details>

### Forwarding setup and upstream failures

<a id="error-c6fed0"></a>
<a id="error-0a35a9"></a>
<a id="error-b30b17"></a>
<a id="error-3f3c04"></a>
<a id="error-2c8def"></a>

These errors originate in `forward`.

| Code | Cause and remedy |
| --- | --- |
| `ERR_TARGET` | Configure an absolute HTTP or HTTPS upstream MCP endpoint. |
| `ERR_TRANSPORT` | Select `transport: 'http'` for a gateway or `transport: 'stdio'` for a stdio to Streamable HTTP bridge. Other bridge combinations are unsupported. |
| `ERR_STORAGE_REQUIRED` | OAuth requires an injected `cli-storage` instance. Pass it in the documented gateway/authorization settings. |
| `ERR_CONNECTION` | An SDK transport could not start. Inspect `cause`, upstream availability, and endpoint transport support; setup closes any listener already opened. |
| `ERR_AUTHORIZATION` | Upstream authorization failed during forwarding. Inspect `cause.code` and the authorization remedies above. A downstream grant cannot replace upstream credentials. |

Step-by-step resolution:

1. Check endpoint reachability and transport selection.
2. If OAuth is enabled, check upstream issuer, client, callback, and storage settings separately from downstream issuer settings.
3. Correct the reported cause and create a new runtime. Await `close()` during shutdown to release streams and listeners.

<details>
<summary>Inspect gateway state without beginning authorization</summary>

This example starts an unauthenticated local HTTP relay and prints its safe status. It closes the gateway immediately after inspection; authenticated gateways use the same lifecycle.

```js
import { forward } from '@mcp-layer/forward';

const runtime = await forward({ target: 'https://mcp.example.com/mcp', transport: 'http', auth: false });
try {
  console.log(await runtime.status());
} finally {
  await runtime.close();
  await runtime.closed;
}
```

</details>

### Issuer configuration

<a id="error-39d7be"></a>
<a id="error-d4ab70"></a>
<a id="error-284bad"></a>

These errors originate in `issuer`.

| Code | Cause and remedy |
| --- | --- |
| `EFORWARD_ISSUER_URL` | Supply absolute HTTP or HTTPS `url` and `resource` URLs, without fragments or an issuer query. The URLs must describe the externally reachable issuer and MCP resource. |
| `EFORWARD_ISSUER_STORAGE` | Inject an asynchronous `cli-storage` instance. There is no alternate token store. |
| `EFORWARD_ISSUER_OPTIONS` | Each scope must be a nonempty token without whitespace; code, access, and refresh lifetimes must be positive finite seconds. |

Step-by-step resolution:

1. Choose stable issuer and resource URLs; changing either creates a separate stored issuer identity.
2. Supply storage, supported scopes, and any preregistered clients.
3. Mount the provider through SDK `mcpAuthRouter` and protect the resource with SDK `requireBearerAuth`, as shown in the gateway example above.

<details>
<summary>Construct a local issuer with explicit lifetimes</summary>

This example demonstrates provider configuration only. The resulting provider is ready for SDK routers and issues tokens after an explicit consent decision.

```js
import { Storage } from 'cli-storage';
import { issuer } from '@mcp-layer/forward';

const provider = issuer({
  url: 'http://127.0.0.1:3000',
  resource: 'http://127.0.0.1:3000/mcp',
  storage: new Storage({ namespace: 'example-issuer' }),
  scopes: ['mcp'],
  codeTtl: 300,
  accessTtl: 3600,
  refreshTtl: 2592000,
});
```

</details>

### Issuer protocol errors

<a id="error-197927"></a>
<a id="error-68e782"></a>
<a id="error-aa7ac9"></a>
<a id="error-2ced28"></a>
<a id="error-0e6f67"></a>
<a id="error-df987c"></a>
<a id="error-f8b87b"></a>
<a id="error-34718f"></a>
<a id="error-7aaaa9"></a>
<a id="error-5d5cfd"></a>

These SDK errors carry LayerError references while preserving the OAuth protocol response.

| Method | Code | Cause and remedy |
| --- | --- | --- |
| `registerClient` | `invalid_client_metadata` | The ID is already registered. Use the existing registration or obtain a new SDK registration; do not overwrite its constraints. |
| `authorize` | `invalid_scope` | Request a subset of issuer-supported scopes. |
| `authorize` | `invalid_target` | Use the issuer's exact MCP resource URL. |
| `authorize` | `invalid_request` | Consent is expired, consumed, or mismatched. Restart at the authorization endpoint and use its fresh consent form. |
| `authorize` | `access_denied` | The resource owner declined consent. Stop this interaction; begin another only if the owner chooses to retry. |
| `challengeForAuthorizationCode` | `invalid_grant` | The code is unknown, expired, used, or belongs to another client. Obtain a new authorization code. |
| `exchangeAuthorizationCode` | `invalid_grant` | The code, client, redirect, PKCE verifier, or resource does not match. Correct the binding and obtain a fresh code rather than replaying it. |
| `exchangeRefreshToken` | `invalid_grant` | The refresh token is expired, rotated, revoked, or mismatched. Persist rotated tokens; if the current token is rejected, restart authorization. |
| `exchangeRefreshToken` | `invalid_scope` | Refresh may narrow the grant's scopes; it cannot add scopes. Obtain new consent for additional scopes. |
| `verifyAccessToken` | `invalid_token` | Obtain a valid unexpired token for this issuer/resource. Upstream and downstream tokens are separate credentials. |

Step-by-step resolution:

1. Keep the standard OAuth code when handling the SDK response.
2. Correct the client, redirect, resource, scope, or consent binding identified above.
3. Start a fresh authorization for rejected grants. Never replay a consumed code or retired refresh token.

<details>
<summary>Handle invalid credentials at the resource boundary</summary>

Use the SDK middleware to turn provider failures into the standard bearer challenge. This rejects an upstream token presented to the downstream resource and guides the client to the local discovery document.

```js
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';

app.use('/mcp', requireBearerAuth({
  verifier: provider,
  requiredScopes: ['mcp'],
  expectedResource: new URL(provider.resource),
  resourceMetadataUrl: new URL('/.well-known/oauth-protected-resource/mcp', provider.url).href,
}), handler);
```

</details>
