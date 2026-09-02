// server.js — SORAHOST PteWorker 用の起動ファイル(sorahost.json の "start" が指す)。
// Node の版を確かめ、.env を探して読み、DB の置き場を決めてから OpenPipes 本体を起動する。
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findEnvFile, parseEnv, applyEnv } from './lib/env.js';
import { MIN_NODE, meetsMinimum } from './lib/version.js';

const REPO_ROOT = path.dirname(fileURLToPath(import.meta.url));

// 0. Node の版。OpenPipes は node:sqlite を使うので、古い Node では import の時点で落ちる。先に止める
if (!meetsMinimum(process.version, MIN_NODE)) {
  console.error(`[launcher] Node ${MIN_NODE} or newer is required (node:sqlite); this is ${process.version}`);
  process.exit(1);
}

// 1. .env: ENV_FILE で明示、無ければ自分のディレクトリから HOME まで遡って探す
const envFile = process.env.ENV_FILE ? path.resolve(process.env.ENV_FILE) : findEnvFile(REPO_ROOT);
let envNote = 'no .env';
if (envFile && existsSync(envFile)) {
  const applied = applyEnv(parseEnv(readFileSync(envFile, 'utf8')));
  envNote = `${envFile} applied: ${applied.join(', ') || '(nothing new)'}`;
}

// 2. DB の置き場。未設定なら <repo>/data/openpipes.db(node_modules の中に作らせない)。
//    ディレクトリは OpenPipes が起動時に作る
const rawDb = process.env.OPENPIPES_DB;
const dbPath = !rawDb ? path.join(REPO_ROOT, 'data', 'openpipes.db')
  : rawDb === ':memory:' ? ':memory:' : path.resolve(rawDb);
process.env.OPENPIPES_DB = dbPath;

// 3. 認証モードの見立て(判定と検証は本体が行う。ここはログと警告のためだけ)
const authMode = (process.env.OPENPIPES_GOOGLE_CLIENT_ID || process.env.OPENPIPES_GOOGLE_CLIENT_SECRET) ? 'google'
  : process.env.OPENPIPES_PASSWORD ? 'basic' : 'none';

console.log(`[launcher] node ${process.version}; ${envNote}; db ${dbPath}; auth=${authMode}; ` +
  `read-only=${process.env.OPENPIPES_READONLY === '1'}`);
if (authMode === 'none') {
  console.error('[launcher] WARNING: no OPENPIPES_PASSWORD and no Google login; the editor and /api/run are open to anyone');
}

// 4. 本体
await import('openpipes/server.js');
