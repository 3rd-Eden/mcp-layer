import { createServer } from 'node:http';
import { once } from 'node:events';

/**
 * Start a real loopback HTTP endpoint with deterministic cleanup.
 * @param {import('node:http').RequestListener} handler - HTTP request handler.
 * @returns {Promise<{url: string, close: () => Promise<void>}>} Bound URL and cleanup method.
 */
export async function listen(handler) {
  const server = createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = /** @type {import('node:net').AddressInfo} */ (server.address()).port;
  /**
   * Close outstanding loopback connections and the listening socket.
   * @returns {Promise<void>} Resolves when the endpoint is closed.
   */
  async function close() {
    server.closeAllConnections();
    server.close();
    await once(server, 'close');
  }
  return { url: `http://127.0.0.1:${port}`, close };
}

/**
 * Read an actual incoming HTTP body without changing its contents.
 * @param {import('node:http').IncomingMessage} request - Incoming request stream.
 * @returns {Promise<string>} Complete UTF-8 body.
 */
export async function read(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}
