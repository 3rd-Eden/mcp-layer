import argh from 'argh';
import open from 'open';
import { Storage } from 'cli-storage';
import { apply, derive, list } from './index.js';
import { load, read, write } from './artifact.js';
import { listen } from './listen.js';
import { LayerError } from '@mcp-layer/error';

/**
 * Execute the standalone profile utility or embed its command runner.
 * @param {string[]} argv Arguments excluding the Node executable and script path.
 * @param {{open?:(url:URL)=>Promise<void>}} [options={}] Browser opener override for the application's OAuth flow.
 * @returns {Promise<void>} Completion after an offline command or hosted listener closes.
 * @throws {LayerError} For invalid profile commands, artifacts, or capture settings.
 */
export async function run(argv, options = {}) {
  const parsed = argh(argv);
  const positional = Array.isArray(parsed.argv) ? parsed.argv : [];
  const [action = 'help', target] = positional;
  if (Boolean(parsed.help) || action === 'help') {
    process.stdout.write('mcp-layer-profiles list [--format json]\nmcp-layer-profiles show <profile-id|profile.json> [--format json]\nmcp-layer-profiles build <capture.json> --output <profile.json>\nmcp-layer-profiles capture --output <capture.json> [--transport http|sse|stdio] [--oauth] [--upstream <url>]\n');
    return;
  }
  if (action === 'list') {
    const profiles = list();
    if (parsed.format === 'json') process.stdout.write(`${JSON.stringify(profiles, null, 2)}\n`);
    else process.stdout.write(`Profile\tClient\tVersion\n${profiles.map(
      /** @param {import('./types.js').Profile} profile Bundled verified profile. @returns {string} One compact profile row. */
      function row(profile) { return `${profile.id}\t${profile.client.name}\t${profile.client.version}`; }).join('\n')}\n`);
    return;
  }
  if (action === 'show') {
    if (!target) throw new LayerError({ name: 'profiles', method: 'run', code: 'ERR_PROFILES_INPUT', message: 'Provide a profile ID or JSON path.' });
    const profile = await load(target);
    if (parsed.format === 'json') process.stdout.write(`${JSON.stringify(profile, null, 2)}\n`);
    else process.stdout.write(`Field\tValue\nProfile\t${profile.id}\nClient\t${profile.client.name}\nVersion\t${profile.client.version}\nPhases\t${profile.coverage.phases.join(', ')}\nPerspectives\t${profile.coverage.perspectives.join(', ')}\nObservations\t${profile.coverage.observations}\n`);
    return;
  }
  if (action === 'build') {
    const output = text(parsed.output);
    if (!target || !output) throw new LayerError({ name: 'profiles', method: 'run', code: 'ERR_PROFILES_INPUT', message: 'Provide a capture JSON path and --output <profile.json>.' });
    await write(output, derive(await read(target)));
    return;
  }
  if (action !== 'capture') throw new LayerError({ name: 'profiles', method: 'run', code: 'ERR_PROFILES_COMMAND', message: 'Unknown profiles command "{command}".', vars: { command: action } });
  await capture(parsed, options);
}

/** @param {unknown} value Parsed option. @returns {string|undefined} A string flag value. */
function text(value) { return typeof value === 'string' ? value : undefined; }

/**
 * Detect a client authentication method that requires runtime credentials.
 * @param {string|undefined} method Active OAuth client authentication method.
 * @returns {boolean} Whether the method requires a confidential client secret.
 */
function confidential(method) {
  return method !== undefined && method !== 'none';
}

/**
 * Start the capture lifecycle selected by CLI flags and wait for shutdown.
 * @param {Record<string, unknown>} parsed Parsed command options.
 * @param {{open?:(url:URL)=>Promise<void>}} options Browser opener override.
 * @returns {Promise<void>} Completion after all listeners close.
 */
async function capture(parsed, options) {
  const output = text(parsed.output);
  if (!output) throw new LayerError({ name: 'profiles', method: 'run', code: 'ERR_PROFILES_INPUT', message: 'Provide --output <capture.json> for the capture artifact.' });
  const upstream = text(parsed.upstream);
  const profile = await load(text(parsed.profile));
  const parts = text(parsed['profile-parts'])?.split(',').map(trimmed) ?? ['http', 'mcp', 'oauth'];
  const identity = profile ? apply(profile, { parts }) : undefined;
  const oauthIdentity = profile && parts.includes('oauth') ? profile.oauth : undefined;
  const oauth = Boolean(parsed.oauth);
  const issuer = text(parsed.issuer);
  const clientId = text(parsed['client-id']);
  const matchingRegistrations = oauthIdentity?.clients.filter(
    /** @param {import('./types.js').Registration} registration Captured issuer-bound registration. @returns {boolean} Whether it matches the active issuer and optional caller ID. */
    function matches(registration) { return sameIssuer(registration.issuer, issuer) && (!clientId || registration.clientId === clientId); }) ?? [];
  const selectedRegistration = matchingRegistrations.length === 1 ? matchingRegistrations[0] : undefined;
  const clientMetadata = { ...oauthIdentity?.metadata };
  if (selectedRegistration?.authMethod) clientMetadata.token_endpoint_auth_method = selectedRegistration.authMethod;
  else if (clientId && !selectedRegistration) delete clientMetadata.token_endpoint_auth_method;
  const authMethod = selectedRegistration?.authMethod ?? clientMetadata.token_endpoint_auth_method;
  if (upstream && oauth && confidential(authMethod)) {
    throw new LayerError({ name: 'profiles', method: 'run', code: 'ERR_PROFILES_OAUTH_CREDENTIALS', message: 'The standalone profile runner cannot use confidential OAuth client bindings without runtime credentials.' });
  }
  const storage = oauth ? new Storage({ namespace: 'profiles-capture', directory: text(parsed['storage-dir']), backend: text(parsed['storage-backend']) }) : undefined;
  const clientName = text(parsed['client-name']);
  const clientVersion = text(parsed['client-version']);
  const client = clientName !== undefined || clientVersion !== undefined ? { name: clientName, version: clientVersion } : undefined;
  const authorization = { clientMetadata };
  if (clientId) {
    authorization.clientInformation = {
      client_id: clientId,
      ...(issuer ? { issuer } : {}),
      ...(selectedRegistration?.clientId === clientId ? registrationConstraints(selectedRegistration) : {}),
    };
  } else if (selectedRegistration) {
    authorization.clientInformation = registrationInfo(selectedRegistration);
  }
  if (issuer) authorization.issuer = issuer;
  if (text(parsed.scope)) authorization.scope = text(parsed.scope);
  if (text(parsed.resource)) authorization.resource = text(parsed.resource);
  if (text(parsed['callback-url'])) authorization.redirectUrl = text(parsed['callback-url']);
  if (parsed['callback-port'] !== undefined) authorization.callbackPort = Number(parsed['callback-port']);
  if (parsed['auth-timeout'] !== undefined) authorization.authTimeout = Number(parsed['auth-timeout']);
  authorization.open = options.open ?? launch;
  const runtime = await listen({
    output,
    transport: text(parsed.transport),
    host: text(parsed.host),
    port: parsed.port === undefined ? undefined : Number(parsed.port),
    baseUrl: text(parsed['base-url']),
    client,
    allowHeaders: text(parsed['allow-headers'])?.split(',').map(trimmed),
    upstream,
    oauth: oauth ? (text(parsed.scope) && !upstream ? { scopes: text(parsed.scope).split(/\s+/).filter(Boolean) } : true) : false,
    storage,
    authorization,
    headers: identity?.headers,
    info: identity?.info,
    fetch: identity?.fetch,
  });
  let failed;
  /** @param {unknown} cause Shutdown failure. @returns {void} Retain failure for the runner. */
  function reject(cause) { failed = cause; }
  /** @returns {void} Close the listener on a process signal. */
  function stop() { void runtime.close().catch(reject); }
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  if (!runtime.url) process.stdin.once('end', stop);
  if (runtime.url) process.stderr.write(`${runtime.url}\n`);
  try {
    await runtime.closed;
    if (failed) throw failed;
  } finally {
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
    process.stdin.removeListener('end', stop);
  }
}

/**
 * Build SDK registration data without inventing or crossing issuer/client bindings.
 * @param {import('./types.js').Registration} registration Captured issuer-bound registration.
 * @returns {object} Matching captured redirect and authentication constraints, or no captured constraints.
 */
function registrationConstraints(registration) {
  return {
    ...(registration.redirectUris ? { redirect_uris: registration.redirectUris } : {}),
    ...(registration.authMethod ? { token_endpoint_auth_method: registration.authMethod } : {}),
  };
}

/**
 * Convert a verified public registration to the SDK provider's supported registration shape.
 * @param {import('./types.js').Registration} registration Captured issuer-bound registration.
 * @returns {{client_id:string,issuer:string,redirect_uris?:string[],token_endpoint_auth_method?:string}} SDK client information.
 */
function registrationInfo(registration) {
  return {
    client_id: registration.clientId,
    issuer: registration.issuer,
    ...registrationConstraints(registration),
  };
}

/**
 * Match URL-equivalent issuer identifiers without crossing issuer paths.
 * @param {string} captured Captured authorization server issuer.
 * @param {string|undefined} active Caller-selected authorization server issuer.
 * @returns {boolean} Whether both values normalize to the same URL.
 */
function sameIssuer(captured, active) {
  if (active === undefined) return false;
  if (captured === active) return true;
  try {
    return new URL(captured).href === new URL(active).href;
  } catch {
    return false;
  }
}

/**
 * Adapt the URL-based SDK authorization callback to the existing open package's string input.
 * @param {URL} url SDK-generated authorization destination.
 * @returns {Promise<void>} Completion after the URL is handed to the operating system.
 */
async function launch(url) { await open(url.href); }

/** @param {string} value Header flag entry. @returns {string} Header name without surrounding whitespace. */
function trimmed(value) { return value.trim(); }
