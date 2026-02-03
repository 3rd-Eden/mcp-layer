import { registerAdd } from './add.js';
import { registerAnnotated } from './annotated.js';
import { registerBatch } from './batch.js';
import { registerBooking } from './booking.js';
import { registerDashboard } from './dashboard.js';
import { registerEcho } from './echo.js';
import { registerFiles } from './files.js';
import { registerLogs } from './logs.js';
import { registerNoteUpdate } from './note-update.js';
import { registerProgress } from './progress.js';
import { registerRebalance } from './rebalance.js';
import { registerRoots } from './roots.js';
import { registerSummaries } from './summaries.js';

/**
 * Register all server tools.
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 * @param {{ references: Array<{ uri: string, name: string, description: string, mimeType: string }> }} context
 * @param {{ hasCapability: (capability: 'sampling' | 'elicitation' | 'roots') => boolean }} capabilities
 */
export function registerTools(server, context, capabilities, notifier) {
  const echoHandle = registerEcho(server);
  const addHandle = registerAdd(server);
  registerBatch(server);
  registerAnnotated(server);
  registerDashboard(server);
  registerFiles(server, context);
  registerSummaries(server, capabilities);
  registerBooking(server, capabilities);
  registerRoots(server, capabilities);
  registerNoteUpdate(server, context, notifier);
  registerLogs(server);
  registerProgress(server);
  registerRebalance(server, { echo: echoHandle, add: addHandle });
}
