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

async function withServer(extra, body) {
  const port = nextPort++;
  const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    cwd: ROOT,
    env: childEnv({ SERVER_PORT: String(port), ...extra }),
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
