/**
 * @typedef {object} Entry
 * @property {string} name
 * @property {string} source
 * @property {Record<string, unknown>} config
 */

/**
 * @typedef {object} Client
 * @property {() => Promise<void>} close
 */

/**
 * @typedef {object} Transport
 * @property {() => Promise<void>} close
 */

/**
 * @typedef {object} Info
 * @property {string} name
 * @property {string} version
 */

/**
 * @typedef {object} Data
 * @property {string} name
 * @property {string} source
 * @property {Entry | null} entry
 * @property {Client} client
 * @property {Transport | null | undefined} transport
 * @property {Info} info
 */

/**
 * Shared MCP session wrapper used by connect and attach.
 * @class
 */
export class Session {
  /**
   * @param {Data} data
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
