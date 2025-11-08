import express from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { build } from '../index.js';

/**
 * Start an HTTP server that exposes Streamable HTTP and SSE transports.
 * @param {{ port?: number }} [opts]
 * @returns {Promise<{ close: () => Promise<void> }>}
 */
export async function startHttpServer(opts = {}) {
  const port = opts.port ?? Number(process.env.PORT ?? 3000);
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  /** @type {Record<string, { transport: StreamableHTTPServerTransport, server: import('@modelcontextprotocol/sdk/server/mcp.js').McpServer }>} */
  const httpSessions = {};
  /** @type {Record<string, { transport: SSEServerTransport, server: import('@modelcontextprotocol/sdk/server/mcp.js').McpServer }>} */
  const sseSessions = {};

  function newSession() {
    const transport = new StreamableHTTPServerTransport({
      enableJsonResponse: true
    });
    const server = build();
    return { transport, server };
  }

  app.post('/mcp', async (req, res) => {
    const sessionId = req.headers['mcp-session-id'];
    let session = sessionId ? httpSessions[sessionId] : undefined;

    if (!session) {
      session = newSession();
      httpSessions[session.transport.sessionId] = session;
      res.setHeader('Mcp-Session-Id', session.transport.sessionId);
      res.on('close', () => {
        void session.transport.close();
        delete httpSessions[session.transport.sessionId];
      });
      await session.server.connect(session.transport);
    }

    await session.transport.handleRequest(req, res, req.body);
  });

  app.get('/sse', async (req, res) => {
    const transport = new SSEServerTransport('/sse/messages', res);
    const server = build();
    sseSessions[transport.sessionId] = { transport, server };
    res.on('close', () => {
      void transport.close();
      delete sseSessions[transport.sessionId];
    });
    await server.connect(transport);
  });

  app.post('/sse/messages', async (req, res) => {
    const sessionId = req.query.sessionId;
    const session = typeof sessionId === 'string' ? sseSessions[sessionId] : undefined;
    if (!session) {
      res.status(400).send('No SSE session found');
      return;
    }
    await session.transport.handlePostMessage(req, res, req.body);
  });

  return new Promise(resolve => {
    const listener = app.listen(port, () => {
      resolve({
        async close() {
          await new Promise(r => listener.close(r));
        }
      });
    });
  });
}
