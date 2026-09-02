# hello-pte-worker

[OpenPipes](https://github.com/takano32/OpenPipes) を **SORAHOST の PteWorker** で動かすための配備リポジトリ。

> **Node.js 22.13.0 以上が必要。** OpenPipes は保存に `node:sqlite` を使い、これをフラグなしで
> static import できるのが 22.13.0 から。手元でも PteWorker でもこれ未満だと起動しない
> (ランチャーが `[launcher] Node 22.13.0 or newer is required (node:sqlite); this is v...` で止める)。

## 1. これは何か

- アプリ本体はこのリポジトリには入っていない。npm の依存 `openpipes`(GitHub の `takano32/OpenPipes`)として取り込み、
  実際に使うコミットは `package-lock.json` の `resolved` で固定している。git submodule も subtree も使わない。
- このリポジトリが持っているのは **起動ランチャー**(`server.js` と `lib/`)、**デプロイ設定**(`sorahost.json`)、
  テスト、この手引きだけ。
- **保存したパイプ・ユーザー・セッションは SQLite 1 ファイル**(`OPENPIPES_DB`)に入る。これはサーバー側のデータで、
  このリポジトリでは配らない。同梱のデモ 4 件(`demo-headline` / `demo-loop` / `demo-merged` / `demo-tech-filter`)は
  OpenPipes のパッケージに入っていて、**全員に同じものが読み取り専用で見える**(上書き・削除は 403。
  エディタで開いて保存するとコピーになる)。
- PteWorker はアップロードされたものをそのまま実行するだけで、依存のインストールもビルドもしない。
  そのため `node_modules/openpipes` を含めて送る(`sorahost.json` の `include`)。
- 秘密情報は `.env` に書く。`.env` は git にもデプロイ成果物にも入らない。PteWorker へは手でアップロードする(§4)。

```
hello-pte-worker/
  server.js              起動ランチャー(Node の版を確かめ、.env を読み、DB の置き場を決めて OpenPipes を起動する)
  lib/env.js             .env の探索・パース・適用
  lib/version.js         Node のバージョン比較(node:sqlite の要件チェック)
  sorahost.json          デプロイ設定(mode / start / include)
  .env.example           .env の雛形
  test/launcher-test.js  単体 + スモークテスト
  data/                  手元で動かしたときの DB 置き場(git 管理外。デプロイにも含めない)
  TASKS.md               このリポジトリを作ったときの設計記録
```

## 2. セットアップ

```sh
node --version            # v22.13.0 以上であること
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

手元では `OPENPIPES_DB` を空(または行ごと削除)にしておけばよい。ランチャーが `<このリポジトリ>/data/openpipes.db`
を使う。`data/` は `.gitignore` 済みで、`npm install` でも消えない。

```sh
curl -s http://127.0.0.1:3123/api/config                    # {"readOnly":false,"auth":"basic","user":null}
curl -s http://127.0.0.1:3123/pipes/demo-tech-filter/run    # RSS
ls data/                                                    # openpipes.db(と稼働中は -wal / -shm)
```

既定で書き込み可なので、ブラウザでそのままパイプを作れる。**書き込みを止めたいときだけ**
`.env` の `OPENPIPES_READONLY=1` のコメントを外す(環境変数はファイルより優先されるので
`OPENPIPES_READONLY=1 SERVER_PORT=3123 npm start` でも同じ)。

## 4. PteWorker へのデプロイ

0. **PteWorker のコンソールで `node --version` を確かめる。22.13.0 未満なら先へ進めない**(§10)。
   コンソールでコマンドを打てない場合は、まず一度デプロイして `logs` を見る
   (`[launcher] Node 22.13.0 or newer is required ...` で止まっていれば版が古い)。
1. SORAHOST のパネルで PteWorker を起動する。コンソールに **エンドポイント** と **デプロイトークン** が出るので控える
   (トークンは一度しか表示されない。失くしたらコンソールで `token rotate`)。
2. このリポジトリで認証情報を保存する(`.sorahost.json` に 600 で保存され、git には入らない):
   ```sh
   npx sorahost-cli login
   npx sorahost-cli whoami     # サイト URL を控える(手順 3 の OPENPIPES_BASE_URL に使う)
   ```
3. `.env` を用意する。`cp .env.example .env` して、少なくとも次の 3 つを入れる:

   | 変数 | 入れる値 |
   | --- | --- |
   | `OPENPIPES_PASSWORD` | 強い固有のパスワード(Basic 認証。Google ログインにするなら §8) |
   | `OPENPIPES_DB` | `/home/container/openpipes/openpipes.db`(再デプロイで消えない絶対パス。親ディレクトリは起動時に作られるので `mkdir` は不要) |
   | `OPENPIPES_BASE_URL` | `whoami` で出たサイト URL。`https://xxx.example` のような **bare origin**(末尾のスラッシュ・パス・クエリは付けない) |

4. **`.env` を PteWorker に手で置く。** Pterodactyl のパネルのファイルマネージャ(または SFTP)でアップロードする。
   置き場所は、アプリが展開されるディレクトリ(その直下)か、`/home/container` 直下(HOME)のどちらか。
   **再デプロイで消えない場所を選ぶ**(§10。分かるまでは `/home/container/.env` を推奨)。

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
   [launcher] node v22.x.x; /home/container/.env applied: OPENPIPES_BASE_URL, OPENPIPES_DB, OPENPIPES_HOST, OPENPIPES_PASSWORD; db /home/container/openpipes/openpipes.db; auth=basic; read-only=false
   OpenPipes listening on http://127.0.0.1:<port> (db /home/container/openpipes/openpipes.db, auth as "admin")
   ```
   - `applied:` のキー名はアルファベット順に並ぶ(値は絶対にログに出ない)。
   - `no .env` や `auth=none`、`[launcher] WARNING: ...` が出ていたら **認証なしで公開されている**。
     `.env` の置き場所を直してすぐ再デプロイする。
   - `Node 22.13.0 or newer is required` で止まっていたら、**PteWorker の Node が古い**(§10 の筆頭)。
7. `npx sorahost-cli open`(または `whoami` で出るサイト URL)でエディタを開き、Basic 認証で入る。
8. 公開フィードは `<サイト URL>/pipes/<id>/run`。`?format=json` で JSON、`?format=jsonfeed` で JSON Feed。
   これを RSS リーダーに登録する。

CI から行う場合は `SORAHOST_ENDPOINT` / `SORAHOST_TOKEN` を Secrets に入れ、`npx sorahost-cli deploy --yes --json`。
`.env` はデプロイと無関係に PteWorker 側に置いたままでよい(CLI は `.env` を送らないので上書きされない)。

## 5. パイプの編集フロー

**編集はサーバー上のエディタで行う。** 保存したパイプはサーバーの SQLite(`OPENPIPES_DB`)に残り、
再デプロイしても DB が消えない場所にあれば残り続ける(§10)。

手元で作ったパイプをサーバーへ持ち込む / サーバーのパイプを取っておくには、
エディタの **読み込み ▾ メニューの「JSON を書き出す / 読み込む」** を使う。
手元で `SERVER_PORT=3123 npm start` して作ったパイプを書き出し、サーバーのエディタで読み込んで保存すればよい
(id はサーバーが採番し直す)。

### バックアップ

DB 1 ファイルを取っておけば済む。**稼働したままコピーすると WAL の途中を掴む**ので、次のどちらかにする。

```sh
# PteWorker のコンソールで(sqlite3 コマンドは無い前提。node ワンライナー)
node -e "new (require('node:sqlite').DatabaseSync)('/home/container/openpipes/openpipes.db').exec(\"VACUUM INTO '/home/container/backup.db'\")"
```

出来た `backup.db` をファイルマネージャか SFTP で手元に落とす。
サーバーを止めてからコピーしてもよいが、その場合は `openpipes.db-wal` と `-shm` も一緒に落とすこと。

> このワンライナーは OpenPipes 側で動作確認済みだが、**PteWorker のコンソールで実行できるかは未確認**(§10)。
> コンソールで任意コマンドを打てない場合は、サーバーを止めて 3 ファイルをファイルマネージャでダウンロードする。

## 6. 環境変数

`.env` に書く(`.env.example` を参照)。**ホスティング側で設定された環境変数が常に優先される**
— ランチャーは既に環境にある変数を `.env` で上書きしない。

| 変数 | 既定 | 意味 |
| --- | --- | --- |
| `OPENPIPES_DB` | `<repo>/data/openpipes.db` | 保存したパイプ・ユーザー・セッションが入る SQLite ファイル。`:memory:` 可。親ディレクトリは起動時に作られる。**PteWorker では再デプロイで消えない絶対パスにする** |
| `OPENPIPES_BASE_URL` | (未設定) | 公開 origin(`https://pipes.example.com`)。フィードのリンクとパイプ内の相対 URL の解決先になり、設定すると書き込み系の `Origin` を照合する(CSRF 対策)。パス・クエリ付きは起動時に拒否。Google ログインでは必須 |
| `OPENPIPES_PASSWORD` | (空) | Basic 認証のパスワード。空だと**認証なし**(§7) |
| `OPENPIPES_USER` | `admin` | Basic 認証のユーザー名 |
| `OPENPIPES_GOOGLE_CLIENT_ID` | (未設定) | 設定すると Google ログインモード。`OPENPIPES_PASSWORD` との併用は起動拒否(§8) |
| `OPENPIPES_GOOGLE_CLIENT_SECRET` | (未設定) | 同上。ID と 2 つセットで必須 |
| `OPENPIPES_ALLOWED_USERS` | (未設定) | Google モードのみ。カンマ区切りのメールアドレスか `@ドメイン`。**未設定だと Google アカウントを持つ誰でも入れる** |
| `OPENPIPES_OIDC_ISSUER` | `https://accounts.google.com` | OIDC プロバイダ。通常は変えない |
| `OPENPIPES_HOST` | 全インターフェース | 待ち受けアドレス。PteWorker では `127.0.0.1`(プロキシ経由で届く) |
| `OPENPIPES_READONLY` | (未設定 = 書き込み可) | `1` で `POST /api/pipes` と `DELETE /api/pipes/:id` を 403 |
| `OPENPIPES_CACHE_TTL` | `300` | 公開フィードのメモリキャッシュ秒数。`0` で無効 |
| `OPENPIPES_ALLOW_PRIVATE` | (未設定) | 内部アドレスへの取得を許可。**設定しない**(§7) |
| `ENV_FILE` | (未設定) | `.env` のパスを明示する。設定すると探索しない |

- `PORT` と `SERVER_PORT` は **ホスティング側が決める**。`.env` に書いても**読まれない**(ランチャーが無視する)。
  PteWorker は `SERVER_PORT` で空きポートを渡す。
- `.env` はリポジトリにもデプロイ成果物にも入らない(`.gitignore` 済み。CLI も `.env` / `.env.*` を常に除外する)。

## 7. セキュリティの注意

- **認証を必ず設定する。** `OPENPIPES_PASSWORD`(§4)か Google ログイン(§8)のどちらか。
  どちらも無いとエディタと `/api/run` が誰でも使え、サーバーを「公開 URL の取得代理」にされる。
  この状態ではランチャーが起動時に
  `[launcher] WARNING: no OPENPIPES_PASSWORD and no Google login; the editor and /api/run are open to anyone`
  を出すので、デプロイ後は必ず `logs` で確認する。
- **`.env` を置き忘れると二重に困る。** 認証なしで公開されるうえ、`OPENPIPES_DB` も未設定になり、
  DB がアプリの展開先(`<アプリのルート>/data/openpipes.db`)に出来て**再デプロイで消える**。
  `logs` に `no .env` と出ていたら、パイプを作る前に直す。
- **`OPENPIPES_PASSWORD` と `OPENPIPES_GOOGLE_*` を同時に設定すると OpenPipes は起動しない**
  (`OPENPIPES_PASSWORD cannot be combined with Google login` で exit 1)。どちらか一方にする。
- **パイプの id(`<slug>-<16 桁の hex>`)は公開フィードを読める資格そのもの。**
  `/pipes/<id>/run` は認証なしで誰でも読める(RSS リーダーがログインできないため。仕様)。
  公開したくないパイプの id を、README・コミットメッセージ・issue・チャットなど人目に付く場所に貼らないこと
  (同梱デモの `demo-*` は全員共通なので除く)。
- 公開フィード `/pipes/<id>/run`、`/demo/*.xml`、`/api/config`、`/auth/*` は認証なし(仕様)。ここに認証を掛けてはいけない。
- デプロイトークンと `.sorahost.json` はコミットしない(`.gitignore` 済み)。
  漏れたら PteWorker のコンソールで `token rotate`。
- `OPENPIPES_ALLOW_PRIVATE` は設定しない。設定すると、保存されたパイプから内部アドレスへ取得できてしまう。
- サイト URL が http のみの場合、Basic 認証は平文で流れる。強いパスワードで緩和する。
  `OPENPIPES_BASE_URL` が https のときだけセッション Cookie に `Secure` が付く。

## 8. Google ログインにする(任意)

Basic 認証の代わりに Google アカウントでログインさせ、**ユーザーごとにパイプを分ける**モード。

1. [Google Cloud Console](https://console.cloud.google.com/) で「API とサービス」→「OAuth 同意画面」を設定する
   (スコープは `openid` `email` `profile` だけ)。
2. 「認証情報」→「認証情報を作成」→「OAuth クライアント ID」→ 種類は **ウェブ アプリケーション**。
3. 「承認済みのリダイレクト URI」に `<OPENPIPES_BASE_URL>/auth/google/callback` を **完全一致** で登録する
   (例: `https://xxx.example/auth/google/callback`)。
4. `.env` を次のようにして置き直し、PteWorker を再起動する:
   ```
   OPENPIPES_PASSWORD=                       # ← 空にする(併用すると起動しない)
   OPENPIPES_GOOGLE_CLIENT_ID=xxx.apps.googleusercontent.com
   OPENPIPES_GOOGLE_CLIENT_SECRET=yyy
   OPENPIPES_ALLOWED_USERS=you@example.com   # ← 必ず設定する
   OPENPIPES_BASE_URL=https://xxx.example
   OPENPIPES_DB=/home/container/openpipes/openpipes.db
   OPENPIPES_HOST=127.0.0.1
   ```
5. `logs` に `auth=google` と `OpenPipes listening on ... (db ..., Google login: allowlist of 1)` が出れば成功。

覚えておくこと:

- **`OPENPIPES_ALLOWED_USERS` を必ず設定する。** 未設定だと Google アカウントを持つ誰でもログインでき、
  自分のパイプを作れてしまう(起動時に `anyone can sign in` と表示される)。
  `@example.com` と書けばそのドメイン全員。照合には確認済みメールアドレスを使う。
- `OPENPIPES_BASE_URL` は **ブラウザで実際に使う URL** と一致させる。違うと保存が 403 になる(`Origin` の照合)。
- モードを切り替えると、Basic 認証時代の持ち主 `local` のパイプは一覧から見えなくなる
  (**消えてはいない**。公開フィード `/pipes/<id>/run` は引き続き読める。Basic に戻せばまた見える)。
- セッションは 30 日で切れる。DB に入るのは Cookie そのものではなく SHA-256。

## 9. 更新手順

OpenPipes 本体:

```sh
npm update openpipes                    # 動かなければ npm install github:takano32/OpenPipes#main
npm test
git add package-lock.json && git commit -m "Update OpenPipes"
npx sorahost-cli deploy
```

`node_modules/openpipes` は直接編集しない。直したいことは OpenPipes 側で直し、テストを通して push してから更新する。
**OpenPipes の Node 要件が上がったら、このリポジトリの `package.json` の `engines.node` も追従させる**
(`node_modules/openpipes/package.json` の `engines` を見る)。ランチャーの `lib/version.js` の `MIN_NODE` も同じ値にする。

CLI:

```sh
npm install -D sorahost-cli@latest
git add package.json package-lock.json && git commit -m "Update sorahost-cli"
```

## 10. 未確認事項

実機(PteWorker)でしか確かめられない項目。仮定のまま作ってあるので、確認して外れていたら直す。

| 項目 | 仮定 | 外れた場合の対処 |
| --- | --- | --- |
| **PteWorker の Node の版** | **22.13.0 以上** | ランチャーが `Node 22.13.0 or newer is required` で止まる。SORAHOST 側で Node の版を選べるか(egg の変数、Docker イメージ)を確認する。選べなければ OpenPipes は動かせない(`node:sqlite` は 22.13 未満では使えない)。**まずこれを確かめる** |
| DB の置き場 `/home/container/openpipes/` | `.env` と同じく、再デプロイで消えない | 保存したパイプが再デプロイで消える。ファイルマネージャで再デプロイ前後を見比べ、残る場所へ `OPENPIPES_DB` を向ける。どこも残らないなら §5 のバックアップを取って手で戻す運用になる |
| DB の親ディレクトリの作成 | OpenPipes が起動時に作る | 権限で失敗したら `logs` に出る。ファイルマネージャで作る |
| `sqlite3` コマンド | PteWorker のコンテナには**無い** | あれば `sqlite3 <db> ".backup backup.db"` でもよい |
| PteWorker コンソールで node ワンライナーが打てるか | 打てる | 打てなければサーバーを止めて `openpipes.db` / `-wal` / `-shm` をファイルマネージャで落とす |
| SQLite の WAL とコンテナのファイルシステム | 通常のローカルディスクで WAL が動く | lock に失敗すると `logs` に出る。OpenPipes 側の `journal_mode` の話になるので issue にする |
| サイト URL | `whoami` で出るサイト URL が固定で、ブラウザで使う URL と同じ(https) | URL が変わると `OPENPIPES_BASE_URL` の照合で保存が 403 になる。`.env` を直して再起動 |
| ポートの環境変数 | `SERVER_PORT`。`PORT` が来たらそちらを優先して使う | どちらでもなければ `logs` で変数名を確認し、ランチャーで `process.env.PORT` に読み替える |
| バインド先 | ループバック(`OPENPIPES_HOST=127.0.0.1`)で PteWorker のプロキシから届く | 届かなければ `.env` から `OPENPIPES_HOST` を消す(全インターフェース) |
| `.env` の置き場所 | アプリの展開先か `/home/container` 直下に置けばランチャーが見つける。HOME は `/home/container` | `logs` に `no .env` と出る。`ENV_FILE` を環境変数で設定できればそれで明示する。HOME が違うなら `lib/env.js` の `findEnvFile` の stopDir を見直す |
| 作業ディレクトリ | `start` はアップロードしたルートで実行される | ランチャーは自分のファイル位置からパスを解決するので cwd に依存しない。`OPENPIPES_DB` を相対パスで書かないこと |
| 送信方向のネットワーク | HTTP/HTTPS で外へ出られる | 出られないと上流フィードを取得できず、OpenPipes の意味が無い |
| メモリ | 数百 MB 級で足りる | 足りなければ PteWorker 側で `NODE_OPTIONS=--max-old-space-size=...` を設定できるか確認する(`.env` に書いても効かない) |
| Google ログインのリダイレクト URI | サイト URL が https で固定なら登録できる | http のみ、または URL が変わるなら Google ログインは使わず Basic のままにする |
