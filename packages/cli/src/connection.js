import { Storage } from 'cli-storage';
import open from 'open';
import { authorize } from '@mcp-layer/forward';
import { apply } from '@mcp-layer/profiles';
import { connect } from '@mcp-layer/connect';
import { profile as load } from './artifact.js';

/**
 * @typedef {import('./argv.js').GlobalOptions & {open?:(url:URL)=>Promise<void>,signal?:AbortSignal,info?:{name?:string,version?:string},requestInit?:RequestInit,fetch?:typeof fetch,stderr?:'pipe'|'inherit'|'overlapped'}} ConnectionOptions
 */

/**
 * Construct the application-owned storage adapter without creating records.
 * @param {ConnectionOptions} options CLI runtime storage settings.
 * @returns {Storage} Lazy cli-storage instance; all OAuth business keys remain owned by forward.
 */
export function storage(options) {
  return new Storage({ namespace: 'mcp-layer', directory: options.storageDir, backend: options.storageBackend ?? 'auto' });
}

/**
 * Open the SDK authorization URL using the ecosystem browser launcher.
 * @param {URL} url SDK-generated authorization URL.
 * @returns {Promise<void>} Completion after the browser has been launched.
 */
async function launch(url) { await open(url.href); }

/**
 * Compose public profile defaults and an optional persistent SDK OAuth provider.
 * @param {ConnectionOptions} options Runtime identity, OAuth and storage settings.
 * @param {string | undefined} target Upstream MCP URL, absent for stdio servers.
 * @param {{interactive?:boolean,oauth?:boolean}} [mode={}] Disable authorization for passive general help, or require it for a forwarding gateway.
 * @returns {Promise<{headers:Headers,info:any,fetch:typeof fetch,authProvider:any,authorization:Parameters<typeof authorize>[0]|undefined,issuer?:string,storage:Storage|undefined,close:()=>Promise<void>}>} Settings and uncredentialed provider construction options shared by CLI connection paths and gateway commands.
 */
export async function settings(options, target, mode = {}) {
  const profile = await load(options.profile);
  const parts = options.parts ?? ['http', 'mcp', 'oauth'];
  const defaults = profile
    ? apply(profile, { parts, headers: options.requestInit?.headers, info: options.info, fetch: options.fetch })
    : { headers: new Headers(options.requestInit?.headers), info: options.info, fetch: options.fetch ?? globalThis.fetch };
  const identity = profile && parts.includes('oauth') ? profile.oauth : undefined;
  const requested = [options.clientId, options.issuer, options.scope, options.resource].some(Boolean);
  const observed = Boolean(identity?.clients.length) || Object.keys(identity?.metadata ?? {}).length > 0;
  let enabled = mode.oauth ?? options.oauth ?? (requested || observed);
  const implicit = mode.oauth === undefined && options.oauth === undefined && !requested && observed;
  if (enabled && implicit && target && mode.interactive !== false) {
    const response = await defaults.fetch(target, { method: 'GET', signal: options.signal });
    enabled = response.status === 401;
    await response.body?.cancel();
  }
  let provider;
  let authorization;
  let store;
  let issuer = options.issuer;
  /** @returns {Promise<void>} Close the currently owned OAuth callback listener. */
  async function close() { await provider?.close(); }
  if (enabled && target && mode.interactive !== false) {
    store = storage(options);
    const oauth = {
      target,
      storage: store,
      issuer,
      scope: options.scope,
      resource: options.resource,
      callbackPort: options.callbackPort,
      redirectUrl: options.redirectUrl,
      authTimeout: options.authTimeout,
      clientMetadata: identity?.metadata,
      clientInformation: options.clientId ? { client_id: options.clientId, ...(issuer ? { issuer } : {}) } : undefined,
      open: options.open ?? launch,
      fetch: defaults.fetch,
      signal: options.signal,
    };
    authorization = oauth;
    provider = authorize(authorization);
    try {
      if (!options.clientId && identity?.clients.length) {
        issuer ??= String((await provider.discover()).state.authorizationServerUrl);
        /**
         * Match public registration to its discovered issuer.
         * @param {import('@mcp-layer/profiles').Registration} value Observed public registration.
         * @returns {boolean} Whether the issuer URLs are equivalent.
         */
        function registered(value) { return new URL(value.issuer).href === new URL(issuer).href; }
        const clients = identity.clients.filter(registered);
        if (clients.length === 1) {
          await provider.close();
          const registration = clients[0];
          authorization = {
            ...oauth,
            issuer,
            clientInformation: {
              client_id: registration.clientId,
              issuer,
              ...(registration.redirectUris ? { redirect_uris: registration.redirectUris } : {}),
              ...(registration.authMethod ? { token_endpoint_auth_method: registration.authMethod } : {}),
            },
          };
          provider = authorize(authorization);
        }
      }
    } catch (cause) {
      await close();
      throw cause;
    }
  }
  const applied = profile
    ? apply(profile, {
      parts,
      headers: options.requestInit?.headers,
      info: options.info,
      fetch: provider?.fetch ?? defaults.fetch,
      authProvider: provider,
      issuer,
    })
    : { ...defaults, fetch: provider?.fetch ?? defaults.fetch, authProvider: provider };
  return { ...applied, authorization, issuer, storage: store, close };
}

/**
 * Connect with identical settings for catalog, detailed help and general help.
 * @param {{config:import('@mcp-layer/config').Config,name:string}} selected Resolved MCP server.
 * @param {ConnectionOptions} options CLI runtime settings.
 * @param {{interactive?:boolean}} [mode={}] Whether this path may initiate login.
 * @returns {Promise<import('@mcp-layer/session').Session>} Session retaining the actual SDK client and transport; close also cleans OAuth callbacks.
 */
export async function connection(selected, options, mode = {}) {
  const item = selected.config.get(selected.name);
  const target = typeof item?.config?.url === 'string'
    ? item.config.url
    : typeof item?.config?.endpoint === 'string' ? item.config.endpoint : undefined;
  const applied = await settings(options, target, mode);
  let session;
  try {
    // Interactive consent uses its own deadline before the SDK initialization timer starts.
    await applied.authProvider?.access();
    session = await connect(selected.config, selected.name, {
      transport: options.transport,
      timeout: options.timeout,
      stderr: options.stderr,
      info: applied.info,
      requestInit: { ...options.requestInit, headers: applied.headers },
      fetch: applied.fetch,
      authProvider: applied.authProvider,
    });
  } catch (cause) {
    await applied.close();
    throw cause;
  }
  const original = session.close.bind(session);
  /** @returns {Promise<void>} Close the real session and then every authorization listener. */
  async function close() {
    try { await original(); } finally { await applied.close(); }
  }
  session.close = close;
  return session;
}
