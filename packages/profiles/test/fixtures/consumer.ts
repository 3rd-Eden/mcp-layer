import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { apply, capture, derive, match, type Capture, type Evidence, type Profile } from '@mcp-layer/profiles';

const recorder = capture({ client: { name: 'type-consumer', version: '1.0.0' } });
const evidence: Evidence = recorder.observe({ phase: 'mcp', perspective: 'downstream', headers: new Headers(), message: { method: 'initialize' } });
const recorded: Capture = recorder.finish();
const profile: Profile = derive(recorded);
const runtime = apply(profile);
const result = match(evidence, { profiles: [profile] });
const status: 'matched' | 'ambiguous' | 'unknown' = result.status;
const request: Promise<Response> = runtime.fetch(new Request('https://example.com/'));
const revocation = apply(profile, { phase: 'revocation' });

if (runtime.info) {
  const client = new Client(runtime.info);
  const transport = new StreamableHTTPClientTransport(new URL('https://example.com/mcp'), { fetch: runtime.fetch, authProvider: runtime.authProvider });
  void client;
  void transport;
}

// @ts-expect-error Unknown phases are not accepted by the public recorder contract.
recorder.observe({ phase: 'handshake', perspective: 'downstream' });
// @ts-expect-error Perspectives distinguish the actual client from relay-origin traffic.
recorder.observe({ phase: 'mcp', perspective: 'sideways' });
// @ts-expect-error Parts are limited to public HTTP, MCP, and OAuth identity.
apply(profile, { parts: ['transport'] });
// @ts-expect-error Public software versions are strings.
apply(profile, { info: { version: 123 } });

void status;
void request;
void revocation;
