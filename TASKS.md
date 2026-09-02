# TASKS.md — hello-pte-worker を「SORAHOST PteWorker で OpenPipes を動かす配備リポジトリ」にする

この文書は AI エージェント(Claude Opus)が読んで、そのまま実行できるように書いてある。
上から順に進めること。各タスクに **受け入れ基準** があり、満たしたら見出しの `[ ]` を `[x]` に変える。

---

## 0. 先に読むこと(エージェント向け)

- 作業ディレクトリは 2 つ。
  - **このリポジトリ**: `/home/takano32/GitHub/hello-pte-worker`(2026-09-02 時点では `TASKS.md` だけ。git 未初期化)
  - **OpenPipes**: `/home/takano32/GitHub/OpenPipes`(公開リポジトリ https://github.com/takano32/OpenPipes 。ブランチは `main`。**T1 は完了済み**で、必要な変更はコミット `13414c0` として push 済み)
- ゴール: このリポジトリで `npx sorahost-cli deploy` を実行すると、SORAHOST の **PteWorker** 上で OpenPipes が起動し、公開フィードが配信される状態にする。
- ユーザーの決定事項(変更しない):
  - 起動コマンドのパスは任意でよい(`node server.js` にする)。
  - git submodule は使わない。
  - `sorahost-cli` はグローバルに入れず、このディレクトリに devDependency として入れて `npx` で実行する。
  - PteWorker は環境変数 `SERVER_PORT` で空いているポートを渡す。
  - **秘密情報は `.env` に書き、Pterodactyl のパネルから手でアップロードする。** CLI は `.env` を送らない(それが仕様)。デプロイの成果物に秘密情報を含めない。
- 迷ったら §7「未確認事項と仮定」を見る。ユーザーにしか確認できない項目は、**止まらずに仮定を明記して進める**。
- §8「やってはいけないこと」は必ず守る。
- この `TASKS.md` は完了後もリポジトリに残す(設計記録として)。

---

## 1. 背景と前提

### 1.1 PteWorker と sorahost-cli(CLI のソースと README で確認済み)

- PteWorker は SORAHOST(Pterodactyl ベースの国内ホスティング https://sorahost.net/)で起動するデプロイ先。Pterodactyl 上で PteWorker を起動すると、コンソールに **エンドポイント URL** と **デプロイトークン**(発行時に一度だけ表示)が出る。
- 公式 CLI は npm の `sorahost-cli`(v1.3.1、bin 名は `sorahost`、Node >= 18、依存は `tar` のみ)。リポジトリ: https://github.com/Sorahost/deploy-cli
- `sorahost deploy` はプロジェクトを tar.gz にして HTTPS でアップロードする。**依存のインストールもビルドも行わない**ので、実行に必要なもの(`node_modules` 含む)をすべて含めて送る。
- 設定は `sorahost.json`(コミットする)。Node アプリの例:
  ```json
  { "mode": "node", "start": "node server.js", "include": ["server.js", "node_modules/openpipes"] }
  ```
  - `mode: "node"` は `start` をそのまま実行する。
  - `include` を書くと、`sorahost.json` とそこに列挙したパス(ファイルでもディレクトリでも可)だけを送る。**列挙したパスが手元に無いとデプロイはエラーで止まる**。
  - `.git/`、`.env`、`.env.*`、`.npmrc`、`.netrc`、`.DS_Store`、`.sorahost.json` は**常に**送られない(basename の完全一致と `.env.` 前置一致)。秘密情報は `.env` に書いて **手でアップロードする** のが前提。
  - アップロード上限は既定 256 MB。`sorahost deploy --dry-run` はファイル数・サイズ・SHA-256・送信対象のルートを表示し、アップロードしない(ファイル一覧は出ない)。
- 認証情報は `SORAHOST_ENDPOINT` / `SORAHOST_TOKEN` 環境変数 → プロジェクト内 `.sorahost.json`(`sorahost login` が 600 で作り、`.gitignore` に自動追記) → 対話入力、の順で解決される。dry-run でも認証情報の有無は確認されるが、ネットワークには出ない。
- Node アプリは「PteWorker から渡されるポート」を使い、**外部へ直接公開せずループバックにバインドする**よう README が求めている。ポートは `SERVER_PORT` で渡される(ユーザー確認済み。CLI の Next.js 向けヒントには `$PORT` も出てくるので両方読む)。
- PteWorker のコンソールには `url`(エンドポイント再表示)、`token rotate`(トークン再発行)、`logs`(直近ログ)がある。
- **未確認**: アップロードしたアプリが `/home/container` のどこに展開されるか、再デプロイで前回のディレクトリの中身が残るか、Pterodactyl のファイルマネージャで置いた `.env` がどこにあればアプリから見えるか。ランチャーは「自分のディレクトリから HOME まで親を遡って `.env` を探す」ことでどこに置かれても拾えるようにする(§1.3 の 5)。

### 1.2 OpenPipes 側の関連仕様(コードで確認済み)

- Node.js >= 18、**依存パッケージゼロ**、ESM(`"type": "module"`)、`package.json` に `exports` は無いので `import 'openpipes/server.js'` の深い import が通る。`main` も無いので `import 'openpipes'` は通らない。
- ポート: `PORT` → `SERVER_PORT` → `3000`。待ち受けアドレス: `OPENPIPES_HOST`(未設定なら全インターフェース)。**この 2 つはコミット `13414c0` で追加済み**。
- `OPENPIPES_DATA`: 保存パイプの置き場(既定は `<OpenPipes>/data/pipes`)。パイプは 1 件 1 JSON ファイル。
- `OPENPIPES_PASSWORD` / `OPENPIPES_USER`: Basic 認証。エディタと `/api/*` を守る。公開フィード `/pipes/<id>/run`、`/demo/*.xml`、`/api/config` は認証なし(設計。閉じてはいけない)。
- `OPENPIPES_READONLY=1`: 保存・削除を 403 にする。
- `OPENPIPES_CACHE_TTL`: 公開フィードのメモリキャッシュ秒数(既定 300、0 で無効)。
- `OPENPIPES_ALLOW_PRIVATE=1`: 内部アドレスへの取得を許可(**設定しない**)。
- 同梱デモ: パイプ `data/pipes/demo-*.json`(git 管理、4 件)、フィード `assets/demo/*.xml`(パッケージ内から配信される)。
- テスト: `npm test`(ユニット 81 件 + HTTP 22 件)。ネットワーク不要。

### 1.3 設計方針(決定済み。変更しない)

1. **OpenPipes は npm の git 依存として取り込む。** `package.json` に `"openpipes": "github:takano32/OpenPipes#main"` と書き、`package-lock.json` でコミットを固定する。submodule も subtree も使わない。デプロイは `include` で `node_modules/openpipes` を送る(PteWorker 側でインストールが走らないため)。
2. **`sorahost-cli` は devDependency。** `npx sorahost-cli <cmd>` で実行する(`npx sorahost` だとローカルに無いとき同名の別パッケージを取りに行く恐れがあるので、常にパッケージ名で呼ぶ)。`include` に `node_modules/openpipes` しか書かないので CLI 自体はアップロードされない。
3. **`server.js`(リポジトリ直下)は起動ランチャー**。`.env` の探索と読み込み → パイプ置き場の決定 → 必要なら初期データの投入 → `openpipes/server.js` を import。`.env` まわりのロジックは `lib/env.js` に分け、単体テストできるようにする。`sorahost.json` の `start` は `node server.js`。
4. **パイプは git で配る(GitOps)。** `data/pipes/*.json` を git 管理し、`include` で送る。サーバー上は `OPENPIPES_READONLY=1` で保存・削除を禁止する。編集は手元で `npm start` してブラウザで行い、変更された JSON をコミットして再デプロイする。理由: 再デプロイで実行ディレクトリが入れ替わる可能性があり、サーバー上で保存したパイプが消えても困らない構成にしたい。サーバー上で編集したい場合の逃げ道は `OPENPIPES_DATA` を永続パスに向けること(ランチャーが初回に `data/pipes` の中身を流し込む)。
5. **秘密情報は `.env`。手でアップロードする。** CLI は `.env` を送らないので、デプロイ成果物には秘密情報が一切入らない。ユーザーは Pterodactyl のファイルマネージャか SFTP で `.env` を PteWorker に置く。置き場所が未確認なので、ランチャーは **自分のディレクトリから HOME(`os.homedir()`)まで親を遡って最初に見つかった `.env`** を読む(`ENV_FILE` 環境変数で明示もできる)。読み方の規則は「既に環境にある変数は上書きしない」「`PORT` と `SERVER_PORT` はファイルから読まない」。手元でも同じ `.env` を使う(git 管理外)。
6. `node_modules/openpipes` は直接編集しない。直したいことは OpenPipes 側で直し、`npm update openpipes` で追従する。

---

## 2. 成果物(完了時のリポジトリ構成)

```
hello-pte-worker/
  TASKS.md               この文書
  README.md              配備・運用手引き(T7)
  package.json           private / type: module / dependencies: openpipes / devDependencies: sorahost-cli
  package-lock.json      openpipes のコミットを固定する。コミットする
  .gitignore             node_modules/ .env .sorahost.json *.log
  sorahost.json          mode: node / start: node server.js / include: [...]
  .env.example           .env の雛形(値は空またはダミー)。コミットする
  .env                   実際の値。git 管理外。CLI も送らない。PteWorker へは手で置く
  server.js              起動ランチャー(T4)
  lib/env.js             .env の探索・パース・適用(T4)
  data/pipes/*.json      公開するパイプ(git 管理。初期値は OpenPipes のデモ 4 件)
  test/launcher-test.js  単体 + スモークテスト(T6)
  node_modules/openpipes npm install で入る OpenPipes 本体。デプロイに含まれる
```

---

## 3. タスク

### [x] T1. OpenPipes に `SERVER_PORT` と `OPENPIPES_HOST` を入れて push する(完了済み)

2026-09-02 に完了。ブランチを `master` から `main` に改名(GitHub 側の既定ブランチも `main`)し、コミット `13414c0` "Honour SERVER_PORT and add OPENPIPES_HOST for proxied hosts" を push 済み。テストは 81 + 22 件 pass。

確認だけ行う:

```sh
cd /home/takano32/GitHub/OpenPipes
git status -sb                                   # ## main...origin/main で ahead/behind が無い
git log -1 --format='%h %s'                      # 13414c0 Honour SERVER_PORT and add OPENPIPES_HOST for proxied hosts
grep -n 'SERVER_PORT\|OPENPIPES_HOST' server.js  # 両方ある
```

**受け入れ基準**: 上の 3 つが期待どおり。違っていたら止まってユーザーに報告する(このタスクは再実行しない)。

### [x] T2. このリポジトリを初期化して依存を入れる

```sh
cd /home/takano32/GitHub/hello-pte-worker
git init -b main
```

`package.json`(手で書く。`npm init` は使わない):

```json
{
  "name": "hello-pte-worker",
  "version": "0.1.0",
  "private": true,
  "description": "OpenPipes on SORAHOST PteWorker, deployed with sorahost-cli",
  "type": "module",
  "engines": { "node": ">=18" },
  "scripts": {
    "start": "node server.js",
    "test": "node test/launcher-test.js",
    "deploy": "sorahost deploy",
    "deploy:dry": "sorahost deploy --dry-run",
    "update:openpipes": "npm update openpipes"
  },
  "dependencies": {
    "openpipes": "github:takano32/OpenPipes#main"
  },
  "devDependencies": {
    "sorahost-cli": "^1.3.1"
  }
}
```

`.gitignore`:

```
node_modules/
.env
.sorahost.json
*.log
```

`.env.example`:

```
# OpenPipes に渡す環境変数。
# このファイルを .env にコピーして値を入れる。.env は git に入れない(.gitignore 済み)し、
# sorahost-cli もアップロードしない。PteWorker へは Pterodactyl のファイルマネージャか SFTP で手で置く。
# ランチャーは server.js のあるディレクトリから HOME まで親を遡って最初に見つかった .env を読む。
# PORT と SERVER_PORT はホスティング側が決めるので、ここに書いても無視される。

# 必須: エディタと /api/* を守る Basic 認証のパスワード(ユーザー名は OPENPIPES_USER、既定 admin)
OPENPIPES_PASSWORD=

# PteWorker はループバックへのバインドを求めているので 127.0.0.1 にする
OPENPIPES_HOST=127.0.0.1

# パイプは git で配るので、サーバー上では保存・削除を禁止する。
# サーバー上で編集したい場合はこの行を消し、OPENPIPES_DATA を再デプロイで消えない絶対パスにする(README 参照)
OPENPIPES_READONLY=1

# 任意: 公開フィードのキャッシュ秒数(既定 300)
#OPENPIPES_CACHE_TTL=300
# 任意: サーバー上で編集する運用のときだけ
#OPENPIPES_DATA=/home/container/openpipes-data/pipes
```

依存を入れて確認する:

```sh
npm install
ls node_modules/openpipes/server.js node_modules/openpipes/data/pipes/   # demo-*.json が 4 件あること
grep -n 'SERVER_PORT\|OPENPIPES_HOST' node_modules/openpipes/server.js    # 両方あること(13414c0 が入っている証拠)
npx sorahost-cli --version                                               # 1.3.1 以上
grep -A3 '"node_modules/openpipes"' package-lock.json                     # resolved に GitHub のコミットが入っていること
```

`node_modules/openpipes/data/pipes` にデモが**無い**場合(npm が `.gitignore` の否定パターンを無視した場合)は、OpenPipes 側の `package.json` に `"files": ["server.js", "lib", "public", "assets", "data/pipes/demo-*.json", "README.md", "docs"]` を追加してコミット・push し(OpenPipes は公開してよいとユーザーが許可済み)、`npm install github:takano32/OpenPipes#main` でやり直す。

最初のコミット:

```sh
git add package.json package-lock.json .gitignore .env.example TASKS.md
git commit -m "Initial commit: SORAHOST PteWorker deployment repo for OpenPipes"
```

**受け入れ基準**: `npm install` 後に上の 4 つの確認が通る。`git status --short` に `node_modules/` が出ない。

### [x] T3. 公開するパイプの初期データを入れる

OpenPipes のデモをそのままこのリポジトリのパイプ置き場に入れる(GitOps の初期値。後でユーザーが差し替える)。

```sh
mkdir -p data/pipes
cp node_modules/openpipes/data/pipes/demo-*.json data/pipes/
ls data/pipes            # demo-headline demo-loop demo-merged demo-tech-filter の 4 件
git add data/pipes
git commit -m "Seed pipes with the OpenPipes demos"
```

**受け入れ基準**: `data/pipes/*.json` が 4 件コミットされている。

### [x] T4. `lib/env.js` と `server.js`(起動ランチャー)を書く

仕様:

1. `.env` の場所: `ENV_FILE` 環境変数があればそのパス。無ければ `server.js` のあるディレクトリから親へ遡り、最初に見つかった `.env`。遡るのは HOME(`os.homedir()`)まで。`server.js` が HOME の外にある場合は自分のディレクトリだけを見る。
2. パースは `util.parseEnv` があればそれ、無い Node では簡易パーサ(`KEY=VALUE`、`#` コメント、前後の引用符除去、`export ` 前置の除去)。
3. 適用規則: **既に環境にある変数は上書きしない**(ホスティング側の設定が優先)。`PORT` と `SERVER_PORT` はファイルからは読まない。
4. `OPENPIPES_DATA` が未設定なら `<repo>/data/pipes` にする。
5. `OPENPIPES_DATA` が `<repo>/data/pipes` 以外を指していて、そのディレクトリが**存在しないときだけ**作成し、`<repo>/data/pipes/*.json` をコピーする(永続パスへの初期投入。2 回目以降は触らない)。
6. 起動ログを 1 行出す。読んだ `.env` のパスと、適用した **キー名だけ** を出し、値は絶対に出さない。
7. 最後に `await import('openpipes/server.js')`。

参照実装(このまま使ってよい)。`lib/env.js`:

```js
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
  // Node 20.12 より前向けの簡易パーサ
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
```

`server.js`:

```js
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
```

**受け入れ基準**: `cp .env.example .env` して `OPENPIPES_PASSWORD=test-only` を書いた状態で `SERVER_PORT=3123 node server.js` を起動すると、コンソールに `[launcher] /home/takano32/GitHub/hello-pte-worker/.env applied: OPENPIPES_PASSWORD, OPENPIPES_HOST, OPENPIPES_READONLY; ...` と `OpenPipes listening on http://127.0.0.1:3123 (auth as "admin", read-only)` が出る。`curl -s http://127.0.0.1:3123/api/config` が `{"readOnly":true,"authRequired":true}` を返す。

### [x] T5. `sorahost.json` を書く

```json
{
  "mode": "node",
  "start": "node server.js",
  "include": [
    "server.js",
    "lib",
    "package.json",
    "node_modules/openpipes",
    "data/pipes"
  ]
}
```

- `package.json` は `"type": "module"` のために必要(無いと `server.js` の `import` が構文エラーになる)。
- `.env` は `include` に **書かない**(書いても CLI が除外する。秘密情報は手で置く)。
- `.sorahostignore` は不要(`include` の外は元々送られない)。

**受け入れ基準**: `SORAHOST_ENDPOINT=https://example.invalid/_sorahost/dummy SORAHOST_TOKEN=dummy npx sorahost-cli deploy --dry-run --yes` が「送信対象: server.js/ lib/ package.json/ node_modules/openpipes/ data/pipes/」を表示し、`node_modules が含まれていません` の警告が**出ず**、アップロードせずに終了する。さらに、手元に `.env` が有るときと無いときで表示される**ファイル数が同じ**(`.env` が送られていない証拠)。ダミーの認証情報は dry-run では使われず、ネットワークにも出ない。

### [x] T6. テスト `test/launcher-test.js` を書く

OpenPipes の `test/server-tests.js` と同じ流儀(依存なし、`node:assert/strict`、子プロセス起動、ネットワーク不要、最後に `N passed, M failed` を出して失敗なら exit 1)。内容:

**単体(`lib/env.js`)**

1. `findEnvFile`: 一時ディレクトリに `<t>/home/app/sub` を作り、`.env` を `<t>/home/.env` に置く。`findEnvFile('<t>/home/app/sub', '<t>/home')` が `<t>/home/.env` を返す。`<t>/home/app/.env` も置くと近いほうが返る。`.env` が `<t>/.env`(stop の外)にしか無ければ `null`。startDir が stop の外にあれば startDir 直下しか見ない。
2. `applyEnv`: `{ OPENPIPES_PASSWORD: 'x', PORT: '9', SERVER_PORT: '9', FOO: '1' }` を `{ FOO: 'keep' }` に適用すると、`FOO` は `keep` のまま、`OPENPIPES_PASSWORD` が入り、`PORT` と `SERVER_PORT` は入らず、戻り値は `['OPENPIPES_PASSWORD']`。
3. `parseEnv`: `#` コメント、引用符、`export KEY=...` を扱える(`util.parseEnv` の有無に関わらず同じ結果になることを、簡易パーサを直接呼んで確認する場合は関数を分けてもよい)。

**スモーク(子プロセス)**

4. 子プロセスの環境は `process.env` をコピーしてから `PORT`, `SERVER_PORT`, `ENV_FILE`, `OPENPIPES_*` を **delete** し、必要な値だけ設定する。空きポートは `25000 + (process.pid % 1000) * 10` から連番。`http://127.0.0.1:<port>/api/config` が応答するまで 100ms × 最大 60 回待つ。
5. ケース A(`.env` あり): 一時ディレクトリの `.env` に `OPENPIPES_PASSWORD=test-only`, `OPENPIPES_HOST=127.0.0.1`, `SERVER_PORT=1`, `PORT=1`(後者 2 つは無視される確認用)を書き、`ENV_FILE=<そのパス>`, `SERVER_PORT=<空きポート>` で起動。
   - `/api/config` → `{ readOnly: false, authRequired: true }`。
   - `/` → 401。`Authorization: Basic admin:test-only` 付き `/` → 200。
   - `/pipes/demo-tech-filter/run` → 200、本文に `<rss`(`data/pipes` のデモと、パッケージ内 `/demo/tech.xml` の自己取得が両方効いている証拠)。
   - 起動ログに `test-only` という文字列が**含まれない**。
6. ケース B(`.env` なし): `ENV_FILE=<存在しないパス>` で起動(手元の本物の `.env` を拾わないため)。`/api/config` → `{ readOnly: false, authRequired: false }`。
7. ケース C(初期投入): ケース A に加えて `OPENPIPES_DATA=<一時ディレクトリ配下の未作成パス>`。起動後、そのディレクトリの `*.json` 一覧が `data/pipes` の一覧と一致する。
8. 終了時に子プロセスを `SIGKILL` し、一時ディレクトリを消す。失敗時は子プロセスのログを出す。

`npm test` で走らせる。

**受け入れ基準**: `npm test` が pass。テスト後に `git status --short` にテスト由来の差分が無い。

### [x] T7. `README.md`(配備・運用手引き)を書く

日本語。次の節を必ず含める。

1. **これは何か**: OpenPipes を SORAHOST PteWorker で動かすための配備リポジトリ。本体は npm 依存 `openpipes`(GitHub の takano32/OpenPipes、コミットは `package-lock.json` の `resolved` 参照)。
2. **セットアップ**: `npm install`、`cp .env.example .env` して値を入れる、`npm test`。
3. **手元で動かす**: `SERVER_PORT=3123 npm start` → http://127.0.0.1:3123/ 。編集したいときは `OPENPIPES_READONLY=0 SERVER_PORT=3123 npm start`(環境変数がファイルより優先される)。
4. **PteWorker へのデプロイ**(§4 を転記)。`.env` を手で置く手順と、ランチャーが `.env` を探す順序(アプリのディレクトリ → 親 → HOME)を書く。
5. **パイプの編集フロー**(§5.1 を転記)。
6. **環境変数**: `.env.example` の各項目。ホスティング側の環境変数が優先されること。`PORT` / `SERVER_PORT` は書かないこと。`.env` はリポジトリにもデプロイ成果物にも入らないこと。
7. **セキュリティの注意**:
   - `OPENPIPES_PASSWORD` を必ず設定する。未設定だとエディタと `/api/run` が誰でも使え、サーバーを公開 URL の取得代理にされる。`.env` を置き忘れて起動すると **認証なしで公開される** ので、デプロイ後は必ず `logs` で `applied: OPENPIPES_PASSWORD` を確認する。
   - 公開フィード `/pipes/<id>/run` は認証なしで誰でも読める(仕様)。
   - デプロイトークンと `.sorahost.json` はコミットしない。漏れたら PteWorker コンソールで `token rotate`。
   - `OPENPIPES_ALLOW_PRIVATE` は設定しない。
8. **更新手順**(§5.2, §5.3 を転記)。
9. **未確認事項**(§7 の表を要約して転記)。

**受け入れ基準**: 上記 9 節がある。コマンドはすべて実際に動くものを書いている。

### [x] T8. ローカルで最終確認

```sh
cd /home/takano32/GitHub/hello-pte-worker
npm test

# 手動確認: .env が効く / 環境変数が優先 / PORT・SERVER_PORT はファイルから読まれない
cp .env.example .env
sed -i 's/^OPENPIPES_PASSWORD=$/OPENPIPES_PASSWORD=test-only/' .env
printf 'PORT=9\nSERVER_PORT=9\n' >> .env
SERVER_PORT=3123 node server.js &
sleep 1
curl -s http://127.0.0.1:3123/api/config                                           # {"readOnly":true,"authRequired":true}
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3123/                    # 401
curl -s -o /dev/null -w '%{http_code}\n' -u admin:test-only http://127.0.0.1:3123/ # 200
curl -s http://127.0.0.1:3123/pipes/demo-tech-filter/run | head -3                 # <rss ...
kill %1
OPENPIPES_READONLY=0 SERVER_PORT=3123 node server.js &
sleep 1
curl -s http://127.0.0.1:3123/api/config                                           # {"readOnly":false,"authRequired":true}
kill %1

# デプロイ内容の確認(アップロードしない)。.env が有っても無くてもファイル数が同じであること
SORAHOST_ENDPOINT=https://example.invalid/_sorahost/dummy SORAHOST_TOKEN=dummy \
  npx sorahost-cli deploy --dry-run --yes
rm -f .env
SORAHOST_ENDPOINT=https://example.invalid/_sorahost/dummy SORAHOST_TOKEN=dummy \
  npx sorahost-cli deploy --dry-run --yes
```

**受け入れ基準**: 上の期待値がすべて一致。dry-run に `node_modules が含まれていません` の警告が出ず、2 回のファイル数が同じ。`.env` を消した後、`git status --short` がクリーン(未コミットの成果物を除く)。

### [x] T9. コミットする(push はユーザー確認のうえで)

```sh
git add -A
git status --short      # .env / .sorahost.json / node_modules が含まれていないこと
git commit -m "Add launcher, sorahost.json, tests and deployment guide"
```

このリポジトリにリモートは無く、PteWorker へのデプロイは手元からのアップロードなので **GitHub は必須ではない**。バックアップとして push したいかはユーザーの判断なので、リポジトリ名と公開/非公開を確認してから `gh repo create` と `git push` を行う。確認が取れなければ push せず終了する。

**受け入れ基準**: コミット済み。`git status --short` が空。

---

## 4. PteWorker へのデプロイ手順(ユーザーが行う。README に転記する)

1. SORAHOST のパネルで PteWorker を起動する。コンソールに **エンドポイント** と **デプロイトークン** が出るので控える(トークンは一度しか表示されない。失くしたらコンソールで `token rotate`)。
2. このリポジトリで認証情報を保存する(`.sorahost.json` に 600 で保存され、git には入らない):
   ```sh
   npx sorahost-cli login
   ```
3. `.env` を用意する。`cp .env.example .env` して `OPENPIPES_PASSWORD` に強い固有のパスワードを入れる。
4. **`.env` を PteWorker に手で置く。** Pterodactyl のパネルのファイルマネージャ(または SFTP)で、この `.env` をアップロードする。置き場所は、アプリが展開されるディレクトリ(その直下)か、`/home/container` 直下(HOME)のどちらか。ランチャーはアプリのディレクトリから HOME まで親を遡って探すので、どちらでも拾う。**再デプロイで消えない場所を選ぶ**(§7 参照。分かるまでは `/home/container/.env` を推奨)。
5. 送信内容を確認してからデプロイする:
   ```sh
   npx sorahost-cli deploy --dry-run
   npx sorahost-cli deploy
   ```
6. PteWorker のコンソールで `logs` を実行し、`[launcher] /home/container/.env applied: OPENPIPES_PASSWORD, OPENPIPES_HOST, OPENPIPES_READONLY` と `OpenPipes listening on http://127.0.0.1:<port>` が出ていることを確認する。`no .env` と出ていたら **認証なしで公開されている** ので、`.env` の置き場所を直してすぐ再デプロイする。
7. `npx sorahost-cli open`(または `whoami` で出るサイト URL)でエディタを開き、Basic 認証(`admin` / 設定したパスワード)で入る。
8. 公開フィードは `<サイト URL>/pipes/<id>/run`。`?format=json` で JSON、`?format=jsonfeed` で JSON Feed。RSS リーダーに登録する。

CI から行う場合は `SORAHOST_ENDPOINT` / `SORAHOST_TOKEN` を Secrets に入れ、`npx sorahost-cli deploy --yes --json`。`.env` はデプロイと無関係に PteWorker 側に置いたままでよい。

---

## 5. 運用

### 5.1 パイプの編集(GitOps)

```sh
OPENPIPES_READONLY=0 SERVER_PORT=3123 npm start   # 手元では書き込み可で起動
# ブラウザ http://127.0.0.1:3123/ でパイプを作成・保存 → data/pipes/<id>.json が増える/変わる
git add data/pipes && git commit -m "Update pipes"
npx sorahost-cli deploy
```

サーバー上で直接編集したい場合(再デプロイで消えない場所に置く運用):
`.env` の `OPENPIPES_READONLY=1` を消し、`OPENPIPES_DATA=<再デプロイで消えない絶対パス>` を設定する。初回起動時にランチャーが `data/pipes` の中身をそこへコピーする。**どのパスが再デプロイ後も残るかは未確認**なので、PteWorker のコンソールで確認してから使う。

### 5.2 OpenPipes の更新

```sh
npm update openpipes                    # 動かなければ npm install github:takano32/OpenPipes#main
npm test
git add package-lock.json && git commit -m "Update OpenPipes"
npx sorahost-cli deploy
```

### 5.3 CLI の更新

```sh
npm install -D sorahost-cli@latest
git add package.json package-lock.json && git commit -m "Update sorahost-cli"
```

---

## 6. 受け入れ基準チェックリスト(全体)

- [x] `../OpenPipes` の `main` に `SERVER_PORT` / `OPENPIPES_HOST` 対応(`13414c0`)が push されている。
- [x] `npm install` だけで `node_modules/openpipes` が入り、その `server.js` に `SERVER_PORT` と `OPENPIPES_HOST` がある。
- [x] このリポジトリで `npm test` が pass する。
- [x] `SERVER_PORT` だけを与えて `node server.js` が起動し、そのポートで応答する。`.env` の `PORT` / `SERVER_PORT` は無視される。
- [x] `.env` の値が効き、既存の環境変数を上書きしない。ログに値が出ない。`.env` はアプリのディレクトリから HOME まで遡って見つかる。
- [x] `OPENPIPES_DATA` を未作成のパスに向けると `data/pipes` の中身で初期化される。
- [x] `sorahost deploy --dry-run` の送信対象が `server.js`, `lib`, `package.json`, `node_modules/openpipes`, `data/pipes` だけで、node_modules 無しの警告が出ず、`.env` の有無でファイル数が変わらない。
- [x] `.env`, `.sorahost.json`, `node_modules/` はコミットされていない。`package-lock.json`, `data/pipes/*.json`, `server.js`, `lib/env.js`, `sorahost.json`, `.env.example` はコミットされている。
- [x] README に §4, §5 とセキュリティの注意、未確認事項が書いてある。

---

## 7. 未確認事項と仮定

エージェントはこれらを検証できない。**仮定のまま進め**、README の「未確認事項」節に列挙してユーザーに委ねる。

| 項目 | 仮定 | 外れた場合の対処 |
| --- | --- | --- |
| ポートの環境変数 | `SERVER_PORT`(ユーザー確認済み)。`PORT` が来ても優先して使う | どちらでもなければ、PteWorker の `logs` で変数名を確認し、ランチャーで `process.env.PORT` に読み替える |
| バインド先 | ループバック(`OPENPIPES_HOST=127.0.0.1`)で PteWorker のプロキシから届く | 届かなければ `.env` から `OPENPIPES_HOST` を消す(全インターフェース) |
| `.env` の置き場所 | アプリの展開先か `/home/container` 直下に手で置けば、ランチャーが親を遡って見つける。`HOME` は `/home/container` | 見つからなければ `logs` に `no .env` と出る。PteWorker 側で環境変数 `ENV_FILE` を設定できればそれで明示する。HOME が違う場合はランチャーの `findEnvFile` の stopDir を見直す |
| 再デプロイ時のファイル | 実行ディレクトリは入れ替わり、実行中に書いたものは残らない。`/home/container` 直下に置いた `.env` は残る | GitOps 構成なのでパイプには影響なし。`.env` が消えるなら置き場所を変える |
| 作業ディレクトリ | `start` はアップロードしたルートで実行される | ランチャーは自分のファイル位置からパスを解決するので cwd に依存しない。`OPENPIPES_DATA` を相対パスで書かない |
| Node のバージョン | 20.12 以上 | 20.12 未満でも簡易パーサで動く。18 未満は不可 |
| 送信方向のネットワーク | HTTP/HTTPS で外へ出られる | 出られないと上流フィードを取得できず OpenPipes の意味が無い |
| HTTPS | サイト URL は https(CLI の例がそうなっている) | http のみなら Basic 認証が平文になる。強いパスワードと読み取り専用運用で緩和 |
| メモリ | 数百 MB 級 | 足りなければ PteWorker 側で `NODE_OPTIONS=--max-old-space-size=...` を設定できるか確認(`.env` に書いても効かない) |
| npm と `.gitignore` の否定パターン | `data/pipes/demo-*.json` はパッケージに含まれる | T2 の fallback(OpenPipes に `files` を追加) |

---

## 8. やってはいけないこと

- `node_modules/openpipes` を直接編集しない。修正は `../OpenPipes` で行い、テストを通し、push してから `npm update openpipes`。
- `.env`、`.sorahost.json`、`node_modules/` をコミットしない。パスワードやトークンの値をログ・README・コミットメッセージ・チャットに書かない。
- `.env` を `include` に入れたり、別名にしてデプロイ成果物に含めたりしない。秘密情報は手で置く(ユーザーの決定)。
- OpenPipes の「依存パッケージゼロ」を崩さない。このリポジトリの `dependencies` も `openpipes` だけにする。
- OpenPipes の既存テストを壊さない。テストの期待値を変えて通すことはしない。
- 公開フィード `/pipes/<id>/run` や `/api/config` に認証を掛けない(RSS リーダーがログインできないため。OpenPipes の設計)。
- `OPENPIPES_ALLOW_PRIVATE=1` を配備設定に入れない。
- `npx sorahost` ではなく `npx sorahost-cli` を使う(ローカルに無いとき別パッケージを取りに行かないため)。
- 本物のエンドポイントとトークンで `deploy` を実行するのはユーザー(§4)。エージェントは `--dry-run` まで。
- このリポジトリの新しいリモート作成や `git push` を、ユーザーの確認なしに行わない。T1 は完了済みなので OpenPipes 側で再度 push する必要は無い(T2 の fallback で `files` を足す場合を除く)。
