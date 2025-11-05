import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const entry = fileURLToPath(new URL('../src/bin.js', import.meta.url));

describe('test-server', function serverSuite() {
  describe('bin', function binSuite() {
    it('exposes tools, resources, prompts, and instructions', async function binFeaturesCase(t) {
      const transport = new StdioClientTransport({
        command: process.execPath,
        args: [entry]
      });
      const client = new Client({ name: 'mcp-layer-tests', version: '0.0.0' });
      await client.connect(transport);

      t.after(async function cleanup() {
        await client.close();
        await transport.close();
      });

      const info = client.getServerVersion();
      assert.equal(info?.name, 'mcp-test-server');

      const guide = client.getInstructions();
      assert.equal(typeof guide, 'string');
      assert.equal(guide?.includes('Echo'), true);

      const tools = await client.listTools({});
      const toolNames = tools.tools.map(function pickName(item) {
        return item.name;
      });
      assert.deepEqual(toolNames.sort(), ['add', 'echo']);

      const echo = await client.callTool({ name: 'echo', arguments: { text: 'hello' } });
      assert.equal(echo.content?.[0]?.type, 'text');

      const prompts = await client.listPrompts({});
      const promptNames = prompts.prompts.map(function pickPrompt(item) {
        return item.name;
      });
      assert.equal(promptNames.includes('welcome'), true);

      const prompt = await client.getPrompt({ name: 'welcome', arguments: { name: 'Ada', tone: 'formal' } });
      assert.equal(prompt.messages[0]?.content?.text.includes('Ada'), true);

      const resources = await client.listResources({});
      assert.equal(resources.resources.length > 0, true);

      const manual = await client.readResource({ uri: 'resource://manual' });
      assert.equal(manual.contents?.[0]?.text.includes('manual'), true);
    });
  });
});
