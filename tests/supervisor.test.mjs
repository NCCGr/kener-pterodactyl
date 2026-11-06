// Lifecycle tests use simulated child processes and storage, not a running Kener/Redis.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { SourceTextModule, SyntheticModule, createContext } from 'node:vm';
import { randomBytes } from 'node:crypto';

const source = readFileSync(new URL('../supervisor.mjs', import.meta.url), 'utf8');
const missing = () => Object.assign(new Error('missing'), { code: 'ENOENT' });
async function harness({ env = {}, storage = new Map(), migrationFailure = false, tunnelFailure = false, tunnelReady = true, tunnelOutput = false } = {}) {
  const logs = [], spawned = [], stopped = [], events = [];
  const process = new EventEmitter();
  Object.assign(process, {
    env: { SERVER_PORT: '3000', ORIGIN: 'https://status.test', ...env },
    execPath: 'node', chdir() {}, loadEnvFile() {},
    stdout: { write: (v) => logs.push(String(v)) },
    stderr: { write: (v) => logs.push(String(v)) },
    exit: (code) => { process.exitCode = code; },
  });
  function spawn(command, args, options = {}) {
    const child = new EventEmitter();
    Object.assign(child, { command, exitCode: null, signalCode: null, stdout: new EventEmitter(), stderr: new EventEmitter() });
    child.kill = (signal) => {
      stopped.push(command);
      child.signalCode = signal;
      queueMicrotask(() => child.emit('exit', null, signal));
      return true;
    };
    spawned.push({ command, args, child, env: { ...(options.env ?? process.env) } });
    events.push(`spawn:${command}`);
    queueMicrotask(() => {
      if (command === 'redis-cli') {
        child.stdout.emit('data', Buffer.from('PONG\n'));
        child.exitCode = 0;
        child.emit('close', 0);
      } else if (command === 'node') {
        if (migrationFailure) child.stderr.emit('data', Buffer.from('Error running migrations: test failure\n'));
        else child.stdout.emit('data', Buffer.from('Kener is running on port 3000!\n'));
      } else if (command === 'cloudflared') {
        if (tunnelOutput) {
          const token = options.env.TUNNEL_TOKEN;
          for (const stream of [child.stdout, child.stderr]) {
            stream.emit('data', Buffer.from(`connector token: ${token.slice(0, 9)}`));
            stream.emit('data', Buffer.from(`${token.slice(9)}\npartial final ${token}`));
            stream.emit('end');
          }
        }
        if (tunnelFailure) {
          child.exitCode = 3;
          child.emit('exit', 3, null);
        }
      }
    });
    return child;
  }
  const fs = {
    mkdirSync() {}, chmodSync() {},
    lstatSync(path) { if (!storage.has(path)) throw missing(); return { isSymbolicLink: () => storage.get(path).link !== undefined }; },
    readlinkSync(path) { return storage.get(path).link; },
    symlinkSync(link, path) { storage.set(path, { link }); },
    readFileSync(path) { if (!storage.has(path)) throw missing(); return storage.get(path).data; },
    writeFileSync(path, data, options) {
      if (options.flag === 'wx' && storage.has(path)) throw Object.assign(new Error('exists'), { code: 'EEXIST' });
      storage.set(path, { data, mode: options.mode });
    },
  };
  const context = createContext({
    process, URL, console: { log: (v) => logs.push(v), error: (v) => logs.push(v) },
    setTimeout, clearTimeout, AbortSignal,
    fetch: async (url) => {
      events.push(`fetch:${url}`);
      return { ok: String(url).endsWith('/ready') ? tunnelReady : true, status: String(url).endsWith('/ready') && !tunnelReady ? 503 : 200, json: async () => ({ db: true, redis: true }) };
    },
  });
  const definitions = {
    'node:child_process': { spawn }, 'node:crypto': { randomBytes }, 'node:fs': fs,
    'node:timers/promises': { setTimeout: () => new Promise(setImmediate) },
  };
  const module = new SourceTextModule(source, { context });
  await module.link((specifier) => {
    const values = definitions[specifier];
    return new SyntheticModule(Object.keys(values), function () {
      for (const [name, value] of Object.entries(values)) this.setExport(name, value);
    }, { context });
  });
  await module.evaluate();
  async function until(predicate) {
    for (let i = 0; i < 1000; i++) {
      if (predicate()) return;
      await new Promise(setImmediate);
    }
    throw new Error(`Condition not met: ${logs.join('\n')}`);
  }
  await until(() => process.exitCode !== undefined || logs.some((v) => v.includes('起動完了: ポート')));
  return { process, logs, spawned, stopped, storage, until, events };
}

test('healthy startup uses private persistent Redis and stops application before Redis', async () => {
  const h = await harness();
  assert(h.logs.some((v) => v.includes('[kener-egg] 起動完了: ポート 3000')));
  const redis = h.spawned.find((s) => s.command === 'redis-server');
  assert.equal(redis.args[redis.args.indexOf('--bind') + 1], '127.0.0.1');
  assert.equal(redis.args[redis.args.indexOf('--appendonly') + 1], 'yes');
  assert.equal(h.process.env.PORT, '3000');
  assert.equal(h.process.env.DATABASE_URL, 'sqlite://./database/kener.sqlite.db');
  assert.equal(h.storage.get('/home/container/.kener-secret').mode, 0o600);
  h.process.emit('SIGINT');
  await h.until(() => h.process.exitCode !== undefined);
  assert.equal(h.process.exitCode, 0);
  assert.deepEqual(h.stopped, ['node', 'redis-server']);
});

test('restart reuses the persisted secret', async () => {
  const storage = new Map();
  const first = await harness({ storage });
  const key = first.process.env.KENER_SECRET_KEY;
  first.process.emit('SIGTERM');
  await first.until(() => first.process.exitCode !== undefined);
  const second = await harness({ storage });
  assert.equal(second.process.env.KENER_SECRET_KEY, key);
  second.process.emit('SIGTERM');
  await second.until(() => second.process.exitCode !== undefined);
});

test('application failure stops Redis and fails the server', async () => {
  const h = await harness();
  const app = h.spawned.find((s) => s.command === 'node').child;
  app.exitCode = 7;
  app.emit('exit', 7, null);
  await h.until(() => h.process.exitCode !== undefined);
  assert.equal(h.process.exitCode, 7);
  assert.deepEqual(h.stopped, ['redis-server']);
});

test('migration failure fails startup and shuts down both children', async () => {
  const h = await harness({ migrationFailure: true });
  assert.equal(h.process.exitCode, 1);
  assert(!h.logs.some((v) => v.includes('起動完了: ポート')));
  assert.deepEqual(h.stopped, ['node', 'redis-server']);
});

test('invalid public origin fails before starting services', async () => {
  const h = await harness({ env: { ORIGIN: 'https://status.test/subpath' } });
  assert.equal(h.process.exitCode, 1);
  assert.equal(h.spawned.length, 0);
});

test('Redis port collision fails before starting services', async () => {
  const h = await harness({ env: { SERVER_PORT: '6379' } });
  assert.equal(h.process.exitCode, 1);
  assert.equal(h.spawned.length, 0);
});

const tunnelToken = 'eyJhbGciOiJTbW9rZVRlc3QiLCJ0b2tlbiI6InRlc3QifQ==';

test('tunnel credentials in .env are rejected before starting child processes', async () => {
  const storage = new Map([['/home/container/.env', { data: `CLOUDFLARED_TOKEN=${tunnelToken}\n` }]]);
  const h = await harness({ storage });
  assert.equal(h.process.exitCode, 1);
  assert.equal(h.spawned.length, 0);
  assert(!h.logs.join('').includes(tunnelToken));
});

test('tunnel mode binds Kener privately and passes token only to cloudflared', async () => {
  const h = await harness({ env: { SERVER_PORT: '31000', CLOUDFLARED_TOKEN: `  ${tunnelToken}  ` } });
  const tunnel = h.spawned.find((s) => s.command === 'cloudflared');
  assert(tunnel, 'cloudflared must be launched');
  assert.equal(h.process.env.PORT, '3000');
  assert.equal(h.process.env.HOST, '127.0.0.1');
  assert.equal(h.process.env.CLOUDFLARED_TOKEN, undefined);
  assert.equal(h.process.env.TUNNEL_TOKEN, undefined);
  assert.equal(tunnel.env.TUNNEL_TOKEN, tunnelToken);
  assert(!tunnel.args.some((argument) => argument.includes(tunnelToken)));
  for (const child of h.spawned.filter((s) => s.command !== 'cloudflared')) {
    assert.equal(child.env.TUNNEL_TOKEN, undefined, `${child.command} received TUNNEL_TOKEN`);
    assert.equal(child.env.CLOUDFLARED_TOKEN, undefined, `${child.command} received CLOUDFLARED_TOKEN`);
  }
  const healthy = h.events.findIndex((event) => event.includes('/healthcheck?strict=1'));
  const launch = h.events.indexOf('spawn:cloudflared');
  const tunnelReady = h.events.indexOf('fetch:http://127.0.0.1:20241/ready');
  assert(healthy >= 0 && healthy < launch && launch < tunnelReady);
  h.process.emit('SIGTERM');
  await h.until(() => h.process.exitCode !== undefined);
  assert.equal(h.process.exitCode, 0);
  assert.deepEqual(h.stopped, ['cloudflared', 'node', 'redis-server']);
});

test('blank tunnel token preserves normal allocation binding', async () => {
  const h = await harness({ env: { SERVER_PORT: '31000', CLOUDFLARED_TOKEN: '   ' } });
  assert.equal(h.process.env.PORT, '31000');
  assert.equal(h.process.env.HOST, '0.0.0.0');
  assert(!h.spawned.some((s) => s.command === 'cloudflared'));
  h.process.emit('SIGTERM');
  await h.until(() => h.process.exitCode !== undefined);
});

test('tunnel requires an HTTPS public origin', async () => {
  const h = await harness({ env: { CLOUDFLARED_TOKEN: tunnelToken, ORIGIN: 'http://status.test' } });
  assert.equal(h.process.exitCode, 1);
  assert.equal(h.spawned.length, 0);
});

test('tunnel failure before readiness stops the application and Redis', async () => {
  const h = await harness({ env: { CLOUDFLARED_TOKEN: tunnelToken }, tunnelFailure: true });
  assert.notEqual(h.process.exitCode, 0);
  assert(!h.logs.some((value) => value.includes('起動完了: ポート')));
  assert.deepEqual(h.stopped, ['node', 'redis-server']);
});

test('loss of the cloudflared process after readiness fails the whole server', async () => {
  const h = await harness({ env: { CLOUDFLARED_TOKEN: tunnelToken } });
  const tunnel = h.spawned.find((s) => s.command === 'cloudflared').child;
  tunnel.exitCode = 9;
  tunnel.emit('exit', 9, null);
  await h.until(() => h.process.exitCode !== undefined);
  assert.notEqual(h.process.exitCode, 0);
  assert.deepEqual(h.stopped, ['node', 'redis-server']);
});

test('an unready tunnel never reports the egg as ready', async () => {
  const h = await harness({ env: { CLOUDFLARED_TOKEN: tunnelToken }, tunnelReady: false });
  assert.notEqual(h.process.exitCode, 0);
  assert(!h.logs.some((value) => value.includes('起動完了: ポート')));
  assert.deepEqual(h.stopped, ['cloudflared', 'node', 'redis-server']);
});

test('tunnel logs redact tokens across chunks and final unterminated lines', async () => {
  const h = await harness({ env: { CLOUDFLARED_TOKEN: tunnelToken }, tunnelOutput: true });
  const output = h.logs.join('');
  assert(!output.includes(tunnelToken));
  assert(output.includes('connector token:'), 'normal cloudflared diagnostics should remain visible');
  assert(output.includes('partial final'), 'unterminated final lines should be flushed');
  h.process.emit('SIGTERM');
  await h.until(() => h.process.exitCode !== undefined);
});
