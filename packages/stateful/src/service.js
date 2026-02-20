import { createConnection, createServer } from 'node:net';
import { chmod, readFile, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { load } from '@mcp-layer/config';
import { connect } from '@mcp-layer/connect';
import { extract } from '@mcp-layer/schema';
import { LayerError } from '@mcp-layer/error';
import { endpoint } from './path.js';
import {
  appendEvent,
  clearServiceMeta,
  ensureRoot,
  hash,
  loadSessionsMeta,
  normalizeError,
  saveServiceMeta,
  saveSessionsMeta
} from './store.js';

const DEFAULTS = {
  idleTimeoutMs: 1800000,
  maxAgeMs: 28800000,
  sweepIntervalMs: 60000,
  maxSessions: 32,
  persistIntervalMs: 250,
  eventLogMaxBytes: 1024 * 1024,
  eventLogMaxFiles: 3,
  maxFrameBytes: 1024 * 1024,
  socketTimeoutMs: 30000,
  maxConnections: 64
};

/**
 * Check whether a value is a plain object.
 * @param {unknown} value - Value to inspect.
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

/**
 * Resolve configuration loading behavior for a path override.
 * @param {string | undefined} file - Optional config path.
 * @returns {Promise<import('@mcp-layer/config').Config>}
 */
async function config(file) {
  if (!file) return load(undefined, process.cwd());

  try {
    const info = await stat(file);
    if (info.isFile()) {
      const raw = await readFile(file, 'utf8');
      const doc = JSON.parse(raw);
      return load(doc, { start: file });
    }
  } catch {
    // Fall back to discovery search.
  }

  return load(undefined, file);
}

/**
 * Resolve a server from loaded configuration.
 * @param {import('@mcp-layer/config').Config} cfg - Loaded config.
 * @param {string | undefined} name - Optional server name.
 * @returns {{ config: import('@mcp-layer/config').Config, name: string }}
 */
function server(cfg, name) {
  if (name && cfg.get(name)) return { config: cfg, name };

  const list = Array.from(cfg.map.keys());
  if (!name && list.length === 1) {
    return { config: cfg, name: list[0] };
  }

  if (!name) {
    throw new LayerError({
      name: 'stateful',
      method: 'open',
      message: 'Multiple servers found. Provide --server <name>.',
      code: 'SESSION_SERVER_REQUIRED'
    });
  }

  throw new LayerError({
    name: 'stateful',
    method: 'open',
    message: 'Server "{server}" was not found.',
    vars: { server: name },
    code: 'SESSION_SERVER_NOT_FOUND'
  });
}

/**
 * Select the least recently used active entry id.
 * @param {Map<string, Record<string, unknown>>} entries - Entry map.
 * @returns {string | null}
 */
function oldest(entries) {
  let pick = null;

  for (const [id, entry] of entries.entries()) {
    if (entry.status !== 'active') continue;
    if (!pick || Number(entry.lastActiveAt) < Number(pick.lastActiveAt)) {
      pick = { id, lastActiveAt: entry.lastActiveAt };
    }
  }

  return pick ? pick.id : null;
}

/**
 * Derive a short transport label from a session transport instance.
 * @param {import('@mcp-layer/session').Session} session - Connected session.
 * @returns {string}
 */
function transport(session) {
  const name = String(session.transport?.constructor?.name ?? '').toLowerCase();
  if (name.includes('stdio')) return 'stdio';
  if (name.includes('sse')) return 'sse';
  if (name.includes('http')) return 'streamable-http';
  return 'unknown';
}

/**
 * Create a stable metadata snapshot from runtime entry state.
 * @param {Record<string, unknown>} entry - Internal entry.
 * @returns {Record<string, unknown>}
 */
function snapshot(entry) {
  return {
    id: entry.id,
    serverName: entry.serverName,
    transport: entry.transport,
    configHash: entry.configHash,
    createdAt: entry.createdAt,
    lastActiveAt: entry.lastActiveAt,
    expiresAt: entry.expiresAt,
    maxAgeAt: entry.maxAgeAt,
    status: entry.status,
    closeReason: entry.closeReason ?? null
  };
}

/**
 * Create a stateful service instance.
 * @param {{ idleTimeoutMs?: number, maxAgeMs?: number, sweepIntervalMs?: number, maxSessions?: number, persistIntervalMs?: number, eventLogMaxBytes?: number, eventLogMaxFiles?: number, maxFrameBytes?: number, socketTimeoutMs?: number, maxConnections?: number }} [input] - Service configuration.
 * @returns {Promise<{ listen: () => Promise<void>, close: () => Promise<void>, open: (params: Record<string, unknown>) => Promise<Record<string, unknown>>, execute: (params: Record<string, unknown>) => Promise<Record<string, unknown>>, catalog: (params: Record<string, unknown>) => Promise<Record<string, unknown>>, list: () => Promise<Array<Record<string, unknown>>>, stop: (params: Record<string, unknown>) => Promise<Record<string, unknown>>, stopAll: () => Promise<Record<string, unknown>>, ping: () => Record<string, unknown> }>}
 */
export async function createService(input = {}) {
  await ensureRoot();

  const cfg = {
    idleTimeoutMs: typeof input.idleTimeoutMs === 'number' && input.idleTimeoutMs > 0 ? input.idleTimeoutMs : DEFAULTS.idleTimeoutMs,
    maxAgeMs: typeof input.maxAgeMs === 'number' && input.maxAgeMs > 0 ? input.maxAgeMs : DEFAULTS.maxAgeMs,
    sweepIntervalMs: typeof input.sweepIntervalMs === 'number' && input.sweepIntervalMs > 0 ? input.sweepIntervalMs : DEFAULTS.sweepIntervalMs,
    maxSessions: typeof input.maxSessions === 'number' && input.maxSessions > 0 ? input.maxSessions : DEFAULTS.maxSessions,
    persistIntervalMs: typeof input.persistIntervalMs === 'number' && input.persistIntervalMs >= 0 ? input.persistIntervalMs : DEFAULTS.persistIntervalMs,
    eventLogMaxBytes: typeof input.eventLogMaxBytes === 'number' && input.eventLogMaxBytes > 0 ? input.eventLogMaxBytes : DEFAULTS.eventLogMaxBytes,
    eventLogMaxFiles: typeof input.eventLogMaxFiles === 'number' && input.eventLogMaxFiles >= 0 ? Math.floor(input.eventLogMaxFiles) : DEFAULTS.eventLogMaxFiles,
    maxFrameBytes: typeof input.maxFrameBytes === 'number' && input.maxFrameBytes > 0 ? input.maxFrameBytes : DEFAULTS.maxFrameBytes,
    socketTimeoutMs: typeof input.socketTimeoutMs === 'number' && input.socketTimeoutMs > 0 ? input.socketTimeoutMs : DEFAULTS.socketTimeoutMs,
    maxConnections: typeof input.maxConnections === 'number' && input.maxConnections > 0 ? input.maxConnections : DEFAULTS.maxConnections
  };

  const persisted = await loadSessionsMeta();
  const entries = new Map();
  let activeCount = 0;
  let lastPersistAt = 0;

  for (const meta of persisted) {
    if (!isRecord(meta) || typeof meta.id !== 'string') continue;
    const status = meta.status === 'active' ? 'orphaned' : meta.status;
    entries.set(meta.id, { ...meta, status });
    if (status === 'active') activeCount += 1;
  }

  await persist(true);

  let listener;
  let timer;
  let secret = '';
  let started = false;

  /**
   * Persist snapshots for all entries.
   * @param {boolean} [force] - Force persistence even when throttled.
   * @returns {Promise<void>}
   */
  async function persist(force = false) {
    const now = Date.now();
    if (!force && cfg.persistIntervalMs > 0 && now - lastPersistAt < cfg.persistIntervalMs) return;

    const list = Array.from(entries.values()).map(function mapEntry(item) {
      return snapshot(item);
    });

    await saveSessionsMeta(list);
    lastPersistAt = Date.now();
  }

  /**
   * Persist a lifecycle event with configured rotation controls.
   * @param {{ type: string, data?: Record<string, unknown> }} entry - Event payload.
   * @returns {Promise<void>}
   */
  async function log(entry) {
    await appendEvent(entry, {
      maxBytes: cfg.eventLogMaxBytes,
      maxFiles: cfg.eventLogMaxFiles
    });
  }

  /**
   * Determine whether an entry has passed timeout limits.
   * @param {Record<string, unknown>} entry - Session entry.
   * @returns {'expired_idle' | 'expired_max_age' | null}
   */
  function expired(entry) {
    const now = Date.now();
    if (now > Number(entry.maxAgeAt)) return 'expired_max_age';
    if (now > Number(entry.expiresAt)) return 'expired_idle';
    return null;
  }

  /**
   * Close a runtime session entry.
   * @param {string} id - Entry id.
   * @param {string} reason - Close reason.
   * @param {{ persist?: boolean, force?: boolean }} [input] - Close behavior overrides.
   * @returns {Promise<void>}
   */
  async function closeEntry(id, reason, input = {}) {
    const entry = entries.get(id);
    if (!entry) return;
    const wasActive = entry.status === 'active';

    if (entry.session && typeof entry.session.close === 'function') {
      try {
        await entry.session.close();
      } catch {
        // Best effort close.
      }
    }

    entry.session = null;
    entry.catalog = null;
    entry.status = reason;
    entry.closeReason = reason;
    entry.lastActiveAt = Date.now();
    if (wasActive) activeCount = Math.max(0, activeCount - 1);
    await log({ type: 'session.closed', data: { id, reason } });
    if (input.persist === false) return;
    await persist(Boolean(input.force));
  }

  /**
   * Sweep entries for timeout expiry.
   * @returns {Promise<void>}
   */
  async function sweep() {
    const closing = [];

    for (const [id, entry] of entries.entries()) {
      if (entry.status !== 'active') continue;
      const reason = expired(entry);
      if (!reason) continue;
      closing.push(closeEntry(id, reason, { persist: false }));
    }

    if (closing.length === 0) return;
    await Promise.all(closing);
    await persist(true);
  }

  /**
   * Build an expiration error for a session.
   * @param {'expired_idle' | 'expired_max_age'} reason - Expiration reason.
   * @param {string} id - Session id.
   * @returns {LayerError}
   */
  function expiredError(reason, id) {
    if (reason === 'expired_idle') {
      return new LayerError({
        name: 'stateful',
        method: 'active',
        message: 'Session "{session}" expired due to inactivity.',
        vars: { session: id },
        code: 'SESSION_EXPIRED_IDLE'
      });
    }

    return new LayerError({
      name: 'stateful',
      method: 'active',
      message: 'Session "{session}" expired due to max age policy.',
      vars: { session: id },
      code: 'SESSION_EXPIRED_MAX_AGE'
    });
  }

  /**
   * Ensure a session entry is active and not expired.
   * @param {string} id - Session id.
   * @returns {Promise<Record<string, unknown>>}
   */
  async function active(id) {
    const entry = entries.get(id);

    if (!entry) {
      throw new LayerError({
        name: 'stateful',
        method: 'active',
        message: 'Session "{session}" was not found.',
        vars: { session: id },
        code: 'SESSION_NOT_FOUND'
      });
    }

    if (entry.status === 'orphaned') {
      throw new LayerError({
        name: 'stateful',
        method: 'active',
        message: 'Session "{session}" is orphaned and cannot be resumed.',
        vars: { session: id },
        code: 'SESSION_ORPHANED'
      });
    }

    if (entry.status === 'expired_idle') {
      throw expiredError('expired_idle', id);
    }

    if (entry.status === 'expired_max_age') {
      throw expiredError('expired_max_age', id);
    }

    if (entry.status !== 'active' || !entry.session) {
      throw new LayerError({
        name: 'stateful',
        method: 'active',
        message: 'Session "{session}" is not active.',
        vars: { session: id },
        code: 'SESSION_NOT_FOUND'
      });
    }

    const reason = expired(entry);
    if (!reason) return entry;

    await closeEntry(id, reason, { force: true });
    throw expiredError(reason, id);
  }

  /**
   * Invoke an MCP method on a connected session.
   * @param {import('@mcp-layer/session').Session} session - Connected session.
   * @param {string} method - MCP method.
   * @param {Record<string, unknown>} params - MCP params.
   * @returns {Promise<unknown>}
   */
  async function invoke(session, method, params) {
    if (method === 'tools/call') return session.client.callTool(params);
    if (method === 'prompts/get') return session.client.getPrompt(params);
    if (method === 'resources/read') return session.client.readResource(params);
    return session.client.request({ method, params });
  }

  /**
   * Open or reuse a stateful session.
   * @param {Record<string, unknown>} params - Open params.
   * @returns {Promise<Record<string, unknown>>}
   */
  async function open(params) {
    const provided = typeof params.name === 'string' && params.name.length > 0 ? params.name : undefined;
    const id = provided ?? randomUUID();

    const existing = entries.get(id);
    if (existing && existing.status === 'active' && existing.session) {
      const reason = expired(existing);
      if (reason) {
        await closeEntry(id, reason, { persist: false });
      } else {
        existing.lastActiveAt = Date.now();
        existing.expiresAt = existing.lastActiveAt + cfg.idleTimeoutMs;
        await persist();
        return { id, generated: !provided, reused: true, server: existing.serverName };
      }
    }

    if (existing && existing.status === 'orphaned') {
      throw new LayerError({
        name: 'stateful',
        method: 'open',
        message: 'Session "{session}" is orphaned and cannot be resumed.',
        vars: { session: id },
        code: 'SESSION_ORPHANED'
      });
    }

    let evicted = false;

    while (activeCount >= cfg.maxSessions) {
      const victim = oldest(entries);
      if (!victim) break;
      evicted = true;
      await closeEntry(victim, 'evicted_lru', { persist: false });
    }

    if (evicted) await persist(true);

    const loaded = await config(typeof params.config === 'string' ? params.config : undefined);
    const pick = server(loaded, typeof params.server === 'string' ? params.server : undefined);
    const session = await connect(pick.config, pick.name, {
      transport: typeof params.transport === 'string' ? params.transport : undefined,
      stderr: 'pipe'
    });
    const catalog = await extract(session);

    const now = Date.now();
    entries.set(id, {
      id,
      serverName: pick.name,
      transport: transport(session),
      configHash: hash(session.entry?.config ?? {}),
      createdAt: now,
      lastActiveAt: now,
      expiresAt: now + cfg.idleTimeoutMs,
      maxAgeAt: now + cfg.maxAgeMs,
      status: 'active',
      closeReason: null,
      session,
      catalog
    });
    activeCount += 1;

    await log({ type: 'session.opened', data: { id, server: pick.name } });
    await persist(true);

    return { id, generated: !provided, reused: false, server: pick.name };
  }

  /**
   * Return session catalog metadata.
   * @param {Record<string, unknown>} params - Session params.
   * @returns {Promise<Record<string, unknown>>}
   */
  async function catalog(params) {
    const id = typeof params.name === 'string' ? params.name : '';
    const entry = await active(id);

    entry.lastActiveAt = Date.now();
    entry.expiresAt = entry.lastActiveAt + cfg.idleTimeoutMs;
    await persist();

    return isRecord(entry.catalog) ? entry.catalog : { server: {}, items: [] };
  }

  /**
   * List tracked sessions.
   * @returns {Promise<Array<Record<string, unknown>>>}
   */
  async function list() {
    await sweep();
    return Array.from(entries.values()).map(function mapEntry(item) {
      return snapshot(item);
    });
  }

  /**
   * Stop one session by id.
   * @param {Record<string, unknown>} params - Stop params.
   * @returns {Promise<Record<string, unknown>>}
   */
  async function stop(params) {
    const id = typeof params.name === 'string' ? params.name : '';
    if (!id) {
      throw new LayerError({
        name: 'stateful',
        method: 'stop',
        message: 'Session name is required for stop.',
        code: 'SESSION_NOT_FOUND'
      });
    }

    const entry = entries.get(id);
    if (!entry) {
      throw new LayerError({
        name: 'stateful',
        method: 'stop',
        message: 'Session "{session}" was not found.',
        vars: { session: id },
        code: 'SESSION_NOT_FOUND'
      });
    }

    await closeEntry(id, 'stopped', { force: true });
    return { stopped: true, id };
  }

  /**
   * Stop all active sessions.
   * @returns {Promise<Record<string, unknown>>}
   */
  async function stopAll() {
    let count = 0;

    for (const [id, entry] of entries.entries()) {
      if (entry.status !== 'active') continue;
      count += 1;
      await closeEntry(id, 'stopped_all', { persist: false });
    }

    if (count > 0) await persist(true);
    return { stopped: count };
  }

  /**
   * Execute an operation within an active session.
   * @param {Record<string, unknown>} params - Execution params.
   * @returns {Promise<Record<string, unknown>>}
   */
  async function execute(params) {
    const id = typeof params.name === 'string' ? params.name : '';
    const method = typeof params.method === 'string' ? params.method : '';
    const payload = isRecord(params.params) ? params.params : {};

    const entry = await active(id);
    const result = await invoke(entry.session, method, payload);

    entry.lastActiveAt = Date.now();
    entry.expiresAt = entry.lastActiveAt + cfg.idleTimeoutMs;
    await persist();

    return {
      id,
      result,
      server: entry.serverName,
      info: entry.catalog?.server ?? {}
    };
  }

  /**
   * Return service health data.
   * @returns {Record<string, unknown>}
   */
  function ping() {
    return {
      ok: true,
      pid: process.pid,
      endpoint: endpoint(),
      sessions: activeCount
    };
  }

  /**
   * Dispatch inbound RPC methods.
   * @param {string} method - RPC method.
   * @param {Record<string, unknown>} params - Method params.
   * @returns {Promise<unknown>}
   */
  async function dispatch(method, params) {
    if (method === 'health.ping') return ping();
    if (method === 'session.open') return open(params);
    if (method === 'session.execute') return execute(params);
    if (method === 'session.catalog') return catalog(params);
    if (method === 'session.list') return list();
    if (method === 'session.stop') return stop(params);
    if (method === 'session.stopAll') return stopAll();

    throw new LayerError({
      name: 'stateful',
      method: 'dispatch',
      message: 'Unknown RPC method "{method}".',
      vars: { method },
      code: 'SESSION_RPC_UNKNOWN'
    });
  }

  /**
   * Handle a single transport socket.
   * @param {import('node:net').Socket} socket - Inbound socket.
   * @returns {void}
   */
  function onSocket(socket) {
    let buffer = '';

    socket.setTimeout(cfg.socketTimeoutMs);
    socket.on('timeout', function onTimeout() {
      socket.destroy();
    });

    /**
     * Send a JSON-RPC response frame.
     * @param {Record<string, unknown>} payload - Response payload.
     * @returns {void}
     */
    function send(payload) {
      socket.write(`${JSON.stringify(payload)}\n`);
    }

    /**
     * Process one received frame line.
     * @param {string} line - NDJSON frame.
     * @returns {void}
     */
    function processLine(line) {
      if (!line.trim()) return;

      let packet;

      try {
        packet = JSON.parse(line);
      } catch {
        send({
          id: null,
          ok: false,
          error: {
            message: 'Invalid JSON frame.',
            code: 'SESSION_RPC_INVALID_JSON'
          }
        });
        return;
      }

      if (!isRecord(packet)) {
        send({
          id: null,
          ok: false,
          error: {
            message: 'Invalid JSON frame.',
            code: 'SESSION_RPC_INVALID_JSON'
          }
        });
        return;
      }

      const id = packet.id ?? null;
      const method = typeof packet.method === 'string' ? packet.method : '';
      const params = isRecord(packet.params) ? packet.params : {};
      const token = typeof packet.token === 'string' ? packet.token : '';

      if (token !== secret) {
        send({
          id,
          ok: false,
          error: {
            message: 'Unauthorized stateful RPC request.',
            code: 'SESSION_UNAUTHORIZED'
          }
        });
        return;
      }

      dispatch(method, params)
        .then(function done(result) {
          send({ id, ok: true, result });
        })
        .catch(function failed(error) {
          const normalized = normalizeError(error, method || 'dispatch');
          send({
            id,
            ok: false,
            error: {
              message: normalized.message,
              code: normalized.code,
              reference: normalized.reference
            }
          });
        });
    }

    /**
     * Process incoming socket chunks.
     * @param {Buffer | string} chunk - Socket data chunk.
     * @returns {void}
     */
    function onData(chunk) {
      buffer += chunk.toString();

      while (buffer.includes('\n')) {
        const idx = buffer.indexOf('\n');
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        if (Buffer.byteLength(line, 'utf8') > cfg.maxFrameBytes) {
          send({
            id: null,
            ok: false,
            error: {
              message: 'RPC frame exceeds maximum allowed size.',
              code: 'SESSION_RPC_FRAME_TOO_LARGE'
            }
          });
          socket.destroy();
          return;
        }
        processLine(line);
      }

      if (Buffer.byteLength(buffer, 'utf8') <= cfg.maxFrameBytes) return;

      send({
        id: null,
        ok: false,
        error: {
          message: 'RPC frame exceeds maximum allowed size.',
          code: 'SESSION_RPC_FRAME_TOO_LARGE'
        }
      });
      socket.destroy();
    }

    socket.on('data', onData);
  }

  /**
   * Check whether another process currently owns the stateful endpoint.
   * @returns {Promise<boolean>}
   */
  async function endpointActive() {
    return new Promise(function probe(resolve) {
      const socket = createConnection(endpoint());
      let done = false;
      let timer;

      /**
       * Resolve probe and release probe resources.
       * @param {boolean} value - Probe result.
       * @returns {void}
       */
      function finish(value) {
        if (done) return;
        done = true;

        if (timer) clearTimeout(timer);
        timer = undefined;

        socket.off('connect', onConnect);
        socket.off('error', onError);
        socket.destroy();
        resolve(value);
      }

      /**
       * Resolve a successful endpoint probe.
       * @returns {void}
       */
      function onConnect() {
        finish(true);
      }

      /**
       * Resolve endpoint probe errors.
       * @param {{ code?: string | number }} error - Probe error.
       * @returns {void}
       */
      function onError(error) {
        const code = error && Object.hasOwn(error, 'code')
          ? String(error.code ?? '')
          : '';

        if (code === 'ENOENT' || code === 'ECONNREFUSED') {
          finish(false);
          return;
        }

        finish(true);
      }

      /**
       * Resolve probe timeout.
       * @returns {void}
       */
      function onTimeout() {
        finish(false);
      }

      timer = setTimeout(onTimeout, 200);
      if (timer && typeof timer.unref === 'function') timer.unref();
      socket.once('connect', onConnect);
      socket.once('error', onError);
    });
  }

  /**
   * Start listening on the configured endpoint.
   * @returns {Promise<void>}
   */
  async function listen() {
    if (started) return;

    if (await endpointActive()) {
      throw new LayerError({
        name: 'stateful',
        method: 'listen',
        message: 'Stateful service endpoint is already active.',
        code: 'SESSION_SERVICE_RUNNING'
      });
    }

    await clearServiceMeta();
    secret = randomUUID();
    await saveServiceMeta({
      pid: process.pid,
      endpoint: endpoint(),
      token: secret,
      startedAt: new Date().toISOString()
    });

    timer = setInterval(function tick() {
      sweep().catch(function ignore() {
        // Sweep errors are surfaced by operations.
      });
    }, cfg.sweepIntervalMs);

    if (timer && typeof timer.unref === 'function') timer.unref();

    listener = createServer(onSocket);
    listener.maxConnections = cfg.maxConnections;

    try {
      await new Promise(function start(resolve, reject) {
        /**
         * Resolve listen completion and detach temporary listeners.
         * @returns {void}
         */
        function onListening() {
          listener.off('error', onError);
          resolve(undefined);
        }

        /**
         * Reject listen startup errors and detach temporary listeners.
         * @param {Error} error - Startup failure.
         * @returns {void}
         */
        function onError(error) {
          listener.off('listening', onListening);
          reject(error);
        }

        listener.once('error', onError);
        listener.once('listening', onListening);
        listener.listen(endpoint());
      });
    } catch (error) {
      if (timer) clearInterval(timer);
      timer = undefined;
      await clearServiceMeta();
      throw error;
    }

    if (process.platform !== 'win32') {
      try {
        await chmod(endpoint(), 0o600);
      } catch {
        // Best effort endpoint hardening.
      }
    }

    started = true;
    await log({ type: 'service.started', data: { pid: process.pid } });
  }

  /**
   * Close the service and all active sessions.
   * @returns {Promise<void>}
   */
  async function close() {
    if (timer) clearInterval(timer);
    timer = undefined;

    let closed = false;
    for (const [id, entry] of entries.entries()) {
      if (entry.status !== 'active') continue;
      closed = true;
      await closeEntry(id, 'service_shutdown', { persist: false });
    }

    if (closed) await persist(true);

    if (listener) {
      await new Promise(function stop(resolve) {
        listener.close(function done() {
          resolve(undefined);
        });
      });
    }

    listener = undefined;
    if (!started) return;

    started = false;
    await log({ type: 'service.stopped', data: { pid: process.pid } });
    await clearServiceMeta();
  }

  return {
    listen,
    close,
    open,
    execute,
    catalog,
    list,
    stop,
    stopAll,
    ping
  };
}

/**
 * Run the stateful service and keep process alive.
 * @param {{ idleTimeoutMs?: number, maxAgeMs?: number, sweepIntervalMs?: number, maxSessions?: number, persistIntervalMs?: number, maxFrameBytes?: number, socketTimeoutMs?: number, maxConnections?: number }} [options] - Service options.
 * @returns {Promise<void>}
 */
export async function runService(options = {}) {
  const service = await createService(options);
  await service.listen();

  /**
   * Close service and exit process.
   * @param {number} code - Exit code.
   * @returns {Promise<void>}
   */
  async function shutdown(code) {
    await service.close();
    process.exit(code);
  }

  process.on('SIGINT', function onSigint() {
    shutdown(0).catch(function fail() {
      process.exit(1);
    });
  });

  process.on('SIGTERM', function onSigterm() {
    shutdown(0).catch(function fail() {
      process.exit(1);
    });
  });
}
