# 追加タスク書: BFFから全APIを呼び分ける

## 背景

現在の `matsu-front` はBFFだけを呼んでいるが、`matsu-bff` が公開・中継しているのは
`matsu-api` の家計簿経路だけである。

`matsu-toolbox-api` と `matsu-arcade-api` は、それぞれBearer JWTを使って直接呼び出す
構成になっている。最終構成では、ブラウザからのアプリケーションAPI呼び出しをすべて
BFFへ集約する。

```text
Browser / matsu-front
          |
          | HttpOnly session cookie + BFF contract
          v
      matsu-bff
       |   |   |
       |   |   +-- Arcade token  --> matsu-arcade-api
       |   +------ Toolbox token --> matsu-toolbox-api
       +---------- matsu token   --> matsu-api
```

Backend APIはResource Serverとして単体実行可能なまま維持する。ネットワーク的に直接
到達可能であること自体は問題にせず、ブラウザ向けの正式な利用経路と契約をBFFに限定する。

## 作業対象

主対象:

- `apps/matsu-bff`

BFF OpenAPIから生成される型を同期するために変更してよい対象:

- `apps/matsu-front/src/api/generated/schema.d.ts`
- 必要な場合だけ、Frontendの認証接続状態を扱う型・API helper

変更しない対象:

- `apps/matsu-api`
- `apps/matsu-auth`
- `apps/matsu-toolbox-api`
- `apps/matsu-arcade-api`
- `apps/matsu-arcade-auth`
- `docs`
- 親ワークスペース

各子リポジトリは独立している。変更と将来のcommit単位を混ぜない。commitとpushは実行しない。

## 固定する上流契約

| BFF上の用途 | 上流 | Dockerからの既定URL | token issuer | audience |
|---|---|---|---|---|
| 家計簿 | `matsu-api` | `http://host.docker.internal:18080/api` | `http://localhost:18081` | `matsu-api` |
| Toolbox | `matsu-toolbox-api` | `http://host.docker.internal:18083/api` | `http://localhost:18081` | `matsu-toolbox-api` |
| Arcade | `matsu-arcade-api` | `http://host.docker.internal:18085/api` | `http://localhost:18084` | `matsu-arcade-api` |

Auth:

| 用途 | URL |
|---|---|
| 既存Auth（Docker） | `http://host.docker.internal:18081` |
| 既存Auth（Browser redirect） | `http://localhost:18081` |
| Arcade Auth（Docker） | `http://host.docker.internal:18084` |

## BFFが公開する経路

既存の家計簿経路は後方互換で維持する。

### Toolbox

```text
GET    /api/toolbox/me
POST   /api/toolbox/notes
GET    /api/toolbox/notes
GET    /api/toolbox/notes/:noteId
PATCH  /api/toolbox/notes/:noteId
DELETE /api/toolbox/notes/:noteId
POST   /api/toolbox/bookmarks
GET    /api/toolbox/bookmarks
GET    /api/toolbox/bookmarks/:bookmarkId
PATCH  /api/toolbox/bookmarks/:bookmarkId
DELETE /api/toolbox/bookmarks/:bookmarkId
POST   /api/toolbox/tools/text/inspect
```

上流では `/api/toolbox` prefixを除き、Toolbox APIの既存 `/api/*` へ対応付ける。

### Arcade

```text
GET    /api/arcade/me
GET    /api/arcade/profile
PUT    /api/arcade/profile
GET    /api/arcade/games
GET    /api/arcade/games/:gameKey
POST   /api/arcade/scores
GET    /api/arcade/scores
GET    /api/arcade/scores/:scoreId
DELETE /api/arcade/scores/:scoreId
GET    /api/arcade/leaderboards/:gameKey
```

上流では `/api/arcade` prefixを除き、Arcade APIの既存 `/api/*` へ対応付ける。

汎用catch-all proxyにはしない。BFF側でroute、request、成功response、errorを明示的な
Zod/OpenAPI schemaとして所有する。

## 複数tokenを持つBFF session

現在の単一token sessionを、resourceごとのtoken slotを持つversioned schemaへ変更する。

概念:

```text
session
├── matsuApi
│   ├── accessToken
│   ├── refreshToken
│   └── expiresAt
├── toolbox
│   ├── accessToken
│   ├── refreshToken
│   └── expiresAt
└── arcade
    ├── accessToken
    ├── refreshToken
    └── expiresAt
```

要件:

- tokenをBrowserへ返さない。
- Redis以外へtokenを永続化しない。
- resourceごとにaccess/refresh/expiryを分離する。
- 既存session JSONを安全に `matsuApi` slotへ読み替えるか、明示的に無効化する。
- JSON parseだけで信用せず、ZodなどでRedis sessionを検証する。
- 1つのupstreamでrefreshに失敗しても、無関係なtoken slotを削除しない。
- 全token slotが空になった場合だけBrowser session全体を削除する。
- logout全体と、resource単位のdisconnectを区別する。

`GET /auth/session` はtokenを含めず、接続状態だけを返す。

例:

```json
{
  "authenticated": true,
  "resources": {
    "matsuApi": true,
    "toolbox": false,
    "arcade": true
  }
}
```

既存Frontendが参照するfieldは壊さず、後方互換に拡張する。

## 認証フロー

### 既存家計簿

現在の `/auth/login`、`/auth/callback`、direct login/register、refresh、logoutを
後方互換で維持する。取得tokenは `matsuApi` slotへ保存する。

### Toolbox

既存 `matsu-auth` のAuthorization Code + PKCEを利用する。

- `GET /auth/toolbox/login` を追加する。
- Authへ送るscopeは `matsu-toolbox-api`。
- redirect URIは既存 `/auth/callback` を再利用してよい。
- authorization flow storeへ対象resourceを保存する。
- callbackで取得したtokenを `toolbox` slotへ保存する。
- 既存Browser sessionがある場合は破棄せずmergeする。
- token refreshは既存AuthのOAuth token endpointを使う。

### Arcade

現行 `matsu-arcade-auth` はJSON register/login/refresh/revokeを公開し、OAuthは実装していない。
この契約をBFFから利用する。

```text
POST /auth/arcade/register
POST /auth/arcade/login
POST /auth/arcade/disconnect
```

- BrowserはBFFへだけrequestする。
- BFFは資格情報をログへ出さず、Arcade Authへ直ちに転送する。
- Arcade Auth responseのtokenをBrowserへ返さず `arcade` slotへ保存する。
- refreshはBFFからArcade Auth `/auth/refresh` を呼ぶ。
- disconnect時は可能ならArcade Auth `/auth/revoke` を呼び、BFF slotを削除する。
- Arcade Auth停止時は他resourceのsessionを壊さない。

OAuth化は別の将来判断とし、このタスクではArcade Authへ機能追加しない。

## 上流client

単一 `backendClient` の固定URL・固定token参照を廃止し、次を明示的に選べる構成にする。

- upstream識別子
- base URL
- session token slot
- refresh方法
- request timeout
- response schema

要件:

- requestごとに正しいtokenだけを付与する。
- Browserから受け取ったAuthorization headerを上流へ転送しない。
- hop-by-hop headerやCookieを転送しない。
- upstreamのURLをBrowser responseへ漏らさない。
- timeout、接続失敗、非JSON、schema不一致を安全なBFF errorへ正規化する。
- upstreamが `401` の場合は対象slotだけ1回refreshし、同じrequestを1回だけ再試行する。
- refresh後も `401` の場合は対象slotを削除してBFFから `401`。
- `4xx` と `5xx` のBFF向けmappingをroute contractに明記する。

## 設定

既存設定を保ち、最低限次を追加する。

```text
TOOLBOX_API_BASE_URL=http://host.docker.internal:18083/api
ARCADE_API_BASE_URL=http://host.docker.internal:18085/api
ARCADE_AUTH_BASE_URL=http://host.docker.internal:18084
UPSTREAM_TIMEOUT_MILLISECONDS=5000
```

Toolbox loginでは既存Authのclient設定を再利用する。URL、timeout、正数、必須値を起動時に
検証する。

Docker ComposeのBFFは新API/Authを `depends_on` に追加しない。各リポジトリのComposeを
独立させたまま、URL設定だけで連携する。

## OpenAPIとFrontend

- BFF OpenAPIへToolbox/Arcade/Auth接続経路を追加する。
- 上流OpenAPIをそのまま結合せず、BFFが公開する契約としてschemaを所有する。
- Frontend生成型をBFF OpenAPIから再生成する。
- Frontend sourceにToolbox/Arcade/Authへの直接URLを追加しない。
- `VITE_BFF_BASE_URL` 以外のBackend/Auth URLをFrontend環境変数へ追加しない。
- 今回Frontend画面を作らない場合でも、生成型とAPI helperがBFF経路を利用できる状態にする。

## `openapi:check` の修正

現在のBFF Docker imageにはGitが含まれず、`git diff` を使う `openapi:check` がDocker内で
失敗する。

Toolbox/Arcade APIと同様に、生成結果を一時データまたはメモリ上で既存artifactと比較する
Node scriptへ変更する。品質チェックのためだけにruntime/development imageへGitを追加しない。

## テスト

最低限、次を自動テストする。

### Route dispatch

- 家計簿routeが `matsu-api` だけを呼ぶ。
- Toolbox routeがToolboxだけを呼ぶ。
- Arcade routeがArcadeだけを呼ぶ。
- path/query/bodyのmapping。
- 上流成功responseのschema検証。
- 非JSON・schema不一致・timeoutの安全なerror。

### Token selection

- 各routeが対応slotのtokenだけを使う。
- slotなしは上流を呼ばず `401`。
- 対象slotのrefreshと1回再試行。
- 1つのrefresh失敗が他slotを削除しない。
- legacy sessionのmigrationまたは安全なinvalid化。
- Browserへtokenを返さない。

### Authentication

- 既存login/callbackの後方互換。
- Toolbox loginが `scope=matsu-toolbox-api`。
- callbackが既存sessionへmergeする。
- Arcade login/registerがtokenをBrowserへ返さない。
- Arcade disconnectが他resourceを維持する。
- OAuth state/PKCEとcookie属性。

### Contract

- OpenAPI artifact一致。
- Docker内 `npm run openapi:check` 成功。
- Frontend生成型一致。

fetch、Redis、clockをtestで差し替えられる境界を作り、単体testで実サービスへ依存しない。

## 実サービス結合確認

稼働中の全サービスを使い、少なくとも次を確認する。

1. 既存ログイン後、BFF経由の家計簿routeが成功する。
2. Toolbox接続後、BFF経由でnote作成・取得が成功する。
3. Arcade register/login後、BFF経由でprofile作成、score登録、leaderboard取得が成功する。
4. Browser側で確認できるのはBFF session cookieだけ。
5. Frontend sourceと通信ログにAPI/AuthのBearer tokenが現れない。
6. Toolbox停止時も家計簿routeは動く。
7. Arcade停止時も家計簿・Toolbox routeは動く。
8. 既存API用tokenをToolboxへ、Arcade tokenを他APIへ誤送信しない。

テストデータを作成した場合は、作成内容を最終報告に明記する。

## 品質ゲート

`matsu-bff`:

```text
npm run check
npm run openapi:check
npm test
npm run build
```

`matsu-front`:

```text
npm run openapi:check
npm run check
npm run build
```

Windows PowerShellでは `npm.cmd` を使う。Docker経由でも同じゲートが成功すること。

## 完了条件

- Frontendの正式なアプリケーションAPI経路がBFFだけになっている。
- BFFが3つのResource APIを明示routeで呼び分ける。
- resource別tokenがRedisに分離され、Browserへ露出しない。
- 1サービス障害が無関係なroute/sessionを壊さない。
- BFF OpenAPIとFrontend型が同期している。
- BFF Docker内でも `openapi:check` が成功する。
- 全品質ゲートと実サービス結合確認が成功する。
- 無関係なリポジトリを変更していない。
- commitとpushを実行していない。

## 最終報告

- BFF公開routeと上流mapping
- session/token schema
- provider/resource別login・refresh・disconnect
- 障害分離の確認結果
- OpenAPI/Frontend同期結果
- 実行した品質ゲート
- リポジトリ別変更ファイル
- 未確認事項

