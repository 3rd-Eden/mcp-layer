import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createConnection, createServer } from 'node:net';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { request } from '../src/client.js';
import { endpoint, serviceFile } from '../src/path.js';
import { createService } from '../src/service.js';

/**
 * Create a temporary home directory for isolated stateful client tests.
 * @returns {Promise<string>}
 */
async function home() {
  const base = process.platform === 'win32' ? os.tmpdir() : '/tmp';
  return mkdtemp(path.join(base, 'mls-'));
}

/**
 * Apply an isolated home configuration and return a restore function.
 * @param {string} next - Temporary home directory.
 * @returns {() => void}
 */
function applyhome(next) {
  const prevHome = process.env.HOME;
  const prevProfile = process.env.USERPROFILE;
  process.env.HOME = next;
  process.env.USERPROFILE = next;

  /**
   * Restore previous environment variables.
   * @returns {void}
   */
  function restore() {
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;

    if (prevProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = prevProfile;
  }

  return restore;
}

/**
 * Close a net server.
 * @param {import('node:net').Server} server - Server to close.
 * @returns {Promise<void>}
 */
async function stop(server) {
  await new Promise(function close(resolve) {
    /**
     * Resolve close completion.
     * @returns {void}
     */
    function done() {
      resolve(undefined);
    }

    server.close(done);
  });
}

/**
 * Verify stateful RPC errors preserve service code metadata.
 * @returns {Promise<void>}
 */
async function codeCase() {
  const dir = await home();
  const restore = applyhome(dir);
  const service = await createService();
  await service.listen();

  try {
    await assert.rejects(
      request('session.stop', { name: 'missing' }),
      function verify(error) {
        assert.equal(error.code, 'SESSION_NOT_FOUND');
        assert.equal(typeof error.upstreamReference, 'string');
        return true;
      }
    );
  } finally {
    await service.close();
    restore();
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Verify request timeout handling when a socket accepts but does not respond.
 * @returns {Promise<void>}
 */
async function timeoutCase() {
  const dir = await home();
  const restore = applyhome(dir);
  const file = endpoint();
  const sockets = new Set();

  /**
   * Track accepted timeout test sockets.
   * @param {import('node:net').Socket} socket - Accepted socket.
   * @returns {void}
   */
  function hold(socket) {
    sockets.add(socket);

    /**
     * Remove closed sockets from tracking.
     * @returns {void}
     */
    function remove() {
      sockets.delete(socket);
    }

    socket.once('close', remove);
  }

  const server = createServer(hold);

  if (process.platform !== 'win32') {
    await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  }

  await new Promise(function listen(resolve, reject) {
    /**
     * Reject listen startup errors.
     * @param {Error} error - Startup failure.
     * @returns {void}
     */
    function onError(error) {
      reject(error);
    }

    /**
     * Resolve server start.
     * @returns {void}
     */
    function onListening() {
      server.off('error', onError);
      resolve(undefined);
    }

    server.once('error', onError);
    server.listen(file, onListening);
  });

  try {
    await assert.rejects(
      request('health.ping', {}, { timeoutMs: 50 }),
      function verify(error) {
        assert.equal(error.code, 'SESSION_RPC_TIMEOUT');
        return true;
      }
    );
  } finally {
    for (const socket of sockets.values()) {
      socket.destroy();
    }

    await stop(server);
    if (process.platform !== 'win32') await rm(file, { force: true });
    restore();
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Verify RPC handling skips unrelated frames and continues reading.
 * @returns {Promise<void>}
 */
async function frameCase() {
  const dir = await home();
  const restore = applyhome(dir);
  const file = endpoint();
  const sockets = new Set();

  /**
   * Handle one client socket for frame routing checks.
   * @param {import('node:net').Socket} socket - Accepted socket.
   * @returns {void}
   */
  function onSocket(socket) {
    sockets.add(socket);
    let buffer = '';

    /**
     * Remove closed sockets from tracking.
     * @returns {void}
     */
    function remove() {
      sockets.delete(socket);
    }

    /**
     * Process socket chunks and respond with mixed frame ids.
     * @param {Buffer | string} chunk - Incoming data chunk.
     * @returns {void}
     */
    function onData(chunk) {
      buffer += chunk.toString();
      if (!buffer.includes('\n')) return;

      const idx = buffer.indexOf('\n');
      const line = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 1);

      let packet;

      try {
        packet = JSON.parse(line);
      } catch {
        return;
      }

      const id = typeof packet.id === 'string' ? packet.id : '';
      if (!id) return;

      socket.write(`${JSON.stringify({ id: 'ignore', ok: true, result: { ignored: true } })}\n`);
      socket.write(`${JSON.stringify({ id, ok: true, result: { ok: true } })}\n`);
    }

    socket.once('close', remove);
    socket.on('data', onData);
  }

  const server = createServer(onSocket);

  if (process.platform !== 'win32') {
    await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  }

  await new Promise(function listen(resolve, reject) {
    /**
     * Reject listen startup errors.
     * @param {Error} error - Startup failure.
     * @returns {void}
     */
    function onError(error) {
      reject(error);
    }

    /**
     * Resolve server start.
     * @returns {void}
     */
    function onListening() {
      server.off('error', onError);
      resolve(undefined);
    }

    server.once('error', onError);
    server.listen(file, onListening);
  });

  try {
    const result = await request('health.ping', {}, { timeoutMs: 200 });
    assert.equal(result.ok, true);
  } finally {
    for (const socket of sockets.values()) {
      socket.destroy();
    }

    await stop(server);
    if (process.platform !== 'win32') await rm(file, { force: true });
    restore();
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Send one raw RPC line and parse the first response.
 * @param {string} line - Raw line payload without trailing newline.
 * @returns {Promise<Record<string, unknown>>}
 */
async function raw(line) {
  return new Promise(function call(resolve, reject) {
    const socket = createConnection(endpoint());
    let buffer = '';

    /**
     * Handle socket startup and send request line.
     * @returns {void}
     */
    function onConnect() {
      socket.write(`${line}\n`);
    }

    /**
     * Fail raw RPC call.
     * @param {unknown} error - Socket error.
     * @returns {void}
     */
    function onError(error) {
      reject(error);
    }

    /**
     * Process response chunks and resolve first frame.
     * @param {Buffer | string} chunk - Socket chunk.
     * @returns {void}
     */
    function onData(chunk) {
      buffer += chunk.toString();
      if (!buffer.includes('\n')) return;

      const idx = buffer.indexOf('\n');
      const line = buffer.slice(0, idx);

      let parsed;

      try {
        parsed = JSON.parse(line);
      } catch (error) {
        reject(error);
        return;
      }

      socket.destroy();
      resolve(parsed);
    }

    socket.once('connect', onConnect);
    socket.once('error', onError);
    socket.on('data', onData);
  });
}

/**
 * Verify service rejects unauthenticated raw requests.
 * @returns {Promise<void>}
 */
async function authCase() {
  const dir = await home();
  const restore = applyhome(dir);
  const service = await createService();
  await service.listen();

  try {
    const packet = await raw(JSON.stringify({ id: '1', method: 'health.ping', params: {} }));
    assert.equal(packet.ok, false);
    assert.equal(packet.error?.code, 'SESSION_UNAUTHORIZED');
  } finally {
    await service.close();
    restore();
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Verify service rejects oversized RPC frames.
 * @returns {Promise<void>}
 */
async function sizeCase() {
  const dir = await home();
  const restore = applyhome(dir);
  const service = await createService({ maxFrameBytes: 64 });
  await service.listen();

  try {
    const payload = {
      id: '1',
      method: 'health.ping',
      params: { text: 'x'.repeat(256) }
    };
    const packet = await raw(JSON.stringify(payload));
    assert.equal(packet.ok, false);
    assert.equal(packet.error?.code, 'SESSION_RPC_FRAME_TOO_LARGE');
  } finally {
    await service.close();
    restore();
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Verify client caches service metadata between requests.
 * @returns {Promise<void>}
 */
async function cacheCase() {
  const dir = await home();
  const restore = applyhome(dir);
  const service = await createService();
  await service.listen();

  try {
    const first = await request('health.ping', {}, { timeoutMs: 200 });
    assert.equal(first.ok, true);

    const raw = await readFile(serviceFile(), 'utf8');
    const meta = JSON.parse(raw);
    meta.token = 'broken-token';
    await writeFile(serviceFile(), `${JSON.stringify(meta, null, 2)}\n`, 'utf8');

    const second = await request('health.ping', {}, { timeoutMs: 200 });
    assert.equal(second.ok, true);
  } finally {
    await service.close();
    restore();
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Verify client refreshes cached token after unauthorized response.
 * @returns {Promise<void>}
 */
async function refreshCase() {
  const dir = await home();
  const restore = applyhome(dir);
  const service = await createService();
  await service.listen();

  try {
    const first = await request('health.ping', {}, { timeoutMs: 200 });
    assert.equal(first.ok, true);

    await service.close();
    await service.listen();

    const second = await request('health.ping', {}, { timeoutMs: 200 });
    assert.equal(second.ok, true);
  } finally {
    await service.close();
    restore();
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Verify client rejects oversized response frames.
 * @returns {Promise<void>}
 */
async function responseSizeCase() {
  const dir = await home();
  const restore = applyhome(dir);
  const file = endpoint();
  const sockets = new Set();

  /**
   * Handle one socket and return an oversized response line.
   * @param {import('node:net').Socket} socket - Accepted socket.
   * @returns {void}
   */
  function onSocket(socket) {
    sockets.add(socket);
    let buffer = '';

    /**
     * Remove closed sockets from tracking.
     * @returns {void}
     */
    function remove() {
      sockets.delete(socket);
    }

    /**
     * Process request data and respond once.
     * @param {Buffer | string} chunk - Socket chunk.
     * @returns {void}
     */
    function onData(chunk) {
      buffer += chunk.toString();
      if (!buffer.includes('\n')) return;

      const idx = buffer.indexOf('\n');
      const line = buffer.slice(0, idx);

      let packet;

      try {
        packet = JSON.parse(line);
      } catch {
        return;
      }

      const id = typeof packet.id === 'string' ? packet.id : '';
      if (!id) return;

      socket.write(`${JSON.stringify({ id, ok: true, result: { text: 'x'.repeat(4096) } })}\n`);
    }

    socket.once('close', remove);
    socket.on('data', onData);
  }

  const server = createServer(onSocket);

  if (process.platform !== 'win32') {
    await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  }

  await new Promise(function listen(resolve, reject) {
    /**
     * Reject listen startup errors.
     * @param {Error} error - Startup failure.
     * @returns {void}
     */
    function onError(error) {
      reject(error);
    }

    /**
     * Resolve server start.
     * @returns {void}
     */
    function onListening() {
      server.off('error', onError);
      resolve(undefined);
    }

    server.once('error', onError);
    server.listen(file, onListening);
  });

  try {
    await assert.rejects(
      request('health.ping', {}, { timeoutMs: 200, maxFrameBytes: 256 }),
      function verify(error) {
        assert.equal(error.code, 'SESSION_RPC_FRAME_TOO_LARGE');
        return true;
      }
    );
  } finally {
    for (const socket of sockets.values()) {
      socket.destroy();
    }

    await stop(server);
    if (process.platform !== 'win32') await rm(file, { force: true });
    restore();
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Execute stateful client tests.
 * @returns {void}
 */
function suite() {
  it('preserves service error codes for RPC failures', codeCase);
  it('fails fast when RPC requests time out', timeoutCase);
  it('ignores unrelated frames and returns matching RPC responses', frameCase);
  it('rejects unauthenticated raw requests', authCase);
  it('rejects oversized raw frames', sizeCase);
  it('uses cached state metadata across calls', cacheCase);
  it('refreshes stale auth metadata after unauthorized responses', refreshCase);
  it('rejects oversized response frames', responseSizeCase);
}

describe('stateful client', suite);
