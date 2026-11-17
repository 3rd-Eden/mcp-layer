import { LayerError } from '@mcp-layer/error';
import { ImplementationSchema } from '@modelcontextprotocol/sdk/types.js';

export const phases = ['discovery', 'registration', 'authorization', 'token', 'refresh', 'revocation', 'mcp'];
export const identities = [
  'user-agent', 'x-client-name', 'x-client-version', 'x-client-platform',
  'x-mcp-client-name', 'x-mcp-client-version', 'x-mcp-client-platform',
  'x-stainless-lang', 'x-stainless-package-version', 'x-stainless-os',
  'x-stainless-arch', 'x-stainless-runtime', 'x-stainless-runtime-version',
];
const protocol = ['accept', 'content-type', 'mcp-protocol-version'];
const publicFields = new Set([
  'jsonrpc', 'method', 'protocolVersion', 'protocol_version',
  'io.modelcontextprotocol/protocolVersion',
  'client_id', 'client_name', 'software_id', 'software_version',
  'token_endpoint_auth_method', 'grant_type', 'grant_types', 'response_type',
  'response_types', 'scope', 'scopes_supported', 'token_type', 'code_challenge_method',
  'issuer', 'resource', 'redirect_uri', 'redirect_uris', 'client_uri', 'logo_uri',
  'tos_uri', 'policy_uri', 'authorization_servers', 'authorization_endpoint',
  'token_endpoint', 'registration_endpoint', 'jwks_uri', 'error',
]);
const urls = new Set([
  'issuer', 'resource', 'redirect_uri', 'redirect_uris', 'client_uri', 'logo_uri',
  'tos_uri', 'policy_uri', 'authorization_servers', 'authorization_endpoint',
  'token_endpoint', 'registration_endpoint', 'jwks_uri',
]);
const queries = new Set(['client_id', 'response_type', 'grant_type', 'scope', 'redirect_uri', 'resource', 'code_challenge_method']);
const secret = /authorization|cookie|token|secret|password|api[-_]?key|credential|session|csrf|assertion|verifier|challenge|(?:^|[_-])state$|(?:^|[_-])code$|nonce|ticket/i;

/**
 * Test whether a header can contain reusable public identity.
 * @param {string} name - Lowercase HTTP header name.
 * @param {string[]} allowed - Explicit public identity header allowlist.
 * @returns {boolean} Whether the header is reusable.
 */
export function reusable(name, allowed) {
  return !secret.test(name) && !protocol.includes(name) && (identities.includes(name) || allowed.includes(name));
}

/**
 * Validate explicit public header names.
 * @param {unknown} value - Caller allowlist.
 * @returns {string[]} Sorted normalized header names.
 * @throws {LayerError} When an entry is invalid or reserved.
 */
export function allowlist(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some(
    /**
     * Reject invalid or reserved identity header names.
     * @param {unknown} name - Requested header name.
     * @returns {boolean} Whether the name is invalid.
     */
    function invalid(name) {
    return typeof name !== 'string' || !/^[a-z0-9!#$%&'*+.^_`|~-]+$/i.test(name) || !reusable(name.toLowerCase(), [name.toLowerCase()]);
  })) {
    throw new LayerError({ name: 'profiles', method: 'capture', message: 'Capture options must contain valid public identity metadata and header names.', code: 'ERR_PROFILES_OPTIONS' });
  }
  return [...new Set(value.map(
    /**
     * Normalize a public header name.
     * @param {string} name - Requested header name.
     * @returns {string} Lowercase header name.
     */
    function lower(name) { return name.toLowerCase(); }))].sort();
}

/**
 * Classify a removed value without recording it.
 * @param {string} name - Field name.
 * @returns {import('./types.js').Redaction['kind']} Redaction classification.
 */
function kind(name) {
  if (/session/i.test(name)) return 'session';
  if (/authorization|cookie|secret|password|api[-_]?key|credential/i.test(name)) return 'credential';
  if (secret.test(name)) return 'oauth';
  if (name === 'id') return 'identifier';
  return 'unclassified';
}

/**
 * Replace a value and append its public classification.
 * @param {string} path - Field path.
 * @param {string} name - Field name.
 * @param {import('./types.js').Redaction[]} redactions - Collected markers.
 * @returns {string} Redaction marker.
 */
function redact(path, name, redactions) {
  redactions.push({ path, kind: kind(name) });
  return '[redacted]';
}

/**
 * Retain an exact public client identifier only when any embedded URL is credential-free.
 * @param {string} value - Public OAuth client ID or Basic username.
 * @param {string} path - Evidence field path.
 * @param {import('./types.js').Redaction[]} redactions - Collected markers.
 * @returns {string} Exact public ID or redaction marker.
 */
function identifier(value, path, redactions) {
  if (!/^https?:/i.test(value)) return value;
  const count = redactions.length;
  address(value, path, redactions);
  return redactions.length === count ? value : redact(path, 'client_id', redactions);
}

/**
 * Remove URL credentials, fragments, and private query values.
 * @param {unknown} value - URL string or URL instance.
 * @param {string} path - Evidence field path.
 * @param {import('./types.js').Redaction[]} redactions - Collected markers.
 * @returns {string} Sanitized URL or redaction marker.
 */
export function address(value, path, redactions) {
  let url;
  try {
    url = new URL(String(value));
  } catch {
    return redact(path, 'url', redactions);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return redact(path, 'url', redactions);
  if (path.endsWith('issuer') && !url.username && !url.password && !url.search && !url.hash) return String(value);
  if (url.username || url.password) {
    redact(`${path}.credentials`, 'password', redactions);
    url.username = '';
    url.password = '';
  }
  if (url.hash) redact(`${path}.fragment`, 'state', redactions);
  url.hash = '';
  url.pathname = url.pathname.replace(/\/(sessions?|tokens?)\/[^/]+/gi, 
    /**
     * Remove a session or token path identifier.
     * @param {string} value - Matched path segment.
     * @param {string} name - Identifier category.
     * @returns {string} Sanitized path segment.
     */
    function segment(value, name) {
    redact(`${path}.path`, name, redactions);
    return `/${name}/[redacted]`;
  });
  const entries = [...url.searchParams];
  url.search = '';
  for (const [name, item] of entries) {
    if (!queries.has(name)) {
      url.searchParams.append(name, redact(`${path}.query.${name}`, name, redactions));
    } else {
      const field = `${path}.query.${name}`;
      const value = name === 'client_id' ? identifier(item, field, redactions) : urls.has(name) ? address(item, field, redactions) : item;
      url.searchParams.append(name, value);
    }
  }
  return url.href;
}

/**
 * Sanitize a structured OAuth or JSON-RPC value.
 * @param {unknown} value - Value to sanitize.
 * @param {string} path - Field path.
 * @param {import('./types.js').Redaction[]} redactions - Collected markers.
 * @param {string} [name=''] - Current field name.
 * @param {WeakSet<object>} [seen] - Ancestors for cyclic input detection.
 * @returns {any} JSON-compatible sanitized value.
 */
function structured(value, path, redactions, name = '', seen = new WeakSet()) {
  if (value === '[redacted]') return value;
  if (secret.test(name) && !publicFields.has(name)) return redact(path, name, redactions);
  if (value !== null && typeof value === 'object') {
    if (seen.has(value)) return redact(path, name, redactions);
    seen.add(value);
    if (Array.isArray(value)) {
      const items = value.map(
        /**
         * Sanitize an array entry using its parent field category.
         * @param {unknown} entry - Observed array entry.
         * @param {number} index - Array position.
         * @returns {any} Sanitized JSON-compatible entry.
         */
        function item(entry, index) { return structured(entry, `${path}.${index}`, redactions, name, seen); });
      seen.delete(value);
      return items;
    }
    const entries = Object.entries(value).map(
      /**
       * Sanitize one observed object property.
       * @param {[string, unknown]} entry - Property name and value.
       * @returns {[string, any]} Sanitized property pair.
       */
      function entry([key, item]) {
      return [key, structured(item, `${path}.${key}`, redactions, key, seen)];
    });
    seen.delete(value);
    return Object.fromEntries(entries);
  }
  const identity = /(?:^|\.)(?:clientInfo|io\.modelcontextprotocol\/clientInfo)\.(?:name|version|title|description|websiteUrl|icons\.\d+\.(?:src|mimeType|theme|sizes\.\d+))$/.test(path);
  const capability = /\.(?:capabilities|io\.modelcontextprotocol\/clientCapabilities)\./.test(path) && (typeof value === 'boolean' || value === null);
  if (capability) return value;
  if (typeof value === 'string' && (publicFields.has(name) || identity)) {
    if (name === 'client_id') return identifier(value, path, redactions);
    if (identity && (name === 'websiteUrl' || name === 'src')) return address(value, path, redactions);
    return urls.has(name) ? address(value, path, redactions) : value;
  }
  return redact(path, name, redactions);
}

/**
 * Select standard public implementation metadata through the official SDK schema.
 * @param {unknown} value - Observed or declared implementation metadata.
 * @param {string} [path='clientInfo'] - Evidence field path.
 * @param {import('./types.js').Redaction[]} [redactions=[]] - Existing and newly collected redaction markers.
 * @returns {import('@modelcontextprotocol/sdk/types.js').Implementation | undefined} Safe standard metadata without unknown or redacted fields.
 */
export function implementation(value, path = 'clientInfo', redactions = []) {
  const parsed = ImplementationSchema.safeParse(structured(value, path, redactions));
  if (!parsed.success || !parsed.data.name.trim() || !parsed.data.version.trim()
    || parsed.data.name === '[redacted]' || parsed.data.version === '[redacted]') return undefined;
  const result = parsed.data;
  for (const field of ['title', 'description', 'websiteUrl']) {
    if (result[field] === '[redacted]') delete result[field];
  }
  const website = `${path}.websiteUrl`;
  if (redactions.some(
    /**
     * Detect a website URL changed by sanitization.
     * @param {import('./types.js').Redaction} marker - Sanitized field marker.
     * @returns {boolean} Whether the website contained removed data.
     */
    function altered(marker) { return marker.path === website || marker.path.startsWith(`${website}.`); })) delete result.websiteUrl;
  if (result.icons) {
    result.icons = result.icons.filter(
      /**
       * Retain icon metadata only when its source URL was observed without removed data.
       * @param {import('@modelcontextprotocol/sdk/types.js').Icon} icon - Schema-validated icon.
       * @param {number} index - Icon position in the evidence.
       * @returns {boolean} Whether the public icon source is reusable.
       */
      function safe(icon, index) {
        const source = `${path}.icons.${index}.src`;
        return icon.src !== '[redacted]' && !redactions.some(
          /**
           * Detect an icon source changed by sanitization.
           * @param {import('./types.js').Redaction} marker - Sanitized field marker.
           * @returns {boolean} Whether the icon URL contained removed data.
           */
          function changed(marker) { return marker.path === source || marker.path.startsWith(`${source}.`); });
      });
    if (result.icons.length === 0) delete result.icons;
  }
  return result;
}

/**
 * Parse standard OAuth body representations before sanitizing them.
 * @param {unknown} value - JSON, form, or structured body.
 * @param {string} path - Evidence field path.
 * @param {import('./types.js').Redaction[]} redactions - Collected markers.
 * @returns {any} Sanitized body.
 */
function body(value, path, redactions) {
  if (value instanceof URLSearchParams) return structured(Object.fromEntries(value), path, redactions);
  if (typeof value !== 'string') return structured(value, path, redactions);
  try {
    return structured(JSON.parse(value), path, redactions);
  } catch {
    if (value.includes('=')) return structured(Object.fromEntries(new URLSearchParams(value)), path, redactions);
    return redact(path, 'body', redactions);
  }
}

/**
 * Sanitize an observation before any public snapshot is returned.
 * @param {import('./types.js').Observation} observation - Observed request, response, or RPC message.
 * @param {string[]} [allowed=[]] - Additional public identity headers.
 * @returns {import('./types.js').Evidence} Sanitized independent evidence.
 * @throws {LayerError} When observation fields are invalid.
 */
export function clean(observation, allowed = []) {
  const roles = ['client', 'browser', 'bridge', 'server'];
  if (!observation || !phases.includes(observation.phase) || !['downstream', 'upstream'].includes(observation.perspective)
    || (observation.method !== undefined && typeof observation.method !== 'string')
    || (observation.status !== undefined && (!Number.isInteger(observation.status) || observation.status < 100 || observation.status > 599))
    || (observation.provenance?.role !== undefined && !roles.includes(observation.provenance.role))) {
    throw new LayerError({ name: 'profiles', method: 'capture.observe', message: 'Observation must describe a supported phase and perspective with valid HTTP metadata.', code: 'ERR_PROFILES_OBSERVATION' });
  }
  /** @type {import('./types.js').Evidence} */
  const result = { phase: observation.phase, perspective: observation.perspective, headers: {}, redactions: [] };
  let headers;
  try {
    headers = new Headers(observation.headers);
  } catch {
    throw new LayerError({ name: 'profiles', method: 'capture.observe', message: 'Observation must describe a supported phase and perspective with valid HTTP metadata.', code: 'ERR_PROFILES_OBSERVATION' });
  }
  for (const [name, value] of headers) {
    if (reusable(name, allowed) || protocol.includes(name)) {
      result.headers[name] = value;
      continue;
    }
    result.headers[name] = redact(`headers.${name}`, name, result.redactions);
    if (name !== 'authorization') continue;
    const scheme = /^(Bearer|Basic)\s/i.exec(value)?.[1];
    const marker = result.redactions.at(-1);
    if (!scheme) continue;
    marker.scheme = scheme.toLowerCase() === 'basic' ? 'Basic' : 'Bearer';
    if (marker.scheme !== 'Basic') continue;
    try {
      const decoded = Buffer.from(value.slice(6).trim(), 'base64').toString('utf8');
      const index = decoded.indexOf(':');
      if (index >= 0) {
        const value = identifier(decodeURIComponent(decoded.slice(0, index)), 'headers.authorization.clientId', result.redactions);
        if (value !== '[redacted]') marker.clientId = value;
      }
    } catch {
      // Malformed Basic credentials still carry a classification, never their value.
    }
  }
  if (observation.url !== undefined) result.url = address(observation.url, 'url', result.redactions);
  if (observation.method !== undefined) result.method = observation.method.toUpperCase();
  if (observation.status !== undefined) result.status = observation.status;
  if (observation.message !== undefined) result.message = body(observation.message, 'message', result.redactions);
  if (observation.body !== undefined) result.body = body(observation.body, 'body', result.redactions);
  if (observation.provenance) {
    const provenance = observation.provenance;
    result.provenance = {};
    if (typeof provenance.source === 'string') result.provenance.source = provenance.source;
    if (provenance.role !== undefined) result.provenance.role = provenance.role;
    if (provenance.issuer !== undefined) result.provenance.issuer = address(provenance.issuer, 'provenance.issuer', result.redactions);
  }
  const previous = /** @type {{redactions?: import('./types.js').Redaction[]}} */ (observation).redactions;
  if (Array.isArray(previous)) {
    for (const marker of previous) {
      if (!marker || typeof marker.path !== 'string' || !/^(?:headers|body|message|url|provenance)\./.test(marker.path)
        || !['credential', 'session', 'oauth', 'identifier', 'unclassified'].includes(marker.kind)) continue;
      let current = result.redactions.find(
        /**
         * Find an existing redaction by field path.
         * @param {import('./types.js').Redaction} value - Current marker.
         * @returns {boolean} Whether the marker describes the same field.
         */
        function same(value) { return value.path === marker.path; });
      if (!current) {
        current = { path: marker.path, kind: marker.kind };
        result.redactions.push(current);
      }
      if (marker.path !== 'headers.authorization' || !['Basic', 'Bearer'].includes(marker.scheme)) continue;
      current.scheme = marker.scheme;
      if (marker.scheme === 'Basic' && typeof marker.clientId === 'string') {
        const value = identifier(marker.clientId, 'headers.authorization.clientId', result.redactions);
        if (value !== '[redacted]') current.clientId = value;
      }
    }
  }
  return result;
}
