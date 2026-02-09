import express from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { build } from '../index.js';

/**
 * Extract a single header/query string value.
 * @param {unknown} value - Raw input value.
 * @returns {string | undefined}
 */
function one(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return undefined;
}

/**
 * Close one tracked SSE session.
 * @param {Record<string, { transport: { close: () => Promise<void> }, server: { close: () => Promise<void> } }>} sessions - Session map.
 * @param {string} id - Session id to close.
 * @returns {Promise<void>}
 */
async function closesession(sessions, id) {
  const session = sessions[id];
  if (!session) return;
  delete sessions[id];
  try {
    await session.transport.close();
  } finally {
    await session.server.close();
  }
}

/**
 * Close and remove every open session in a map.
 * @param {Record<string, { transport: { close: () => Promise<void> }, server: { close: () => Promise<void> } }>} sessions - Session map to drain.
 * @returns {Promise<void>}
 */
async function drain(sessions) {
  for (const id of Object.keys(sessions))
    await closesession(sessions, id);
}

/**
 * Start an HTTP server that exposes Streamable HTTP and SSE transports.
 * @param {{ port?: number }} [opts] - Optional port override for the HTTP server.
 * @returns {Promise<{ port: number, close: () => Promise<void> }>}
 */
export async function startHttpServer(opts = {}) {
  const port = opts.port ?? Number(process.env.PORT ?? 3000);
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  const streamServer = build();
  const streamTransport = new StreamableHTTPServerTransport({
    // We keep this fixture stateless so tests don't need extra session plumbing.
    sessionIdGenerator: undefined,
    enableJsonResponse: true
  });
  await streamServer.connect(streamTransport);

  /** @type {Record<string, { transport: SSEServerTransport, server: import('@modelcontextprotocol/sdk/server/mcp.js').McpServer }>} */
  const sseSessions = {};

  /**
   * Handle legacy SSE session bootstrap.
   * @param {import('express').Request} req - Express request.
   * @param {import('express').Response} res - Express response.
   * @returns {Promise<void>}
   */
  async function sse(req, res) {
    // The SDK emits this endpoint back to the client; we keep GET+POST on one path to reduce routing surface.
    const transport = new SSEServerTransport('/sse', res);
    const server = build();
    sseSessions[transport.sessionId] = { transport, server };
    res.on('close', function onclose() {
      void closesession(sseSessions, transport.sessionId);
    });
    await server.connect(transport);
  }

  /**
   * Handle legacy SSE postback messages.
   * @param {import('express').Request} req - Express request.
   * @param {import('express').Response} res - Express response.
   * @returns {Promise<void>}
   */
  async function ssemessage(req, res) {
    const sessionId = one(req.query.sessionId);
    const session = sessionId ? sseSessions[sessionId] : undefined;
    if (!session) {
      res.status(400).send('No SSE session found');
      return;
    }

    await session.transport.handlePostMessage(req, res, req.body);
  }

  app.all('/mcp', function mcpHandler(req, res, next) {
    void streamTransport.handleRequest(req, res, req.body).catch(next);
  });

  app.get('/sse', function sseHandler(req, res, next) {
    void sse(req, res).catch(next);
  });
  app.post('/sse', function sseMessageHandler(req, res, next) {
    void ssemessage(req, res).catch(next);
  });

  return new Promise(function start(resolve) {
    const listener = app.listen(port, function listen() {
      const address = listener.address();
      const activePort = address && typeof address !== 'string' ? address.port : port;
      resolve({
        port: activePort,
        async close() {
          await streamTransport.close();
          await streamServer.close();
          await drain(sseSessions);
          await new Promise(function stop(done) {
            listener.close(done);
          });
        }
      });
    });
  });
}
