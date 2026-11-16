import { createHash } from 'node:crypto';
import { LayerError } from '@mcp-layer/error';
import { OAuthClientMetadataSchema } from '@modelcontextprotocol/sdk/shared/auth.js';
import claudeCode from './catalog/claude-code.json' with { type: 'json' };
import { capture, identity } from './capture.js';
import { clean, implementation, reusable } from './clean.js';

/** @type {import('./types.js').Profile[]} */
const catalog = [claudeCode];
const metadata = ['client_name', 'software_id', 'software_version', 'client_uri', 'logo_uri', 'tos_uri', 'policy_uri', 'token_endpoint_auth_method'];

/**
 * Serialize JSON with deterministic object key order.
 * @param {any} value - JSON-compatible input.
 * @returns {string} Canonical JSON text.
 */
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(
      /**
       * Serialize a public field in sorted key order.
       * @param {string} key - Object field name.
       * @returns {string} Canonical field representation.
       */
      function field(key) { return `${JSON.stringify(key)}:${canonical(value[key])}`; }).join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * Extract an explicitly observed MCP client identity.
 * @param {import('./types.js').Evidence} observation - Sanitized observation.
 * @returns {import('@modelcontextprotocol/sdk/types.js').Implementation | undefined} Standard public initialize or request metadata identity.
 */
function client(observation) {
  const message = observation.message;
  const initialized = message?.method === 'initialize';
  const value = initialized ? message.params?.clientInfo : message?.params?._meta?.['io.modelcontextprotocol/clientInfo'];
  const path = initialized ? 'message.params.clientInfo' : 'message.params._meta.io.modelcontextprotocol/clientInfo';
  return identity(value) ? implementation(value, path, observation.redactions) : undefined;
}

/**
 * Determine whether evidence comes from the actual downstream client.
 * @param {import('./types.js').Evidence} observation - Sanitized observation.
 * @returns {boolean} Whether evidence is eligible for reusable identity.
 */
function eligible(observation) {
  return observation.perspective === 'downstream' && !['browser', 'bridge', 'server'].includes(observation.provenance?.role);
}

/**
 * Collect one public value, rejecting contradictory observations.
 * @param {Record<string, any>} target - Values collected so far.
 * @param {string} key - Public identity field name.
 * @param {any} value - Observed public value.
 * @returns {void} Updates target in place.
 * @throws {LayerError} When the capture contains conflicting identity values.
 */
function collect(target, key, value) {
  if (Object.hasOwn(target, key) && canonical(target[key]) !== canonical(value)) {
    throw new LayerError({ name: 'profiles', method: 'derive', message: 'Capture contains conflicting downstream client identity values.', code: 'ERR_PROFILES_CONFLICT' });
  }
  target[key] = value;
}

/**
 * Merge a reusable registration constraint, retaining evidence only when it was not redacted.
 * @param {import('./types.js').Registration} target - Issuer-bound registration under construction.
 * @param {string} key - Public registration field.
 * @param {unknown} value - Sanitized field value.
 * @param {import('./types.js').Evidence} observation - Evidence that declares the field.
 * @returns {void} Adds a consistent optional constraint to the registration.
 * @throws {LayerError} When observations declare incompatible constraints for one registration.
 */
function constraint(target, key, value, observation) {
  if (value === undefined) return;
  const path = `body.${key === 'redirectUris' ? 'redirect_uris' : 'token_endpoint_auth_method'}`;
  if (observation.redactions.some(
    /**
     * Detect sanitized changes to this registration field.
     * @param {import('./types.js').Redaction} marker - Redaction marker.
     * @returns {boolean} Whether sanitization changed the field.
     */
    function changed(marker) { return marker.path === path || marker.path.startsWith(`${path}.`); })) return;
  if (Object.hasOwn(target, key) && canonical(target[key]) !== canonical(value)) {
    throw new LayerError({ name: 'profiles', method: 'derive', message: 'Capture contains conflicting OAuth registration constraints for the same issuer and client ID. Keep one registration or recapture its consistent redirect URIs and authentication method.', code: 'ERR_PROFILES_REGISTRATION' });
  }
  target[key] = value;
}

/**
 * Build a deterministic profile from sanitized downstream evidence.
 * @param {import('./types.js').Capture} input - Exported capture, including imported capture JSON.
 * @returns {import('./types.js').Profile} Validated profile with public reusable identity.
 * @throws {LayerError} When the capture schema, identity, or evidence is invalid or conflicting.
 */
export function derive(input) {
  if (!input || input.schema !== 1 || !Array.isArray(input.observations)
    || typeof input.capturedAt !== 'string' || !Number.isFinite(Date.parse(input.capturedAt))) {
    throw new LayerError({ name: 'profiles', method: 'derive', message: 'Capture must use schema 1 and contain an observations array.', code: 'ERR_PROFILES_CAPTURE' });
  }
  const recorder = capture({ id: input.id, client: input.client, capturedAt: input.capturedAt, allowHeaders: input.allowHeaders });
  for (const observation of input.observations) recorder.observe(observation);
  const snapshot = recorder.finish();
  const selected = snapshot.observations.filter(eligible);
  const observed = selected.map(client).filter(Boolean);
  const first = observed.at(0);
  if (!first && !snapshot.client) {
    throw new LayerError({ name: 'profiles', method: 'derive', message: 'Capture needs an observed MCP clientInfo or an explicit client name and version.', code: 'ERR_PROFILES_IDENTITY' });
  }
  const descriptor = { ...snapshot.client };
  for (const value of observed) {
    for (const [field, metadata] of Object.entries(value)) collect(descriptor, field, metadata);
  }
  const byPhase = new Map();
  /** @type {import('./types.js').Metadata} */
  const publicMetadata = {};
  /** @type {import('./types.js').Registration[]} */
  const clients = [];
  const versions = new Set();
  const capabilities = new Map();
  for (const observation of selected) {
    if (observation.phase !== 'authorization') {
      const headers = byPhase.get(observation.phase) ?? {};
      for (const [name, value] of Object.entries(observation.headers)) {
        if (reusable(name, snapshot.allowHeaders) && value !== '[redacted]') collect(headers, name, value);
      }
      byPhase.set(observation.phase, headers);
    }
    const params = observation.message?.params;
    if (observation.phase === 'mcp') {
      if (typeof params?.protocolVersion === 'string') versions.add(params.protocolVersion);
      const revision = params?._meta?.['io.modelcontextprotocol/protocolVersion'];
      if (typeof revision === 'string' && revision !== '[redacted]') versions.add(revision);
      const header = observation.headers['mcp-protocol-version'];
      if (header && header !== '[redacted]') versions.add(header);
      const value = params?.capabilities ?? params?._meta?.['io.modelcontextprotocol/clientCapabilities'];
      if (value && typeof value === 'object' && !Array.isArray(value)) capabilities.set(canonical(value), value);
    }
    if (observation.phase !== 'mcp' && observation.body && typeof observation.body === 'object') {
      for (const name of metadata) {
        if (name === 'token_endpoint_auth_method' && typeof observation.body.client_id === 'string') continue;
        const value = observation.body[name];
        if (typeof value === 'string' && value !== '[redacted]') collect(publicMetadata, name, value);
      }
    }
    const issuer = observation.provenance?.issuer;
    if (!issuer || issuer === '[redacted]') continue;
    const ids = new Set();
    if (typeof observation.body?.client_id === 'string') ids.add(observation.body.client_id);
    if (observation.url && observation.url !== '[redacted]') {
      const value = new URL(observation.url).searchParams.get('client_id');
      if (value) ids.add(value);
    }
    for (const marker of observation.redactions) {
      if (marker.scheme === 'Basic' && marker.clientId) ids.add(marker.clientId);
    }
    for (const clientId of ids) {
      if (clientId === '[redacted]') continue;
      let registration = clients.find(
        /**
         * Find an existing issuer-bound public registration.
         * @param {import('./types.js').Registration} value - Collected registration.
         * @returns {boolean} Whether issuer and public client ID agree.
         */
        function duplicate(value) { return value.issuer === issuer && value.clientId === clientId; });
      if (!registration) {
        registration = { issuer, clientId };
        clients.push(registration);
      }
      if (observation.phase === 'registration' && observation.body?.client_id === clientId) {
        const body = observation.body;
        const redirects = Array.isArray(body.redirect_uris) && body.redirect_uris.every(
          /**
           * Require every observed callback URL to remain a valid, unredacted URL.
           * @param {unknown} value - Sanitized redirect URI.
           * @returns {boolean} Whether the callback is fully reusable.
           */
          function valid(value) {
            if (typeof value !== 'string' || value === '[redacted]') return false;
            try { return Boolean(new URL(value)); } catch { return false; }
          }) && body.redirect_uris.length > 0 ? body.redirect_uris : undefined;
        constraint(registration, 'redirectUris', redirects, observation);
        constraint(registration, 'authMethod', typeof body.token_endpoint_auth_method === 'string' && body.token_endpoint_auth_method !== '[redacted]' ? body.token_endpoint_auth_method : undefined, observation);
      }
    }
  }
  const info = implementation(descriptor);
  const registration = OAuthClientMetadataSchema.safeParse({ ...publicMetadata, redirect_uris: [] });
  if (!info || !registration.success) {
    throw new LayerError({ name: 'profiles', method: 'derive', message: 'Capture contains client identity fields that do not satisfy the official SDK schemas.', code: 'ERR_PROFILES_CAPTURE' });
  }
  clients.sort(
    /**
     * Order public entries deterministically.
     * @param {any} a - First public entry.
     * @param {any} b - Second public entry.
     * @returns {number} Stable sort comparison.
     */
    function order(a, b) { return canonical(a).localeCompare(canonical(b)); });
  const headers = byPhase.get('mcp') ?? {};
  const phases = Object.fromEntries([...byPhase.entries()]
    .filter(([phase, values]) => phase !== 'mcp' && canonical(values) !== canonical(headers))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([phase, values]) => [phase, Object.fromEntries(Object.entries(values).sort())]));
  const fingerprintData = { client: descriptor, headers, metadata: publicMetadata, clients };
  if (Object.keys(phases).length > 0) fingerprintData.phases = phases;
  const fingerprint = createHash('sha256').update(canonical(fingerprintData)).digest('hex').slice(0, 12);
  const slug = `${descriptor.name}-${descriptor.version}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return {
    schema: 1,
    id: snapshot.id ?? `${slug}-${fingerprint}`,
    client: descriptor,
    capturedAt: snapshot.capturedAt,
    evidence: snapshot.observations,
    coverage: {
      phases: [...new Set(snapshot.observations.map(
        /**
         * Read the observed capture phase.
         * @param {import('./types.js').Evidence} value - Sanitized observation.
         * @returns {import('./types.js').Phase} Observed phase.
         */
        function phase(value) { return value.phase; }))].sort(),
      perspectives: [...new Set(snapshot.observations.map(
        /**
         * Read the observed capture perspective.
         * @param {import('./types.js').Evidence} value - Sanitized observation.
         * @returns {import('./types.js').Perspective} Observed perspective.
         */
        function perspective(value) { return value.perspective; }))].sort(),
      identity: first ? 'observed' : 'declared',
      observations: snapshot.observations.length,
    },
    http: { headers: Object.fromEntries(Object.entries(headers).sort()), ...(Object.keys(phases).length > 0 ? { phases } : {}), allowHeaders: snapshot.allowHeaders },
    mcp: {
      clientInfo: info,
      observed: { protocolVersions: [...versions].sort(), capabilities: [...capabilities.entries()].sort().map(
        /**
         * Extract a canonically ordered capability observation.
         * @param {[string, object]} entry - Canonical key and capabilities.
         * @returns {object} Observed capabilities.
         */
        function value(entry) { return entry[1]; }) },
    },
    oauth: { metadata: publicMetadata, clients },
  };
}

/**
 * Validate reusable profile fields against their own sanitized evidence.
 * @param {import('./types.js').Profile} profile - Caller-supplied profile.
 * @returns {import('./types.js').Profile} Sanitized independently reconstructed profile.
 * @throws {LayerError} When the profile does not match its evidence or uses an unsupported schema.
 */
export function validate(profile) {
  let result;
  try {
    result = derive({ schema: profile?.schema, id: profile?.id, client: profile?.client, capturedAt: profile?.capturedAt, allowHeaders: profile?.http?.allowHeaders, observations: profile?.evidence });
  } catch {
    throw new LayerError({ name: 'profiles', method: 'apply', message: 'Profile must use schema 1 and contain reusable fields supported by its sanitized evidence.', code: 'ERR_PROFILES_PROFILE' });
  }
  if (canonical(profile.http) !== canonical(result.http) || canonical(profile.mcp) !== canonical(result.mcp)
    || canonical(profile.oauth) !== canonical(result.oauth) || canonical(profile.coverage) !== canonical(result.coverage)) {
    throw new LayerError({ name: 'profiles', method: 'apply', message: 'Profile must use schema 1 and contain reusable fields supported by its sanitized evidence.', code: 'ERR_PROFILES_PROFILE' });
  }
  return result;
}

/**
 * List bundled profiles backed by reviewed, reproducible captures.
 * @returns {import('./types.js').Profile[]} Independent verified catalog entries.
 */
export function list() {
  return structuredClone(catalog);
}

/**
 * Look up a bundled verified profile.
 * @param {string} id - Exact catalog profile ID or client family name.
 * @returns {import('./types.js').Profile} Independent pinned profile or newest verified family capture.
 * @throws {LayerError} When no verified profile has the requested ID.
 */
export function get(id) {
  let profile = catalog.find(
    /**
     * Find an exact bundled profile identifier.
     * @param {import('./types.js').Profile} value - Bundled profile.
     * @returns {boolean} Whether the ID matches.
     */
    function same(value) { return value.id === id; });
  if (!profile) {
    profile = catalog.filter(
      /**
       * Select verified captures from the requested client family.
       * @param {import('./types.js').Profile} value Bundled profile.
       * @returns {boolean} Whether the client family matches.
       */
      function family(value) { return value.client.name === id; }).sort(
      /**
       * Order family captures newest first, resolving equal timestamps deterministically.
       * @param {import('./types.js').Profile} left First capture.
       * @param {import('./types.js').Profile} right Second capture.
       * @returns {number} Chronological order followed by stable identifier order.
       */
      function newest(left, right) {
        const order = Date.parse(right.capturedAt) - Date.parse(left.capturedAt);
        return order === 0 ? left.id.localeCompare(right.id) : order;
      }).at(0);
  }
  if (!profile) {
    throw new LayerError({ name: 'profiles', method: 'get', message: 'No verified client profile exists for the requested ID.', code: 'ERR_PROFILES_UNKNOWN' });
  }
  return structuredClone(profile);
}

/**
 * Compare public identity signals with verified or caller-owned profiles.
 * @param {import('./types.js').Observation} observation - Inbound HTTP or MCP evidence.
 * @param {import('./types.js').MatchOptions} [options={}] - Optional caller-owned evidence-backed catalog.
 * @returns {import('./types.js').Match} Advisory candidates and sanitized evidence, never an authorization result.
 * @throws {LayerError} When observations or supplied profiles are invalid.
 */
export function match(observation, options = {}) {
  const profiles = options?.profiles ?? catalog;
  if (!Array.isArray(profiles)) {
    throw new LayerError({ name: 'profiles', method: 'match', message: 'Matching options must contain an array of evidence-backed profiles.', code: 'ERR_PROFILES_OPTIONS' });
  }
  const validated = profiles.map(validate);
  const allowed = [...new Set(validated.flatMap(
    /**
     * Collect validated public header additions.
     * @param {import('./types.js').Profile} profile - Caller-owned profile.
     * @returns {string[]} Explicit public header names.
     */
    function names(profile) { return profile.http.allowHeaders; }))];
  const evidence = clean(observation, allowed);
  const observed = client(evidence);
  /** @type {import('./types.js').Candidate[]} */
  const candidates = [];
  if (eligible(evidence) && evidence.phase !== 'authorization') {
    for (const profile of validated) {
      const signals = [];
      if (observed) {
        if (observed.name !== profile.client.name || observed.version !== profile.client.version) continue;
        signals.push('mcp.clientInfo');
      }
      const expected = Object.hasOwn(profile.http.phases ?? {}, evidence.phase)
        ? profile.http.phases[evidence.phase]
        : profile.http.headers;
      const present = Object.keys(expected).filter(
        /**
         * Check whether a reusable header was observed.
         * @param {string} name - Public identity header name.
         * @returns {boolean} Whether inbound evidence contains the header.
         */
        function supplied(name) { return evidence.headers[name] !== undefined; });
      if (present.some(
        /**
         * Check a supplied public header against a candidate.
         * @param {string} name - Public identity header name.
         * @returns {boolean} Whether values disagree.
         */
        function contradiction(name) { return evidence.headers[name] !== expected[name]; })) continue;
      for (const name of present) signals.push(`http.headers.${name}`);
      if (signals.length > 0) candidates.push({ id: profile.id, signals });
    }
  }
  candidates.sort(
    /**
     * Order public entries deterministically.
     * @param {any} a - First public entry.
     * @param {any} b - Second public entry.
     * @returns {number} Stable sort comparison.
     */
    function order(a, b) { return a.id.localeCompare(b.id); });
  return { status: candidates.length === 1 ? 'matched' : candidates.length > 1 ? 'ambiguous' : 'unknown', evidence: [evidence], candidates };
}
