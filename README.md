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
   これを RSS リーダーに登録する。RSS の `<link>` と JSON Feed の `home_page_url` / `feed_url` には
   `OPENPIPES_BASE_URL` がそのまま入る(手元で確認済み)。ここに意図しないホスト名が出ていたら
   `OPENPIPES_BASE_URL` の設定漏れなので、`.env` を直して再起動する。

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

DB 1 ファイルを取っておけば済む。ただし **稼働したまま `openpipes.db` だけをコピーしてはいけない**
(ファイルマネージャや SFTP で 1 ファイルだけ落とすのも同じ)。書き込みは WAL 側に溜まっているので、
コピーは行が欠けるどころか **テーブルが 1 つも無いデータベース** になることがある(実測)。次のどちらかにする。

```sh
# PteWorker のコンソールで(sqlite3 コマンドは無い前提。node ワンライナー)
# 出力先は毎回別名にする(下の YYYY-MM-DD はその場で手で書き換える)
node -e "new (require('node:sqlite').DatabaseSync)('/home/container/openpipes/openpipes.db').exec(\"VACUUM INTO '/home/container/openpipes-YYYY-MM-DD.db'\")"
```

**出力先が既にあると `output file already exists` で止まる**(実測)。2 回目のバックアップが失敗したら、
DB の破損ではなくまず名前の重複を疑う。同じ名前を使うなら先に古いファイルを消す。

出来たファイルをファイルマネージャか SFTP で手元に落とす。サーバーを止めてからコピーしてもよいが、
その場合は `openpipes.db-wal` と `-shm` も一緒に落とすこと。

> このワンライナーは**このリポジトリで動作確認済み**(2026-09-03、Node v24.19.0)。
> サーバーを止めた状態でも、**動かしたまま**でも一貫したコピーが取れる(`VACUUM INTO` は WAL の内容も含めて書き出す)。
> `node -e` は `"type": "module"` のディレクトリでも CommonJS として動くので、`require` のままでよい。
> 残る未確認は **PteWorker のコンソールで任意のコマンドを打てるかどうか**だけ(§10)。
> 打てない場合は、サーバーを止めて `openpipes.db` / `-wal` / `-shm` の 3 ファイルをファイルマネージャでダウンロードする。

**戻せることを一度確かめておく。** 落としてきたバックアップは手元でそのまま開いて中身を見られる
(環境変数はファイルより優先されるので `.env` の `OPENPIPES_DB` は無視される):

```sh
OPENPIPES_DB="$PWD/openpipes-YYYY-MM-DD.db" SERVER_PORT=3124 npm start
# → http://127.0.0.1:3124/ でパイプ一覧が載っていることを見て、止める
```

サーバーへ戻すときは PteWorker を止めてから `openpipes.db` を置き換える。隣に古い `openpipes.db-wal` /
`-shm` が残っていたら、新しい DB に別の WAL が被らないよう先に消しておく。`sessions` も同じファイルに
入っているので、**古いバックアップに戻すと Google ログイン中の全員がログインし直しになる**
(Basic 認証はセッションを使わないので影響しない)。

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
| `OPENPIPES_OIDC_ISSUER` | `https://accounts.google.com` | OIDC プロバイダ。**本番では変えない**。同梱の偽プロバイダで手元から Google モードを試すときだけ差し替える(§8) |
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
- **削除は必ず 200 が返る。消えた証拠にならない。** `DELETE /api/pipes/<id>` は、存在しない id でも、
  他人(別の Google ユーザー、Basic 認証時代の `local`)のパイプの id でも `{"ok":true}` を返す
  (他人のパイプの有無を漏らさないための冪等な削除。仕様)。id が漏れて公開フィードを止めたいときは、
  200 で終わりにせず **`curl -s -o /dev/null -w '%{http_code}\n' <サイト URL>/pipes/<id>/run` が 404 になること**
  を確かめる(消えていれば即 404 になる。キャッシュに残り続けることはない — 実測)。
  §8 でモードを切り替えたあとは `local` のパイプを今のユーザーからは消せず、200 が返るだけでフィードは生き続ける。
  消すには先に持ち主を移す(§8)か、`.env` を Basic に戻す。
- 公開フィード `/pipes/<id>/run`、`/demo/*.xml`、`/api/config`、`/auth/*` は認証なし(仕様)。ここに認証を掛けてはいけない。
- デプロイトークンと `.sorahost.json` はコミットしない(`.gitignore` 済み)。
  漏れたら PteWorker のコンソールで `token rotate`。
- **Google のクライアント シークレットをコマンドラインに書かない。** シェルの履歴・`ps` の出力・
  `/proc/<pid>/environ` に残る(§3 のような `VAR=... npm start` の書き方をこの値でやらないこと)。
  値は `.env` にだけ書き、手元の `.env` は `chmod 600` にする。漏れたら Google Cloud Console で
  シークレットをローテートし、PteWorker の `.env` を置き直して**再起動する** —
  環境変数は起動時にしか読まれないので、再起動するまで古いシークレットのまま動く。
- `OPENPIPES_ALLOW_PRIVATE` は設定しない。設定すると、保存されたパイプから内部アドレスへ取得できてしまう。
- サイト URL が http のみの場合、Basic 認証は平文で流れる。強いパスワードで緩和する。
  `OPENPIPES_BASE_URL` が https のときだけセッション Cookie に `Secure` が付く。

## 8. Google ログインにする(任意)

Basic 認証の代わりに Google アカウントでログインさせ、**ユーザーごとにパイプを分ける**モード。

### 本物の Google を用意する前に(手元で一周する)

偽の OIDC プロバイダが `node_modules/openpipes/test/fake-issuer.mjs` として手元にも入っている。
これを `OPENPIPES_OIDC_ISSUER` に向ければ、**Google アカウントも Cloud Console の設定も無しで**、
このリポジトリのランチャーごと Google モードを一周できる。Google に切り替えると Basic は外れる
(併用は起動拒否。§7)ので、許可リストや `OPENPIPES_BASE_URL` を実機で書き損じると入る手段が両方無くなる。
Console を触る前にここで潰しておく。

```sh
mkdir -p ~/tmp/op-verify
cat > ~/tmp/op-verify/issuer.mjs <<'EOF'
import { startFakeIssuer } from 'file:///home/<あなた>/GitHub/hello-pte-worker/node_modules/openpipes/test/fake-issuer.mjs';
const issuer = await startFakeIssuer({ clientId: 'test', clientSecret: 'test-secret' });
if (process.env.USER_JSON) issuer.setUser(JSON.parse(process.env.USER_JSON));
console.log(issuer.issuer);
EOF
USER_JSON='{"sub":"u1","email":"you@example.com","email_verified":true,"name":"テスト"}' \
  node ~/tmp/op-verify/issuer.mjs &   # 表示された http://127.0.0.1:<port> を控える(起動ごとに変わる)
```

ランチャー固有の注意が 3 つある。**`ENV_FILE=/nonexistent`** で手元の `.env` を読ませない
(`OPENPIPES_PASSWORD` が入っていると「cannot be combined」で起動を拒否される)、
**`SERVER_PORT` はコマンドラインで渡す**(`.env` からは読まれない。§6)、
**`OPENPIPES_DB` は捨ててよいパス**にする(本番の DB を指すと偽ユーザーのセッションが本番 DB に入る)。

```sh
ENV_FILE=/nonexistent SERVER_PORT=3123 \
OPENPIPES_GOOGLE_CLIENT_ID=test OPENPIPES_GOOGLE_CLIENT_SECRET=test-secret \
OPENPIPES_BASE_URL=http://127.0.0.1:3123 \
OPENPIPES_OIDC_ISSUER=http://127.0.0.1:<偽 issuer のポート> \
OPENPIPES_ALLOWED_USERS=you@example.com \
OPENPIPES_DB="$HOME/tmp/op-verify/t.db" \
  node server.js
```

ブラウザで `http://127.0.0.1:3123`(`OPENPIPES_BASE_URL` と同じ表記で。違うと保存が 403)を開けば
一周できる。curl だけでも確かめられる:

```sh
curl -s -L -c jar -b jar -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3123/auth/google/login   # 200
curl -s -b jar http://127.0.0.1:3123/api/config
# → {"readOnly":false,"auth":"google","user":{"name":"テスト","email":"you@example.com",...}}
```

`OPENPIPES_ALLOWED_USERS` を許可外にして同じことをすると `/auth/google/callback` が **403** を返し
`user` は `null` のまま。許可リストの書き方はここで確かめる。`USER_JSON` を変えて issuer を立て直せば
別ユーザーになるので、パイプが互いに見えないことも見られる。終わったら issuer とサーバーを止め、
`~/tmp/op-verify` ごと消す。

> **確認済み**(2026-09-03、Node v24.19.0、`node_modules/openpipes` は `e0fe7cc`)。上の出力・403 まで再現した。
> `npm test` のケース E が同じ流れを自動で通している。本物の Google 固有の挙動(同意画面のテストユーザー、
> `redirect_uri_mismatch`)はここでは出ないので、最後は実機で一度通すこと。

### Google Cloud Console の設定

1. [Google Cloud Console](https://console.cloud.google.com/) で「API とサービス」→「OAuth 同意画面」を設定する
   (スコープは `openid` `email` `profile` だけ)。
2. **公開ステータスとテストユーザーを決める(一番の落とし穴)。** 同意画面は作った直後は「テスト中」で、
   **テストユーザーに追加したアカウントしかログインできない。自分自身も追加が要る。**
   追加していないアカウントは Google 側で弾かれ、ブラウザには
   「Google からエラーが返されました: access_denied」としか出ない(サーバーの設定は無関係)。
   **手順 4 の `OPENPIPES_ALLOWED_USERS` に書くアドレスは、全部テストユーザーにも入れておく。**
   個人の Gmail で作ったプロジェクトでは「内部」を選べないので、自分以外にも使わせるなら「本番」に切り替える
   (`openid` `email` `profile` は機微スコープではないので通常は審査なしで公開できるが、
   承認済みドメインの登録や所有権の確認を求められることがある)。
3. 「認証情報」→「認証情報を作成」→「OAuth クライアント ID」→ 種類は **ウェブ アプリケーション**。
   「承認済みのリダイレクト URI」に `<OPENPIPES_BASE_URL>/auth/google/callback` を **完全一致** で登録する
   (例: `https://xxx.example/auth/google/callback`)。スキーム・ホスト名・ポート・パス・末尾スラッシュが
   1 文字でも違うと `redirect_uri_mismatch` になる。`http` が使えるのは localhost と 127.0.0.1 だけで、
   PteWorker のサイト URL は https。
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
5. `logs` に `auth=google` と `OpenPipes listening on ... (db ..., Google login: allowlist of 1)` が出れば
   **起動は**成功。ただしこの 2 行は Google Console 側の設定が間違っていても出る。
   **必ずブラウザで実際にログインし、`logs` に `login u-<16 桁の hex>` が出るところまで確認する**
   (認証に関してサーバーが増やすログは `login <ユーザー id>` と `logout <ユーザー id>` の 2 行だけ。
   トークン・認可コード・Cookie・メールアドレスは出ない)。
   ここまで出なければ Google 側で弾かれている。下の落とし穴 2 つを見る。

覚えておくこと:

- **`OPENPIPES_ALLOWED_USERS` を必ず設定する。** 未設定だと Google アカウントを持つ誰でもログインでき、
  自分のパイプを作れてしまう(起動時に `anyone can sign in` と表示される)。
  `@example.com` と書けばそのドメイン全員。照合には確認済みメールアドレスを使う。
- **持ち主は Google の `sub` で決まり、メールアドレスでは決まらない。許可リストはアドレスで照合する。**
  アドレスを変えてもパイプは自分のまま残るが、`OPENPIPES_ALLOWED_USERS` に古いアドレスが残っていると
  **次のログインから自分が入れなくなる**(すでに持っている Cookie は 30 日切れるまで効くので、気付くのが遅れる)。
  アドレスを変えたら `.env` も直して再起動すること。弾かれても `logs` に理由は出ず、ブラウザ側にだけ出る。
  逆に Google 側で `sub` が変わった場合(アカウントを消して作り直した等)は別人扱いになり、
  パイプは DB に残ったまま一覧が空になる — 下の引き継ぎ手順で移せる。
- **`redirect_uri_mismatch` は `logs` に何も残らない。** Google の画面で終わってサーバーまで届かないので、
  「ログに何も出ていないから設定は合っている」と誤診しやすい(§4 の切り分けが効かない唯一の失敗)。
  登録する文字列は推測せず、サーバーが実際に送る値をそのままコピーする:
  ```sh
  curl -s -o /dev/null -D - https://xxx.example/auth/google/login | grep -i '^location:'
  ```
  `Location:` の中の `redirect_uri=`(URL エンコードされている)がその文字列。
  この出力には本物のクライアント ID も入るので、人目に付く場所に貼らないこと。
  `curl -I` は HEAD リクエストになり、このサーバーは HEAD のルートを持たないので**全パスが 404** になる。使わない。
- `OPENPIPES_BASE_URL` は **ブラウザで実際に使う URL** と一致させる。違うと保存が 403 になる(`Origin` の照合)。
- モードを切り替えると、Basic 認証時代の持ち主 `local` のパイプは一覧からも `GET /api/pipes` からも見えなくなる
  (**消えてはいない**。公開フィード `/pipes/<id>/run` は引き続き読める。Basic に戻せばまた見える)。
  **Google モードのまま引き継ぐ手段はエディタに無く、DB を直接書き替えるしかない**(下記)。
- セッションは 30 日で切れる。DB に入るのは Cookie そのものではなく SHA-256。
- **編集の途中でセッションが切れたら、ログインし直す前に JSON を書き出す。** 保存や読み込みが 401 になった瞬間に
  ログイン画面が画面全体を覆い、読み込み ▾ の「JSON を書き出す」に手が届かなくなる。キャンバスに何か置いてあるときだけ
  ログイン画面に **「⭳ 編集中の内容を JSON で保存」** が出るので、**先にこれを押す**。
  「Google でログイン」を押すと元の URL に戻る形でページが読み込み直され、未保存のグラフは消える。
  書き出した JSON はログインし直してから読み込み ▾ →「JSON を読み込む」で戻せるが、
  戻すと **id は採番し直されて別のパイプになる**。公開済みのパイプを編集していたなら、
  保存し直したあとに古い方を消し、RSS リーダーに登録した `/pipes/<id>/run` を貼り直すこと(§4 の 8)。

### `local` のパイプを Google のユーザーへ引き継ぐ

手で 1 回だけ行う移行。切り替えたあとでは一覧に出ないので、**引き継ぐかどうかは切り替える前に決める**
(出し忘れたら `.env` を Basic に戻して起動し直せばまた見える)。

**id が変わってよいなら DB を触らなくてよい。** Basic のうちにエディタの読み込み ▾ →「JSON を書き出す」で
1 件ずつ手元に出し、Google でログインしてから「JSON を読み込む」で入れ直す(§5)。
ただし **id は採番し直されるので、RSS リーダーに登録済みの `/pipes/<id>/run` は全部貼り直しになる**(§4 の 8)。

**id を保ったまま引き継ぐなら**、DB の `owner_id` を書き換えるしかない。
**先に §5 のバックアップを取り、Google で一度ログインして自分のユーザー行を作り、サーバーを止めてから**行う。
**引き継ぐと `local` からは消えるので、Basic に戻したときは一覧が空になる**(片道)。

1. 移す先のユーザー id は、ログイン直後の `logs` に出る `login u-<16 桁の hex>` の部分。
   ログを流してしまったら DB から引く(出力には本物のメールアドレスが出るので、そのまま貼らないこと):
   ```sh
   node -e "console.log(new (require('node:sqlite').DatabaseSync)('/home/container/openpipes/openpipes.db').prepare('SELECT id, email FROM users').all())"
   ```
2. サーバーを止めてから移す(表示される `changes` が移った件数):
   ```sh
   node -e "const d=new (require('node:sqlite').DatabaseSync)('/home/container/openpipes/openpipes.db');console.log(d.prepare(\"UPDATE pipes SET owner_id = ? WHERE owner_id = 'local'\").run('u-<ここに 16 桁の hex>'))"
   ```
   id を間違えると `FOREIGN KEY constraint failed` で止まる(黙って壊れることはない。実測)。

起動し直すと一覧に出る。パイプの id は変わらないので公開フィードの URL もそのまま。
スキーマは OpenPipes のものなので、この書き換えは自己責任で。ランチャーやテストからは触らない。
**PteWorker のコンソールでコマンドを打てない場合**(§10)は、サーバーを止めて `openpipes.db` /
`-wal` / `-shm` をファイルマネージャで落とし、手元で同じ 2 つを実行してから 3 ファイルを戻す。

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
| ~~**PteWorker の Node の版**~~ | **確認済み(2026-09-03)**: 22.13.0 以上。初回デプロイ直後にサイトが OpenPipes のエディタと `/api/config` を返した(`node:sqlite` の import を通っている)。正確な版は `logs` の `[launcher] node v...` で読む | (外れていなかった) |
| ~~DB の置き場 `/home/container/openpipes/`~~ | **確認済み(2026-09-03)**: `/home/container/.env` も `/home/container/openpipes/openpipes.db` も再デプロイで消えない。エディタで保存したパイプが `npm run deploy` の後も一覧に残った | (外れていなかった。別の場所へ移すなら §5 のバックアップを先に取る) |
| DB の親ディレクトリの作成 | OpenPipes が起動時に作る | 権限で失敗したら `logs` に出る。ファイルマネージャで作る |
| `sqlite3` コマンド | PteWorker のコンテナには**無い** | あれば `sqlite3 <db> ".backup backup.db"` でもよい |
| PteWorker コンソールで node ワンライナーが打てるか | 打てる(**コマンド自体は手元で確認済み**。停止中でも稼働中でも取れる) | 打てなければサーバーを止めて `openpipes.db` / `-wal` / `-shm` をファイルマネージャで落とす |
| SQLite の WAL とコンテナのファイルシステム | 通常のローカルディスクで WAL が動く | lock に失敗すると `logs` に出る。OpenPipes 側の `journal_mode` の話になるので issue にする |
| サイト URL | `whoami` で出るサイト URL が固定で、ブラウザで使う URL と同じ | URL が変わると `OPENPIPES_BASE_URL` の照合で保存が 403 になる。`.env` を直して再起動。**実機では `http://<IP>:<port>/` で https は無かった(2026-09-03)**。`OPENPIPES_BASE_URL` には末尾のスラッシュを落とした `http://<IP>:<port>` を入れる |
| ポートの環境変数 | `SERVER_PORT`。`PORT` が来たらそちらを優先して使う | どちらでもなければ `logs` で変数名を確認し、ランチャーで `process.env.PORT` に読み替える |
| バインド先 | ループバック(`OPENPIPES_HOST=127.0.0.1`)で PteWorker のプロキシから届く | 届かなければ `.env` から `OPENPIPES_HOST` を消す(全インターフェース) |
| `.env` の置き場所 | アプリの展開先か `/home/container` 直下に置けばランチャーが見つける。HOME は `/home/container` | `logs` に `no .env` と出る。`ENV_FILE` を環境変数で設定できればそれで明示する。HOME が違うなら `lib/env.js` の `findEnvFile` の stopDir を見直す |
| 作業ディレクトリ | `start` はアップロードしたルートで実行される | ランチャーは自分のファイル位置からパスを解決するので cwd に依存しない。`OPENPIPES_DB` を相対パスで書かないこと |
| 送信方向のネットワーク | HTTP/HTTPS で外へ出られる | 出られないと上流フィードを取得できず、OpenPipes の意味が無い |
| メモリ | 数百 MB 級で足りる | 足りなければ PteWorker 側で `NODE_OPTIONS=--max-old-space-size=...` を設定できるか確認する(`.env` に書いても効かない) |
| Google ログインのリダイレクト URI | サイト URL が https で固定なら登録できる | **実機のサイト URL は http のみ**(上の行)なので、当面は Google ログインを使わず Basic のままにする |
