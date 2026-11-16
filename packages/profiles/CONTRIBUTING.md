# Contributing client profiles

A catalog entry is a claim about traffic produced by a particular client version and platform. Accept claims only when another developer can reproduce the capture and inspect its sanitized evidence. Start with [the public API and sanitization contract](./README.md), then follow this workflow.

## Capture a real client

1. Record the exact application version, platform, launch method, transport, date, and capture boundaries. Distinguish client requests from browser authorization requests and bridge-origin requests. Never label bridge HTTP as original client HTTP.
2. Run a fresh client session against a local capture boundary that preserves the SDK's transport and authorization behavior. Use disposable accounts and local configuration. Use `mcp-layer-profiles capture` or `listen()` for SDK-owned lifecycle handling; the host application remains responsible for the test client's configuration and account.
3. For an application-owned boundary, call `capture({client, capturedAt, allowHeaders})` and pass each observed request, response, and MCP message directly to `recorder.observe()` before any log or write. For a standalone test client, use `mcp-layer-profiles capture` and persist only its sanitized output. Add only reviewed public identity headers to `allowHeaders`. Credentials and protocol/session headers cannot be enabled.
4. Assign `perspective: 'downstream'` to original traffic and `upstream` to relay-origin traffic. Use `provenance.role: 'client'`, `browser`, `bridge`, or `server` accurately. Record an OAuth `provenance.issuer` only when discovery or the application establishes the actual authorization-server issuer; an endpoint origin is insufficient for issuer paths or aliases.
5. Exercise discovery, registration if applicable, interactive authorization, token exchange, an authenticated MCP initialization and request, refresh and token revocation when supported, and teardown. Record success statuses and evidence without persisting response credentials. An unobserved phase is a coverage gap, not permission to invent values.
6. Finish the recorder and save only its returned sanitized capture. `finish()` is idempotent and prevents further observations. Review both the sanitized payload and `redactions` markers locally before sharing. Do not publish raw traffic, authentication redirects, secrets, authorization codes, state, PKCE challenges/verifiers, session IDs, private account labels, or recordings that embed those values.

MCP framing, HTTP headers, capabilities, and negotiation must follow the [official transport](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports) and [lifecycle](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle) specifications and the installed SDK. OAuth must use the SDK's [provider interface](https://github.com/modelcontextprotocol/typescript-sdk/blob/v1.x/src/client/auth.ts) and [MCP authorization contract](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization). A capture harness must not fabricate protocol behavior to make an observation appear complete.

## Build and inspect a candidate

The following script reads a sanitized capture, derives its reusable fields, and writes the candidate profile. This catches conflicting identities and unsupported schemas before review. The expected output is a validated profile whose coverage states what the capture actually observed.

```js
import { readFile, writeFile } from 'node:fs/promises';
import { derive, apply } from '@mcp-layer/profiles';

const captured = JSON.parse(await readFile('client.capture.json', 'utf8'));
const profile = derive(captured);
apply(profile);
await writeFile('client.profile.json', JSON.stringify(profile, null, 2));
console.log(profile.id, profile.coverage);
```

Inspect every reusable HTTP field, MCP `clientInfo`, public OAuth metadata field, and issuer/client-ID pair. Each must be supported by eligible downstream evidence. Capabilities and protocol versions are evidence only. Issuer-bound redirect URIs may remain only as public client-registration validation constraints; never replay them as runtime callbacks. Resources, tokens, and secrets must never become reusable profile settings. Verify that a browser user agent and the harness's HTTP user agent cannot determine the captured client's profile.

Do not fill missing observations from vendor documentation, memory, another release, or another platform. Record those sources as explanatory context in the review, not as captured values. Profiles are version/platform-specific when the evidence shows those distinctions; keep the scope explicit.

<details>
<summary>Reproduce the native Claude Code capture setup</summary>

This recipe records the setup used for the bundled Claude Code 2.1.325 capture on `darwin-arm64`. It uses an isolated `CLAUDE_CONFIG_DIR`, the client's native headless OAuth flow, a local issuer with a one-second access-token lifetime, explicit consent, and a PTY for the no-browser handoff. A fresh run has a new timestamp, loopback port, and issuer-bound registration ID; compare observed fields and coverage rather than expecting the old profile ID or byte-for-byte artifact equality.

Start a local issuer and keep this Node process running while the client performs capture. It stores OAuth state with `cli-storage`, prints the endpoint on stderr, and writes the sanitized artifact when interrupted with Ctrl-C.

```js
import { Storage } from 'cli-storage';
import { listen } from '@mcp-layer/profiles';

const runtime = await listen({
  oauth: { accessTtl: 1 },
  storage: new Storage({ namespace: 'claude-code-capture' }),
  output: 'claude-code.capture.json',
});

/** @returns {void} Start the SDK listener's orderly artifact-producing shutdown. */
function stop() { void runtime.close(); }

process.stderr.write(`${runtime.url}\n`);
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
await runtime.closed;
```

In a separate shell, install and verify the exact client version, then configure the local endpoint in the isolated native client configuration. The first `list` checks setup; `login --no-browser` uses a TTY, asks for explicit local consent, and requires pasting the callback URL when prompted. Wait longer than the one-second access-token lifetime before listing so refresh is observed, then log out. Preserve the server's printed URL in `CAPTURE_URL` for the setup command.

```sh
export CLAUDE_CONFIG_DIR="$(mktemp -d)"
export CLAUDE_BIN_DIR="$(mktemp -d)"
npm install --prefix "$CLAUDE_BIN_DIR" @anthropic-ai/claude-code@2.1.325
CLAUDE="$CLAUDE_BIN_DIR/node_modules/.bin/claude"
"$CLAUDE" --version
"$CLAUDE" --bare mcp add --transport http --scope user mcp-layer-capture "$CAPTURE_URL"
"$CLAUDE" --bare mcp list
"$CLAUDE" --bare mcp login --no-browser mcp-layer-capture
sleep 2
"$CLAUDE" --bare mcp list
"$CLAUDE" --bare mcp logout mcp-layer-capture
```

After logout, interrupt the listener to export the sanitized capture. Derive the candidate with `derive(capture)` and compare its evidence and coverage with the observed source. Keep the endpoint, disposable account, configuration and install paths out of published evidence unless they are already public and reviewed.

</details>

## Validate behavior and documentation

Write Node `node:test` scenarios before changing behavior, observe the intended failure, and exercise public package APIs. Use named functions and full JSDoc. Place tests in `test/*.test.js` and fixtures in `test/fixtures/`. Synthetic fixtures must be labeled synthetic and cannot enter the verified catalog. No mocks or stubs may be introduced without explicit user approval.

Run types and focused tests first, then the workspace tests before shipping. Real consumer coverage must include native `Request` headers/body/abort behavior, untouched response streams, SDK-owned authorization/session/protocol headers, official SDK clients and servers, and a concrete OAuth provider with runtime storage. Test that live redirects, resources, credentials, authentication methods, and provider secrets override or remain independent of captured public identity. Close all SDK and network resources.

```sh
pnpm --filter @mcp-layer/profiles build:types
pnpm --filter @mcp-layer/profiles test
pnpm test
```

Update the README API reference, examples, error references, and limitations as the implementation changes. Any new persisted package artifact field needs a clear purpose and compatibility decision. Package artifacts do not authorize new keys in `.mcp.json`, `mcp.json`, connector-managed configuration, or other host schemas. A config contract change also needs a semver-correct changeset and links to the relevant official host/specification schema.

## Admit a verified catalog entry

Submit the sanitized capture, reproducible setup instructions, exact client/version/platform, public source links, observed coverage, and real consumer validation with the candidate. A reviewer must independently reproduce or verify the evidence and check for credentials and private data. Only then may code add a bundled catalog entry and its tests. `list()` and `get()` expose reviewed entries only; a locally derived profile or a test fixture does not establish verification.

The current bundled entry is Claude Code 2.1.325 on `darwin-arm64`, backed by `test/fixtures/claude-code.capture.json` and `src/catalog/claude-code.json`. Its 24 observations cover OAuth discovery, dynamic registration, local browser consent, code exchange, refresh, revocation, and MCP; the README describes the temporary loopback issuer and its one-second access-token lifetime. The OAuth client ID is evidence-bound to that exact ephemeral issuer and must never be reused with another issuer. New entries require independent reproduction, review of sanitized evidence and rebuilt profile equality; never synthesize claims for named products to make the list appear useful. Custom catalogs supplied through `match(observation, {profiles})` remain application-owned and must not be described as bundled or independently verified.

Include a changeset for user-facing additions. The PR must include a standards compliance summary listing every config key introduced or removed and its specification/host-doc source; this package currently introduces none. Also state whether property-access `&&` chains were added/removed and whether any `||` defaults were intentionally retained instead of `??`.
