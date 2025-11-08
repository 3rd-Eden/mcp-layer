import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import {
  CreateMessageRequestSchema,
  ElicitRequestSchema,
  ListRootsRequestSchema,
  ResourceUpdatedNotificationSchema,
  LoggingMessageNotificationSchema,
  ProgressNotificationSchema,
  ToolListChangedNotificationSchema
} from '@modelcontextprotocol/sdk/types.js';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const entry = fileURLToPath(new URL('../src/bin.js', import.meta.url));

/**
 * Establish a client/transport pair connected to the test server.
 * @param {{ clientOptions?: object, beforeConnect?: (client: Client) => void | Promise<void> }} [options]
 * @returns {Promise<{ client: Client, transport: StdioClientTransport }>}
 */
async function connect(options = {}) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [entry]
  });
  const client = new Client({ name: 'mcp-layer-tests', version: '0.0.0' }, options.clientOptions);
  if (options.beforeConnect) {
    await options.beforeConnect(client);
  }
  await client.connect(transport);
  return { client, transport };
}

/**
 * Close a client and transport pair.
 * @param {{ client: Client, transport: StdioClientTransport }} session
 * @returns {Promise<void>}
 */
async function cleanup(session) {
  await session.client.close();
  await session.transport.close();
}

describe('test-server', function serverSuite() {
  describe('bin', function binSuite() {
    it('exposes instructions, registries, and metadata', async function registriesCase(t) {
      const session = await connect();
      t.after(async function afterRegistries() {
        await cleanup(session);
      });

      const info = session.client.getServerVersion();
      assert.equal(info?.name, 'mcp-test-server');

      const guide = session.client.getInstructions();
      assert.equal(typeof guide, 'string');
      assert.equal(guide?.includes('sampling'), true);

      const tools = await session.client.listTools({});
      const toolNames = tools.tools.map(function pickToolName(item) {
        return item.name;
      });
      assert.deepEqual(
        toolNames.sort(),
        ['add', 'booking', 'echo', 'files', 'logs', 'note-update', 'progress', 'rebalance', 'roots', 'summaries']
      );

      const prompts = await session.client.listPrompts({});
      const promptNames = prompts.prompts.map(function pickPromptName(prompt) {
        return prompt.name;
      });
      assert.equal(promptNames.includes('welcome'), true);

      const resources = await session.client.listResources({});
      const resourceUris = resources.resources.map(function pickUri(item) {
        return item.uri;
      });
      assert.equal(resourceUris.includes('resource://manual'), true);

      const templates = await session.client.listResourceTemplates({});
      const templateNames = templates.resourceTemplates.map(function pickTemplateName(item) {
        return item.name;
      });
      assert.equal(templateNames.includes('notes'), true);
    });

    it('runs core tools with structured and linked outputs', async function toolsCase(t) {
      const session = await connect();
      t.after(async function afterTools() {
        await cleanup(session);
      });

      const echo = await session.client.callTool({ name: 'echo', arguments: { text: 'hello', loud: true } });
      assert.equal(echo.structuredContent?.text, 'HELLO');

      const add = await session.client.callTool({ name: 'add', arguments: { first: 2, second: 5 } });
      assert.equal(add.structuredContent?.total, 7);

      const files = await session.client.callTool({ name: 'files', arguments: { filter: 'note' } });
      assert.equal(files.structuredContent?.files.length > 0, true);
      const resourceLink = files.content?.find(function findLink(entry) {
        return entry.type === 'resource_link';
      });
      assert.equal(typeof resourceLink?.uri, 'string');
    });

    it('supports sampling and elicitation workflows', async function advancedCapabilitiesCase(t) {
      const session = await connect({
        clientOptions: { capabilities: { sampling: {}, elicitation: {} } },
        beforeConnect(client) {
          client.setRequestHandler(CreateMessageRequestSchema, function handleSampling(request) {
            const source = request.params.messages[0]?.content;
            const text = source?.type === 'text' ? source.text : 'unsupported';
            return {
              model: 'test-only-model',
              stopReason: 'endTurn',
              role: 'assistant',
              content: {
                type: 'text',
                text: `summary:${text.slice(0, 20)}`
              }
            };
          });
          client.setRequestHandler(ElicitRequestSchema, function handleElicit(request) {
            assert.equal(request.params.message.includes('No tables'), true);
            return {
              action: 'accept',
              content: {
                confirmAlternate: true,
                alternateDate: '2025-04-01'
              }
            };
          });
        }
      });
      t.after(async function afterAdvancedCapabilities() {
        await cleanup(session);
      });

      const summary = await session.client.callTool({ name: 'summaries', arguments: { text: 'This server needs a summary.' } });
      assert.equal(summary.structuredContent?.usedSampling, true);
      assert.equal(summary.structuredContent?.summary.startsWith('summary:'), true);

      const booking = await session.client.callTool({
        name: 'booking',
        arguments: { restaurant: 'Echo Bistro', date: '2025-03-02', guests: 2 }
      });
      assert.equal(booking.structuredContent?.alternateDate, '2025-04-01');
      assert.equal(booking.structuredContent?.confirmed, true);
    });

    it('offers completions and dynamic resources', async function completionsCase(t) {
      const session = await connect();
      t.after(async function afterCompletions() {
        await cleanup(session);
      });

      const templates = await session.client.listResourceTemplates({});
      const notesTemplate = templates.resourceTemplates.find(function findNotes(item) {
        return item.name === 'notes';
      });
      assert.ok(notesTemplate);

      const topicCompletion = await session.client.complete({
        ref: { type: 'ref/resource', uri: notesTemplate.uriTemplate },
        argument: { name: 'topic', value: 'e' }
      });
      assert.equal(topicCompletion.completion.values.includes('echo'), true);

      const detailCompletion = await session.client.complete({
        ref: { type: 'ref/resource', uri: notesTemplate.uriTemplate },
        argument: { name: 'detail', value: 'u' },
        context: { arguments: { topic: 'echo' } }
      });
      assert.equal(detailCompletion.completion.values.includes('usage'), true);

      const promptCompletion = await session.client.complete({
        ref: { type: 'ref/prompt', name: 'welcome' },
        argument: { name: 'tone', value: 'c' },
        context: { arguments: { name: 'Ada' } }
      });
      assert.equal(promptCompletion.completion.values.includes('casual'), true);

      const manual = await session.client.readResource({ uri: 'resource://manual' });
      assert.equal(manual.contents?.[0]?.text.includes('Manual'), true);

      const note = await session.client.readResource({ uri: 'note://echo/summary' });
      assert.equal(note.contents?.[0]?.text.includes('Echo repeats'), true);
    });

    it('emits logging and progress notifications', async function loggingProgressCase(t) {
      const session = await connect();
      t.after(async function afterLoggingProgress() {
        await cleanup(session);
      });

      const logs = [];
      session.client.setNotificationHandler(LoggingMessageNotificationSchema, function handleLog(notification) {
        logs.push(notification.params);
      });
      await session.client.setLoggingLevel('debug');
      await session.client.callTool({ name: 'logs', arguments: { level: 'info', message: 'coverage', logger: 'tests' } });
      assert.equal(logs.length > 0, true);
      assert.equal(logs[0]?.data, 'coverage');

      const progressSteps = [];
      session.client.setNotificationHandler(ProgressNotificationSchema, function handleProgress(notification) {
        progressSteps.push(notification.params.progress);
      });
      await session.client.callTool({
        name: 'progress',
        arguments: { steps: 2, delayMs: 5 },
        _meta: { progressToken: 'token-1' }
      });
      assert.deepEqual(progressSteps, [1, 2]);
    });

    it('supports resource subscriptions and updates', async function subscriptionCase(t) {
      const session = await connect();
      t.after(async function afterSubscriptions() {
        await cleanup(session);
      });

      const updates = [];
      session.client.setNotificationHandler(ResourceUpdatedNotificationSchema, function handleResourceUpdated(notification) {
        updates.push(notification.params.uri);
      });

      await session.client.subscribeResource({ uri: 'note://echo/summary' });
      await session.client.callTool({
        name: 'note-update',
        arguments: { topic: 'echo', detail: 'summary', text: 'Updated from test.' }
      });
      await delay(5);
      assert.equal(updates.includes('note://echo/summary'), true);

      await session.client.unsubscribeResource({ uri: 'note://echo/summary' });
      updates.length = 0;
      await session.client.callTool({
        name: 'note-update',
        arguments: { topic: 'echo', detail: 'summary', text: 'Second update.' }
      });
      await delay(5);
      assert.equal(updates.length, 0);
    });

    it('requests roots from capable clients', async function rootsCase(t) {
      const workspace = path.resolve(path.dirname(entry), '..');
      const rootUri = pathToFileURL(workspace).href;
      const session = await connect({
        clientOptions: { capabilities: { roots: {} } },
        beforeConnect(client) {
          client.setRequestHandler(ListRootsRequestSchema, function handleRoots() {
            return {
              roots: [
                {
                  uri: rootUri,
                  name: 'test-server-root',
                  _meta: { workspace }
                }
              ]
            };
          });
        }
      });
      t.after(async function afterRoots() {
        await cleanup(session);
      });

      const roots = await session.client.callTool({ name: 'roots', arguments: { includeMeta: true } });
      assert.equal(roots.structuredContent?.usedCapability, true);
      assert.equal(roots.structuredContent?.count, 1);
      assert.equal(roots.structuredContent?.roots[0]?.name, 'test-server-root');
      assert.equal(roots.structuredContent?.roots[0]?.meta?.workspace, workspace);
    });

    it('debounces notifications when batch updates occur', async function debouncedNotificationsCase(t) {
      const session = await connect();
      t.after(async function afterDebounced() {
        await cleanup(session);
      });

      let notificationCount = 0;
      session.client.setNotificationHandler(ToolListChangedNotificationSchema, function handleToolListChanged() {
        notificationCount += 1;
      });

      await session.client.listTools({});
      await session.client.callTool({ name: 'rebalance', arguments: { cycles: 3 } });
      await delay(0);
      assert.equal(notificationCount, 1);
    });
  });
});
