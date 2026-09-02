// server.js — SORAHOST PteWorker 用の起動ファイル(sorahost.json の "start" が指す)。
// .env を探して読み、パイプの置き場を決め、必要なら初期データを入れてから OpenPipes 本体を起動する。
import { existsSync, readFileSync, mkdirSync, readdirSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findEnvFile, parseEnv, applyEnv } from './lib/env.js';

const REPO_ROOT = path.dirname(fileURLToPath(import.meta.url));
const SEED_DIR = path.join(REPO_ROOT, 'data', 'pipes'); // git 管理のパイプ

// 1. .env: ENV_FILE で明示、無ければ自分のディレクトリから HOME まで遡って探す
const envFile = process.env.ENV_FILE ? path.resolve(process.env.ENV_FILE) : findEnvFile(REPO_ROOT);
let envNote = 'no .env';
if (envFile && existsSync(envFile)) {
  const applied = applyEnv(parseEnv(readFileSync(envFile, 'utf8')));
  envNote = `${envFile} applied: ${applied.join(', ') || '(nothing new)'}`;
}

// 2. パイプの置き場。既定は git 管理の data/pipes
const dataDir = process.env.OPENPIPES_DATA ? path.resolve(process.env.OPENPIPES_DATA) : SEED_DIR;
process.env.OPENPIPES_DATA = dataDir;

// 3. 別の場所を指していて、まだ無ければ data/pipes の中身で初期化する
if (dataDir !== SEED_DIR && !existsSync(dataDir)) {
  mkdirSync(dataDir, { recursive: true });
  if (existsSync(SEED_DIR)) {
    for (const name of readdirSync(SEED_DIR)) {
      if (name.endsWith('.json')) copyFileSync(path.join(SEED_DIR, name), path.join(dataDir, name));
    }
  }
}

console.log(`[launcher] ${envNote}; pipes in ${dataDir}; read-only=${process.env.OPENPIPES_READONLY === '1'}`);

// 4. 本体
await import('openpipes/server.js');
