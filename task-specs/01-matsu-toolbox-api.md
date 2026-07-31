# タスク書: `matsu-toolbox-api`

## このタスクの目的

既存の `matsu-auth` を認証基盤として利用する、家計簿とは独立したHono製のResource Serverを構築する。

`matsu-auth` が次の2つの異なるBackendへ、それぞれ正しいaudienceを持つアクセストークンを発行できる状態まで含めて完成させる。

```text
matsu-auth
├── matsu-api            aud = matsu-api
└── matsu-toolbox-api    aud = matsu-toolbox-api
```

既存の `aud=matsu-api` を `matsu-toolbox-api` が受け入れる実装にはしない。Backendごとにaudienceを分離する。

## 作業対象

主対象:

- `apps/matsu-toolbox-api`

既存Authとの結合に必要な範囲だけ変更してよい対象:

- `apps/matsu-auth`

変更しない対象:

- `apps/matsu-api`
- `apps/matsu-bff`
- `apps/matsu-front`
- `apps/matsu-arcade-auth`
- `apps/matsu-arcade-api`
- `docs`
- 親ワークスペースのsubmodule・lock管理ファイル

`matsu-toolbox-api` と `matsu-auth` は独立Gitリポジトリである。変更、検証結果、将来のcommit単位を混ぜないこと。commitとpushは実行しない。

## 着手時の確認

1. ワークスペースルートと対象リポジトリにある `AGENTS.md` を読む。
2. 両リポジトリのbranch、HEAD、未commit変更を確認する。
3. 既存変更がある場合は戻さず、今回の変更と衝突しないようにする。
4. `apps/matsu-bff` は構成参考として読むだけにし、変更しない。
5. 現在の `matsu-auth` のJWT claim、DB schema、OAuthフローを確認してから拡張する。

## 固定するローカル契約

### Toolbox API

| 項目 | 値 |
|---|---|
| Repository / package name | `matsu-toolbox-api` |
| Host API URL | `http://localhost:18083` |
| Container port | `8080` |
| PostgreSQL host port | `15433` |
| PostgreSQL container port | `5432` |
| Database | `matsu-toolbox` |
| Database user | `matsu-toolbox` |
| Development password | `matsu-toolbox-pass` |

### 既存Authから受け取るJWT

| Claim / 設定 | 値 |
|---|---|
| Algorithm | `RS256` |
| Issuer | `http://localhost:18081` |
| Audience | `matsu-toolbox-api` |
| Scope/resource name | `matsu-toolbox-api` |
| JWKS from host | `http://localhost:18081/.well-known/jwks.json` |
| JWKS from Docker | `http://host.docker.internal:18081/.well-known/jwks.json` |
| Required `token_use` | `access` |

アクセストークンでは少なくとも `iss`、`aud`、`sub`、`iat`、`exp`、`token_use`、`kid`、`alg` を検証する。`email` は表示用claimとして任意扱いにし、所有権判定には `sub` を使う。

## 使用技術

- Node.js 22
- TypeScript（strict）
- Hono
- `@hono/node-server`
- Zod
- `@hono/zod-openapi`
- Swagger UI
- `jose` によるJWT/JWKS検証
- PostgreSQL 16
- Drizzle ORMとmigration、または同等に型安全でmigrationを明示できる構成
- ESLint
- Prettier
- TypeScript対応テストランナー
- Docker Compose

依存関係のバージョンは、実装時点で互換性のある安定版を選ぶ。既存 `matsu-bff` の品質設定とOpenAPI生成方法は参考にしてよい。

## 実装するToolbox機能

### 1. 共通機能

- `GET /health`
- `GET /openapi.json`
- `GET /docs`
- `GET /api/me`
- 統一されたJSONエラーレスポンス
- request ID付きの構造化ログ
- graceful shutdown

`/health`、`/openapi.json`、`/docs` だけを認証不要とし、`/api/*` はすべてBearer JWT必須にする。

`GET /api/me` は、検証済みJWTから次を返す。

```json
{
  "sub": "user UUID",
  "email": "optional@example.com",
  "issuer": "http://localhost:18081",
  "audience": "matsu-toolbox-api"
}
```

### 2. Notes

ユーザーごとの短いメモを管理する。

- `POST /api/notes`
- `GET /api/notes`
- `GET /api/notes/:noteId`
- `PATCH /api/notes/:noteId`
- `DELETE /api/notes/:noteId`

最低限の項目:

- `id`: UUID
- `ownerSub`: JWTの `sub`
- `title`: 必須、1～120文字
- `content`: 0～20,000文字
- `createdAt`
- `updatedAt`

一覧は `updatedAt` 降順にする。別ユーザーのIDを指定した場合は存在有無を漏らさず `404` を返す。

### 3. Bookmarks

ユーザーごとのブックマークを管理する。

- `POST /api/bookmarks`
- `GET /api/bookmarks`
- `GET /api/bookmarks/:bookmarkId`
- `PATCH /api/bookmarks/:bookmarkId`
- `DELETE /api/bookmarks/:bookmarkId`

最低限の項目:

- `id`: UUID
- `ownerSub`: JWTの `sub`
- `url`: `http` または `https`
- `title`: 1～200文字
- `tags`: 重複を除いた文字列配列
- `createdAt`
- `updatedAt`

一覧はタグによる任意フィルターを受け付ける。所有権条件を必ずDB queryへ含める。

### 4. Text Inspector

保存を伴わない小さなツールとして次を実装する。

- `POST /api/tools/text/inspect`

入力:

```json
{
  "text": "任意の文字列"
}
```

出力:

- Unicode code pointベースの文字数
- UTF-8 byte数
- 単語数
- 行数
- SHA-256

最大入力サイズを定義し、過大な入力はvalidation errorにする。

## API設計規約

- 成功レスポンスとエラーレスポンスをZod schemaで定義する。
- route定義とschemaからOpenAPIを生成する。
- 生成した `openapi/openapi.json` をリポジトリへ含める。
- validation errorは `400`、認証失敗は `401`、所有リソースなしは `404`、競合は `409`、想定外は `500` とする。
- 内部例外、SQL、JWT検証の詳細をクライアントへ返さない。
- 日時はUTCのISO 8601文字列で返す。
- DELETE成功は `204 No Content` とする。

推奨エラー形式:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed.",
    "details": []
  }
}
```

## JWT認証middleware

次を満たすmiddlewareを独立モジュールとして実装する。

- `Authorization: Bearer <token>` のみ受け付ける。
- `alg=RS256` を固定する。
- `kid` に対応する公開鍵をJWKSから選ぶ。
- signature、issuer、audience、有効期限を検証する。
- `token_use=access` と空でない `sub` を検証する。
- JWKSを毎リクエスト取得せずキャッシュする。
- `kid` 未知の場合の再取得を扱う。
- JWKS取得失敗とtoken不正をログ上で区別し、レスポンスは安全な `401` または `503` に正規化する。
- route handlerへ型付きの認証コンテキストを渡す。

## Database

各テーブルの主キーはUUIDとする。少なくとも次のmigrationを用意する。

- `notes`
- `bookmarks`

全ユーザー所有テーブルに `owner_sub` と適切なindexを持たせる。API起動時の暗黙的な `CREATE TABLE` だけにせず、再現可能なmigrationコマンドを用意する。

Docker ComposeにはAPIと専用PostgreSQLだけを含める。他サービスのDBやRedisを共有しない。

## `matsu-auth` の複数Resource Server対応

### 後方互換性

既存の次の動作を壊さない。

- `matsu-bff` のOAuth Authorization Code + PKCE
- `scope=matsu-api`
- `aud=matsu-api`
- 既存の `/auth/register`、`/auth/login`、`/auth/refresh`
- 既存PostgreSQL volumeを削除しなくてもschema更新できること

### 設定

既存の `AUTH_AUDIENCE=matsu-api` と `AUTH_SCOPE=matsu-api` は既定resourceとして維持する。

追加で次を導入する。

```text
AUTH_ALLOWED_RESOURCES=matsu-api,matsu-toolbox-api
```

この簡易Authではresource名、OAuth scope、JWT audienceを同じ文字列として扱う。空白除去、空要素、重複を安全に処理し、既定resourceがallowlistに含まれない設定では起動を失敗させる。

### Direct Auth API

`POST /auth/register` と `POST /auth/login` に任意の `audience` を追加する。

```json
{
  "email": "user@example.com",
  "password": "password",
  "audience": "matsu-toolbox-api"
}
```

- `audience` 省略時は従来どおり `matsu-api`
- allowlist外はトークンを発行せず `400`
- 発行JWTの `aud` は選択したresource

### OAuthフロー

- authorize requestの `scope` をallowlistで検証する。
- authorization requestとauthorization codeに保存済みのscopeからaudienceを決定する。
- code交換時にそのaudienceを持つJWTを発行する。
- metadataの `scopes_supported` にallowlistを列挙する。
- `matsu-bff` の既存リクエストは変更なしで成功する。

### Refresh Token

refresh tokenに対応するresource/audienceをDBへ永続化する。

- `refresh_tokens` にresource/audience列を追加する。
- 既存行は `matsu-api` として安全に移行する。
- refresh時にクライアントからaudienceを変更させない。
- rotation後も元のaudienceを維持する。
- OAuth code交換、direct login、direct registerの全経路で正しく保存する。

DB初期化SQLとアプリ側のschema保証処理が両方存在する場合は、両方を同じ定義へ更新する。

## テスト

### Toolbox API

最低限、次を自動テストする。

- health
- request validation
- tokenなし、形式不正
- wrong signature
- wrong issuer
- wrong audience
- expired token
- `token_use` 不正
- valid token
- notes CRUD
- bookmarks CRUD
- 他ユーザーのデータを参照・更新・削除できないこと
- text inspectorのUnicode、改行、空文字、上限
- OpenAPI artifactがroute定義と一致すること

JWT test fixtureでは専用のテスト鍵を使用し、本物の開発秘密鍵へ依存しない。

### `matsu-auth`

最低限、次を確認する。

- `matsu-api` の既存発行が変わらない。
- `matsu-toolbox-api` を指定するとそのaudienceになる。
- allowlist外を拒否する。
- OAuth scopeから正しいaudienceを選ぶ。
- refresh後もaudienceが変わらない。
- 既存refresh token行のmigrationが成立する。

### 結合確認

可能な範囲で実サービスを起動し、次を確認する。

1. `matsu-auth` へ `audience=matsu-toolbox-api` を付けてregisterまたはloginする。
2. 返されたtokenで `GET /api/me` が `200`。
3. 同じtokenでnoteを作成・取得できる。
4. `aud=matsu-api` のtokenではToolbox APIが `401`。
5. `aud=matsu-toolbox-api` のtokenでは既存 `matsu-api` が `401`。
6. 既存 `matsu-bff` のログインフローが引き続き `matsu-api` tokenを取得できる。

環境制約で全結合確認ができない場合は、実施できた範囲と未確認項目を明記する。

## 必須コマンド

次のscriptを `package.json` に用意する。

- `npm run dev`
- `npm run build`
- `npm run start`
- `npm run lint`
- `npm run typecheck`
- `npm run format`
- `npm run format:check`
- `npm run check`
- `npm test`
- `npm run db:migrate`
- `npm run openapi:generate`
- `npm run openapi:check`

Windows PowerShellでは `npm.cmd` を使う。Docker経由でもbuild、check、test、migrationを再現できるようにする。

## READMEに記載する内容

- サービスの責務と非責務
- 技術構成
- 起動・停止・初期migration
- ポート一覧
- 環境変数
- APIとSwagger UI URL
- `matsu-auth` からToolbox用tokenを取得する例
- lint、typecheck、test、build手順
- JWT trust条件
- 開発用passwordや鍵を本番secretとして扱わない注意

## 完了条件

- Toolboxの3機能が認証ユーザーごとに動作する。
- OpenAPI、migration、Docker Compose、READMEが揃っている。
- JWTのsignature、issuer、audience、期限、token useを検証している。
- `matsu-api` audienceのtokenをToolboxが拒否する。
- `matsu-auth` が既存経路を壊さず2つのresourceを発行できる。
- refreshでaudienceが変化しない。
- lint、typecheck、format check、test、buildが成功する。
- 既存の無関係なファイルを変更していない。
- commitとpushを実行していない。

## 最終報告

最終回答には次を含める。

- `matsu-toolbox-api` の実装概要
- `matsu-auth` の互換拡張概要
- DB migration内容
- 実行した検証コマンドと結果
- 実施できなかった結合確認
- 残課題
- リポジトリ別の変更ファイル一覧

