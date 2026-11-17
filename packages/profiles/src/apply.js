import { LayerError } from '@mcp-layer/error';
import { redirectUriMatches } from '@modelcontextprotocol/sdk/server/auth/handlers/authorize.js';
import { get, validate } from './profile.js';

/**
 * Decorate public provider metadata while retaining the runtime credential store.
 * @param {import('@modelcontextprotocol/sdk/client/auth.js').OAuthClientProvider} provider - Runtime OAuth provider.
 * @param {import('./types.js').Profile} profile - Validated profile.
 * @param {string | undefined} issuer - Explicit authorization server issuer.
 * @returns {import('@modelcontextprotocol/sdk/client/auth.js').OAuthClientProvider} Delegating SDK provider.
 */
function decorate(provider, profile, issuer) {
  const registrations = profile.oauth.clients.filter(
    /**
     * Select registrations for the explicitly requested issuer.
     * @param {import('./types.js').Registration} value - Observed public registration.
     * @returns {boolean} Whether the issuer matches.
     */
    function registered(value) { return value.issuer === issuer; });
  const registration = registrations.length === 1 ? registrations[0] : undefined;
  /**
   * Return runtime registration first, with an explicitly issuer-bound public fallback.
   * @returns {Promise<import('@modelcontextprotocol/sdk/shared/auth.js').OAuthClientInformationMixed | undefined>} Runtime credentials or public registration.
   */
  async function information() {
    const runtime = await provider.clientInformation();
    if (runtime !== undefined) return runtime;
    if (!registration) return undefined;
    const redirect = provider.redirectUrl === undefined ? undefined : String(provider.redirectUrl);
    if (registration.redirectUris?.length && (!redirect || !registration.redirectUris.some(
      /**
       * Check the provider callback using the SDK's RFC 8252 matcher.
       * @param {string} value - Captured public callback URI.
       * @returns {boolean} Whether the callback is registered or loopback-port compatible.
       */
      function matches(value) { return redirectUriMatches(redirect, value); }))) {
      throw new LayerError({ name: 'profiles', method: 'apply', message: 'Captured OAuth registration constraints do not match the runtime provider callback or authentication method. Configure a compatible runtime provider or register it with the issuer.', code: 'ERR_PROFILES_REGISTRATION' });
    }
    const runtimeMethod = provider.clientMetadata.token_endpoint_auth_method;
    if (registration.authMethod && registration.authMethod !== 'none' && runtimeMethod !== registration.authMethod
      && typeof provider.addClientAuthentication !== 'function') {
      throw new LayerError({ name: 'profiles', method: 'apply', message: 'Captured OAuth registration constraints do not match the runtime provider callback or authentication method. Configure a compatible runtime provider or register it with the issuer.', code: 'ERR_PROFILES_REGISTRATION' });
    }
    return {
      client_id: registration.clientId,
      issuer: registration.issuer,
      ...(registration.redirectUris ? { redirect_uris: registration.redirectUris } : {}),
      ...(registration.authMethod ? { token_endpoint_auth_method: registration.authMethod } : {}),
    };
  }
  /**
   * Resolve provider properties while binding every delegated method to its original store.
   * @param {object} target - Decorator shell.
   * @param {string | symbol} key - Accessed property.
   * @returns {any} Metadata override or bound runtime property.
   */
  function property(target, key) {
    if (key === 'clientMetadata') return { ...profile.oauth.metadata, ...provider.clientMetadata };
    if (key === 'clientInformation') return information;
    const value = Reflect.get(provider, key, provider);
    return typeof value === 'function' ? value.bind(provider) : value;
  }
  // A separate shell permits public defaults even when the original provider is frozen.
  return new Proxy(Object.create(provider), { get: property });
}

/**
 * Select an OAuth request phase from URL and already-materialized request data.
 * @param {RequestInfo | URL} resource - Fetch URL or Request.
 * @param {RequestInit | undefined} init - Fetch options whose body may be inspected without consumption.
 * @returns {import('./types.js').Phase | undefined} Recognized OAuth phase, if any.
 */
function phase(resource, init) {
  let url;
  try { url = new URL(resource instanceof Request ? resource.url : String(resource)); } catch { return undefined; }
  if (/(?:^|\/)\.well-known\/(?:oauth-authorization-server|oauth-protected-resource)(?:\/.*)?$/.test(url.pathname)
    || url.pathname.endsWith('/.well-known/openid-configuration')) return 'discovery';
  if (typeof init?.body === 'string') {
    let value;
    try { value = JSON.parse(init.body); } catch { value = undefined; }
    if (Array.isArray(value?.redirect_uris)) return 'registration';
  }
  let form;
  if (init?.body instanceof URLSearchParams) form = init.body;
  if (typeof init?.body === 'string') form = new URLSearchParams(init.body);
  const grant = form?.get('grant_type');
  if (grant === 'refresh_token') return 'refresh';
  if (grant) return 'token';
  if (form?.has('token')) return 'revocation';
  return undefined;
}

/**
 * Compose the profile's default HTTP identity with an observed phase override.
 * @param {import('./types.js').Profile} profile - Validated evidence-backed profile.
 * @param {import('./types.js').Phase | undefined} selected - Selected request phase.
 * @param {boolean} enabled - Whether profile HTTP defaults are enabled.
 * @returns {Headers} New merged profile headers.
 */
function profileHeaders(profile, selected, enabled) {
  const hasPhase = Boolean(selected && Object.hasOwn(profile.http.phases ?? {}, selected));
  const values = hasPhase ? profile.http.phases[selected] : profile.http.headers;
  return new Headers(enabled ? values : undefined);
}

/**
 * Apply profile identity to standards-compliant SDK or fetch options.
 * @param {import('./types.js').Profile | string} input - Evidence-backed profile or bundled verified ID.
 * @param {import('./types.js').ApplyOptions} [options={}] - Runtime overrides, selected parts, phase, provider, and issuer.
 * @returns {import('./types.js').Applied} Composable HTTP headers, MCP clientInfo, fetch, and optional OAuth provider.
 * @throws {LayerError} When the profile, runtime options, or selected parts are invalid.
 */
export function apply(input, options = {}) {
  const profile = typeof input === 'string' ? get(input) : validate(input);
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new LayerError({ name: 'profiles', method: 'apply', message: 'Apply options must use supported parts and valid runtime HTTP and OAuth values.', code: 'ERR_PROFILES_OPTIONS' });
  }
  const parts = options.parts ?? ['http', 'mcp', 'oauth'];
  if (!Array.isArray(parts) || parts.some(
    /**
     * Reject unsupported profile parts.
     * @param {string} value - Requested part.
     * @returns {boolean} Whether the part is unsupported.
     */
    function invalid(value) { return !['http', 'mcp', 'oauth'].includes(value); })
    || (options.fetch !== undefined && typeof options.fetch !== 'function')
    || (options.phase !== undefined && !['discovery', 'registration', 'authorization', 'token', 'refresh', 'revocation', 'mcp'].includes(options.phase))
    || (options.authProvider !== undefined && (typeof options.authProvider?.clientInformation !== 'function' || !options.authProvider?.clientMetadata))
    || (options.issuer !== undefined && typeof options.issuer !== 'string')
    || (options.info !== undefined && (!options.info || typeof options.info !== 'object' || Array.isArray(options.info)
      || (options.info.name !== undefined && (typeof options.info.name !== 'string' || !options.info.name.trim()))
      || (options.info.version !== undefined && (typeof options.info.version !== 'string' || !options.info.version.trim()))))) {
    throw new LayerError({ name: 'profiles', method: 'apply', message: 'Apply options must use supported parts and valid runtime HTTP and OAuth values.', code: 'ERR_PROFILES_OPTIONS' });
  }
  let headers;
  try {
    headers = profileHeaders(profile, options.phase, parts.includes('http'));
    const overrides = new Headers(options.headers);
    for (const [name, value] of overrides) headers.set(name, value);
  } catch {
    throw new LayerError({ name: 'profiles', method: 'apply', message: 'Apply options must use supported parts and valid runtime HTTP and OAuth values.', code: 'ERR_PROFILES_OPTIONS' });
  }
  const initialHeaders = new Headers(headers);
  const base = options.fetch ?? globalThis.fetch;
  /**
   * Apply identity defaults without consuming bodies, responses, or SDK-owned headers.
   * @param {RequestInfo | URL} resource - Fetch URL or Request.
   * @param {RequestInit} [init] - Per-request fetch options, which take precedence over defaults.
   * @returns {Promise<Response>} Original fetch response, including its untouched streaming body.
   */
  async function request(resource, init) {
    const selected = phase(resource, init) ?? options.phase;
    const merged = profileHeaders(profile, selected, parts.includes('http'));
    for (const [name, value] of new Headers(options.headers)) merged.set(name, value);
    for (const [name, value] of initialHeaders) {
      const current = headers.get(name);
      if (current === null) merged.delete(name);
      else if (current !== value) merged.set(name, current);
    }
    for (const [name, value] of headers) {
      if (!initialHeaders.has(name)) merged.set(name, value);
    }
    if (resource instanceof Request) {
      for (const [name, value] of resource.headers) merged.set(name, value);
    }
    for (const [name, value] of new Headers(init?.headers)) merged.set(name, value);
    return base(resource, { ...init, headers: merged });
  }
  const info = parts.includes('mcp') ? { ...profile.mcp.clientInfo, ...options.info } : options.info;
  if (info !== undefined && (typeof info.name !== 'string' || !info.name.trim() || typeof info.version !== 'string' || !info.version.trim())) {
    throw new LayerError({ name: 'profiles', method: 'apply', message: 'Apply options must use supported parts and valid runtime HTTP and OAuth values.', code: 'ERR_PROFILES_OPTIONS' });
  }
  const provider = options.authProvider;
  return {
    headers,
    info,
    fetch: request,
    authProvider: provider && parts.includes('oauth') ? decorate(provider, profile, options.issuer) : provider,
  };
}
