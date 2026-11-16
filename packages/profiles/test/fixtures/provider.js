/**
 * In-memory OAuth provider implementing the official SDK storage contract.
 */
export class Provider {
  #information;
  #tokens;
  #verifier;
  #redirect;
  #metadata;

  /**
   * Create an isolated runtime OAuth credential store.
   * @param {import('@modelcontextprotocol/sdk/shared/auth.js').OAuthClientMetadata} [metadata] - Runtime client metadata.
   */
  constructor(metadata = { redirect_uris: ['http://127.0.0.1:43871/callback'] }) {
    this.#metadata = structuredClone(metadata);
  }

  /** @returns {string} Runtime callback URL. */
  get redirectUrl() { return this.#metadata.redirect_uris[0]; }

  /** @returns {import('@modelcontextprotocol/sdk/shared/auth.js').OAuthClientMetadata} Independent runtime metadata. */
  get clientMetadata() { return structuredClone(this.#metadata); }

  /** @returns {import('@modelcontextprotocol/sdk/shared/auth.js').OAuthClientInformationMixed | undefined} Current runtime registration. */
  clientInformation() { return this.#information ? structuredClone(this.#information) : undefined; }

  /**
   * Store current registration credentials in this session.
   * @param {import('@modelcontextprotocol/sdk/shared/auth.js').OAuthClientInformationMixed} information - Registration to store.
   * @returns {void} Updates the runtime credential store.
   */
  saveClientInformation(information) { this.#information = structuredClone(information); }

  /** @returns {import('@modelcontextprotocol/sdk/shared/auth.js').OAuthTokens | undefined} Current runtime tokens. */
  tokens() { return this.#tokens ? structuredClone(this.#tokens) : undefined; }

  /**
   * Store tokens issued for this runtime session.
   * @param {import('@modelcontextprotocol/sdk/shared/auth.js').OAuthTokens} tokens - New session tokens.
   * @returns {void} Updates the runtime token store.
   */
  saveTokens(tokens) { this.#tokens = structuredClone(tokens); }

  /**
   * Store the runtime redirect destination.
   * @param {URL} url - Authorization redirect.
   * @returns {void} Updates the most recent redirect.
   */
  redirectToAuthorization(url) { this.#redirect = new URL(url); }

  /**
   * Save the runtime PKCE verifier.
   * @param {string} verifier - Session-specific PKCE verifier.
   * @returns {void} Updates the verifier store.
   */
  saveCodeVerifier(verifier) { this.#verifier = verifier; }

  /** @returns {string} Runtime session verifier. */
  codeVerifier() { return this.#verifier; }

  /** @returns {string} Runtime session state. */
  state() { return 'runtime-state'; }

  /**
   * Return the runtime resource explicitly selected by the caller.
   * @param {string | URL} server - Connected MCP server URL.
   * @param {string} [resource] - Explicit runtime resource.
   * @returns {Promise<URL>} Selected resource.
   */
  async validateResourceURL(server, resource) { return new URL(resource ?? server); }

  /**
   * Remove runtime state using the official provider invalidation scopes.
   * @param {'all' | 'client' | 'tokens' | 'verifier' | 'discovery'} scope - State to invalidate.
   * @returns {void} Clears matching runtime storage.
   */
  invalidateCredentials(scope) {
    if (scope === 'all' || scope === 'client') this.#information = undefined;
    if (scope === 'all' || scope === 'tokens') this.#tokens = undefined;
    if (scope === 'all' || scope === 'verifier') this.#verifier = undefined;
  }

  /** @returns {URL | undefined} Most recent real authorization redirect. */
  get authorizationUrl() { return this.#redirect; }
}
