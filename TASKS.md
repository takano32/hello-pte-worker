# TASKS.md — hello-pte-worker を「SORAHOST PteWorker で OpenPipes を動かす配備リポジトリ」にする

この文書は AI エージェント(Claude Opus)が読んで、そのまま実行できるように書いてある。
上から順に進めること。各タスクに **受け入れ基準** があり、満たしたら見出しの `[ ]` を `[x]` に変える。

---

## 0. 先に読むこと(エージェント向け)

> **2026-09-03 の状態**: §3 の T1〜T9(第 1 期)は 2026-09-02 に完了済み。その後 OpenPipes が
> `13414c0` → `6aca055` に進み、保存先が SQLite になって `OPENPIPES_DATA` が消え、Node >= 22.13 が
> 必要になり、Google ログインが入った。§1〜§8 は第 1 期の記録としてそのまま残す(**「13414c0 時点」の記述を含む**)。
> **これから行う作業は §9「第 2 期」の T10〜T20**。§9 の記述が §1〜§8 と食い違う場合は §9 が正しい。

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

### 1.2 OpenPipes 側の関連仕様(コードで確認済み。**`13414c0` 時点**。現行の仕様は §9.2)

- Node.js >= 18、**依存パッケージゼロ**、ESM(`"type": "module"`)、`package.json` に `exports` は無いので `import 'openpipes/server.js'` の深い import が通る。`main` も無いので `import 'openpipes'` は通らない。
- ポート: `PORT` → `SERVER_PORT` → `3000`。待ち受けアドレス: `OPENPIPES_HOST`(未設定なら全インターフェース)。**この 2 つはコミット `13414c0` で追加済み**。
- `OPENPIPES_DATA`: 保存パイプの置き場(既定は `<OpenPipes>/data/pipes`)。パイプは 1 件 1 JSON ファイル。
- `OPENPIPES_PASSWORD` / `OPENPIPES_USER`: Basic 認証。エディタと `/api/*` を守る。公開フィード `/pipes/<id>/run`、`/demo/*.xml`、`/api/config` は認証なし(設計。閉じてはいけない)。
- `OPENPIPES_READONLY=1`: 保存・削除を 403 にする。
- `OPENPIPES_CACHE_TTL`: 公開フィードのメモリキャッシュ秒数(既定 300、0 で無効)。
- `OPENPIPES_ALLOW_PRIVATE=1`: 内部アドレスへの取得を許可(**設定しない**)。
- 同梱デモ: パイプ `data/pipes/demo-*.json`(git 管理、4 件)、フィード `assets/demo/*.xml`(パッケージ内から配信される)。
- テスト: `npm test`(ユニット 81 件 + HTTP 22 件)。ネットワーク不要。

### 1.3 設計方針(決定済み。変更しない。**ただし 3〜4 は OpenPipes の更新に伴い §9.3 で改訂**)

1. **OpenPipes は npm の git 依存として取り込む。** `package.json` に `"openpipes": "github:takano32/OpenPipes#main"` と書き、`package-lock.json` でコミットを固定する。submodule も subtree も使わない。デプロイは `include` で `node_modules/openpipes` を送る(PteWorker 側でインストールが走らないため)。
2. **`sorahost-cli` は devDependency。** `npx sorahost-cli <cmd>` で実行する(`npx sorahost` だとローカルに無いとき同名の別パッケージを取りに行く恐れがあるので、常にパッケージ名で呼ぶ)。`include` に `node_modules/openpipes` しか書かないので CLI 自体はアップロードされない。
3. **`server.js`(リポジトリ直下)は起動ランチャー**。`.env` の探索と読み込み → パイプ置き場の決定 → 必要なら初期データの投入 → `openpipes/server.js` を import。`.env` まわりのロジックは `lib/env.js` に分け、単体テストできるようにする。`sorahost.json` の `start` は `node server.js`。
4. **パイプは git で配る(GitOps)。** `data/pipes/*.json` を git 管理し、`include` で送る。サーバー上は `OPENPIPES_READONLY=1` で保存・削除を禁止する。編集は手元で `npm start` してブラウザで行い、変更された JSON をコミットして再デプロイする。理由: 再デプロイで実行ディレクトリが入れ替わる可能性があり、サーバー上で保存したパイプが消えても困らない構成にしたい。サーバー上で編集したい場合の逃げ道は `OPENPIPES_DATA` を永続パスに向けること(ランチャーが初回に `data/pipes` の中身を流し込む)。
5. **秘密情報は `.env`。手でアップロードする。** CLI は `.env` を送らないので、デプロイ成果物には秘密情報が一切入らない。ユーザーは Pterodactyl のファイルマネージャか SFTP で `.env` を PteWorker に置く。置き場所が未確認なので、ランチャーは **自分のディレクトリから HOME(`os.homedir()`)まで親を遡って最初に見つかった `.env`** を読む(`ENV_FILE` 環境変数で明示もできる)。読み方の規則は「既に環境にある変数は上書きしない」「`PORT` と `SERVER_PORT` はファイルから読まない」。手元でも同じ `.env` を使う(git 管理外)。
6. `node_modules/openpipes` は直接編集しない。直したいことは OpenPipes 側で直し、`npm update openpipes` で追従する。

---

## 2. 成果物(第 1 期完了時のリポジトリ構成。第 2 期完了後の構成は §9.4)

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

## 3. タスク(第 1 期。すべて完了済み)

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

## 6. 受け入れ基準チェックリスト(第 1 期。第 2 期は §9.6)

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

## 7. 未確認事項と仮定(第 1 期。第 2 期で増えた分は §9.7)

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

## 8. やってはいけないこと(第 2 期で増えた分は §9.8)

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

---

## 9. 第 2 期: OpenPipes `6aca055` への追従(2026-09-03)

OpenPipes が `13414c0` → `6aca055`(`main` HEAD)に進んだ。手元のクローン `/home/takano32/GitHub/OpenPipes` は
`origin/main` と一致しており、`npm test` は **101 + 40 件 pass**(2026-09-03 に確認)。
このリポジトリの `package-lock.json` はまだ `13414c0` を指しているので、以下で追従する。
T10 から順に進め、各タスクの受け入れ基準を満たしたら `[ ]` を `[x]` に変える。

> **追記 1(2026-09-03)**: その後 OpenPipes に `d568509`「Write down the operational traps the
> verification run turned up」が積まれ、push された。**README.md だけの変更**(+66/−9)で、
> ランタイムのコードも `package.json` も動いていなかったため、**このコミット単体では再固定の理由に
> ならなかった**。ただし d568509 は**実測に基づく運用上の落とし穴**を初めて書き下ろしており、
> その多くはこの配備リポジトリの README に効く。反映は §9.5 の T19 で行った。
>
> **追記 2(2026-09-03)**: さらに `e0fe7cc`「Fix a login that ends in 500, and a gate that traps
> unsaved work」が積まれ、`origin/main` = `e0fe7cc` になった。**今度は README だけではなくランタイムの
> コードが動いている**(`server.js` に `headerSafeUrl()`、`public/index.html` / `editor.js` / `editor.css` に
> ゲートからの JSON 書き出し)ので、**追従は任意ではない**。`npm update openpipes` で `e0fe7cc` に上げ、
> `package-lock.json` を再固定する(§9.5 の T20)。`package.json`(`engines.node` = `>=22.13.0`、`files` 無し)と
> `test/fake-issuer.mjs` は無変更なので、ケース E の深い import は壊れない。環境変数・起動ログ・
> `OPENPIPES_DB` の扱いも動いていないので、ランチャーと `sorahost.json` に手は要らない。
>
> **実施済み(2026-09-03)**: `package-lock.json` は `e0fe7cc69ccc406141362ab456825c5c3b7e71a4` を指し、
> `npm test` は 11 件 pass。以後このリポジトリが動かす OpenPipes は `e0fe7cc`
> (`6aca055` → `d568509` → `e0fe7cc`)。

### 9.1 何が変わったか(このリポジトリに効く差分だけ)

| 変更(OpenPipes 側) | このリポジトリへの影響 |
| --- | --- |
| **Node.js >= 22.13.0** が必須(`node:sqlite` をフラグなしで static import する。CI も 22 / 24 だけ) | `engines.node` を上げる。**PteWorker の Node が 22.13 未満なら OpenPipes は起動できない**(§9.7 の筆頭)。ランチャーは import 前にバージョンを確かめて分かる言葉で止める |
| 保存先が **SQLite 1 ファイル**(`OPENPIPES_DB`、既定 `<OpenPipes>/data/openpipes.db`、`:memory:` 可。親ディレクトリは起動時に作られる。WAL) | `OPENPIPES_DATA` は**無くなった**。ランチャーの「`data/pipes` を永続パスへ初期投入」は死んだコードになる。既定のままだと DB が `node_modules/openpipes/data/` に出来て、再デプロイや `npm install` で消える |
| デモ 4 件は `assets/demo/pipes/*.json` に移り、**組み込み・読み取り専用**として起動時にファイルから読まれる(DB には入らない。上書き・削除は 403、⧉ で複製すると自分のものになる) | `data/pipes/`(デモのコピー)は不要。`sorahost.json` の `include` から外す(残すとパスが無い時点で deploy がエラーになる) |
| 保存したパイプは **持ち主(ユーザー)付き**。ログイン無し / Basic 認証時の持ち主は `local`。id は `slug-<16 hex>` で **id を知っていることが公開フィードを読める資格** | 1 パイプ 1 JSON を git で配る GitOps は成り立たない(`savePipe` に id を渡すと更新のみ。指定 id での新規挿入 API は無い)。§9.3 で方針を改める |
| 認証モードが 3 つ: `none` / `basic`(`OPENPIPES_PASSWORD`)/ `google`(`OPENPIPES_GOOGLE_CLIENT_ID` + `_SECRET` + `OPENPIPES_BASE_URL`)。**Basic と Google を両方設定すると起動時にエラーで止まる** | `.env.example` に Google の欄を足す。ランチャーは設定からモードを推定してログに出す。`none` のまま起動したら警告を出す |
| `GET /api/config` が `{ readOnly, auth: 'none'|'basic'|'google', user }` を返す(`authRequired` は無い) | `test/launcher-test.js` の期待値が壊れる(T13) |
| `OPENPIPES_BASE_URL`(bare origin。どのモードでも可、Google では必須)。配信フィードのリンクとパイプ内の相対 URL の解決先になり、設定すると書き込み系の `Origin` を照合する(CSRF 対策)。https なら Cookie に `Secure` | PteWorker のサイト URL を入れるべき。**ブラウザで実際に使う URL と一致させないと保存が 403** になる |
| エディタの読み込みメニューに **JSON を書き出す / 読み込む** が付いた | 手元の JSON をサーバーへ入れる・バックアップを取る手段はこれ(GitOps の後継)。`data/pipes/*.json` は捨てる前にこれで入れ直せる |
| README にバックアップ手順(`VACUUM INTO` の node ワンライナー、または `sqlite3 .backup`) | README(T14)に転記する |
| 起動ログの末尾: `OpenPipes listening on http://<host>:<port> (Google login: ..., auth as "admin", read-only, ...)` | README の確認手順の期待行を直す |
| `test/server-tests.js` が 40 件、`test/run-tests.js` が 101 件 | §1.2 の「81 + 22」は古い |

### 9.2 OpenPipes 側の関連仕様(`e0fe7cc` で確認済み。§1.2 を置き換える)

- Node.js **>= 22.13.0**、依存パッケージゼロ、ESM。`exports` / `main` は相変わらず無いので `import 'openpipes/server.js'` の深い import で起動する。
- ポート: `PORT` → `SERVER_PORT` → `3000`。待ち受け: `OPENPIPES_HOST`(未設定なら全インターフェース)。変更なし。
- 環境変数(`docs/SPEC.md` の表と `server.js` 冒頭で確認):

  | 変数 | 意味 |
  | --- | --- |
  | `OPENPIPES_DB` | SQLite ファイル。既定 `<OpenPipes>/data/openpipes.db`。`:memory:` 可。親ディレクトリは起動時に作られる |
  | `OPENPIPES_BASE_URL` | 公開 origin(例 `https://xxx.sorahost.example`)。パス・クエリ付きは起動時に拒否。Google モードでは必須。設定すると書き込み系の `Origin` がこれと違えば 403 |
  | `OPENPIPES_PASSWORD` / `OPENPIPES_USER` | Basic 認証(`basic` モード)。既定ユーザー `admin` |
  | `OPENPIPES_GOOGLE_CLIENT_ID` / `OPENPIPES_GOOGLE_CLIENT_SECRET` | どちらかを設定すると `google` モード。3 点(+ `OPENPIPES_BASE_URL`)が揃わないと起動拒否。`OPENPIPES_PASSWORD` との併用は起動拒否 |
  | `OPENPIPES_ALLOWED_USERS` | Google モードのみ。カンマ区切りのメール / `@domain`。未設定なら Google アカウントを持つ誰でも入れる(起動時に警告) |
  | `OPENPIPES_OIDC_ISSUER` | 既定 `https://accounts.google.com` |
  | `OPENPIPES_READONLY` | `1` で `POST /api/pipes` と `DELETE /api/pipes/:id` を 403。全モード共通 |
  | `OPENPIPES_CACHE_TTL` | 公開フィードのキャッシュ秒数。既定 300、`0` で無効 |
  | `OPENPIPES_ALLOW_PRIVATE` | `1` で内部アドレスへの取得を許可(**設定しない**) |
  | `OPENPIPES_DATA` | **廃止** |

- 公開フィード `/pipes/<id>/run`、`/demo/*.xml`、`/api/config`、`/auth/*` は認証なし(設計。閉じてはいけない)。エディタ `/` は `basic` モードでは Basic 認証の内側、`google` モードではページ自体は開いてエディタがログイン画面を出す。
- `/api/config` → `{ readOnly: bool, auth: 'none'|'basic'|'google', user: null | { name, email, picture } }`(`user` は Google ログイン中のみ、それ以外は `null`)。
- `POST /api/pipes` の body は `{ id?, name, modules, wires }`。`id` 無しなら新規(サーバーが `slug-<16 hex>` を採番)、`id` 付きは自分のパイプの更新のみ。最小の有効な body は `{ name, modules: [{ id: 'm1', type: 'output', params: {}, x: 0, y: 0 }], wires: [] }`。
- 同梱デモ: `assets/demo/pipes/demo-*.json`(4 件。`npm pack --dry-run` で同梱を確認済み)とフィード `assets/demo/*.xml`。パッケージに `data/` ディレクトリは**含まれない**。
- OpenPipes の `.gitignore` は `data/*.db`, `data/*.db-wal`, `data/*.db-shm` を除外している。
- テスト: `npm test` で 101 + 41 件。ネットワーク不要。Google のテストは偽の OIDC プロバイダ(`test/fake-issuer.mjs`)相手。

### 9.3 設計方針の改訂(§1.3 の 3〜4 を置き換える。1, 2, 5, 6 はそのまま)

3′. **ランチャーの仕事は「Node の版を確かめる → `.env` を読む → DB の置き場を決める → 本体を import」**。パイプの初期投入は行わない(デモは本体に同梱されているので入れるものが無い)。Node が 22.13 未満なら `node:sqlite` の分かりにくい import エラーの前に、ランチャーが自分の言葉で止める。

4′. **パイプはサーバー上の SQLite に置き、置き場は再デプロイで消えない絶対パスにする(GitOps は廃止)。**
   - 理由: 保存 API が id を採番する設計になり、1 パイプ 1 JSON を git で配る前提が崩れた。ユーザー自身が OpenPipes を「持ち主付きの SQLite 保存 + ログイン」に作り替えたのだから、配備側もそれに合わせる。
   - `.env` で `OPENPIPES_DB=/home/container/openpipes/openpipes.db` を指す。`.env` を `/home/container` 直下に置くのと同じ「再デプロイで残る場所」という仮定に乗る(§9.7)。
   - ランチャーは `OPENPIPES_DB` 未設定時の既定を `<repo>/data/openpipes.db` にする(`node_modules/openpipes/data/` に作らせない。手元では `npm install` で消えず、`.gitignore` の `data/` で git にも入らない)。**`.env` が無い場合はこの既定になり、再デプロイで消える**が、その状態は既に「認証なしで公開されている」異常なので、ログで気付いて直す前提でよい。
   - `OPENPIPES_READONLY` は既定で**付けない**(サーバー上で編集する運用に戻る)。編集を凍結したいときだけ `1` にする。
   - 手元で作ったパイプをサーバーへ持ち込む・サーバーのパイプを保存しておく手段は、エディタの **JSON を書き出す / 読み込む** と、DB ファイルのバックアップ(`VACUUM INTO`)。`data/pipes/` は git から消す。
   - 認証は **Basic を既定**にする(単独運用で最も手間が少なく、Google Cloud Console の設定も https の固定 URL も要らない)。Google ログインは `.env.example` にコメントアウトで用意し、README で切り替え方を書く。両方は設定できない。
   - `OPENPIPES_BASE_URL` には PteWorker のサイト URL(`npx sorahost-cli whoami` で出るもの)を入れる。フィードのリンクが正しくなり、https なら Cookie に `Secure` が付く。ブラウザで使う URL と一致させること。

### 9.4 成果物(第 2 期完了時のリポジトリ構成)

```
hello-pte-worker/
  TASKS.md               この文書
  README.md              配備・運用手引き(T14 で改訂)
  package.json           engines.node >= 22.13.0 に上げる
  package-lock.json      openpipes を e0fe7cc に固定
  .gitignore             node_modules/ .env .sorahost.json *.log data/
  sorahost.json          include から data/pipes を外す
  .env.example           OPENPIPES_DB / OPENPIPES_BASE_URL / Google の欄を足し、OPENPIPES_DATA を消す
  server.js              ランチャー(T12 で書き直し)
  lib/env.js             変更なし
  lib/version.js         Node の版の比較(T12)
  test/launcher-test.js  期待値を更新、永続化のテストを追加(T13)
  data/                  手元の DB 置き場(git 管理外。data/pipes は消す)
  node_modules/openpipes e0fe7cc の OpenPipes 本体。デプロイに含まれる
```

### 9.5 タスク

### [x] T10. OpenPipes を `6aca055` に更新する

```sh
cd /home/takano32/GitHub/hello-pte-worker
node --version                                   # v22.13.0 以上(手元は v24.19.0)
npm update openpipes                             # 動かなければ npm install github:takano32/OpenPipes#main
grep -A3 '"node_modules/openpipes"' package-lock.json   # resolved が ...#6aca055c4939a5c29146e3e131d45edb25aef36e
ls node_modules/openpipes/assets/demo/pipes/     # demo-headline demo-loop demo-merged demo-tech-filter
ls node_modules/openpipes/data 2>&1              # 「No such file」か空。古い data/pipes が残っていたら rm -rf node_modules/openpipes && npm install
grep -n 'node:sqlite' node_modules/openpipes/lib/store.js   # ある
grep -n 'OPENPIPES_DB\|OPENPIPES_GOOGLE_CLIENT_ID' node_modules/openpipes/server.js   # 両方ある
```

`package.json` の `engines` を `{ "node": ">=22.13.0" }` に変える。他は変えない。

この時点で `npm test` は **失敗する**(`authRequired` を期待している)。T13 で直すので、ここではコミットしない。

**受け入れ基準**: 上の確認がすべて期待どおり。`git status --short` に `package.json` と `package-lock.json` だけが出る。

### [x] T11. `data/pipes`、`.gitignore`、`.env.example`、`sorahost.json` を改める

1. `data/pipes` を消す。**消す前に** `ls data/pipes` が `demo-*.json` 4 件だけであることを確かめる(2026-09-03 時点ではそうなっている)。デモ以外の JSON があれば消さず、T15 の手動確認でエディタの「JSON を読み込む」から DB に入れてから消す。
   ```sh
   ls data/pipes                     # demo-headline.json demo-loop.json demo-merged.json demo-tech-filter.json
   git rm -r data/pipes
   ```
2. `.gitignore` に `data/` を足す(手元の `data/openpipes.db` と `-wal` / `-shm` を入れないため):
   ```
   node_modules/
   .env
   .sorahost.json
   *.log
   data/
   ```
3. `.env.example` を全文差し替える:
   ```
   # OpenPipes に渡す環境変数。
   # このファイルを .env にコピーして値を入れる。.env は git に入れない(.gitignore 済み)し、
   # sorahost-cli もアップロードしない。PteWorker へは Pterodactyl のファイルマネージャか SFTP で手で置く。
   # ランチャーは server.js のあるディレクトリから HOME まで親を遡って最初に見つかった .env を読む。
   # PORT と SERVER_PORT はホスティング側が決めるので、ここに書いても無視される。

   # --- 認証(どちらか一方。両方書くと OpenPipes が起動を拒否する) ---

   # (A) Basic 認証: エディタと /api/* を守るパスワード(ユーザー名は OPENPIPES_USER、既定 admin)
   OPENPIPES_PASSWORD=

   # (B) Google ログイン: 使うときは (A) を空にして、この 3 行のコメントを外す。
   #     承認済みリダイレクト URI に <OPENPIPES_BASE_URL>/auth/google/callback を登録しておく(README 参照)
   #OPENPIPES_GOOGLE_CLIENT_ID=
   #OPENPIPES_GOOGLE_CLIENT_SECRET=
   # 任意: ログインできるアカウント(カンマ区切り。メールアドレスか @ドメイン)。未設定だと誰でも入れる
   #OPENPIPES_ALLOWED_USERS=you@example.com

   # --- 置き場と URL ---

   # 保存したパイプ・ユーザー・セッションが入る SQLite ファイル。
   # 再デプロイで消えない絶対パスにする(未設定だと <このリポジトリ>/data/openpipes.db になり、再デプロイで消える)
   OPENPIPES_DB=/home/container/openpipes/openpipes.db

   # ブラウザで実際に使う公開 URL(npx sorahost-cli whoami で出るサイト URL。末尾のスラッシュ・パスは付けない)。
   # フィードのリンクに使われ、Google ログインでは必須。違う URL でアクセスすると保存が 403 になる
   OPENPIPES_BASE_URL=

   # PteWorker はループバックへのバインドを求めているので 127.0.0.1 にする
   OPENPIPES_HOST=127.0.0.1

   # --- 任意 ---

   # サーバー上での保存・削除を止めたいときだけ 1
   #OPENPIPES_READONLY=1
   # 公開フィードのキャッシュ秒数(既定 300)
   #OPENPIPES_CACHE_TTL=300
   ```
4. `sorahost.json` の `include` から `data/pipes` を外す:
   ```json
   {
     "mode": "node",
     "start": "node server.js",
     "include": [
       "server.js",
       "lib",
       "package.json",
       "node_modules/openpipes"
     ]
   }
   ```
   DB は `include` に**書かない**(サーバー上にあるもので、手元から送るものではない)。

**受け入れ基準**: `git status --short` に `data/pipes/*.json` の削除 4 件、`.gitignore`、`.env.example`、`sorahost.json` が出る。`.env.example` に `OPENPIPES_DATA` が無い。

### [x] T12. `lib/version.js` を足し、`server.js` を SQLite 前提に書き直す

仕様:

1. **Node の版**: `process.version` が `22.13.0` 未満なら、OpenPipes を import する**前**に `[launcher] Node 22.13.0 or newer is required (node:sqlite); this is v20.x.y` を stderr に出して exit 1。比較関数は `lib/version.js` に分けて単体テストする。
2. **`.env`**: 第 1 期のまま(`ENV_FILE` → 自分のディレクトリから HOME まで遡る。既存の環境変数は上書きしない。`PORT` / `SERVER_PORT` は読まない)。`lib/env.js` は変更しない。
3. **DB の置き場**: `OPENPIPES_DB` が未設定なら `<repo>/data/openpipes.db` を設定する。設定済みで `:memory:` 以外なら絶対パスに解決して入れ直す(`OPENPIPES_DATA` を相対パスで書かないのと同じ理由)。ディレクトリは作らない(OpenPipes が起動時に作る)。
4. **`OPENPIPES_DATA` の扱いと初期投入は削除する。**
5. **認証モードの推定**(ログ用。本当の判定と検証は OpenPipes が行う): `OPENPIPES_GOOGLE_CLIENT_ID` か `_SECRET` があれば `google`、無くて `OPENPIPES_PASSWORD` があれば `basic`、どちらも無ければ `none`。`none` なら `[launcher] WARNING: no OPENPIPES_PASSWORD and no Google login; the editor and /api/run are open to anyone` を stderr に出す(起動は止めない。手元の `npm start` を邪魔しないため)。
6. **起動ログ 1 行**: `[launcher] node v24.19.0; <.env のパス> applied: <キー名...>; db <DB のパス>; auth=basic; read-only=false`。値は出さない。
7. 最後に `await import('openpipes/server.js')`。

参照実装。`lib/version.js`:

```js
// Node のバージョン比較。OpenPipes は node:sqlite を static import するので、古い Node では
// 分かりにくい import エラーになる。その前にランチャーが自分の言葉で止めるための小さな道具。
export const MIN_NODE = '22.13.0';

// 'v24.19.0' や '22.13.0' を [24, 19, 0] に。読めなければ null
export function parseVersion(text) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(String(text).trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

export function meetsMinimum(version, minimum = MIN_NODE) {
  const a = parseVersion(version);
  const b = parseVersion(minimum);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return true;
}
```

`server.js`:

```js
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
```

**受け入れ基準**: `cp .env.example .env` して `OPENPIPES_PASSWORD=test-only`、`OPENPIPES_DB=` を空(未設定扱いにするため行ごと削除)、`OPENPIPES_BASE_URL=` を空(行ごと削除)にした状態で `SERVER_PORT=3123 node server.js` を起動すると、`[launcher] node v24.19.0; /home/takano32/GitHub/hello-pte-worker/.env applied: OPENPIPES_PASSWORD, OPENPIPES_HOST; db /home/takano32/GitHub/hello-pte-worker/data/openpipes.db; auth=basic; read-only=false` と `OpenPipes listening on http://127.0.0.1:3123 (auth as "admin")` が出る。`curl -s http://127.0.0.1:3123/api/config` が `{"readOnly":false,"auth":"basic","user":null}` を返す。`data/openpipes.db` が出来ていて `git status --short` に出ない。

> **実測(2026-09-03、Node v24.19.0)**: 上の期待値はすべて満たしたが、ログの細部は 2 点ちがった。
> どちらも OpenPipes / Node 側の都合なので、ランチャーは直さず README(T14)を実測に合わせてある。
> 1. `applied:` のキー名は `util.parseEnv` が返す順、つまり**アルファベット順**に並ぶ
>    (`.env` の記載順ではない)。例: `applied: OPENPIPES_HOST, OPENPIPES_PASSWORD`。
> 2. OpenPipes の起動行には DB のパスが入る:
>    `OpenPipes listening on http://127.0.0.1:3123 (db <DB のパス>, auth as "admin")`。

### [x] T13. `test/launcher-test.js` を更新する

第 1 期の流儀(依存なし、`node:assert/strict`、子プロセス、ネットワーク不要、`N passed, M failed`)は変えない。変更点:

**単体**

1. `lib/env.js` のテスト(findEnvFile / applyEnv / parseEnv)はそのまま。
2. `meetsMinimum`: `('v24.19.0', '22.13.0')` → true、`('v22.13.0')` → true、`('v22.12.9')` → false、`('v20.19.0')` → false、`('garbage')` → false。`parseVersion('v24.19.0')` → `[24, 19, 0]`。

**スモーク**(`childEnv` は第 1 期のまま `PORT`, `SERVER_PORT`, `ENV_FILE`, `OPENPIPES_*` を消してから組み立てる。**`OPENPIPES_DB` も消える**ので、各ケースで明示する)

3. ケース A(`.env` あり): 一時ディレクトリの `.env` に `OPENPIPES_PASSWORD=test-only`, `OPENPIPES_HOST=127.0.0.1`, `OPENPIPES_DB=:memory:`, `SERVER_PORT=1`, `PORT=1` を書き、`ENV_FILE=<そのパス>`, `SERVER_PORT=<空きポート>` で起動。
   - `/api/config` → `{ readOnly: false, auth: 'basic', user: null }`。
   - `/` → 401。`Authorization: Basic admin:test-only` 付き `/` → 200。
   - `/pipes/demo-tech-filter/run` → 200、本文に `<rss`(同梱デモがファイルから読めて、`/demo/tech.xml` の自己取得が効いている証拠)。
   - 起動ログに `test-only` が**含まれない**。`auth=basic` と `db :memory:` が含まれる。`WARNING` が含まれない。
4. ケース B(`.env` なし): `ENV_FILE=<存在しないパス>`, `OPENPIPES_DB=:memory:` で起動。`/api/config` → `{ readOnly: false, auth: 'none', user: null }`。ログ(stderr)に `WARNING` が含まれる。
5. ケース C(永続化): ケース A の `.env` に加えて `OPENPIPES_DB=<一時ディレクトリ>/nested/openpipes.db`(`nested` は作らない)。
   - 起動後、`POST /api/pipes`(Basic 認証付き、body `{ name: 'launcher test', modules: [{ id: 'm1', type: 'output', params: {}, x: 0, y: 0 }], wires: [] }`)→ 200、`{ id }` が返り、`id` が `/^launcher-test-[0-9a-f]{16}$/` に一致する。
   - 子プロセスを止め、**同じ `.env` で再起動**し、`GET /api/pipes`(Basic 認証付き)の一覧にその `id` が含まれる(DB が指定した場所に出来て、再起動をまたいで残る証拠)。
   - `<一時ディレクトリ>/nested/openpipes.db` が存在する。
6. ケース D(読み取り専用): ケース A に `OPENPIPES_READONLY=1` を足して、`/api/config` の `readOnly` が true、`POST /api/pipes` が 403。
7. 終了時に子プロセスを `SIGKILL` し、一時ディレクトリを消す。失敗時は子プロセスのログを出す。

`withServer` が stdout と stderr を分けて溜めるようにする(ケース B の `WARNING` は stderr)。

**受け入れ基準**: `npm test` が pass。テスト後に `git status --short` にテスト由来の差分が無く、`data/` にも何も増えていない(すべて `:memory:` か一時ディレクトリを使う)。

### [x] T14. `README.md` を改訂する

節構成は第 1 期(9 節)を保ち、内容を差し替える。

1. **これは何か**: 「パイプは `data/pipes/*.json`」の記述を消し、「保存したパイプ・ユーザー・セッションは SQLite 1 ファイル(`OPENPIPES_DB`)に入る。デモ 4 件は OpenPipes に同梱され読み取り専用」に。ツリーから `data/pipes` を外し、`lib/version.js` と `data/`(手元の DB、git 管理外)を足す。**Node.js 22.13 以上が必要**と冒頭に書く。
2. **セットアップ**: `node --version` の確認を先頭に足す。
3. **手元で動かす**: `SERVER_PORT=3123 npm start` → `data/openpipes.db` が出来る。`OPENPIPES_READONLY=0` の話は消す(既定で書き込み可)。`/api/config` の期待値を `{"readOnly":false,"auth":"basic","user":null}` に。
4. **PteWorker へのデプロイ**: 手順 3 で `.env` に入れる値を `OPENPIPES_PASSWORD`、`OPENPIPES_DB`(`/home/container/openpipes/openpipes.db`)、`OPENPIPES_BASE_URL`(`whoami` のサイト URL)の 3 つに。手順 6 の期待行を `[launcher] node v22.x.x; /home/container/.env applied: OPENPIPES_PASSWORD, OPENPIPES_DB, OPENPIPES_BASE_URL, OPENPIPES_HOST; db /home/container/openpipes/openpipes.db; auth=basic; read-only=false` と `OpenPipes listening on http://127.0.0.1:<port> (auth as "admin")` に。**`Node 22.13.0 or newer is required` と出て止まったら PteWorker の Node が古い**(§9.7)と書く。手順 0 として PteWorker のコンソールで `node --version` を確かめることを足す。
5. **パイプの編集フロー**: GitOps を消し、「サーバー上のエディタで編集する。パイプはサーバーの DB に残る。手元で作ったものは読み込みメニューの『JSON を書き出す』→ サーバーで『JSON を読み込む』で持ち込む」に。**バックアップ**の小節を足す(OpenPipes README の `VACUUM INTO` ワンライナーをパスだけ `/home/container/openpipes/openpipes.db` に直して転記。PteWorker のコンソールで動くかは未確認と明記。サーバーを止めて `-wal` / `-shm` ごとコピーする方法も書く)。
6. **環境変数**: 表を §9.2 に合わせる。`OPENPIPES_DATA` を消し、`OPENPIPES_DB`、`OPENPIPES_BASE_URL`、`OPENPIPES_GOOGLE_CLIENT_ID` / `_SECRET`、`OPENPIPES_ALLOWED_USERS`、`OPENPIPES_OIDC_ISSUER` を足す。`OPENPIPES_READONLY` の既定を「未設定(書き込み可)」に。
7. **セキュリティの注意**: 「`.env` を置き忘れると認証なし」に加え、ランチャーが `WARNING` を出すこと、`.env` が無いと DB も再デプロイで消える場所に出来ることを書く。**パイプの id は公開フィードを読める資格なので、公開する場所に貼らない**を足す。Basic と Google を同時に設定すると起動しないことを書く。
8. **Google ログイン**(新設。7 と 8 の間に入れ、以降を繰り下げてよい): Google Cloud Console で OAuth クライアント(ウェブアプリケーション)を作り、承認済みリダイレクト URI に `<OPENPIPES_BASE_URL>/auth/google/callback` を完全一致で登録する。`.env` の `OPENPIPES_PASSWORD` を空にし、`OPENPIPES_GOOGLE_CLIENT_ID` / `_SECRET` / `OPENPIPES_ALLOWED_USERS` を入れて再起動。**`OPENPIPES_ALLOWED_USERS` を必ず設定する**(未設定だと Google アカウントを持つ誰でも入れる)。モードを切り替えると Basic 時代の `local` ユーザーのパイプは一覧から見えなくなる(消えてはいない。公開フィードは引き続き読める)。
9. **更新手順**: 変更なし(`npm update openpipes` → `npm test` → コミット → deploy)。「OpenPipes の Node 要件が上がったら `engines` を追従させる」を足す。
10. **未確認事項**: §9.7 の表を要約して転記(第 1 期の表に**追記**。Node の版が筆頭)。

**受け入れ基準**: README に `OPENPIPES_DATA`、`data/pipes`、`authRequired`、`GitOps` が残っていない(`grep -n 'OPENPIPES_DATA\|data/pipes\|authRequired\|GitOps' README.md` が空)。`OPENPIPES_DB`、`OPENPIPES_BASE_URL`、`22.13`、`VACUUM INTO`、`OPENPIPES_ALLOWED_USERS` がある。コマンドはすべて実際に動くもの。

### [x] T15. ローカルで最終確認

```sh
cd /home/takano32/GitHub/hello-pte-worker
npm test

# 手動確認: .env が効く / 既定の DB 置き場 / 認証 / 永続化
cp .env.example .env
sed -i 's/^OPENPIPES_PASSWORD=$/OPENPIPES_PASSWORD=test-only/' .env
sed -i '/^OPENPIPES_DB=/d; /^OPENPIPES_BASE_URL=/d' .env          # 手元では既定の置き場・URL でよい
printf 'PORT=9\nSERVER_PORT=9\n' >> .env
rm -f data/openpipes.db data/openpipes.db-wal data/openpipes.db-shm
SERVER_PORT=3123 node server.js &
sleep 1
curl -s http://127.0.0.1:3123/api/config                                           # {"readOnly":false,"auth":"basic","user":null}
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3123/                    # 401
curl -s -o /dev/null -w '%{http_code}\n' -u admin:test-only http://127.0.0.1:3123/ # 200
curl -s http://127.0.0.1:3123/pipes/demo-tech-filter/run | head -3                 # <rss ...
curl -s -u admin:test-only -H 'content-type: application/json' \
  -d '{"name":"manual check","modules":[{"id":"m1","type":"output","params":{},"x":0,"y":0}],"wires":[]}' \
  http://127.0.0.1:3123/api/pipes                                                  # {"id":"manual-check-<16 hex>"}
kill %1
ls data/                                                                           # openpipes.db(と -wal / -shm)
SERVER_PORT=3123 node server.js &
sleep 1
curl -s -u admin:test-only http://127.0.0.1:3123/api/pipes | head -c 200          # manual-check-... が残っている
kill %1

# Basic と Google を両方書くと止まることの確認(値はダミー)
OPENPIPES_GOOGLE_CLIENT_ID=dummy OPENPIPES_GOOGLE_CLIENT_SECRET=dummy OPENPIPES_BASE_URL=http://localhost:3123 \
  SERVER_PORT=3123 node server.js                                                  # "cannot be combined" で exit 1

# 古い Node を装った版チェックの確認(関数だけ)
node -e "import('./lib/version.js').then(m => console.log(m.meetsMinimum('v20.19.0'), m.meetsMinimum('v22.13.0')))"   # false true

# デプロイ内容の確認(アップロードしない)。data/pipes が無くてもエラーにならず、.env の有無でファイル数が同じ
SORAHOST_ENDPOINT=https://example.invalid/_sorahost/dummy SORAHOST_TOKEN=dummy \
  npx sorahost-cli deploy --dry-run --yes
rm -f .env
SORAHOST_ENDPOINT=https://example.invalid/_sorahost/dummy SORAHOST_TOKEN=dummy \
  npx sorahost-cli deploy --dry-run --yes
rm -f data/openpipes.db data/openpipes.db-wal data/openpipes.db-shm
```

**受け入れ基準**: 上の期待値がすべて一致。dry-run の送信対象が `server.js/ lib/ package.json/ node_modules/openpipes/` で、`node_modules が含まれていません` の警告が出ず、2 回のファイル数が同じ。第 1 期(30 ファイル、343 KB)よりファイル数が変わっていてよい(OpenPipes の構成が変わったため)。`git status --short` に `.env`、`data/` が出ない。

### [x] T16. コミットする

```sh
git add -A
git status --short      # .env / .sorahost.json / node_modules / data/*.db が含まれていないこと。data/pipes の削除 4 件が含まれること
git commit -m "Follow OpenPipes 6aca055: SQLite storage, Node 22.13, Google login"
```

push はしない(第 1 期と同じ。リモートは無く、ユーザーの判断)。

**受け入れ基準**: コミット済み。`git status --short` が空。`git show --stat HEAD` に `package-lock.json`、`server.js`、`lib/version.js`、`test/launcher-test.js`、`README.md`、`.env.example`、`sorahost.json`、`.gitignore`、`data/pipes/*.json`(削除)が出る。

### [ ] T17. PteWorker 実機で確認する(**ユーザーが行う**。エージェントは README に書くまで)

1. PteWorker のコンソールで `node --version`(または最初のデプロイ後の `logs`)。**22.13.0 未満なら以降は進めない**。SORAHOST 側で Node の版を選べるか(egg の変数、Docker イメージ)を確かめ、選べなければ OpenPipes を古い Node に戻すか(`node:sqlite` を捨てることになるので事実上不可)、別のホスティングにする。
2. `.env` を更新して置き直す(`OPENPIPES_DB`、`OPENPIPES_BASE_URL` を追加)。`mkdir -p /home/container/openpipes` は不要(起動時に作られる)。
3. `npx sorahost-cli deploy` → `logs` で `db /home/container/openpipes/openpipes.db; auth=basic` を確認。
4. エディタで適当なパイプを 1 つ保存 → **もう一度 `deploy`** → 一覧に残っていることを確認する。残っていなければ `OPENPIPES_DB` の置き場を変える(§9.7)。
5. `?format=json` のフィードの `home_page_url` / RSS の `<link>` が `OPENPIPES_BASE_URL` になっていることを確認する。
6. バックアップの node ワンライナーがコンソールで動くか試す。

**受け入れ基準**: 上の 4 で保存したパイプが再デプロイ後も残る。結果(Node の版、残ったかどうか)を README の未確認事項の表に反映する。

> **エージェント側の進捗(2026-09-03)**: 1〜4 は実機とデプロイトークンが要るので手を付けていない
> (§8「本物のエンドポイントとトークンで `deploy` を実行するのはユーザー」。この作業環境には
> `.sorahost.json` も `SORAHOST_*` も無く、`sorahost-cli` にコンソールを叩く手段も無い)。
> **実機に依存しない 5 と 6 は手元で先に確かめてあり**、README に反映済み:
> - 5: `OPENPIPES_BASE_URL=http://127.0.0.1:3123` で起動してパイプを保存すると、RSS の `<link>` も
>   JSON Feed の `home_page_url` / `feed_url` もその origin になった。
> - 6: README のワンライナーがそのまま動き、`pipes` / `sessions` / `users` を含むコピーが出来た。
>   **サーバーを止めた状態でも稼働中でも**一貫したコピーが取れる(`VACUUM INTO` は WAL の内容も書き出す)。
>   `node -e` は `"type": "module"` のディレクトリでも CommonJS なので `require` のままでよい。
>
> 残るのは**この作業環境では原理的に確かめられない 3 点**だけ: PteWorker の Node の版、
> `/home/container/openpipes/` が再デプロイをまたぐか、コンソールで任意コマンドを打てるか。

### [x] T18. Google モードを偽 issuer で手元から確かめる(実機不要)

`node_modules/openpipes/test/fake-issuer.mjs` がパッケージに同梱されていて `startFakeIssuer` を export しているので、
Google アカウントもデプロイトークンも無しに、このリポジトリのランチャーごと Google モードを一周できる。
T17 の 1〜4 と違って実機に依らないので、ユーザーの一度きりの実機作業に持ち込む未知を減らせる(5c1169c と同じ理由)。
操作手順は **README §8 の「本物の Google を用意する前に(手元で一周する)」**(重複させない)。

`test/launcher-test.js` に **ケース E** を足す。既存ケースと同じ流儀で子プロセスを起こし、`ENV_FILE` を
存在しないパスにして手元の `.env` を無効化し(`OPENPIPES_PASSWORD` が入っていると併用扱いで起動を拒否される)、
`OPENPIPES_DB=:memory:`、`OPENPIPES_BASE_URL` は `withServer` が決めたポートに合わせる。確かめること:

- 起動ログに `auth=google` が出て、`OPENPIPES_GOOGLE_CLIENT_SECRET` の値がログのどこにも出ない
- `/api/config` が `auth:"google"`、ログイン前は `user:null`。エディタ `/` は 401 ではなく 200
- 許可外のアドレスは `/auth/google/callback` で弾かれ、`user` は `null` のまま
- 許可済みは往復でき、セッションで `GET /api/pipes` が読めて同梱デモが載っている
- ログに出る認証の行は `login u-<16 桁の hex>` だけで、メールアドレスは出ない

**受け入れ基準**: `npm test` にケース E が入って pass し(単体 6 + ケース A〜E = 11 件)、`data/` にファイルを残さない。

> **実施済み(2026-09-03、Node v24.19.0)**: 上をケース E として実装し、11 件 pass。
> 偽 issuer は `import { startFakeIssuer } from 'openpipes/test/fake-issuer.mjs'` で読んでいる
> (OpenPipes に `exports` が無いので深い import が通る)。**OpenPipes 側が `package.json` に `files` を
> 足して `test/` を同梱しなくなるとこの import は壊れる**ので、そのときは `../OpenPipes/test/fake-issuer.mjs`
> から読むか、ケース E を落とす。

### [x] T19. d568509 の運用上の落とし穴を README に反映する

OpenPipes `d568509`(README のみ。2026-09-03 に push 済み)が、実測に基づく落とし穴を書き下ろした。
このリポジトリに効くものを README に取り込む。**d568509 単体では再固定の理由にならなかった**
(その後 `e0fe7cc` で再固定した。T20)。取り込んだもの:

| d568509 の指摘 | このリポジトリでの確認 | 反映先 |
| --- | --- | --- |
| 稼働中に `openpipes.db` だけをコピーすると**テーブルが 1 つも無い DB** になり得る | 実測で再現 | README §5 |
| `VACUUM INTO` は出力先が既にあると `output file already exists` で止まる | 実測で再現。README のワンライナーは出力先を固定していたので日付入りの別名に直した | README §5 |
| 復元の予行演習。`sessions` が同じファイルなので古いバックアップに戻すと全員ログインし直し | Basic 認証はセッションを使わないので影響しないことを追記 | README §5 |
| 同意画面は「テスト中」だとテストユーザーしか入れず、外は `access_denied` だけ | (実機のみ。手順として記載) | README §8 手順 2 |
| `redirect_uri_mismatch` はサーバーのログに残らない。`curl -D -` で実際の値を読む。`curl -I` は HEAD なので全パス 404 | 手元で再現(送信値は `<BASE_URL>/auth/google/callback`、HEAD は 404) | README §8 |
| 認証のログは `login <id>` / `logout <id>` の 2 行だけ | 実測。`login u-<16 hex>`、メールは出ない | README §8 手順 5、ケース E |
| クライアント シークレットをコマンドラインに書かない | — | README §7 |
| `OPENPIPES_ALLOWED_USERS` 未設定は踏み台になる | — | README §8、`.env.example` |
| 持ち主は `sub`、許可リストはアドレス照合。ズレると自分が締め出される | — | README §8 |
| `local` のパイプの引き継ぎは `UPDATE pipes SET owner_id` しかない | 実測: `node:sqlite` は `foreign_keys` が既定 ON なので、誤った id は `FOREIGN KEY constraint failed` で止まる。ユーザー id は `u-<16 hex>` | README §8 の新しい小見出し |
| `DELETE /api/pipes/:id` は存在しない id でも他人の id でも 200 | 実測。削除後の `/pipes/<id>/run` は**即 404**(キャッシュに残らない)ので、これが確認手段になる | README §7 |
| 旧 `data/pipes/*.json` は自動移行されない | このリポジトリの 4 件はデモと byte 一致だったので移行対象なし(T11 で確認済み)。**追記不要** | — |

**受け入れ基準**: 上の反映先がすべて README(と `.env.example`)に入っており、`npm test` が pass、
`git status --short` が空。README に `OPENPIPES_DATA` / `data/pipes` / `authRequired` / `GitOps` が無いままであること。

### [x] T20. OpenPipes `e0fe7cc` に追従する(バグ修正。ランタイムのコードが動いた)

`d568509` と違い、`e0fe7cc`「Fix a login that ends in 500, and a gate that traps unsaved work」は
**ランタイムのコードを変えた**ので、§5.2 の更新手順どおりに追従する。

```sh
npm update openpipes
grep -A3 '"node_modules/openpipes"' package-lock.json   # resolved が ...#e0fe7cc69ccc406141362ab456825c5c3b7e71a4
grep -n 'headerSafeUrl' node_modules/openpipes/server.js
npm test                                                # 11 件 pass
```

このリポジトリに効く差分:

| e0fe7cc の中身 | このリポジトリでの確認 | 反映先 |
| --- | --- | --- |
| `return_to` が非 ASCII(`/あ` など)だと `writeHead` が投げる。しかも `Set-Cookie` の**後**なので、成功したログインが有効なセッション Cookie を持ったまま 500 になる。`headerSafeUrl()` が全 `Location` をパーセントエンコード | 実測: 偽 issuer 経由で `return_to=%2F%E3%81%82` を通し、**302 + `Location: <base>/%E3%81%82` + セッション Cookie** を確認(修正前は 500)。ケース E に組み込んで回帰テストにした | `test/launcher-test.js` |
| ゲート(全画面のログイン画面)に **「⭳ 編集中の内容を JSON で保存」** が付いた。キャンバスが空でないときだけ出る | 実測: 書き出しは `exportPipe()`(ブラウザ内の Blob)なのでセッション無しで動く。戻すと `savedId` が null になり **id は採番し直される** | README §8「覚えておくこと」 |
| ランチャーが触る面(環境変数名・起動の順序・起動ログ・`OPENPIPES_DB` の扱い・`engines.node`)には**何も無い**。`server.js` 側の差分は `redirectTo` に `headerSafeUrl()` を挟むだけで、`engines.node` は両側とも `>=22.13.0`、`lib/version.js` の `MIN_NODE` も `22.13.0` のままでよい | 確認済み | 変更なし |
| `test/fake-issuer.mjs` と `package.json`(`files` 無し)は無変更 | ケース E の深い import は壊れない | 変更なし |

**上流の回帰テストを写さないこと。** 非 ASCII の `return_to` は OpenPipes 側の `test/server-tests.js` が、
ゲートの書き出しは `test/e2e/suites.mjs` が既に守っている。このリポジトリのケース E が足すのは
「**このランチャー経由で**同じことが成り立つ」ところだけ。

**受け入れ基準**: `package-lock.json` が `e0fe7cc` を指し、`npm test` が 11 件 pass(ケース E の一周に
非 ASCII の `return_to` が入っている)。`sorahost deploy --dry-run` の送信対象とファイル数が `6aca055` 時点から
増減していない(サイズだけ増える)。`git status --short` が `package-lock.json` だけ(コミット後は空)。

### 9.6 受け入れ基準チェックリスト(第 2 期)

- [x] `package-lock.json` の `openpipes` が `e0fe7cc69ccc406141362ab456825c5c3b7e71a4` を指し(`6aca055` → `d568509` → `e0fe7cc`。§9.5 の T20)、`engines.node` が `>=22.13.0`(OpenPipes 側も `>=22.13.0`)。
- [x] `data/pipes` が git から消え、`sorahost.json` の `include` にも無い。`.gitignore` に `data/` がある。
- [x] `.env.example` に `OPENPIPES_DB`、`OPENPIPES_BASE_URL`、Google の 3 変数(コメントアウト)があり、`OPENPIPES_DATA` が無い。
- [x] ランチャーが Node 22.13 未満で分かる言葉で止まり、`OPENPIPES_DB` 未設定時に `<repo>/data/openpipes.db` を使い、`auth=` をログに出し、`none` なら `WARNING` を出す。値はログに出ない。
- [x] `npm test` が pass(単体 + ケース A〜E)。テストが `data/` にファイルを残さない。
- [x] 偽 issuer 相手にランチャーを `auth=google` で起動でき、ログイン往復と許可リストの弾きがケース E として `npm test` に入っている(T18)。
- [x] d568509 の運用上の落とし穴が README に反映されている(T19)。
- [x] OpenPipes `e0fe7cc` に再固定され、このリポジトリのコード・設定は無変更(T20)。
- [x] セッションが編集中に切れたときの退避(ゲートの「⭳ 編集中の内容を JSON で保存」を先に押すこと、戻すと id が変わること)が README §8 に書いてある(T20)。
- [x] `sorahost deploy --dry-run` の送信対象が `server.js`, `lib`, `package.json`, `node_modules/openpipes` だけで、`.env` の有無でファイル数が変わらない。
- [x] README に `OPENPIPES_DATA` / `data/pipes` / `authRequired` / `GitOps` が残っておらず、Node 22.13、`OPENPIPES_DB`、`OPENPIPES_BASE_URL`、Google ログイン、バックアップ、未確認事項(Node の版)が書いてある。
- [x] コミット済みで `git status --short` が空。
- [ ] (ユーザー)PteWorker の Node が 22.13 以上で、保存したパイプが再デプロイ後も残る。

### 9.7 未確認事項と仮定(第 2 期で増えた分。§7 に追加)

| 項目 | 仮定 | 外れた場合の対処 |
| --- | --- | --- |
| **PteWorker の Node の版** | 22.13.0 以上(SORAHOST の Node イメージが十分新しい) | ランチャーが `Node 22.13.0 or newer is required` で止まる。SORAHOST 側で Node の版を選べるか確認する。選べなければ OpenPipes は動かせない(`node:sqlite` は 22.13 未満ではフラグ付きでも API が違う)。これは**ユーザーにしか確認できず、外れると第 2 期全体が無駄になる**ので、T17 の 1 を最初に行う |
| DB の置き場 `/home/container/openpipes/` | `.env` を `/home/container` 直下に置くのと同じく、再デプロイで消えない | T17 の 4 で保存したパイプが消える。Pterodactyl のファイルマネージャで再デプロイ前後のディレクトリを見比べ、残る場所へ `OPENPIPES_DB` を向ける。どこも残らないなら、定期的に `VACUUM INTO` で取ったバックアップを手で置き直す運用になる |
| DB の親ディレクトリの作成 | OpenPipes が起動時に `mkdir -p` する(`SPEC.md`「The parent directory is created at boot」) | 権限で失敗したら `logs` に出る。ファイルマネージャで作る |
| `sqlite3` コマンド | PteWorker のコンテナには**無い**前提。バックアップは node ワンライナーで行う | あればそれでもよい |
| `OPENPIPES_BASE_URL` に入れるサイト URL | `npx sorahost-cli whoami` で出るサイト URL が固定で、ブラウザで使う URL と同じ(https) | URL が変わると保存が 403 になる(CSRF の `Origin` 照合)。`.env` を直して再起動 |
| Google ログインのリダイレクト URI | サイト URL が https で固定なら `<サイト URL>/auth/google/callback` を Google に登録できる | http のみ、または URL が変わるなら Google ログインは使わず Basic のまま。`http` が使えるのは localhost / 127.0.0.1 だけ(d568509) |
| Google モードそのもの | ~~仮定~~ → **実測(2026-09-03)**。同梱の偽 issuer 相手に、このランチャー経由でログイン往復・許可リストの弾き・ユーザー分離まで通ることを確認し、`npm test` のケース E にした(T18) | 残るのは**本物の Google 固有の挙動**だけ: 同意画面のテストユーザー(未追加だと `access_denied`)と `redirect_uri_mismatch`(サーバーのログには何も出ない)。どちらも README §8 に手順として書いた |
| SQLite の WAL とコンテナのファイルシステム | 通常のローカルディスクで WAL が動く | NFS 等で lock に失敗するなら `logs` に出る。OpenPipes 側で `journal_mode` を変える必要があるので、OpenPipes に issue として持ち込む |
| 再デプロイ中の DB | 旧プロセスが止まってから新プロセスが開くので、同時に開かれることはない | 同時に開かれても WAL + `busy_timeout=5000` で待つ |

### 9.8 やってはいけないこと(第 2 期で増えた分。§8 に追加)

- `OPENPIPES_DB` を `node_modules/openpipes/` の中や、アップロードしたアプリのディレクトリの中に置かない(再デプロイで消える)。DB を `include` に入れて手元から送らない。
- `OPENPIPES_PASSWORD` と `OPENPIPES_GOOGLE_*` を同時に設定しない(起動しない)。Google モードでは `OPENPIPES_ALLOWED_USERS` を空にしない。
- `data/*.db`、`-wal`、`-shm` をコミットしない(`.gitignore` の `data/`)。
- パイプの id(`slug-<16 hex>`)は公開フィードを読める資格なので、README・コミットメッセージ・チャットに本物の id を貼らない(同梱デモの `demo-*` は除く)。
- `OPENPIPES_DATA` を復活させない。ランチャーで DB の中身に触らない(`openpipes/lib/store.js` を深い import してテーブルに直接書かない。スキーマは OpenPipes のもの)。
- `engines.node` を OpenPipes より緩くしない(`>=22.13.0` 未満を名乗らない)。
- 実機の Node の版が確認できていない段階で「PteWorker で動く」と README に断定しない。
