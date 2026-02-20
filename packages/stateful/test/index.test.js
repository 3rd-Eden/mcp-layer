import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createService } from '../src/service.js';
import { request } from '../src/client.js';
import { endpoint, eventsFile, serviceFile, sessionsFile } from '../src/path.js';
import { appendEvent } from '../src/store.js';

const read = createRequire(import.meta.url);
const serverpkg = read.resolve('@mcp-layer/test-server/package.json');
const entry = path.join(path.dirname(serverpkg), 'src', 'bin.js');

/**
 * Create a temporary config file for stateful session tests.
 * @returns {Promise<{ dir: string, file: string }>}
 */
async function fixture() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-layer-stateful-'));
  const file = path.join(dir, 'mcp.json');

  const config = {
    servers: {
      demo: {
        command: process.execPath,
        args: [entry]
      }
    }
  };

  await fs.writeFile(file, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  return { dir, file };
}

/**
 * Remove temporary fixture files.
 * @param {string} dir - Temporary directory.
 * @returns {Promise<void>}
 */
async function cleanup(dir) {
  await fs.rm(dir, { recursive: true, force: true });
}

/**
 * Apply an isolated home directory for endpoint-sensitive tests.
 * @param {string} dir - Home directory override.
 * @returns {() => void}
 */
function applyhome(dir) {
  const prevHome = process.env.HOME;
  const prevProfile = process.env.USERPROFILE;
  process.env.HOME = dir;
  process.env.USERPROFILE = dir;

  /**
   * Restore previous environment variables.
   * @returns {void}
   */
  function restore() {
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;

    if (prevProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = prevProfile;
  }

  return restore;
}

/**
 * Execute stateful package tests.
 * @returns {void}
 */
function suite() {
  it('opens, executes, lists, and stops sessions', async function lifecycleCase() {
    const setup = await fixture();
    const service = await createService();

    try {
      const opened = await service.open({ config: setup.file, server: 'demo' });
      assert.equal(typeof opened.id, 'string');
      assert.equal(opened.generated, true);
      assert.equal(opened.server, 'demo');

      const catalog = await service.catalog({ name: opened.id });
      assert.equal(Array.isArray(catalog.items), true);

      const executed = await service.execute({
        name: opened.id,
        method: 'tools/call',
        params: { name: 'echo', arguments: { text: 'hello' } }
      });

      assert.equal(Array.isArray(executed.result?.content), true);
      assert.equal(executed.result.content[0].text, 'hello');

      const listed = await service.list();
      assert.equal(listed.length > 0, true);

      const stopped = await service.stop({ name: opened.id });
      assert.equal(stopped.stopped, true);
    } finally {
      await service.close();
      await cleanup(setup.dir);
    }
  });

  it('reuses named sessions and stops all active sessions', async function reuseCase() {
    const setup = await fixture();
    const service = await createService();

    try {
      const first = await service.open({ name: 'alpha', config: setup.file, server: 'demo' });
      const second = await service.open({ name: 'alpha', config: setup.file, server: 'demo' });
      assert.equal(first.id, 'alpha');
      assert.equal(second.reused, true);

      await service.open({ name: 'beta', config: setup.file, server: 'demo' });
      const result = await service.stopAll();
      assert.equal(result.stopped >= 2, true);
    } finally {
      await service.close();
      await cleanup(setup.dir);
    }
  });

  it('evicts least recently used sessions when max is exceeded', async function evictionCase() {
    const setup = await fixture();
    const service = await createService({ maxSessions: 1 });

    try {
      await service.open({ name: 'one', config: setup.file, server: 'demo' });
      await service.open({ name: 'two', config: setup.file, server: 'demo' });

      await assert.rejects(
        service.execute({
          name: 'one',
          method: 'tools/call',
          params: { name: 'echo', arguments: { text: 'stale' } }
        }),
        function verify(error) {
          assert.equal(error.code, 'SESSION_NOT_FOUND');
          return true;
        }
      );
    } finally {
      await service.close();
      await cleanup(setup.dir);
    }
  });

  it('expires idle sessions', async function idleCase() {
    const setup = await fixture();
    const service = await createService({ idleTimeoutMs: 20, sweepIntervalMs: 10 });

    try {
      const opened = await service.open({ name: 'idle', config: setup.file, server: 'demo' });
      await new Promise(function wait(resolve) {
        setTimeout(resolve, 60);
      });

      await assert.rejects(
        service.execute({
          name: opened.id,
          method: 'tools/call',
          params: { name: 'echo', arguments: { text: 'late' } }
        }),
        function verify(error) {
          assert.equal(error.code, 'SESSION_EXPIRED_IDLE');
          return true;
        }
      );
    } finally {
      await service.close();
      await cleanup(setup.dir);
    }
  });

  it('closes expired sessions during execute when sweeper has not run', async function lazyExpiryCase() {
    const setup = await fixture();
    const service = await createService({ idleTimeoutMs: 20, sweepIntervalMs: 600000 });

    try {
      const opened = await service.open({ name: 'lazy', config: setup.file, server: 'demo' });
      await new Promise(function wait(resolve) {
        setTimeout(resolve, 60);
      });

      await assert.rejects(
        service.execute({
          name: opened.id,
          method: 'tools/call',
          params: { name: 'echo', arguments: { text: 'late' } }
        }),
        function verify(error) {
          assert.equal(error.code, 'SESSION_EXPIRED_IDLE');
          return true;
        }
      );

      await assert.rejects(
        service.execute({
          name: opened.id,
          method: 'tools/call',
          params: { name: 'echo', arguments: { text: 'still-late' } }
        }),
        function verify(error) {
          assert.equal(error.code, 'SESSION_EXPIRED_IDLE');
          return true;
        }
      );

      const listed = await service.list();
      const current = listed.find(function find(item) {
        return item.id === opened.id;
      });

      assert.equal(current?.status, 'expired_idle');
    } finally {
      await service.close();
      await cleanup(setup.dir);
    }
  });

  it('reopens expired named sessions instead of reusing stale handles', async function reopenCase() {
    const setup = await fixture();
    const service = await createService({ idleTimeoutMs: 20, sweepIntervalMs: 600000 });

    try {
      const first = await service.open({ name: 'alpha', config: setup.file, server: 'demo' });
      await new Promise(function wait(resolve) {
        setTimeout(resolve, 60);
      });

      const reopened = await service.open({ name: 'alpha', config: setup.file, server: 'demo' });
      assert.equal(first.id, 'alpha');
      assert.equal(reopened.id, 'alpha');
      assert.equal(reopened.reused, false);

      const output = await service.execute({
        name: 'alpha',
        method: 'tools/call',
        params: { name: 'echo', arguments: { text: 'fresh' } }
      });

      assert.equal(output.result.content[0].text, 'fresh');
    } finally {
      await service.close();
      await cleanup(setup.dir);
    }
  });

  it('hardens endpoint permissions on posix', async function permsCase() {
    if (process.platform === 'win32') return;

    const dir = await fs.mkdtemp(path.join('/tmp', 'mls-'));
    const restore = applyhome(dir);
    const service = await createService();

    try {
      await service.listen();
      const info = await fs.stat(endpoint());
      assert.equal(info.mode & 0o777, 0o600);
    } finally {
      await service.close();
      restore();
      await cleanup(dir);
    }
  });

  it('hardens state file permissions on posix', async function stateFilePermsCase() {
    if (process.platform === 'win32') return;

    const setup = await fixture();
    const dir = await fs.mkdtemp(path.join('/tmp', 'mls-'));
    const restore = applyhome(dir);
    const service = await createService();

    try {
      await service.listen();

      const serviceInfo = await fs.stat(serviceFile());
      const sessionInfo = await fs.stat(sessionsFile());
      const eventInfo = await fs.stat(eventsFile());

      assert.equal(serviceInfo.mode & 0o777, 0o600);
      assert.equal(sessionInfo.mode & 0o777, 0o600);
      assert.equal(eventInfo.mode & 0o777, 0o600);

      await service.open({ name: 'perm-check', config: setup.file, server: 'demo' });

      const eventAfter = await fs.stat(eventsFile());
      assert.equal(eventAfter.mode & 0o777, 0o600);
    } finally {
      await service.close();
      restore();
      await cleanup(dir);
      await cleanup(setup.dir);
    }
  });

  it('reports accurate active session counts in health ping', async function pingCountCase() {
    const setup = await fixture();
    const service = await createService();

    try {
      await service.open({ name: 'count-a', config: setup.file, server: 'demo' });
      await service.open({ name: 'count-b', config: setup.file, server: 'demo' });
      assert.equal(service.ping().sessions, 2);

      await service.stop({ name: 'count-a' });
      assert.equal(service.ping().sessions, 1);

      await service.stopAll();
      assert.equal(service.ping().sessions, 0);
    } finally {
      await service.close();
      await cleanup(setup.dir);
    }
  });

  it('refuses to listen when another service owns the endpoint', async function listenConflictCase() {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mls-'));
    const restore = applyhome(dir);
    const first = await createService();
    const second = await createService();

    try {
      await first.listen();

      await assert.rejects(
        second.listen(),
        function verify(error) {
          assert.equal(error.code, 'SESSION_SERVICE_RUNNING');
          return true;
        }
      );
    } finally {
      await first.close();
      restore();
      await cleanup(dir);
    }
  });

  it('does not clear running service metadata when a non-listening instance closes', async function isolatedCloseCase() {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mls-'));
    const restore = applyhome(dir);
    const first = await createService();
    const second = await createService();

    try {
      await first.listen();
      await second.close();

      const health = await request('health.ping');
      assert.equal(health.ok, true);
    } finally {
      await first.close();
      restore();
      await cleanup(dir);
    }
  });

  it('redacts sensitive string values in persisted events log entries', async function eventRedactionCase() {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mls-'));
    const restore = applyhome(dir);

    try {
      await appendEvent({
        type: 'security.check',
        data: {
          note: 'Bearer ABCDEFGHIJKLMNOPQRSTUVWXYZ',
          nested: {
            detail: 'api_key=shhh-1234567890-verysecret'
          }
        }
      });

      const content = await fs.readFile(eventsFile(), 'utf8');
      const lines = content.trim().split('\n');
      const last = JSON.parse(lines.at(-1));

      assert.equal(last.data.note, '[REDACTED]');
      assert.equal(last.data.nested.detail, '[REDACTED]');
    } finally {
      restore();
      await cleanup(dir);
    }
  });

  it('rotates lifecycle event logs when size limits are exceeded', async function eventRotationCase() {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mls-'));
    const restore = applyhome(dir);

    try {
      await appendEvent(
        {
          type: 'rotation.check',
          data: { message: 'a'.repeat(120) }
        },
        {
          maxBytes: 128,
          maxFiles: 2
        }
      );

      await appendEvent(
        {
          type: 'rotation.check',
          data: { message: 'b'.repeat(120) }
        },
        {
          maxBytes: 128,
          maxFiles: 2
        }
      );

      await appendEvent(
        {
          type: 'rotation.check',
          data: { message: 'c'.repeat(120) }
        },
        {
          maxBytes: 128,
          maxFiles: 2
        }
      );

      const current = await fs.readFile(eventsFile(), 'utf8');
      const backupOne = await fs.readFile(`${eventsFile()}.1`, 'utf8');
      const backupTwo = await fs.readFile(`${eventsFile()}.2`, 'utf8');
      let backupThree = null;

      try {
        backupThree = await fs.readFile(`${eventsFile()}.3`, 'utf8');
      } catch {
        backupThree = null;
      }

      assert.equal(current.includes('cccccccccc'), true);
      assert.equal(backupOne.includes('bbbbbbbbbb'), true);
      assert.equal(backupTwo.includes('aaaaaaaaaa'), true);
      assert.equal(backupThree, null);
    } finally {
      restore();
      await cleanup(dir);
    }
  });
}

describe('stateful service', suite);
