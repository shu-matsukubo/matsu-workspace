# タスク書: `matsu-arcade-auth`

## このタスクの目的

`matsu-arcade-api` 専用の独立した認証サーバーをHaskellで構築する。

既存の `matsu-auth` とは、ユーザーDB、issuer、署名鍵、refresh tokenを一切共有しない。

```text
matsu-arcade-auth
└── RS256 JWT / JWKS ──> matsu-arcade-api
```

今回はFrontendやBFFを追加しない。email/passwordのJSON APIで登録・ログインし、JWTアクセストークンとopaque refresh tokenを発行する、小さく明確なAuth Serverとする。

## 作業対象

- `apps/matsu-arcade-auth`

変更しない対象:

- `apps/matsu-auth`
- `apps/matsu-api`
- `apps/matsu-bff`
- `apps/matsu-front`
- `apps/matsu-toolbox-api`
- `apps/matsu-arcade-api`
- `docs`
- 親ワークスペースのsubmodule・lock管理ファイル

別スレッドが `matsu-arcade-api` を同時実装する前提であり、固定契約を独断で変更しない。変更が不可避な場合はコードで相手repoを変更せず、最終報告に必要な契約変更案を明記する。

commitとpushは実行しない。

## 着手時の確認

1. ワークスペースルートと対象リポジトリの `AGENTS.md` を読む。
2. branch、HEAD、未commit変更を確認する。
3. 既存変更を戻さない。
4. `apps/matsu-auth` の責務とclaimは参考にしてよいが、コード、DB、鍵を共有しない。
5. 空repoの場合は、README、Haskell project、Docker、DB migration、testを含む構成を一から作る。

## 固定するローカル契約

| 項目 | 値 |
|---|---|
| Repository / executable name | `matsu-arcade-auth` |
| Host Auth URL / issuer | `http://localhost:18084` |
| Container port | `8080` |
| PostgreSQL host port | `15434` |
| PostgreSQL container port | `5432` |
| Database | `matsu-arcade-auth` |
| Database user | `matsu-arcade-auth` |
| Development password | `matsu-arcade-auth-pass` |
| JWT algorithm | `RS256` |
| JWT audience | `matsu-arcade-api` |
| Development `kid` | `matsu-arcade-dev-key-1` |
| Access token TTL | `900` 秒 |
| Refresh token TTL | `2592000` 秒 |

## JWT契約

アクセストークンには次を含める。

```json
{
  "iss": "http://localhost:18084",
  "aud": "matsu-arcade-api",
  "sub": "user UUID",
  "email": "user@example.com",
  "token_use": "access",
  "iat": 0,
  "exp": 0
}
```

JWT header:

```json
{
  "alg": "RS256",
  "typ": "JWT",
  "kid": "matsu-arcade-dev-key-1"
}
```

claim名、JSONの型、issuer、audienceを変更しない。`sub` は安定したUUIDとする。

## HTTP API

### Public endpoints

- `GET /health`
- `POST /auth/register`
- `POST /auth/login`
- `POST /auth/refresh`
- `POST /auth/revoke`
- `GET /.well-known/jwks.json`

このタスクではOAuth Authorization Code、PKCE、ログインHTML、BFFセッションは実装しない。実在しないOAuth metadataを公開しない。

### Register / Login

request:

```json
{
  "email": "user@example.com",
  "password": "password"
}
```

token response:

```json
{
  "accessToken": "JWT",
  "refreshToken": "opaque random token",
  "tokenType": "Bearer",
  "expiresIn": 900
}
```

要件:

- emailは正規化方針を一貫させ、DB unique制約と同じ判定にする。
- passwordの最小・最大長を定義する。
- passwordはbcryptまたは同等のpassword hashing専用方式で保存する。
- duplicate emailは `409`。
- login失敗ではemailの存在有無を区別しない。
- responseやログへpassword、password hash、refresh tokenを出さない。

### Refresh

request:

```json
{
  "refreshToken": "opaque random token"
}
```

要件:

- refresh tokenは十分なentropyを持つ乱数にする。
- DBにはraw tokenではなくSHA-256などの一方向hashだけを保存する。
- refresh時はtokenを1回で失効させ、新しいrefresh tokenへrotationする。
- 失効済み、期限切れ、不明tokenは同じ安全な `401` にする。
- rotationはDB transaction内で行い、同時利用で複数成功させない。

### Revoke

`POST /auth/revoke` はrefresh tokenを受け取り、存在していてもいなくても情報を漏らさない成功レスポンスにする。すでに失効済みでもidempotentに扱う。

### JWKS

`GET /.well-known/jwks.json` は、現在のRS256公開鍵を標準JWKS形式で返す。

- private keyを含めない。
- `kid`、`kty`、`alg`、`use`、`n`、`e` を正しく返す。
- JWT headerの `kid` と一致させる。
- responseへ適切なcache headerを付ける。

## 使用技術

- Haskell
- GHC 9.8系
- Cabal
- Servant
- Warp / WAI
- Aeson
- PostgreSQL 16
- `postgresql-simple` または同等の明示的SQLライブラリ
- connection pool
- bcrypt
- Haskellの暗号・JOSEライブラリによるRS256署名
- Hspec
- `wai-extra` などによるHTTP test
- Docker multi-stage build
- Docker Compose

アクセストークン発行のたびに外部 `openssl` processを起動しない。署名はHaskell process内のライブラリで行う。開発鍵生成scriptでOpenSSLを利用することは許容する。

## 内部構成

巨大な単一 `Main.hs` に集約しない。最低限、次の責務を分離する。

- `Main` / server startup
- environment config
- API type / routes
- request and response types
- user repository
- refresh token repository
- password hashing
- token issuance
- JWKS loading/publication
- error mapping
- database migration

具体的なmodule名はHaskellの慣例に合わせて決めてよい。

## Database

最低限、次のテーブルをmigrationで作成する。

### users

- `sub` UUID primary key
- `email` unique
- `password_hash`
- `created_at`
- `updated_at`

### refresh_tokens

- token hash primary keyまたはunique
- user sub foreign key
- expires at
- revoked at
- replaced-by token hashまたはrotationを追跡できる情報
- created at

raw refresh tokenは保存しない。

migrationは再現可能なファイルとコマンドを用意する。初回起動時に空DBへ適用でき、同じmigrationを再実行してデータを破壊しない。

## 鍵管理

- 開発専用RSA key pairとJWKSを用意する。
- private keyとpublic JWKSの整合性を検証するscriptまたはtestを用意する。
- 既存 `matsu-auth` の鍵をコピーしない。
- READMEへ「開発専用であり本番secretではない」と明記する。
- 鍵のpathと `kid` を環境変数で設定できるようにする。
- 起動時に鍵とJWKSが不整合ならfail fastする。

本番用KMSや自動key rotationは今回のスコープ外だが、複数 `kid` への拡張点を塞がない構成にする。

## 設定

最低限、次を環境変数化する。

```text
ARCADE_AUTH_PORT=8080
ARCADE_AUTH_DATABASE_URL=postgres://matsu-arcade-auth:matsu-arcade-auth-pass@auth-db:5432/matsu-arcade-auth
ARCADE_AUTH_ISSUER=http://localhost:18084
ARCADE_AUTH_AUDIENCE=matsu-arcade-api
ARCADE_AUTH_ACCESS_TOKEN_TTL_SECONDS=900
ARCADE_AUTH_REFRESH_TOKEN_TTL_SECONDS=2592000
ARCADE_AUTH_PRIVATE_KEY_PATH=/app/keys/private.pem
ARCADE_AUTH_JWKS_PATH=/app/keys/jwks.json
ARCADE_AUTH_KEY_ID=matsu-arcade-dev-key-1
```

必須値の欠落、不正なURL、非正数TTL、鍵不整合は起動時に検出する。

## エラーレスポンス

統一形式:

```json
{
  "error": {
    "code": "INVALID_CREDENTIALS",
    "message": "Email or password is invalid."
  }
}
```

少なくとも `400`、`401`、`409`、`500` を用途に応じて使い分ける。DB error、内部例外、token hashなどを外部へ返さない。

## セキュリティ要件

- JSON bodyの最大サイズを制限する。
- passwordとtokenをログへ出さない。
- SQL parameter bindingを使う。
- login失敗メッセージを統一する。
- refresh rotationをtransactionで保護する。
- JWTはRS256以外で発行しない。
- `iss` と `aud` を設定から明示する。
- clockはtestで差し替え可能な境界を持たせる。
- CORSを有効化する場合はallowlist方式とし、`*` とcredentialを組み合わせない。

rate limit、メール確認、password reset、MFA、OAuth/OIDCは今回のスコープ外。READMEに将来課題として記載してよい。

## テスト

最低限、次を自動テストする。

- health
- register成功
- duplicate email
- email/password validation
- login成功
- password不正
- JWT headerとclaim
- JWT signatureを公開JWKSで検証できる
- issuerとaudienceが固定契約どおり
- access token TTL
- refresh成功とrotation
- 同じrefresh tokenを2回使えない
- expired refresh token
- revoked refresh token
- revokeのidempotency
- raw refresh tokenがDBに保存されていない
- private keyとJWKSの一致
- 統一エラーレスポンス

DBを使うintegration testをDockerで再現できるようにする。testが並列実行されても相互汚染しない方法を採用する。

## Docker / 運用

Docker Composeに次を含める。

- `auth`
- 専用PostgreSQL `auth-db`

要件:

- host portは `18084` と `15434`
- DB healthcheck
- AuthがDB readyを適切に待つ
- migration手順が明確
- graceful shutdown
- source mount前提だけでなくproduction相当buildが成功
- development secret以外をimageへ焼き込まない

## READMEに記載する内容

- サービスの責務と非責務
- 既存 `matsu-auth` との分離
- endpoint一覧
- register、login、refresh、revoke例
- JWT claim契約
- JWKS URL
- ポート一覧
- environment一覧
- DB migration
- build、test、起動・停止
- 開発鍵の注意
- `matsu-arcade-api` が設定すべきissuer、audience、JWKS URL

## 完了条件

- 新規ユーザー登録とログインで有効なRS256 JWTを取得できる。
- JWTを公開JWKSだけで検証できる。
- issuerとaudienceが固定契約どおりである。
- refresh tokenがhash保存され、transactionalにrotationされる。
- revokeがidempotentに動く。
- PostgreSQL migration、Docker Compose、READMEが揃う。
- Haskell codeが責務別moduleに分かれている。
- build、test、警告を含む品質チェックが成功する。
- 他repoを変更していない。
- commitとpushを実行していない。

## 最終報告

最終回答には次を含める。

- 実装した認証フロー
- JWT/JWKS契約
- DB schemaとrefresh rotation方式
- 実行したbuild/testと結果
- 未確認項目
- セキュリティ上スコープ外にした項目
- 変更ファイル一覧

