import { createHash } from 'node:crypto';
import { Storage } from 'cli-storage';
import { authorize } from '../../src/index.js';
import { browser } from './oauth-server.mjs';

const target = process.argv[2];
const directory = process.argv[3];
const storage = new Storage({ namespace: 'authorize-process', directory, backend: 'file' });
const provider = authorize({ target, storage, open: browser, authTimeout: 5000 });
let token;

/** Return an opaque digest for assertions without returning a credential to the parent.
 * @param {string} value OAuth token.
 * @returns {string} SHA-256 token digest.
 */
function digest(value) { return createHash('sha256').update(value).digest('hex'); }

/** Execute one public authorization operation and report only safe state.
 * @param {{id:number,action:'access'|'refresh'|'close'}} message Parent command.
 * @returns {Promise<void>} Completion after sending the result.
 */
async function command(message) {
  try {
    if (message.action === 'close') {
      await provider.close();
      process.send({ id: message.id, status: 'closed' });
      process.disconnect();
      return;
    }
    if (message.action === 'refresh') {
      if (token === undefined) {
        process.send({ id: message.id, status: 'rejected', code: 'ERR_TEST_STATE' });
        return;
      }
      token = await provider.access({ rejected: token });
    } else token = await provider.access();
    process.send({ id: message.id, status: 'fulfilled', digest: digest(token), state: await provider.status() });
  } catch (error) {
    process.send({ id: message.id, status: 'rejected', code: error.code });
  }
}

process.on('message', /** @param {{id:number,action:'access'|'refresh'|'close'}} message Parent command. @returns {void} Start one public provider operation. */
function received(message) { void command(message); });
