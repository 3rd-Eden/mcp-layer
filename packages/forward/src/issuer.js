import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { LayerError } from '@mcp-layer/error';
import {
  AccessDeniedError,
  InvalidClientMetadataError,
  InvalidGrantError,
  InvalidRequestError,
  InvalidScopeError,
  InvalidTargetError,
  InvalidTokenError,
} from '@modelcontextprotocol/sdk/server/auth/errors.js';

/** @typedef {import('@modelcontextprotocol/sdk/shared/auth.js').OAuthClientInformationFull} Client */
/** @typedef {import('@modelcontextprotocol/sdk/server/auth/provider.js').AuthorizationParams} Params */
/** @typedef {import('@modelcontextprotocol/sdk/shared/auth.js').OAuthTokens} Tokens */
/** @typedef {{clients: Record<string, Client>, consents: Record<string, any>, codes: Record<string, any>, grants: Record<string, any>, accesses: Record<string, any>, refreshes: Record<string, any>}} Records */

/**
 * @typedef {object} IssuerOptions
 * @property {string | URL} url Public authorization server URL.
 * @property {import('./authorize.js').Storage} storage Private application storage for every persisted issuer record.
 * @property {string | URL} [resource] Protected resource identifier; defaults to `/mcp` on the issuer origin.
 * @property {string[]} [scopes] Supported and default scopes; defaults to `['mcp']`.
 * @property {Client[]} [clients] Preconfigured clients in addition to persisted dynamic registrations.
 * @property {(input: {client: Client, params: Params}) => Promise<Record<string, unknown> | void>} [grant] Application authorization after explicit consent; returned JSON context appears in `AuthInfo.extra`.
 * @property {number} [accessTtl] Access token lifetime in seconds; defaults to 3600.
 * @property {number} [refreshTtl] Rotating refresh token lifetime in seconds; defaults to 2592000.
 * @property {number} [codeTtl] Authorization code and consent lifetime in seconds; defaults to 300.
 * @property {(event: Record<string, unknown>) => void | Promise<void>} [observe] Boundary observations containing metadata without credentials.
 */

/**
 * Hash credentials before using them as stored indices.
 * @param {string} value Credential or stable storage identity.
 * @returns {string} SHA-256 digest.
 */
function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * Create an unpredictable opaque credential.
 * @returns {string} Cryptographically random base64url value.
 */
function credential() {
  return randomBytes(32).toString('base64url');
}

/**
 * Convert SDK metadata to plain JSON while omitting optional undefined fields.
 * @param {any} value JSON-serializable metadata.
 * @returns {any} Detached JSON value.
 */
function json(value) {
  return JSON.parse(JSON.stringify(value));
}

/**
 * Escape text for HTML content and double-quoted attributes.
 * @param {string} value Plain text.
 * @returns {string} Escaped HTML.
 */
function escape(value) {
  return String(value).replace(/[&<>"']/g, /**
   * Encode one character in HTML text or an attribute.
   * @param {string} character Character requiring HTML escaping.
   * @returns {string} Corresponding HTML entity.
   */
  function entity(character) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character];
  });
}

/**
 * Remove expired credentials and grants with no remaining live credentials.
 * @param {Records} records Persisted issuer records held under the storage lease.
 * @returns {void}
 */
function purge(records) {
  const now = Date.now() / 1000;
  for (const kind of ['consents', 'codes', 'accesses', 'refreshes']) {
    for (const [key, record] of Object.entries(records[kind])) {
      if (record.expiresAt <= now) delete records[kind][key];
    }
  }
  const active = new Set();
  for (const record of [...Object.values(records.accesses), ...Object.values(records.refreshes)]) active.add(record.grant);
  for (const id of Object.keys(records.grants)) {
    if (!active.has(id)) delete records.grants[id];
  }
}

/**
 * Create an SDK OAuthServerProvider with explicit local consent and opaque tokens.
 * @param {IssuerOptions} options Issuer identity, application authorization and injected storage.
 * @returns {import('@modelcontextprotocol/sdk/server/auth/provider.js').OAuthServerProvider & {url: string, resource: string, scopes: string[]}} Provider for `mcpAuthRouter` and `requireBearerAuth`.
 * @throws {LayerError} Invalid issuer options. Protocol methods throw SDK OAuth errors carrying LayerError metadata; storage and grant failures retain their original cause.
 */
export function issuer(options) {
  let url;
  let resource;
  try {
    url = new URL(options?.url);
    resource = new URL(options.resource ?? new URL('/mcp', url));
  } catch (cause) {
    throw new LayerError({
      name: 'forward', method: 'issuer', code: 'EFORWARD_ISSUER_URL',
      message: 'Issuer and resource must be valid HTTP URLs without fragments or an issuer query.', cause,
    });
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.hash || url.search ||
      !['http:', 'https:'].includes(resource.protocol) || resource.hash) {
    throw new LayerError({
      name: 'forward', method: 'issuer', code: 'EFORWARD_ISSUER_URL',
      message: 'Issuer and resource must be valid HTTP URLs without fragments or an issuer query.',
    });
  }
  const storage = options.storage;
  if (['get', 'set', 'delete', 'lock'].some(/**
   * Check a required operation on the injected storage instance.
   * @param {string} method Required asynchronous storage operation.
   * @returns {boolean} Whether the operation is missing.
   */
  function absent(method) { return typeof storage?.[method] !== 'function'; })) {
    throw new LayerError({
      name: 'forward', method: 'issuer', code: 'EFORWARD_ISSUER_STORAGE',
      message: 'Issuer requires an injected cli-storage instance.',
    });
  }
  const supported = options.scopes ?? ['mcp'];
  const clients = options.clients ?? [];
  const accessTtl = options.accessTtl ?? 3600;
  const refreshTtl = options.refreshTtl ?? 2592000;
  const codeTtl = options.codeTtl ?? 300;
  if (!Array.isArray(supported) || supported.some(/**
   * Reject an empty, non-string, or whitespace-containing OAuth scope.
   * @param {unknown} scope Configured scope candidate.
   * @returns {boolean} Whether the scope is invalid.
   */
  function invalid(scope) { return typeof scope !== 'string' || scope.length === 0 || /\s/.test(scope); }) ||
      [accessTtl, refreshTtl, codeTtl].some(/**
       * Reject a nonpositive or nonfinite credential lifetime.
       * @param {number} ttl Configured lifetime in seconds.
       * @returns {boolean} Whether the lifetime is invalid.
       */
      function invalid(ttl) { return !Number.isFinite(ttl) || ttl <= 0; })) {
    throw new LayerError({
      name: 'forward', method: 'issuer', code: 'EFORWARD_ISSUER_OPTIONS',
      message: 'Issuer scopes must be nonempty scope tokens and lifetimes must be positive seconds.',
    });
  }
  const scopes = [...new Set(supported)];
  const key = `forward:issuer:${digest(`${url.href}\0${resource.href}`)}`;

  /**
   * Run an atomic application-state transaction using the injected storage lease.
   * @template T
   * @param {(records: Records) => Promise<T> | T} work Application record operation.
   * @returns {Promise<T>} Operation result after durable persistence.
   */
  async function transaction(work) {
    return storage.lock(key, /**
     * Read, prune, update, and persist issuer records under the bound lease.
     * @param {import('./authorize.js').Lease} lease Exclusive issuer record lease.
     * @returns {Promise<T>} Application operation result after persistence.
     */
    async function held(lease) {
      const records = await lease.get() ?? { clients: {}, consents: {}, codes: {}, grants: {}, accesses: {}, refreshes: {} };
      purge(records);
      const result = await work(records);
      await lease.set(records);
      return result;
    });
  }

  /**
   * Report a credential-free application boundary observation.
   * @param {string} phase Canonical OAuth/MCP phase.
   * @param {string} operation Issuer method or consent operation.
   * @param {Record<string, unknown>} [metadata] Safe boundary metadata.
   * @returns {Promise<void>}
   */
  async function observe(phase, operation, metadata = {}) {
    await options.observe?.({
      phase, operation, perspective: 'downstream',
      role: phase === 'authorization' ? 'browser' : 'client', ...metadata,
    });
  }

  /**
   * Resolve a configured or dynamically registered client.
   * @param {string} id Standard OAuth client identifier.
   * @returns {Promise<Client | undefined>} Detached client information, or absence.
   */
  async function getClient(id) {
    const configured = clients.find(/**
     * Match a configured OAuth client identifier.
     * @param {Client} client Configured client information.
     * @returns {boolean} Whether its identifier matches the requested client.
     */
    function matching(client) { return client.client_id === id; });
    if (configured) return json(configured);
    return transaction(/**
     * Read a dynamically registered client from leased issuer records.
     * @param {Records} records Issuer records protected by the lease.
     * @returns {Client | undefined} Matching client registration or absence.
     */
    function read(records) { return records.clients[digest(id)]; });
  }

  /**
   * Persist SDK-validated dynamic client metadata and credentials.
   * @param {Omit<Client, 'client_id' | 'client_id_issued_at'> & Partial<Pick<Client, 'client_id' | 'client_id_issued_at'>>} client SDK registration result.
   * @returns {Promise<Client>} Persisted registration, preserving the SDK's generated identity.
   */
  async function registerClient(client) {
    const registered = json({ ...client, client_id: client.client_id ?? randomUUID(), client_id_issued_at: client.client_id_issued_at ?? Math.floor(Date.now() / 1000) });
    await transaction(/**
     * Store a new registration while refusing identifier replacement.
     * @param {Records} records Issuer records protected by the lease.
     * @returns {void} Adds the validated registration.
     */
    function write(records) {
      if (Object.hasOwn(records.clients, digest(registered.client_id)) ||
          clients.some(/**
           * Check whether a registration identifier is already configured.
           * @param {Client} configured Preregistered client information.
           * @returns {boolean} Whether the identifier is already assigned.
           */
          function matching(configured) { return configured.client_id === registered.client_id; })) {
        const cause = new LayerError({
          name: 'forward', method: 'registerClient', code: 'invalid_client_metadata',
          message: 'The client identifier is already registered.',
        });
        throw Object.assign(new InvalidClientMetadataError(cause.message.split('\n')[0], cause.docs), cause, { cause });
      }
      records.clients[digest(registered.client_id)] = registered;
    });
    await observe('registration', 'issuer.register', { clientId: registered.client_id });
    return registered;
  }

  /**
   * Validate application scope and resource policy for an SDK authorization request.
   * @param {Params} params SDK-validated authorization parameters.
   * @returns {Params & {resource: URL, scopes: string[]}} Parameters with application defaults.
   */
  function policy(params) {
    const requested = params.scopes?.length > 0 ? [...new Set(params.scopes)] : [...scopes];
    if (requested.some(/**
     * Compare a requested scope with the supported issuer scope set.
     * @param {string} scope Requested OAuth scope.
     * @returns {boolean} Whether the issuer does not support it.
     */
    function unsupported(scope) { return !scopes.includes(scope); })) {
      const cause = new LayerError({
        name: 'forward', method: 'authorize', code: 'invalid_scope',
        message: 'The requested scopes are not supported by this issuer.',
      });
      throw Object.assign(new InvalidScopeError(cause.message.split('\n')[0], cause.docs), cause, { cause });
    }
    const target = params.resource ?? resource;
    if (target.href !== resource.href) {
      const cause = new LayerError({
        name: 'forward', method: 'authorize', code: 'invalid_target',
        message: 'The requested resource does not match this issuer resource.',
      });
      throw Object.assign(new InvalidTargetError(cause.message.split('\n')[0], cause.docs), cause, { cause });
    }
    return { ...params, scopes: requested, resource: new URL(target) };
  }

  /**
   * Display consent, or consume the exact SDK-validated request approved by its owner.
   * @param {Client} client Registered client validated by the SDK.
   * @param {Params} params Authorization request validated by the SDK.
   * @param {import('express').Response} res Authorization HTTP response with its parsed request.
   * @returns {Promise<void>} Sends a consent page or authorization redirect.
   */
  async function authorize(client, params, res) {
    const approved = policy(params);
    const snapshot = json({ clientId: client.client_id, ...approved, resource: approved.resource.href });
    const submitted = res.req.method === 'POST' ? res.req.body?.consent : undefined;
    if (typeof submitted !== 'string') {
      const consent = credential();
      await transaction(/**
       * Persist a short-lived consent request before showing its form.
       * @param {Records} records Issuer records protected by the lease.
       * @returns {void} Adds the pending consent binding.
       */
      function pending(records) {
        records.consents[digest(consent)] = { params: snapshot, expiresAt: Date.now() / 1000 + codeTtl };
      });
      const fields = {
        response_type: 'code', client_id: client.client_id,
        redirect_uri: approved.redirectUri, code_challenge: approved.codeChallenge,
        code_challenge_method: 'S256', scope: approved.scopes.join(' '),
        resource: approved.resource.href,
        ...(approved.state !== undefined ? { state: approved.state } : {}),
        consent,
      };
      const inputs = Object.entries(fields).map(/**
       * Render one escaped consent-form field.
       * @param {[string, string]} entry Field name and value.
       * @returns {string} Escaped hidden input markup.
       */
      function hidden([name, value]) {
        return `<input type="hidden" name="${escape(name)}" value="${escape(value)}">`;
      }).join('\n');
      const display = approved.scopes.length > 0 ? approved.scopes.join(' ') : '(none)';
      res.set({
        'Cache-Control': 'no-store',
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
        'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'no-referrer',
      });
      res.status(200).type('html').send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Authorize MCP access</title>
<style>body{font:16px system-ui,sans-serif;max-width:42rem;margin:8vh auto;padding:1.5rem;line-height:1.6}button{font:inherit;padding:.6rem 1.2rem;margin-right:.5rem}code{overflow-wrap:anywhere}</style></head>
<body><h1>Authorize MCP access</h1><p><strong>${escape(client.client_name ?? client.client_id)}</strong> requests access to this MCP resource.</p>
<p>Resource: <code>${escape(approved.resource.href)}</code></p><p>Scopes: <code>${escape(display)}</code></p>
<p>After authorization, this client can use your connected upstream access. Continue only if you recognize this client.</p>
<p>Redirect: <code>${escape(approved.redirectUri)}</code></p><form method="post" action="/authorize">${inputs}
<button type="submit" name="decision" value="allow">Authorize</button><button type="submit" name="decision" value="deny">Deny</button></form></body></html>`);
      await observe('authorization', 'issuer.consent', { clientId: client.client_id, scopes: approved.scopes, resource: resource.href, status: 'pending' });
      return;
    }
    const decision = res.req.body?.decision;
    await transaction(/**
     * Validate and consume a single-use consent submission.
     * @param {Records} records Issuer records protected by the lease.
     * @returns {void} Removes the matched consent request.
     */
    function confirm(records) {
      const record = records.consents[digest(submitted)];
      if (!record || JSON.stringify(record.params) !== JSON.stringify(snapshot) || !['allow', 'deny'].includes(decision)) {
        const cause = new LayerError({
          name: 'forward', method: 'authorize', code: 'invalid_request',
          message: 'Consent is invalid, expired, already used or does not match this authorization request.',
        });
        throw Object.assign(new InvalidRequestError(cause.message.split('\n')[0], cause.docs), cause, { cause });
      }
      delete records.consents[digest(submitted)];
    });
    if (decision === 'deny') {
      const cause = new LayerError({
        name: 'forward', method: 'authorize', code: 'access_denied',
        message: 'The resource owner denied this authorization request.',
      });
      throw Object.assign(new AccessDeniedError(cause.message.split('\n')[0], cause.docs), cause, { cause });
    }
    // Interactive upstream authorization may outlive a storage lease, so it runs after consent is consumed and before the code transaction.
    const extra = await options.grant?.({ client, params: approved }) ?? {};
    const code = credential();
    await transaction(/**
     * Persist a single-use authorization code after consent and application approval.
     * @param {Records} records Issuer records protected by the lease.
     * @returns {void} Adds the bound code and expiration.
     */
    function issued(records) {
      records.codes[digest(code)] = { ...snapshot, extra: json(extra), expiresAt: Date.now() / 1000 + codeTtl };
    });
    const target = new URL(approved.redirectUri);
    target.searchParams.set('code', code);
    if (approved.state !== undefined) target.searchParams.set('state', approved.state);
    res.redirect(302, target.href);
    await observe('authorization', 'issuer.authorize', { clientId: client.client_id, scopes: approved.scopes, resource: resource.href, status: 'granted' });
  }

  /**
   * Read a bound code's S256 challenge for the SDK's own PKCE validation.
   * @param {Client} client Authenticated registered client.
   * @param {string} code Opaque authorization code.
   * @returns {Promise<string>} Original PKCE code challenge.
   */
  async function challengeForAuthorizationCode(client, code) {
    return transaction(/**
     * Resolve a live authorization code challenge for its authenticated client.
     * @param {Records} records Issuer records protected by the lease.
     * @returns {string} Original S256 challenge.
     */
    function challenge(records) {
      const record = records.codes[digest(code)];
      if (!record || record.clientId !== client.client_id) {
        const cause = new LayerError({
          name: 'forward', method: 'challengeForAuthorizationCode', code: 'invalid_grant',
          message: 'Authorization code is invalid, expired, already used or issued to another client.',
        });
        throw Object.assign(new InvalidGrantError(cause.message.split('\n')[0], cause.docs), cause, { cause });
      }
      return record.codeChallenge;
    });
  }

  /**
   * Persist one access credential and its rotating refresh credential under a grant.
   * @param {Records} records Application state held under a storage lease.
   * @param {string} id Grant identifier.
   * @param {string[]} allowed Scopes for this credential pair.
   * @returns {Tokens} Opaque OAuth bearer credentials.
   */
  function tokens(records, id, allowed) {
    const access = credential();
    const refresh = credential();
    const now = Date.now() / 1000;
    records.accesses[digest(access)] = { grant: id, scopes: allowed, expiresAt: now + accessTtl };
    records.refreshes[digest(refresh)] = { grant: id, scopes: allowed, expiresAt: now + refreshTtl };
    return { access_token: access, refresh_token: refresh, token_type: 'Bearer', expires_in: accessTtl, scope: allowed.join(' ') };
  }

  /**
   * Atomically redeem a single-use authorization code after SDK PKCE validation.
   * @param {Client} client Authenticated registered client.
   * @param {string} code Opaque authorization code.
   * @param {string} [codeVerifier] Unused because the SDK performs local PKCE validation.
   * @param {string} [redirectUri] Redirect URI bound to the original request.
   * @param {URL} [target] Requested resource, defaulting to the issuer resource.
   * @returns {Promise<Tokens>} Access and refresh credentials.
   */
  async function exchangeAuthorizationCode(client, code, codeVerifier, redirectUri, target) {
    const result = await transaction(/**
     * Consume a bound authorization code and issue a credential pair.
     * @param {Records} records Issuer records protected by the lease.
     * @returns {Tokens} Fresh access and refresh credentials.
     */
    function exchange(records) {
      const record = records.codes[digest(code)];
      if (!record || record.clientId !== client.client_id || record.redirectUri !== redirectUri || record.resource !== (target ?? resource).href) {
        const cause = new LayerError({
          name: 'forward', method: 'exchangeAuthorizationCode', code: 'invalid_grant',
          message: 'Authorization code is invalid, expired, already used or does not match its client, redirect or resource.',
        });
        throw Object.assign(new InvalidGrantError(cause.message.split('\n')[0], cause.docs), cause, { cause });
      }
      const id = randomUUID();
      records.grants[id] = { clientId: record.clientId, resource: record.resource, extra: record.extra };
      delete records.codes[digest(code)];
      return tokens(records, id, record.scopes);
    });
    await observe('token', 'issuer.exchange', { clientId: client.client_id, resource: resource.href, scopes: result.scope.split(' ') });
    return result;
  }

  /**
   * Atomically rotate a refresh credential without expanding its resource or scope.
   * @param {Client} client Authenticated registered client.
   * @param {string} token Opaque refresh credential.
   * @param {string[]} [requested] Requested subset of the current refresh scopes.
   * @param {URL} [target] Requested resource, defaulting to the issuer resource.
   * @returns {Promise<Tokens>} Replacement access and refresh credentials.
   */
  async function exchangeRefreshToken(client, token, requested, target) {
    const result = await transaction(/**
     * Redeem a valid rotating refresh token without expanding its grant.
     * @param {Records} records Issuer records protected by the lease.
     * @returns {Tokens} Replacement access and refresh credentials.
     */
    function refresh(records) {
      const record = records.refreshes[digest(token)];
      const grant = record ? records.grants[record.grant] : undefined;
      if (!grant || grant.clientId !== client.client_id || grant.resource !== (target ?? resource).href) {
        const cause = new LayerError({
          name: 'forward', method: 'exchangeRefreshToken', code: 'invalid_grant',
          message: 'Refresh token is invalid, expired, revoked, already used or does not match its client or resource.',
        });
        throw Object.assign(new InvalidGrantError(cause.message.split('\n')[0], cause.docs), cause, { cause });
      }
      const allowed = requested ?? record.scopes;
      if (allowed.some(/**
       * Check a refresh scope against the previously granted scope set.
       * @param {string} scope Requested refresh scope.
       * @returns {boolean} Whether it would expand the grant.
       */
      function expanded(scope) { return !record.scopes.includes(scope); })) {
        const cause = new LayerError({
          name: 'forward', method: 'exchangeRefreshToken', code: 'invalid_scope',
          message: 'Refresh scopes must be a subset of the previously granted scopes.',
        });
        throw Object.assign(new InvalidScopeError(cause.message.split('\n')[0], cause.docs), cause, { cause });
      }
      delete records.refreshes[digest(token)];
      return tokens(records, record.grant, [...new Set(allowed)]);
    });
    await observe('refresh', 'issuer.refresh', { clientId: client.client_id, resource: resource.href, scopes: result.scope.split(' ') });
    return result;
  }

  /**
   * Verify a live opaque access credential and return its grant context.
   * @param {string} token Bearer access credential.
   * @returns {Promise<import('@modelcontextprotocol/sdk/server/auth/types.js').AuthInfo>} Validated bearer information with expiration, exact resource and auxiliary grant context.
   */
  async function verifyAccessToken(token) {
    const result = await transaction(/**
     * Resolve a live access credential and its bound grant.
     * @param {Records} records Issuer records protected by the lease.
     * @returns {import('@modelcontextprotocol/sdk/server/auth/types.js').AuthInfo} Validated access information.
     */
    function verify(records) {
      const record = records.accesses[digest(token)];
      const grant = record ? records.grants[record.grant] : undefined;
      if (!grant) {
        const cause = new LayerError({
          name: 'forward', method: 'verifyAccessToken', code: 'invalid_token',
          message: 'Access token is invalid, expired or revoked.',
        });
        throw Object.assign(new InvalidTokenError(cause.message.split('\n')[0], cause.docs), cause, { cause });
      }
      return { token, clientId: grant.clientId, scopes: record.scopes, expiresAt: record.expiresAt, resource: new URL(grant.resource), extra: grant.extra };
    });
    await observe('mcp', 'issuer.verify', { clientId: result.clientId, resource: resource.href, scopes: result.scopes });
    return result;
  }

  /**
   * Revoke the complete grant associated with this client's access or refresh token.
   * @param {Client} client Authenticated registered client.
   * @param {import('@modelcontextprotocol/sdk/shared/auth.js').OAuthTokenRevocationRequest} request Standard OAuth revocation request; unknown tokens are ignored.
   * @returns {Promise<void>} Completes after the grant and all related credentials are removed.
   */
  async function revokeToken(client, request) {
    await transaction(/**
     * Remove the grant and credentials associated with a revocation request.
     * @param {Records} records Issuer records protected by the lease.
     * @returns {void} Revokes the matching grant or ignores an unknown token.
     */
    function revoke(records) {
      const record = records.accesses[digest(request.token)] ?? records.refreshes[digest(request.token)];
      const grant = record ? records.grants[record.grant] : undefined;
      if (!grant || grant.clientId !== client.client_id) return;
      delete records.grants[record.grant];
      for (const kind of ['accesses', 'refreshes']) {
        for (const [id, credential] of Object.entries(records[kind])) {
          if (credential.grant === record.grant) delete records[kind][id];
        }
      }
    });
    await observe('revocation', 'issuer.revoke', { clientId: client.client_id });
  }

  return {
    url: url.href, resource: resource.href, scopes: [...scopes],
    clientsStore: { getClient, registerClient }, authorize,
    challengeForAuthorizationCode, exchangeAuthorizationCode, exchangeRefreshToken,
    verifyAccessToken, revokeToken,
  };
}
