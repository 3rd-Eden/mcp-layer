import { spawn } from 'node:child_process';
import { createConnection } from 'node:net';
import { fileURLToPath } from 'node:url';
import { LayerError } from '@mcp-layer/error';
import { endpoint } from './path.js';
import { loadServiceMeta } from './store.js';

const DEFAULT_TIMEOUT_MS = 3000;
const DEFAULT_MAX_FRAME_BYTES = 1024 * 1024;
let cached = null;

/**
 * Resolve request timeout configuration.
 * @param {{ timeoutMs?: number } | undefined} options - Request options.
 * @returns {number}
 */
function timeout(options) {
  if (typeof options?.timeoutMs === 'number' && options.timeoutMs > 0) return options.timeoutMs;
  return DEFAULT_TIMEOUT_MS;
}

/**
 * Resolve response frame size configuration.
 * @param {{ maxFrameBytes?: number } | undefined} options - Request options.
 * @returns {number}
 */
function frame(options) {
  if (typeof options?.maxFrameBytes === 'number' && options.maxFrameBytes > 0) return options.maxFrameBytes;
  return DEFAULT_MAX_FRAME_BYTES;
}

/**
 * Load service metadata with endpoint-scoped memoization.
 * @param {boolean} force - Force metadata refresh from disk.
 * @returns {Promise<{ endpoint: string, token: string, scope: string }>}
 */
async function meta(force) {
  const scope = endpoint();

  if (!force && cached && cached.scope === scope) return cached;

  const loaded = await loadServiceMeta();
  const next = {
    scope,
    endpoint: typeof loaded.endpoint === 'string' && loaded.endpoint.length > 0
      ? loaded.endpoint
      : scope,
    token: typeof loaded.token === 'string' ? loaded.token : ''
  };

  cached = next;
  return next;
}

/**
 * Send one RPC request with explicit service metadata.
 * @param {{ endpoint: string, token: string }} info - Service metadata.
 * @param {string} method - RPC method.
 * @param {Record<string, unknown>} params - RPC params.
 * @param {number} timeoutMs - Request timeout.
 * @param {number} maxFrameBytes - Maximum response frame size.
 * @returns {Promise<unknown>}
 */
async function send(info, method, params, timeoutMs, maxFrameBytes) {
  const id = `${Date.now()}-${Math.random()}`;

  return new Promise(function call(resolve, reject) {
    const socket = createConnection(info.endpoint);
    let buffer = '';
    let done = false;
    let timer;

    /**
     * Release resources before resolving/rejecting.
     * @returns {void}
     */
    function cleanup() {
      if (timer) clearTimeout(timer);
      timer = undefined;
      socket.off('data', onData);
      socket.off('connect', onConnect);
      socket.off('error', onError);
    }

    /**
     * Finish with a formatted error.
     * @param {{ message: string, code: string, cause?: unknown, upstreamReference?: unknown }} input - Failure data.
     * @returns {void}
     */
    function fail(input) {
      if (done) return;
      done = true;
      cleanup();
      socket.destroy();
      reject(new LayerError({
        name: 'stateful',
        method: 'request',
        message: input.message,
        code: input.code,
        cause: input.cause,
        upstreamReference: input.upstreamReference
      }));
    }

    /**
     * Finish with a successful response payload.
     * @param {unknown} result - Response payload.
     * @returns {void}
     */
    function pass(result) {
      if (done) return;
      done = true;
      cleanup();
      socket.end();
      resolve(result);
    }

    /**
     * Handle socket-level failures.
     * @param {unknown} error - Socket error.
     * @returns {void}
     */
    function onError(error) {
      const detail = error instanceof Error ? error.message : String(error);
      fail({
        message: detail,
        code: 'SESSION_RPC_ERROR',
        cause: error
      });
    }

    /**
     * Handle request timeout.
     * @returns {void}
     */
    function onTimeout() {
      fail({
        message: `Stateful request timed out after ${timeoutMs}ms.`,
        code: 'SESSION_RPC_TIMEOUT'
      });
    }

    /**
     * Process one parsed response packet.
     * @param {Record<string, unknown>} packet - Parsed packet.
     * @returns {void}
     */
    function onPacket(packet) {
      if (!packet || typeof packet !== 'object' || Array.isArray(packet)) return;
      if (packet.id !== id) return;

      if (packet.ok === true) {
        pass(packet.result);
        return;
      }

      const text = typeof packet.error?.message === 'string'
        ? packet.error.message
        : 'Stateful request failed.';
      const code = typeof packet.error?.code === 'string' && packet.error.code.length > 0
        ? packet.error.code
        : 'SESSION_RPC_ERROR';

      fail({
        message: text,
        code,
        cause: new Error(text),
        upstreamReference: packet.error?.reference
      });
    }

    /**
     * Process socket data chunks.
     * @param {Buffer | string} chunk - Socket chunk.
     * @returns {void}
     */
    function onData(chunk) {
      buffer += chunk.toString();

      if (Buffer.byteLength(buffer, 'utf8') > maxFrameBytes) {
        if (done) return;
        done = true;
        cleanup();
        socket.destroy();
        reject(new LayerError({
          name: 'stateful',
          method: 'request',
          message: 'RPC frame exceeds maximum allowed size.',
          code: 'SESSION_RPC_FRAME_TOO_LARGE'
        }));
        return;
      }

      while (buffer.includes('\n')) {
        const idx = buffer.indexOf('\n');
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);

        if (Buffer.byteLength(line, 'utf8') > maxFrameBytes) {
          if (done) return;
          done = true;
          cleanup();
          socket.destroy();
          reject(new LayerError({
            name: 'stateful',
            method: 'request',
            message: 'RPC frame exceeds maximum allowed size.',
            code: 'SESSION_RPC_FRAME_TOO_LARGE'
          }));
          return;
        }

        if (!line.trim()) continue;

        let packet;

        try {
          packet = JSON.parse(line);
        } catch {
          continue;
        }

        onPacket(packet);
        if (done) return;
      }
    }

    /**
     * Send request after socket connect.
     * @returns {void}
     */
    function onConnect() {
      socket.write(`${JSON.stringify({ id, method, params, token: info.token })}\n`);
    }

    timer = setTimeout(onTimeout, timeoutMs);
    if (typeof timer.unref === 'function') timer.unref();

    socket.once('error', onError);
    socket.once('connect', onConnect);
    socket.on('data', onData);
  });
}

/**
 * Send one RPC request and wait for a response.
 * @param {string} method - RPC method.
 * @param {Record<string, unknown>} [params] - RPC params.
 * @param {{ timeoutMs?: number, maxFrameBytes?: number }} [options] - Request options.
 * @returns {Promise<unknown>}
 */
export async function request(method, params = {}, options = {}) {
  const timeoutMs = timeout(options);
  const maxFrameBytes = frame(options);

  try {
    const snapshot = await meta(false);
    return await send(snapshot, method, params, timeoutMs, maxFrameBytes);
  } catch (error) {
    if (!(error instanceof LayerError) || error.code !== 'SESSION_UNAUTHORIZED') throw error;

    const refreshed = await meta(true);
    return await send(refreshed, method, params, timeoutMs, maxFrameBytes);
  }
}

/**
 * Attempt service health ping.
 * @returns {Promise<boolean>}
 */
export async function ping() {
  try {
    await request('health.ping', {}, { timeoutMs: 250 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Ensure the stateful service is running.
 * @returns {Promise<void>}
 */
export async function ensureService() {
  if (await ping()) return;

  const entry = fileURLToPath(new URL('./daemon.js', import.meta.url));
  const child = spawn(process.execPath, [entry], {
    detached: true,
    stdio: 'ignore'
  });
  child.unref();

  let attempt = 0;

  while (attempt < 25) {
    const ok = await ping();
    if (ok) return;

    await new Promise(function wait(resolve) {
      setTimeout(resolve, 100);
    });

    attempt += 1;
  }

  throw new LayerError({
    name: 'stateful',
    method: 'ensureService',
    message: 'Unable to start stateful session service.',
    code: 'SESSION_SERVICE_UNAVAILABLE'
  });
}

/**
 * Open or reuse a session.
 * @param {{ name?: string, server?: string, config?: string, transport?: string }} params - Open params.
 * @returns {Promise<Record<string, unknown>>}
 */
export async function openSession(params) {
  await ensureService();
  return /** @type {Promise<Record<string, unknown>>} */ (request('session.open', params));
}

/**
 * Execute an operation within a session.
 * @param {{ name: string, method: string, params: Record<string, unknown>, meta?: Record<string, unknown> }} params - Execution params.
 * @returns {Promise<Record<string, unknown>>}
 */
export async function executeSession(params) {
  await ensureService();
  return /** @type {Promise<Record<string, unknown>>} */ (request('session.execute', params));
}

/**
 * Fetch catalog metadata for an active session.
 * @param {{ name: string }} params - Session lookup params.
 * @returns {Promise<Record<string, unknown>>}
 */
export async function sessionCatalog(params) {
  await ensureService();
  return /** @type {Promise<Record<string, unknown>>} */ (request('session.catalog', params));
}

/**
 * List known sessions.
 * @returns {Promise<Array<Record<string, unknown>>>}
 */
export async function listSessions() {
  await ensureService();
  return /** @type {Promise<Array<Record<string, unknown>>>} */ (request('session.list'));
}

/**
 * Stop one session.
 * @param {{ name: string }} params - Stop params.
 * @returns {Promise<Record<string, unknown>>}
 */
export async function stopSession(params) {
  await ensureService();
  return /** @type {Promise<Record<string, unknown>>} */ (request('session.stop', params));
}

/**
 * Stop all sessions.
 * @returns {Promise<Record<string, unknown>>}
 */
export async function stopAllSessions() {
  await ensureService();
  return /** @type {Promise<Record<string, unknown>>} */ (request('session.stopAll'));
}
