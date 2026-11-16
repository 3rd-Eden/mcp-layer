import { Storage } from 'cli-storage';
import { issuer } from '../../src/issuer.js';

/**
 * Redeem a persisted refresh credential from an independent Node process.
 * @param {{directory: string, url: string, resource: string, clientId: string, token: string}} message Private ephemeral test inputs.
 * @returns {Promise<void>} Reports the public provider result through the parent IPC channel.
 */
async function rotate(message) {
  try {
    const storage = new Storage({ namespace: 'issuer-test', directory: message.directory, backend: 'file' });
    const provider = issuer({ url: message.url, resource: message.resource, storage });
    const client = await provider.clientsStore.getClient(message.clientId);
    const result = await provider.exchangeRefreshToken(client, message.token);
    process.send({ status: 'fulfilled', ...result });
  } catch (error) {
    process.send({ status: 'rejected', code: error.code, package: error.package });
  } finally {
    process.disconnect();
  }
}

process.once('message', rotate);
