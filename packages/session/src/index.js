/**
 * Shared MCP session wrapper used by connect and attach.
 * @class
 */
export class Session {
  /**
   * @param {{ name: string, source: string, entry: { name: string, source: string, config: Record<string, unknown> } | null, client: import('@modelcontextprotocol/sdk/client/index.js').Client, transport: unknown, info: { name: string, version: string } }} data
   */
  constructor(data) {
    this.name = data.name;
    this.source = data.source;
    this.entry = data.entry;
    this.client = data.client;
    this.transport = data.transport;
    this.info = data.info;
  }

  /**
   * Close the client and transport.
   * @returns {Promise<void>}
   */
  async close() {
    await this.client.close();
    if (this.transport && typeof this.transport.close === 'function') await this.transport.close();
  }
}
