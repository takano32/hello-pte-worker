// ランチャーのテスト。OpenPipes の test/server-tests.js と同じ流儀で、依存なし・
// ネットワーク不要・子プロセスを立てて HTTP で確かめる。`npm test` から走る。
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { findEnvFile, parseEnv, parseEnvFallback, applyEnv, PLATFORM_KEYS } from '../lib/env.js';
import { MIN_NODE, meetsMinimum, parseVersion } from '../lib/version.js';
// OpenPipes に同梱されている偽 OIDC プロバイダ。Google アカウント無しで google モードを一周できる
import { startFakeIssuer } from 'openpipes/test/fake-issuer.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

// 作った一時ディレクトリはまとめて消す
const tempDirs = [];
async function tempDir(prefix) {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

// --------------------------------------------------------------- unit: env.js

test('findEnvFile: 親を遡って最初の .env を返す', async () => {
  const t = await tempDir('launcher-find-');
  const home = path.join(t, 'home');
  const sub = path.join(home, 'app', 'sub');
  await mkdir(sub, { recursive: true });
  await writeFile(path.join(home, '.env'), 'A=1\n');

  assert.equal(findEnvFile(sub, home), path.join(home, '.env'));

  // より近いほうが勝つ
  await writeFile(path.join(home, 'app', '.env'), 'A=2\n');
  assert.equal(findEnvFile(sub, home), path.join(home, 'app', '.env'));
  assert.equal(findEnvFile(path.join(home, 'app'), home), path.join(home, 'app', '.env'));
});

test('findEnvFile: stopDir の外は見ない', async () => {
  const t = await tempDir('launcher-stop-');
  const home = path.join(t, 'home');
  const sub = path.join(home, 'app', 'sub');
  await mkdir(sub, { recursive: true });
  await writeFile(path.join(t, '.env'), 'A=1\n'); // stop の外にしかない

  assert.equal(findEnvFile(sub, home), null);
  assert.equal(findEnvFile(home, home), null);
});

test('findEnvFile: startDir が stopDir の外なら自分のディレクトリだけを見る', async () => {
  const t = await tempDir('launcher-outside-');
  const home = path.join(t, 'home');
  const outside = path.join(t, 'outside', 'deep');
  await mkdir(home, { recursive: true });
  await mkdir(outside, { recursive: true });
  await writeFile(path.join(t, 'outside', '.env'), 'A=1\n'); // 親にはあるが遡らない

  assert.equal(findEnvFile(outside, home), null);

  await writeFile(path.join(outside, '.env'), 'A=2\n');
  assert.equal(findEnvFile(outside, home), path.join(outside, '.env'));
});

test('applyEnv: 既存を上書きせず、PORT / SERVER_PORT は読まない', () => {
  const env = { FOO: 'keep' };
  const applied = applyEnv({ OPENPIPES_PASSWORD: 'x', PORT: '9', SERVER_PORT: '9', FOO: '1' }, env);

  assert.equal(env.FOO, 'keep');
  assert.equal(env.OPENPIPES_PASSWORD, 'x');
  assert.equal(env.PORT, undefined);
  assert.equal(env.SERVER_PORT, undefined);
  assert.deepEqual(applied, ['OPENPIPES_PASSWORD']);
  assert.deepEqual([...PLATFORM_KEYS].sort(), ['PORT', 'SERVER_PORT']);
});

test('parseEnv: コメント・引用符・export を扱う(簡易パーサも同じ結果)', () => {
  const text = [
    '# コメント行',
    '',
    'FOO=bar',
    'QUOTED="has space"',
    "SINGLE='sq'",
    'export EXPORTED=ok',
    'EMPTY=',
  ].join('\n');
  const expected = {
    FOO: 'bar', QUOTED: 'has space', SINGLE: 'sq', EXPORTED: 'ok', EMPTY: '',
  };

  assert.deepEqual({ ...parseEnv(text) }, expected);
  assert.deepEqual({ ...parseEnvFallback(text) }, expected);
});

// ----------------------------------------------------------- unit: version.js

test('meetsMinimum: node:sqlite に足りる版だけを通す', () => {
  assert.equal(MIN_NODE, '22.13.0');
  assert.equal(meetsMinimum('v24.19.0', '22.13.0'), true);
  assert.equal(meetsMinimum('v22.13.0'), true);
  assert.equal(meetsMinimum('v22.13.1'), true);
  assert.equal(meetsMinimum('v23.0.0'), true);
  assert.equal(meetsMinimum('v22.12.9'), false);
  assert.equal(meetsMinimum('v20.19.0'), false);
  assert.equal(meetsMinimum('garbage'), false);
  assert.equal(meetsMinimum('v24.19.0', 'garbage'), false);

  assert.deepEqual(parseVersion('v24.19.0'), [24, 19, 0]);
  assert.deepEqual(parseVersion('22.13.0'), [22, 13, 0]);
  assert.equal(parseVersion('garbage'), null);
});

// ------------------------------------------------------------------- smoke

let nextPort = 25000 + (process.pid % 1000) * 10;

// 子プロセスの環境はホストの設定を持ち込まないよう、ポートと OPENPIPES_*(OPENPIPES_DB を
// 含む)を消してから組み立てる。DB の置き場は各ケースが必ず自分で決める。
function childEnv(extra) {
  const env = { ...process.env };
  delete env.PORT;
  delete env.SERVER_PORT;
  delete env.ENV_FILE;
  for (const key of Object.keys(env)) {
    if (key.startsWith('OPENPIPES_')) delete env[key];
  }
  return { ...env, ...extra };
}

// extra はオブジェクトでも、ポートを受け取る関数でもよい(OPENPIPES_BASE_URL はポートに依るため)
async function withServer(extra, body) {
  const port = nextPort++;
  const resolved = typeof extra === 'function' ? extra(port) : extra;
  const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    cwd: ROOT,
    env: childEnv({ SERVER_PORT: String(port), ...resolved }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  // stdout と stderr は分けて溜める(WARNING は stderr に出る)
  const out = [];
  const err = [];
  child.stdout.on('data', (d) => out.push(String(d)));
  child.stderr.on('data', (d) => err.push(String(d)));

  const origin = `http://127.0.0.1:${port}`;
  const logs = () => ({ stdout: out.join(''), stderr: err.join(''), all: out.join('') + err.join('') });
  try {
    for (let i = 0; ; i++) {
      try {
        await fetch(`${origin}/api/config`);
        break;
      } catch {
        if (i > 60) throw new Error('server did not start:\n' + logs().all);
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    return await body({ origin, logs, port });
  } finally {
    child.kill('SIGKILL');
    await new Promise((r) => child.once('exit', r));
  }
}

const basic = (user, pass) =>
  ({ authorization: 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64') });

const MINIMAL_PIPE = {
  name: 'launcher test',
  modules: [{ id: 'm1', type: 'output', params: {}, x: 0, y: 0 }],
  wires: [],
};

const postPipe = (origin, body = MINIMAL_PIPE) => fetch(`${origin}/api/pipes`, {
  method: 'POST',
  headers: { ...basic('admin', 'test-only'), 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

// .env のある一時ディレクトリを作り、そのパスを返す。SERVER_PORT / PORT は
// ファイルから読まれないことの確認用にわざと壊れた値を入れてある。
async function writeEnvFile(prefix, extraLines = []) {
  const dir = await tempDir(prefix);
  const file = path.join(dir, '.env');
  await writeFile(file, [
    'OPENPIPES_PASSWORD=test-only',
    'OPENPIPES_HOST=127.0.0.1',
    'OPENPIPES_DB=:memory:',
    'SERVER_PORT=1',
    'PORT=1',
    ...extraLines,
    '',
  ].join('\n'));
  return { dir, file };
}

test('ケース A: .env が効き、値はログに出ず、公開フィードが動く', async () => {
  const { file } = await writeEnvFile('launcher-env-a-');
  await withServer({ ENV_FILE: file }, async ({ origin, logs }) => {
    const config = await (await fetch(`${origin}/api/config`)).json();
    assert.deepEqual(config, { readOnly: false, auth: 'basic', user: null });

    assert.equal((await fetch(`${origin}/`)).status, 401);
    assert.equal((await fetch(`${origin}/`, { headers: basic('admin', 'test-only') })).status, 200);

    // 同梱デモがファイルから読めて、/demo/tech.xml の自己取得が効いている証拠
    const feed = await fetch(`${origin}/pipes/demo-tech-filter/run`);
    assert.equal(feed.status, 200);
    assert.match(await feed.text(), /<rss/);

    const { stdout, all } = logs();
    assert.match(stdout, /\[launcher\] node v\d+\.\d+\.\d+; .*applied: /);
    assert.match(stdout, /auth=basic/);
    assert.match(stdout, /db :memory:/);
    assert.ok(!all.includes('test-only'), `ログに値が出ている: ${all}`);
    assert.ok(!all.includes('WARNING'), `WARNING が出ている: ${all}`);
  });
});

test('ケース B: .env が無ければ認証なしで起動し、WARNING を出す', async () => {
  const dir = await tempDir('launcher-env-b-');
  const extra = { ENV_FILE: path.join(dir, 'missing', '.env'), OPENPIPES_DB: ':memory:' };
  await withServer(extra, async ({ origin, logs }) => {
    const config = await (await fetch(`${origin}/api/config`)).json();
    assert.deepEqual(config, { readOnly: false, auth: 'none', user: null });

    const { stdout, stderr } = logs();
    assert.match(stdout, /\[launcher\] node v[\d.]+; no \.env;/);
    assert.match(stdout, /auth=none/);
    assert.match(stderr, /WARNING: no OPENPIPES_PASSWORD and no Google login/);
  });
});

test('ケース C: OPENPIPES_DB の場所に DB が出来て、再起動をまたいで残る', async () => {
  const { dir, file } = await writeEnvFile('launcher-env-c-');
  const db = path.join(dir, 'nested', 'openpipes.db'); // nested はまだ作っていない
  await writeFile(file, [
    'OPENPIPES_PASSWORD=test-only',
    'OPENPIPES_HOST=127.0.0.1',
    `OPENPIPES_DB=${db}`,
    'SERVER_PORT=1',
    'PORT=1',
    '',
  ].join('\n'));

  const id = await withServer({ ENV_FILE: file }, async ({ origin, logs }) => {
    const res = await postPipe(origin);
    assert.equal(res.status, 200, logs().all);
    const saved = await res.json();
    assert.match(saved.id, /^launcher-test-[0-9a-f]{16}$/);
    return saved.id;
  });

  assert.ok((await stat(db)).isFile(), `${db} が出来ていない`);

  // 同じ .env で入れ直す。DB が指定した場所に残っている証拠
  await withServer({ ENV_FILE: file }, async ({ origin, logs }) => {
    const res = await fetch(`${origin}/api/pipes`, { headers: basic('admin', 'test-only') });
    assert.equal(res.status, 200, logs().all);
    const list = await res.json();
    assert.ok(list.some((p) => p.id === id), `再起動後の一覧に残っていない: ${JSON.stringify(list)}`);
  });
});

test('ケース D: OPENPIPES_READONLY=1 で保存が 403 になる', async () => {
  const { file } = await writeEnvFile('launcher-env-d-', ['OPENPIPES_READONLY=1']);
  await withServer({ ENV_FILE: file }, async ({ origin, logs }) => {
    const config = await (await fetch(`${origin}/api/config`)).json();
    assert.deepEqual(config, { readOnly: true, auth: 'basic', user: null });

    assert.equal((await postPipe(origin)).status, 403);
    assert.match(logs().stdout, /read-only=true/);
  });
});

// --------------------------------------------------- smoke: google モード

// Cookie を持ち回るだけの最小の入れ物。fetch は redirect: 'manual' で 1 ホップずつ進める
function cookieJar() {
  const jar = new Map();
  return {
    header: () => [...jar].map(([k, v]) => `${k}=${v}`).join('; '),
    take(res) {
      for (const raw of res.headers.getSetCookie?.() ?? []) {
        const [pair] = raw.split(';');
        const eq = pair.indexOf('=');
        const name = pair.slice(0, eq).trim();
        const value = pair.slice(eq + 1).trim();
        if (value === '' || /Max-Age=0/i.test(raw)) jar.delete(name);
        else jar.set(name, value);
      }
      return res;
    },
  };
}

// /auth/google/login → 偽 issuer の /authorize → /auth/google/callback まで進めて、
// callback の応答を返す(成功なら 302、許可外なら 4xx)。
async function walkLogin(origin, jar) {
  const hop = (url) => fetch(url, {
    redirect: 'manual',
    headers: jar.header() ? { cookie: jar.header() } : {},
  }).then((r) => jar.take(r));

  const login = await hop(`${origin}/auth/google/login`);
  assert.equal(login.status, 302, '/auth/google/login が 302 を返さない');
  const authorize = await hop(login.headers.get('location'));
  assert.equal(authorize.status, 302, `偽 issuer の /authorize が 302 を返さない: ${authorize.status}`);
  const callback = authorize.headers.get('location');
  assert.ok(callback.startsWith(`${origin}/auth/google/callback`), `戻り先が違う: ${callback}`);
  return hop(callback);
}

test('ケース E: 偽 issuer 相手に google モードが一周し、許可リストが効く', async () => {
  const issuer = await startFakeIssuer({ clientId: 'test-client', clientSecret: 'test-secret' });
  const googleEnv = (port) => ({
    ENV_FILE: path.join(ROOT, 'no-such-.env'),   // 手元の .env を読ませない(併用は起動拒否になる)
    OPENPIPES_DB: ':memory:',
    OPENPIPES_HOST: '127.0.0.1',
    OPENPIPES_BASE_URL: `http://127.0.0.1:${port}`,
    OPENPIPES_GOOGLE_CLIENT_ID: 'test-client',
    OPENPIPES_GOOGLE_CLIENT_SECRET: 'test-secret',
    OPENPIPES_OIDC_ISSUER: issuer.issuer,
    OPENPIPES_ALLOWED_USERS: 'allowed@example.com',
  });

  try {
    await withServer(googleEnv, async ({ origin, logs }) => {
      const { stdout, stderr, all } = logs();
      assert.match(stdout, /auth=google/, `ログに auth=google が無い: ${stdout}`);
      assert.ok(!all.includes('test-secret'), 'シークレットがログに出ている');
      assert.ok(!stderr.includes('WARNING'), 'google モードなのに WARNING が出ている');

      // ログイン前
      assert.deepEqual(await (await fetch(`${origin}/api/config`)).json(),
        { readOnly: false, auth: 'google', user: null });
      // エディタは 401 ではなく開く(ログイン画面はエディタが出す)
      assert.equal((await fetch(`${origin}/`)).status, 200);

      // 許可外は弾かれ、ログインできない
      const stranger = cookieJar();
      issuer.setUser({ sub: 's1', email: 'stranger@example.com', email_verified: true, name: '部外者' });
      const denied = await walkLogin(origin, stranger);
      assert.ok(denied.status >= 400, `許可外が弾かれていない: ${denied.status}`);
      const asStranger = await (await fetch(`${origin}/api/config`,
        { headers: { cookie: stranger.header() } })).json();
      assert.equal(asStranger.user, null, '許可外がログインできてしまっている');

      // 許可済みは一周でき、セッションでパイプ一覧が読める
      const allowed = cookieJar();
      issuer.setUser({ sub: 'a1', email: 'allowed@example.com', email_verified: true, name: '許可' });
      const ok = await walkLogin(origin, allowed);
      assert.ok(ok.status === 302 || ok.status === 200, `許可済みが弾かれた: ${ok.status}`);
      const cfg = await (await fetch(`${origin}/api/config`,
        { headers: { cookie: allowed.header() } })).json();
      assert.equal(cfg.auth, 'google');
      assert.ok(cfg.user && cfg.user.email === 'allowed@example.com',
        `user が入っていない: ${JSON.stringify(cfg)}`);

      const list = await fetch(`${origin}/api/pipes`, { headers: { cookie: allowed.header() } });
      assert.equal(list.status, 200);
      assert.ok((await list.json()).some((p) => p.id === 'demo-tech-filter'), 'デモが一覧に出ていない');

      // ログに出るのは login <ユーザー id> だけ。メールもトークンも出ない
      const after = logs();
      assert.match(after.all, /login u-[0-9a-f]{16}/, `login の行が無い: ${after.all}`);
      assert.ok(!after.all.includes('allowed@example.com'), 'メールアドレスがログに出ている');
    });
  } finally {
    await issuer.close();
  }
});

// ------------------------------------------------------------------- runner

let passed = 0;
let failed = 0;
for (const { name, fn } of tests) {
  try {
    await fn();
    console.log(`ok ${name}`);
    passed += 1;
  } catch (err) {
    console.log(`FAIL ${name}`);
    console.log('  ' + String(err && err.stack ? err.stack : err).split('\n').join('\n  '));
    failed += 1;
  }
}
for (const dir of tempDirs) await rm(dir, { recursive: true, force: true }).catch(() => {});
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
