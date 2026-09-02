// .env の探索・パース・適用。ホスティング側が決める変数は上書きしない。
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import util from 'node:util';

// ホスティング側が決める。ファイルからは読まない
export const PLATFORM_KEYS = new Set(['PORT', 'SERVER_PORT']);

// startDir から親へ遡り、最初に見つかった .env のパスを返す(無ければ null)。
// stopDir(既定は HOME)を越えては探さない。startDir が stopDir の外なら startDir だけを見る。
export function findEnvFile(startDir, stopDir = os.homedir()) {
  let dir = path.resolve(startDir);
  const stop = path.resolve(stopDir);
  const inside = dir === stop || dir.startsWith(stop + path.sep);
  for (;;) {
    const candidate = path.join(dir, '.env');
    if (existsSync(candidate)) return candidate;
    if (!inside || dir === stop) return null;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function parseEnv(text) {
  if (typeof util.parseEnv === 'function') return util.parseEnv(text);
  return parseEnvFallback(text);
}

// Node 20.12 より前向けの簡易パーサ。util.parseEnv があっても比較できるよう外に出してある。
export function parseEnvFallback(text) {
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim().replace(/^export\s+/, '');
    let value = line.slice(eq + 1).trim();
    const quoted = (value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"));
    if (quoted) value = value.slice(1, -1);
    out[key] = value;
  }
  return out;
}

// parsed を env に入れる。既にある変数は上書きせず、PLATFORM_KEYS は読まない。適用したキー名を返す。
export function applyEnv(parsed, env = process.env) {
  const applied = [];
  for (const [key, value] of Object.entries(parsed)) {
    if (PLATFORM_KEYS.has(key)) continue;
    if (env[key] === undefined) {
      env[key] = value;
      applied.push(key);
    }
  }
  return applied;
}
