export const info = { name: 'mcp-test-server', version: '0.1.0' };

export const instructions = [
  'MCP test server exercises tools, resources, prompts, completions, sampling, elicitation, roots, and debounced notifications',
  'so every integration path described in the TypeScript SDK README is available for automated verification.'
].join(' ');

export const debouncedNotifications = [
  'notifications/tools/list_changed',
  'notifications/resources/list_changed',
  'notifications/prompts/list_changed'
];
