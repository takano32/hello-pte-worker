# hello-pte-worker

[OpenPipes](https://github.com/takano32/OpenPipes) を **SORAHOST の PteWorker** で動かすための配備リポジトリ。

## 1. これは何か

- アプリ本体はこのリポジトリには入っていない。npm の依存 `openpipes`(GitHub の `takano32/OpenPipes`)として取り込み、
  実際に使うコミットは `package-lock.json` の `resolved` で固定している。git submodule も subtree も使わない。
- このリポジトリが持っているのは **起動ランチャー**(`server.js` と `lib/env.js`)、**公開するパイプ**(`data/pipes/*.json`)、
  **デプロイ設定**(`sorahost.json`)、テスト、この手引きだけ。
- PteWorker はアップロードされたものをそのまま実行するだけで、依存のインストールもビルドもしない。
  そのため `node_modules/openpipes` を含めて送る(`sorahost.json` の `include`)。
- 秘密情報は `.env` に書く。`.env` は git にもデプロイ成果物にも入らない。PteWorker へは手でアップロードする(§4)。

```
hello-pte-worker/
  server.js              起動ランチャー(.env を読み、パイプ置き場を決め、OpenPipes を起動する)
  lib/env.js             .env の探索・パース・適用
  data/pipes/*.json      公開するパイプ(git 管理。初期値は OpenPipes のデモ 4 件)
  sorahost.json          デプロイ設定(mode / start / include)
  .env.example           .env の雛形
  test/launcher-test.js  単体 + スモークテスト
  TASKS.md               このリポジトリを作ったときの設計記録
```

## 2. セットアップ

```sh
npm install
cp .env.example .env      # 値を入れる。少なくとも OPENPIPES_PASSWORD は必須(§7)
npm test
```

`npm install` で `node_modules/openpipes` に本体が入り、`node_modules/.bin/sorahost` に CLI が入る。
CLI はグローバルには入れず、**常に `npx sorahost-cli <cmd>` とパッケージ名で呼ぶ**
(`npx sorahost` だと手元に無いときに同名の別パッケージを取りに行く恐れがあるため)。

> メモ: npm は `github:` 指定を `package-lock.json` に `git+ssh://git@github.com/...` として書く。
> GitHub への SSH 鍵が無い環境(CI など)で `npm ci` する場合は
> `git config --global url."https://github.com/".insteadOf git@github.com:` を設定する。

## 3. 手元で動かす

```sh
SERVER_PORT=3123 npm start
# → http://127.0.0.1:3123/  (Basic 認証: admin / .env に書いたパスワード)
```

`.env.example` のまま `.env` を作ると `OPENPIPES_READONLY=1` なので保存・削除はできない。
パイプを編集したいときは環境変数で上書きする(**環境変数はファイルより優先される**):

```sh
OPENPIPES_READONLY=0 SERVER_PORT=3123 npm start
```

公開フィードの確認:

```sh
curl -s http://127.0.0.1:3123/api/config                    # {"readOnly":true,"authRequired":true}
curl -s http://127.0.0.1:3123/pipes/demo-tech-filter/run    # RSS
```

## 4. PteWorker へのデプロイ

1. SORAHOST のパネルで PteWorker を起動する。コンソールに **エンドポイント** と **デプロイトークン** が出るので控える
   (トークンは一度しか表示されない。失くしたらコンソールで `token rotate`)。
2. このリポジトリで認証情報を保存する(`.sorahost.json` に 600 で保存され、git には入らない):
   ```sh
   npx sorahost-cli login
   ```
3. `.env` を用意する。`cp .env.example .env` して `OPENPIPES_PASSWORD` に強い固有のパスワードを入れる。
4. **`.env` を PteWorker に手で置く。** Pterodactyl のパネルのファイルマネージャ(または SFTP)でアップロードする。
   置き場所は、アプリが展開されるディレクトリ(その直下)か、`/home/container` 直下(HOME)のどちらか。
   **再デプロイで消えない場所を選ぶ**(§9。分かるまでは `/home/container/.env` を推奨)。

   ランチャーが `.env` を探す順序:

   1. 環境変数 `ENV_FILE` があればそのパス(PteWorker 側で環境変数を設定できるなら、これが確実)
   2. 無ければ `server.js` のあるディレクトリ → その親 → … と **HOME(`/home/container`)まで遡り**、
      最初に見つかった `.env`
   3. どこにも無ければ読まない(ログに `no .env` と出る)

5. 送信内容を確認してからデプロイする:
   ```sh
   npx sorahost-cli deploy --dry-run
   npx sorahost-cli deploy
   ```
6. PteWorker のコンソールで `logs` を実行し、次の 2 行を確認する:
   ```
   [launcher] /home/container/.env applied: OPENPIPES_HOST, OPENPIPES_PASSWORD, OPENPIPES_READONLY; pipes in ...
   OpenPipes listening on http://127.0.0.1:<port> (auth as "admin", read-only)
   ```
   `no .env` と出ていたら **認証なしで公開されている**。`.env` の置き場所を直してすぐ再デプロイする。
7. `npx sorahost-cli open`(または `whoami` で出るサイト URL)でエディタを開き、Basic 認証で入る。
8. 公開フィードは `<サイト URL>/pipes/<id>/run`。`?format=json` で JSON、`?format=jsonfeed` で JSON Feed。
   これを RSS リーダーに登録する。

CI から行う場合は `SORAHOST_ENDPOINT` / `SORAHOST_TOKEN` を Secrets に入れ、`npx sorahost-cli deploy --yes --json`。
`.env` はデプロイと無関係に PteWorker 側に置いたままでよい(CLI は `.env` を送らないので上書きされない)。

## 5. パイプの編集フロー(GitOps)

サーバー上は読み取り専用にしておき、**編集は手元で行って git 経由で配る**。
再デプロイで実行ディレクトリが入れ替わっても、公開しているパイプが消えないようにするため。

```sh
OPENPIPES_READONLY=0 SERVER_PORT=3123 npm start   # 手元では書き込み可で起動
# ブラウザ http://127.0.0.1:3123/ でパイプを作成・保存 → data/pipes/<id>.json が増える/変わる
git add data/pipes && git commit -m "Update pipes"
npx sorahost-cli deploy
```

サーバー上で直接編集したい場合は、`.env` の `OPENPIPES_READONLY=1` を消し、
`OPENPIPES_DATA=<再デプロイで消えない絶対パス>` を設定する。
初回起動時にランチャーが `data/pipes` の中身をそこへコピーする(2 回目以降は触らない)。
**どのパスが再デプロイ後も残るかは未確認**なので、PteWorker のコンソールで確認してから使うこと。

## 6. 環境変数

`.env` に書く(`.env.example` を参照)。**ホスティング側で設定された環境変数が常に優先される**
— ランチャーは既に環境にある変数を `.env` で上書きしない。

| 変数 | 既定 | 意味 |
| --- | --- | --- |
| `OPENPIPES_PASSWORD` | (空) | **必須。** エディタと `/api/*` を守る Basic 認証のパスワード。空だと認証なし |
| `OPENPIPES_USER` | `admin` | Basic 認証のユーザー名 |
| `OPENPIPES_HOST` | 全インターフェース | 待ち受けアドレス。PteWorker では `127.0.0.1`(プロキシ経由で届く) |
| `OPENPIPES_READONLY` | (未設定) | `1` で保存・削除を 403 にする。GitOps 運用では `1` |
| `OPENPIPES_CACHE_TTL` | `300` | 公開フィードのメモリキャッシュ秒数。`0` で無効 |
| `OPENPIPES_DATA` | `<repo>/data/pipes` | パイプの置き場。別の場所を指し、まだ無ければ `data/pipes` の中身で初期化される |
| `ENV_FILE` | (未設定) | `.env` のパスを明示する。設定すると探索しない |
| `OPENPIPES_ALLOW_PRIVATE` | (未設定) | 内部アドレスへの取得を許可。**設定しない**(§7) |

- `PORT` と `SERVER_PORT` は **ホスティング側が決める**。`.env` に書いても**読まれない**(ランチャーが無視する)。
  PteWorker は `SERVER_PORT` で空きポートを渡す。
- `.env` はリポジトリにもデプロイ成果物にも入らない(`.gitignore` 済み。CLI も `.env` / `.env.*` を常に除外する)。

## 7. セキュリティの注意

- **`OPENPIPES_PASSWORD` を必ず設定する。** 未設定だとエディタと `/api/run` が誰でも使え、
  サーバーを「公開 URL の取得代理」にされる。`.env` を置き忘れて起動すると **認証なしで公開される** ので、
  デプロイ後は必ず `logs` で `applied: ... OPENPIPES_PASSWORD ...` を確認する。
- 公開フィード `/pipes/<id>/run`、`/demo/*.xml`、`/api/config` は **認証なしで誰でも読める**(仕様)。
  RSS リーダーはログインできないため。ここに認証を掛けてはいけない。
- デプロイトークンと `.sorahost.json` はコミットしない(`.gitignore` 済み)。
  漏れたら PteWorker のコンソールで `token rotate`。
- `OPENPIPES_ALLOW_PRIVATE` は設定しない。設定すると、保存されたパイプから内部アドレスへ取得できてしまう。
- サイト URL が http のみの場合、Basic 認証は平文で流れる。強いパスワードと読み取り専用運用で緩和する。

## 8. 更新手順

OpenPipes 本体:

```sh
npm update openpipes                    # 動かなければ npm install github:takano32/OpenPipes#main
npm test
git add package-lock.json && git commit -m "Update OpenPipes"
npx sorahost-cli deploy
```

`node_modules/openpipes` は直接編集しない。直したいことは OpenPipes 側で直し、テストを通して push してから更新する。

CLI:

```sh
npm install -D sorahost-cli@latest
git add package.json package-lock.json && git commit -m "Update sorahost-cli"
```

## 9. 未確認事項

エージェントが検証できなかった項目。仮定のまま作ってあるので、実機で確認して外れていたら直す。

| 項目 | 仮定 | 外れた場合の対処 |
| --- | --- | --- |
| ポートの環境変数 | `SERVER_PORT`。`PORT` が来たらそちらを優先して使う | どちらでもなければ `logs` で変数名を確認し、ランチャーで `process.env.PORT` に読み替える |
| バインド先 | ループバック(`OPENPIPES_HOST=127.0.0.1`)で PteWorker のプロキシから届く | 届かなければ `.env` から `OPENPIPES_HOST` を消す(全インターフェース) |
| `.env` の置き場所 | アプリの展開先か `/home/container` 直下に置けばランチャーが見つける。HOME は `/home/container` | `logs` に `no .env` と出る。`ENV_FILE` を環境変数で設定できればそれで明示する。HOME が違うなら `lib/env.js` の `findEnvFile` の stopDir を見直す |
| 再デプロイ時のファイル | 実行ディレクトリは入れ替わり、実行中に書いたものは残らない。`/home/container` 直下の `.env` は残る | GitOps 構成なのでパイプには影響しない。`.env` が消えるなら置き場所を変える |
| 作業ディレクトリ | `start` はアップロードしたルートで実行される | ランチャーは自分のファイル位置からパスを解決するので cwd に依存しない。`OPENPIPES_DATA` を相対パスで書かないこと |
| Node のバージョン | 20.12 以上(`util.parseEnv` が使える) | 20.12 未満でも `lib/env.js` の簡易パーサで動く。18 未満は不可 |
| 送信方向のネットワーク | HTTP/HTTPS で外へ出られる | 出られないと上流フィードを取得できず、OpenPipes の意味が無い |
| HTTPS | サイト URL は https | http のみなら Basic 認証が平文になる(§7) |
| メモリ | 数百 MB 級で足りる | 足りなければ PteWorker 側で `NODE_OPTIONS=--max-old-space-size=...` を設定できるか確認する(`.env` に書いても効かない) |
