import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';

/**
 * Host real SDK transports while retaining requests for identity assertions.
 * @returns {Promise<{url:string, observations:object[], close:()=>Promise<void>}>} HTTP fixture lifecycle.
 */
export async function service() {
  const observations = [];
  const sessions = new Map();
  const servers = [];
  /**
   * Dispatch requests to the SDK and collect original request identity.
   * @param {import('node:http').IncomingMessage} req Incoming request.
   * @param {import('node:http').ServerResponse} res Outgoing response.
   * @returns {Promise<void>} SDK request handling.
   */
  async function request(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined;
    observations.push({ method: req.method, path: url.pathname, headers: req.headers, message: body });
    if (url.pathname === '/sse' && req.method === 'GET') {
      const transport = new SSEServerTransport('/sse', res);
      const server = new McpServer({ name: 'identity-fixture', version: '1.0.0' });
      sessions.set(transport.sessionId, transport);
      servers.push(server);
      await server.connect(transport);
      return;
    }
    if (url.pathname === '/sse') {
      const transport = sessions.get(url.searchParams.get('sessionId'));
      await transport.handlePostMessage(req, res, body);
      return;
    }
    let transport = sessions.get(req.headers['mcp-session-id']);
    if (!transport) {
      transport = new StreamableHTTPServerTransport({ sessionIdGenerator: randomUUID, enableJsonResponse: true });
      const server = new McpServer({ name: 'identity-fixture', version: '1.0.0' });
      servers.push(server);
      await server.connect(transport);
    }
    await transport.handleRequest(req, res, body);
    if (transport.sessionId) sessions.set(transport.sessionId, transport);
  }
  const listener = createServer(
    /**
     * Dispatch an incoming request to the real SDK fixture.
     * @param {import('node:http').IncomingMessage} req Original HTTP request.
     * @param {import('node:http').ServerResponse} res Outgoing SDK response.
     * @returns {void} Completion of the real test operation.
     */
    function dispatch(req, res) {
      void request(req, res).catch(
        /**
         * Report an actual SDK request failure.
         * @param {Error} error Actual process or request failure.
         * @returns {void} Completion of the real test operation.
         */
        function failed(error) { res.writeHead(500).end(String(error)); });
    });
  await new Promise(
    /**
     * Observe real listener startup or binding failure.
     * @param {()=>void} resolve Complete the observed lifecycle event.
     * @param {(cause:unknown)=>void} reject Report startup failure.
     * @returns {void} Completion of the real test operation.
     */
    function listening(resolve, reject) {
      listener.once('error', reject);
      listener.listen(0, '127.0.0.1', resolve);
    });
  /** @returns {Promise<void>} Close real server transports and sockets. */
  async function close() {
    for (const server of servers) await server.close();
    listener.closeAllConnections();
    await new Promise(
      /**
       * Complete the real test lifecycle.
       * @param {()=>void} resolve Complete the observed lifecycle event.
       * @returns {void} Completion of the real test operation.
       */
      function closed(resolve) { listener.close(resolve); });
  }
  return { url: `http://127.0.0.1:${listener.address().port}`, observations, close };
}
