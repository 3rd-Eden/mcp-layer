import { Session } from '@mcp-layer/session';
import { LayerError } from '@mcp-layer/error';

/**
 * @typedef {'optional' | 'required' | 'disabled'} AuthMode
 */

/**
 * @typedef {'bearer' | 'basic' | 'raw'} AuthScheme
 */

/**
 * @typedef {{ mode: AuthMode, header: string, scheme: AuthScheme }} AuthConfig
 */

/**
 * @typedef {{ key: string, auth: { scheme: AuthScheme, token: string, header: string } | null, shared: boolean }} Identity
 */

/**
 * @typedef {{ identity: Identity, request: import('fastify').FastifyRequest }} SessionContext
 */

/**
 * @typedef {{ session: Session, createdAt: number, usedAt: number }} Entry
 */

/**
 * @typedef {{ max: number, ttl: number, sharedKey: string, auth: AuthConfig, factory: (ctx: SessionContext) => Promise<Session>, now: () => number, identify?: (request: import('fastify').FastifyRequest) => string | { key: string, auth?: { scheme?: AuthScheme, token?: string, header?: string }, shared?: boolean } }} Options
 */

const DEFAULTS = {
  max: 10,
  ttl: 300000,
  sharedKey: 'shared',
  auth: {
    mode: 'optional',
    header: 'authorization',
    scheme: 'bearer'
  }
};

/**
 * Normalize auth options.
 * @param {Partial<AuthConfig> | undefined} input - Auth overrides.
 * @returns {AuthConfig}
 */
function authConfig(input) {
  const mode = input && typeof input.mode === 'string' ? input.mode : DEFAULTS.auth.mode;
  const header = input && typeof input.header === 'string' ? input.header : DEFAULTS.auth.header;
  const scheme = input && typeof input.scheme === 'string' ? input.scheme : DEFAULTS.auth.scheme;
  return { mode, header: header.toLowerCase(), scheme };
}

/**
 * Normalize options with defaults.
 * @param {Partial<Options> & { factory: Options['factory'] }} input - User options.
 * @returns {Options}
 */
function normalize(input) {
  if (!input || typeof input !== 'object') {
    throw new LayerError({ name: 'manager', method: 'normalize', message: 'Session manager options are required.' });
  }
  if (typeof input.factory !== 'function') {
    throw new LayerError({ name: 'manager', method: 'normalize', message: 'Session manager requires a factory function.' });
  }

  const max = typeof input.max === 'number' ? input.max : DEFAULTS.max;
  const ttl = typeof input.ttl === 'number' ? input.ttl : DEFAULTS.ttl;
  const sharedKey = typeof input.sharedKey === 'string' ? input.sharedKey : DEFAULTS.sharedKey;
  const auth = authConfig(input.auth);
  const now = typeof input.now === 'function' ? input.now : Date.now;

  if (!Number.isFinite(max) || max <= 0) throw new LayerError({ name: 'manager', method: 'normalize', message: 'max must be a positive number.', meta: { value: max } });
  if (!Number.isFinite(ttl) || ttl <= 0) throw new LayerError({ name: 'manager', method: 'normalize', message: 'ttl must be a positive number.', meta: { value: ttl } });

  return {
    max,
    ttl,
    sharedKey,
    auth,
    factory: input.factory,
    now,
    identify: typeof input.identify === 'function' ? input.identify : undefined
  };
}

/**
 * Read a request header in a case-insensitive way.
 * @param {import('fastify').FastifyRequest} request - Fastify request.
 * @param {string} name - Header name to read.
 * @returns {string | undefined}
 */
function header(request, name) {
  if (!request || !request.headers) return undefined;
  const raw = request.headers[name] ?? request.headers[name.toLowerCase()];
  if (Array.isArray(raw)) return raw.join(',');
  if (typeof raw === 'string') return raw;
  return undefined;
}

/**
 * Parse a bearer header.
 * @param {string} value - Header value.
 * @returns {string}
 */
function bearer(value) {
  const match = value.match(/^Bearer\s+(.+)$/i);
  if (!match) throw new LayerError({ name: 'manager', method: 'identity', message: 'Authorization header must use Bearer scheme.' });
  return match[1];
}

/**
 * Parse a basic header.
 * @param {string} value - Header value.
 * @returns {string}
 */
function basic(value) {
  const match = value.match(/^Basic\s+(.+)$/i);
  if (!match) throw new LayerError({ name: 'manager', method: 'identity', message: 'Authorization header must use Basic scheme.' });
  return match[1];
}

/**
 * Resolve an identity from a request.
 * @param {import('fastify').FastifyRequest} request - Fastify request.
 * @param {Options} cfg - Normalized options.
 * @returns {Identity}
 */
function identity(request, cfg) {
  if (cfg.identify) {
    const res = cfg.identify(request);
    if (typeof res === 'string') {
      return { key: res, auth: null, shared: false };
    }
    if (res && typeof res === 'object' && typeof res.key === 'string') {
      const auth = res.auth?.token ? { scheme: res.auth.scheme ?? 'raw', token: res.auth.token, header: res.auth.header ?? '' } : null;
      return { key: res.key, auth, shared: Boolean(res.shared) };
    }
    throw new LayerError({ name: 'manager', method: 'identity', message: 'identify() must return a string or { key, auth } object.' });
  }

  if (cfg.auth.mode === 'disabled') {
    return { key: cfg.sharedKey, auth: null, shared: true };
  }

  const raw = header(request, cfg.auth.header);
  if (!raw) {
    if (cfg.auth.mode === 'required') throw new LayerError({ name: 'manager', method: 'identity', message: 'Authorization header is required.' });
    return { key: cfg.sharedKey, auth: null, shared: true };
  }

  if (cfg.auth.scheme === 'raw') {
    return { key: `raw:${raw}`, auth: { scheme: 'raw', token: raw, header: raw }, shared: false };
  }

  if (cfg.auth.scheme === 'basic') {
    const token = basic(raw);
    return { key: `basic:${token}`, auth: { scheme: 'basic', token, header: raw }, shared: false };
  }

  const token = bearer(raw);
  return { key: `bearer:${token}`, auth: { scheme: 'bearer', token, header: raw }, shared: false };
}

/**
 * Create a session manager with LRU and TTL eviction.
 * @param {Partial<Options> & { factory: Options['factory'] }} input - Manager options.
 * @returns {{ get: (request: import('fastify').FastifyRequest) => Promise<Session>, stats: () => { size: number, max: number, ttl: number, evictions: number, hits: number, misses: number, keys: string[] }, close: () => Promise<void> }}
 */
export function createManager(input) {
  const cfg = normalize(input);
  const entries = new Map();
  const pending = new Map();
  let hits = 0;
  let misses = 0;
  let evictions = 0;

  /**
   * Check whether an entry is expired.
   * @param {Entry} entry - Session entry.
   * @returns {boolean}
   */
  function expired(entry) {
    return cfg.now() - entry.usedAt > cfg.ttl;
  }

  /**
   * Move an entry to the end of the LRU map.
   * @param {string} key - Entry key.
   * @param {Entry} entry - Entry value.
   * @returns {void}
   */
  function touch(key, entry) {
    entry.usedAt = cfg.now();
    entries.delete(key);
    entries.set(key, entry);
  }

  /**
   * Evict the least recently used entry.
   * @returns {Promise<void>}
   */
  async function evict() {
    const first = entries.keys().next();
    if (first.done) return;
    const key = first.value;
    const entry = entries.get(key);
    entries.delete(key);
    if (entry) {
      evictions += 1;
      await entry.session.close();
    }
  }

  /**
   * Resolve or create a session for a request.
   * @param {import('fastify').FastifyRequest} request - Fastify request.
   * @returns {Promise<Session>}
   */
  async function get(request) {
    const ident = identity(request, cfg);
    const key = ident.key;

    const existing = entries.get(key);
    if (existing && !expired(existing)) {
      hits += 1;
      touch(key, existing);
      return existing.session;
    }

    if (existing) {
      entries.delete(key);
      await existing.session.close();
    }

    const inflight = pending.get(key);
    if (inflight) {
      hits += 1;
      // Deduplicate concurrent requests for the same identity to avoid
      // creating multiple sessions for the same key.
      return inflight;
    }

    misses += 1;

    const promise = createSession();
    pending.set(key, promise);

    try {
      const session = await promise;
      const entry = { session, createdAt: cfg.now(), usedAt: cfg.now() };
      entries.set(key, entry);
      // Enforce a hard upper bound so manager memory and upstream connections
      // stay predictable under load.
      while (entries.size > cfg.max) {
        await evict();
      }
      return session;
    } finally {
      pending.delete(key);
    }

    /**
     * Create a session via factory.
     * @returns {Promise<Session>}
     */
    async function createSession() {
      const ctx = { identity: ident, request };
      const session = await cfg.factory(ctx);
      if (!(session instanceof Session)) throw new LayerError({ name: 'manager', method: 'get', message: 'factory must return a Session instance.' });
      return session;
    }
  }

  /**
   * Close all tracked sessions.
   * @returns {Promise<void>}
   */
  async function close() {
    const list = Array.from(entries.values());
    entries.clear();
    pending.clear();
    for (const entry of list) {
      await entry.session.close();
    }
  }

  /**
   * Return session manager stats.
   * @returns {{ size: number, max: number, ttl: number, evictions: number, hits: number, misses: number, keys: string[] }}
   */
  function stats() {
    return {
      size: entries.size,
      max: cfg.max,
      ttl: cfg.ttl,
      evictions,
      hits,
      misses,
      keys: Array.from(entries.keys())
    };
  }

  return { get, stats, close };
}
