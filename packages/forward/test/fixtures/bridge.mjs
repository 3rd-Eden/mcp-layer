import { forward } from '../../src/index.js';

const runtime = await forward({ target: process.argv[2], transport: 'stdio', auth: false, info: { name: 'bridge-test', version: '1.0.0' } });
let signaled = false;
/** Close the SDK transport pair on parent cancellation. @returns {void} */
function stop() { signaled = true; void runtime.close(); }
process.once('SIGTERM', stop);
await runtime.closed;
process.stderr.write(`bridge-closed:${signaled ? 'signal' : 'eof'}\n`);
