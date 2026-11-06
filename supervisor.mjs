import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, lstatSync, symlinkSync, readlinkSync, chmodSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';

const root = '/home/container';
const appRoot = '/opt/kener';
const children = [];
let stopping;
let app;
let redis;
let tunnel;
const log = (message) => console.log(`[kener-egg] ${message}`);

function launch(command, args, stdio = 'inherit', env = process.env) {
  const child = spawn(command, args, { cwd: root, env, stdio });
  child.done = new Promise((resolve) => {
    child.once('error', (error) => {
      console.error(`[kener-egg] ${command}を起動できません: ${error.message}`);
      resolve();
      void stop(1);
    });
    child.once('exit', (code, signal) => {
      resolve();
      if (!stopping) {
        console.error(`[kener-egg] ${command}が終了しました（${signal ?? code}）。`);
        void stop(code || 1);
      }
    });
  });
  children.push(child);
  return child;
}

async function terminate(child, signal) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill(signal);
  let timer;
  await Promise.race([
    child.done,
    new Promise((resolve) => {
      timer = setTimeout(() => {
        child.kill('SIGKILL');
        resolve();
      }, 25000);
    }),
  ]);
  clearTimeout(timer);
}

function stop(code) {
  if (stopping) return stopping;
  // Defer execution so the guard is set before a child's exit event arrives.
  stopping = Promise.resolve().then(async () => {
    log('トンネル、Kenerの順に停止し、Valkeyのデータを保存して終了します。');
    await terminate(tunnel, 'SIGTERM');
    await terminate(app, 'SIGTERM');
    await terminate(redis, 'SIGTERM');
    for (const child of children) await terminate(child, 'SIGTERM');
    process.exit(code);
  });
  return stopping;
}

process.on('SIGINT', () => void stop(0));
process.on('SIGTERM', () => void stop(0));

async function main() {
  process.chdir(root);
  // Optional SMTP and other Kener configuration. Panel variables take precedence.
  try { process.loadEnvFile(`${root}/.env`); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  // Kener loads .env itself; credentials there would leak back into its environment.
  try {
    const extraEnv = readFileSync(`${root}/.env`, 'utf8');
    if (/^\s*(?:export\s+)?(?:CLOUDFLARED_TOKEN|TUNNEL_TOKEN|TUNNEL_TOKEN_FILE)\s*=/m.test(extraEnv)) {
      throw new Error('トンネルトークンは.envではなく、Panelの起動設定に入力してください。');
    }
  } catch (error) { if (error.code !== 'ENOENT') throw error; }

  const tunnelToken = (process.env.CLOUDFLARED_TOKEN || '').trim();
  // Do not pass the credential to Kener, Redis, or their descendants.
  delete process.env.CLOUDFLARED_TOKEN;
  delete process.env.TUNNEL_TOKEN;
  delete process.env.TUNNEL_TOKEN_FILE;
  if (tunnelToken && (tunnelToken.length > 8192 || /\s/.test(tunnelToken))) {
    throw new Error('CLOUDFLARED_TOKENには起動コマンド全体ではなく、トークン値だけを入力してください（8192文字以内・空白なし）。');
  }

  const allocationPort = Number(process.env.SERVER_PORT);
  if (!Number.isInteger(allocationPort) || allocationPort < 1024 || allocationPort > 65535 || allocationPort === 6379) {
    throw new Error('割り当てポート（SERVER_PORT）は1024〜65535の範囲で、6379以外を指定してください。');
  }
  let origin;
  try { origin = new URL(process.env.ORIGIN || ''); }
  catch { throw new Error('公開URL（ORIGIN）に有効なURLを入力してください。'); }
  if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password ||
      origin.pathname !== '/' || origin.search || origin.hash) {
    throw new Error('公開URL（ORIGIN）はhttp://またはhttps://で始め、パス・クエリー・認証情報を含めずに入力してください。');
  }
  if (origin.hostname === 'status.example.com') throw new Error('公開URL（ORIGIN）を実際に使用するURLへ変更してください。');
  if (tunnelToken && origin.protocol !== 'https:') throw new Error('Cloudflare Tunnelを使う場合は、公開URL（ORIGIN）にHTTPSのURLを指定してください。');
  const port = tunnelToken ? 3000 : allocationPort;
  process.env.ORIGIN = origin.origin;
  process.env.PORT = String(port);
  process.env.HOST = tunnelToken ? '127.0.0.1' : '0.0.0.0';
  process.env.KENER_BASE_PATH = '';
  process.env.REDIS_URL = 'redis://127.0.0.1:6379';
  process.env.DATABASE_URL = 'sqlite://./database/kener.sqlite.db';
  process.env.NODE_ENV = 'production';

  for (const name of ['database', 'redis']) mkdirSync(`${root}/${name}`, { recursive: true });
  // The application is immutable in the image; only instance data is on the server volume.
  for (const name of ['build', 'node_modules', 'migrations', 'seeds', 'src', 'package.json']) {
    const target = `${root}/${name}`;
    try {
      const stat = lstatSync(target);
      if (!stat.isSymbolicLink() || readlinkSync(target) !== `${appRoot}/${name}`) {
        throw new Error(`${target}が既に存在します。バックアップして別の場所へ移動してから起動してください。`);
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      symlinkSync(`${appRoot}/${name}`, target);
    }
  }

  const secretFile = `${root}/.kener-secret`;
  if (!process.env.KENER_SECRET_KEY) {
    try { writeFileSync(secretFile, randomBytes(48).toString('hex') + '\n', { flag: 'wx', mode: 0o600 }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    process.env.KENER_SECRET_KEY = readFileSync(secretFile, 'utf8').trim();
    chmodSync(secretFile, 0o600);
  }
  if (process.env.KENER_SECRET_KEY.length < 32) throw new Error('秘密鍵（KENER_SECRET_KEY）は32文字以上で指定してください。');

  redis = launch('redis-server', [
    '--bind', '127.0.0.1', '--protected-mode', 'yes', '--port', '6379',
    '--dir', `${root}/redis`, '--appendonly', 'yes', '--appendfsync', 'everysec',
    '--save', '', '--daemonize', 'no', '--loglevel', 'warning', '--maxmemory-policy', 'noeviction',
  ]);
  let redisReady = false;
  for (let i = 0; i < 120 && !stopping; i++) {
    const probe = spawn('redis-cli', ['-h', '127.0.0.1', 'ping'], { stdio: ['ignore', 'pipe', 'ignore'] });
    let output = '';
    probe.stdout.on('data', (chunk) => { output += chunk; });
    const result = await new Promise((resolve) => {
      const timer = setTimeout(() => probe.kill('SIGKILL'), 2000);
      probe.once('error', () => { clearTimeout(timer); resolve(false); });
      probe.once('close', (code) => { clearTimeout(timer); resolve(code === 0 && output.trim() === 'PONG'); });
    });
    if (result) { redisReady = true; break; }
    await delay(500);
  }
  if (stopping) return;
  if (!redisReady) throw new Error('Valkeyを起動できませんでした。保存領域の権限と直前のログを確認してください。');

  app = launch(process.execPath, [`${appRoot}/build/main.js`], ['ignore', 'pipe', 'pipe']);
  let started = false;
  let pending = '';
  app.stdout.on('data', (chunk) => {
    process.stdout.write(chunk);
    pending = (pending + chunk).slice(-8192);
    if (pending.includes('Kener is running on port ')) started = true;
  });
  let errors = '';
  app.stderr.on('data', (chunk) => {
    process.stderr.write(chunk);
    errors = (errors + chunk).slice(-8192);
    if (/Error running (migrations|seed):/.test(errors)) void stop(1);
  });
  for (let i = 0; i < 180 && !stopping; i++) {
    let healthy = false;
    if (started) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/healthcheck?strict=1`, { signal: AbortSignal.timeout(4000) });
        const health = await response.json();
        healthy = response.ok && health.db === true && health.redis === true;
      } catch { /* Retry while startup completes. */ }
    }
    if (healthy && !stopping) {
      if (tunnelToken) await startTunnel(tunnelToken);
      if (stopping) return;
      log(`起動完了: ポート ${port}`);
      return;
    }
    await delay(1000);
  }
  if (!stopping) throw new Error('Kenerの起動時の正常性確認に失敗しました。直前のログを確認してください。');
}

// Buffer complete lines so a token split between stdout/stderr chunks is still masked.
function forwardTunnelLog(stream, output, token) {
  let pending = '';
  const flush = (line) => output.write(line.split(token).join('[REDACTED]'));
  stream.on('data', (chunk) => {
    pending += chunk.toString();
    let newline;
    while ((newline = pending.indexOf('\n')) !== -1) {
      flush(pending.slice(0, newline + 1));
      pending = pending.slice(newline + 1);
    }
    // Fail closed for unexpectedly long lines rather than flushing a partial secret.
    if (pending.length > 65536) pending = '[cloudflaredの長すぎるログ行を省略しました]\n';
  });
  stream.on('end', () => { if (pending) flush(pending); pending = ''; });
}

async function startTunnel(token) {
  log('Cloudflare Tunnelを起動し、Cloudflareへの接続を待っています。');
  tunnel = launch('cloudflared', [
    'tunnel', '--no-autoupdate', '--metrics', '127.0.0.1:20241',
    '--grace-period', '10s', 'run',
  ], ['ignore', 'pipe', 'pipe'], { ...process.env, TUNNEL_TOKEN: token });
  forwardTunnelLog(tunnel.stdout, process.stdout, token);
  forwardTunnelLog(tunnel.stderr, process.stderr, token);
  for (let i = 0; i < 120 && !stopping; i++) {
    try {
      const response = await fetch('http://127.0.0.1:20241/ready', { signal: AbortSignal.timeout(2000) });
      if (response.ok) {
        log('Cloudflare Tunnelに接続しました。転送先: http://127.0.0.1:3000');
        return;
      }
    } catch { /* cloudflared owns its reconnection/backoff while running. */ }
    await delay(1000);
  }
  if (!stopping) throw new Error('Cloudflare Tunnelに接続できませんでした。トークンと外向き通信の許可設定を確認してください。');
}

main().catch((error) => {
  console.error(`[kener-egg] ${error.message}`);
  void stop(1);
});
