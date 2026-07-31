# タスク書: `matsu-arcade-api`

## このタスクの目的

`matsu-arcade-auth` が発行するJWTだけを信頼する、Hono製のArcade Resource Serverを構築する。

ゲーム本体やFrontendは作らず、プレイヤープロフィール、ゲームカタログ、スコア、ランキングを扱うBackend APIを作る。

```text
matsu-arcade-auth
    │ RS256 JWT
    │ iss = http://localhost:18084
    │ aud = matsu-arcade-api
    ▼
matsu-arcade-api
```

## 作業対象

- `apps/matsu-arcade-api`

変更しない対象:

- `apps/matsu-arcade-auth`
- `apps/matsu-auth`
- `apps/matsu-api`
- `apps/matsu-bff`
- `apps/matsu-front`
- `apps/matsu-toolbox-api`
- `docs`
- 親ワークスペースのsubmodule・lock管理ファイル

別スレッドが `matsu-arcade-auth` を同時実装する。API側はこのタスク書の固定JWT契約に従い、Auth repoへ直接変更を加えない。

commitとpushは実行しない。

## 着手時の確認

1. ワークスペースルートと対象リポジトリの `AGENTS.md` を読む。
2. branch、HEAD、未commit変更を確認する。
3. 既存変更を戻さない。
4. 空repoの場合はpackage、Docker、migration、test、READMEを含めて初期構築する。
5. `apps/matsu-bff` と `matsu-toolbox-api` が存在する場合は品質設定の参考にしてよいが、コードや認証設定を共有しない。

## 固定するローカル契約

### Arcade API

| 項目 | 値 |
|---|---|
| Repository / package name | `matsu-arcade-api` |
| Host API URL | `http://localhost:18085` |
| Container port | `8080` |
| PostgreSQL host port | `15435` |
| PostgreSQL container port | `5432` |
| Database | `matsu-arcade` |
| Database user | `matsu-arcade` |
| Development password | `matsu-arcade-pass` |

### 信頼するAuth

| Claim / 設定 | 値 |
|---|---|
| Algorithm | `RS256` |
| Issuer | `http://localhost:18084` |
| Audience | `matsu-arcade-api` |
| JWKS from host | `http://localhost:18084/.well-known/jwks.json` |
| JWKS from Docker | `http://host.docker.internal:18084/.well-known/jwks.json` |
| Required `token_use` | `access` |

JWT payload契約:

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

`sub` をデータ所有者の識別子に使う。emailを所有権キーや公開ランキング名として使わない。

## 使用技術

- Node.js 22
- TypeScript（strict）
- Hono
- `@hono/node-server`
- Zod
- `@hono/zod-openapi`
- Swagger UI
- `jose`
- PostgreSQL 16
- Drizzle ORMとmigration、または同等に型安全でmigrationを明示できる構成
- ESLint
- Prettier
- TypeScript対応テストランナー
- Docker Compose

## 共通HTTP機能

- `GET /health`
- `GET /openapi.json`
- `GET /docs`
- `GET /api/me`
- 統一JSON error
- request ID
- 構造化ログ
- graceful shutdown

`/health`、`/openapi.json`、`/docs` だけをpublicとする。ゲームカタログとランキングを含め、`/api/*` はすべてBearer JWT必須とする。

`GET /api/me`:

```json
{
  "sub": "user UUID",
  "email": "optional@example.com",
  "issuer": "http://localhost:18084",
  "audience": "matsu-arcade-api"
}
```

## 実装するArcade機能

### 1. Player Profile

- `GET /api/profile`
- `PUT /api/profile`

項目:

- `ownerSub`: JWT `sub`
- `displayName`: 1～40文字
- `createdAt`
- `updatedAt`

profile未作成時のGETは `404`。PUTは作成または全置換としてidempotentにする。

ランキングでは `displayName` だけを公開し、subとemailを他ユーザーへ返さない。

### 2. Game Catalog

- `GET /api/games`
- `GET /api/games/:gameKey`

初期データ:

- `number-rush`
- `memory-grid`
- `typing-sprint`

各ゲーム:

- `key`
- `name`
- `description`
- `scoreOrder`: 今回はすべて `higher-is-better`
- `enabled`

seedを再実行しても重複しないようにする。管理用CRUDは今回実装しない。

### 3. Scores

- `POST /api/scores`
- `GET /api/scores`
- `GET /api/scores/:scoreId`
- `DELETE /api/scores/:scoreId`

score登録request:

```json
{
  "gameKey": "number-rush",
  "score": 1234,
  "playedAt": "2026-07-30T12:00:00Z",
  "metadata": {}
}
```

要件:

- profile作成済みユーザーだけ登録できる。
- gameが存在しenabledであること。
- scoreは0以上のsafe integer。
- `playedAt` は任意。省略時はserver time。
- `metadata` はJSON objectでサイズ上限を持つ。
- 一覧と単体取得は本人のscoreだけ。
- 別ユーザーのscore IDは `404`。
- 一覧は新しい順で、gameKeyによる任意filterとlimitを持つ。
- limitに安全な上限を設ける。

### 4. Leaderboard

- `GET /api/leaderboards/:gameKey`

要件:

- enabledなgameだけ。
- 各ユーザーのbest scoreだけを対象にする。
- score降順、同点の場合はbest scoreの達成日時が早い順。
- query `limit` の既定値と最大値を定める。
- entryにはrank、displayName、score、achievedAtを返す。
- sub、email、内部profile IDを返さない。
- SQL window functionなどを使い、全件をapplication memoryへロードしない。

rankは同点処理の方式をOpenAPIとREADMEへ明記する。推奨は同点同順位の `RANK()`。

## API設計規約

- routeとZod schemaからOpenAPIを生成する。
- `openapi/openapi.json` をリポジトリへ含める。
- request、response、errorを実行時検証する。
- validation `400`、auth `401`、not found `404`、conflict `409`、想定外 `500`。
- DELETE成功は `204`。
- 日時はUTC ISO 8601。
- DBやJWTの内部エラーを外部へ返さない。

推奨エラー形式:

```json
{
  "error": {
    "code": "PROFILE_REQUIRED",
    "message": "Create a player profile before submitting a score."
  }
}
```

## JWT認証middleware

次を独立moduleとして実装する。

- Bearer token抽出
- `alg=RS256` 固定
- JWKSと `kid` による署名検証
- issuer検証
- audience検証
- `exp`、必要に応じて `nbf` 検証
- `token_use=access`
- 空でない `sub`
- JWKS cache
- 未知の `kid` に対する安全な再取得
- typed auth context

次を必ず拒否する。

- `matsu-auth` が発行した `iss=http://localhost:18081` のtoken
- `aud=matsu-api`
- `aud=matsu-toolbox-api`
- HS256や `alg=none`
- expired token

Authサービスが未完成でもAPI開発・testを進められるよう、専用test key fixtureでvalid/invalid JWTを生成する。production codeにtest keyを含めない。

## Database

最低限、migrationで次を作る。

- `player_profiles`
- `games`
- `scores`

推奨制約:

- `player_profiles.owner_sub` unique
- `games.key` primary keyまたはunique
- `scores.id` UUID primary key
- `scores.owner_sub` と `game_key` にindex
- scoreはDB constraintでも0以上
- game foreign key

profileとscoreのユーザー関係を `owner_sub` で安全に扱う。Auth DBを参照したりforeign key接続したりしない。

## 設定

最低限:

```text
PORT=8080
PUBLIC_BASE_URL=http://localhost:18085
DATABASE_URL=postgres://matsu-arcade:matsu-arcade-pass@db:5432/matsu-arcade
AUTH_ISSUER=http://localhost:18084
AUTH_AUDIENCE=matsu-arcade-api
AUTH_JWKS_URL=http://host.docker.internal:18084/.well-known/jwks.json
AUTH_JWKS_CACHE_SECONDS=3600
```

`.env.example` を用意し、必須値、不正URL、非正数cache秒を起動時に検証する。

## テスト

最低限、次を自動テストする。

### Authentication

- tokenなし
- malformed token
- wrong signature
- wrong issuer
- wrong audience
- expired
- wrong `token_use`
- valid arcade token
- Auth停止/JWKS取得失敗時の安全なエラー

### Profile

- 未作成GET
- 作成
- 更新
- ユーザー分離

### Games

- seedのidempotency
- 一覧
- 単体
- disabledまたは存在しないgame

### Scores

- profileなしを拒否
- 登録
- validation
- 本人一覧
- game filter
- 本人取得・削除
- 他ユーザーの参照・削除を拒否

### Leaderboard

- userごとのbestだけを採用
- score順
- 同点順位
- limit
- disabled/unknown game
- sub/emailをresponseに含めない

### Contract

- OpenAPI artifactがrouteと一致
- error schema
- 日時形式

DB integration testをDockerで再現できるようにする。test dataが開発DBへ残らない構成にする。

## 結合確認

`matsu-arcade-auth` が利用可能になったら、次を確認する。

1. Arcade Authでregisterまたはloginする。
2. 取得tokenで `GET /api/me` が成功する。
3. profile作成、score登録、leaderboard取得が成功する。
4. refresh後の新access tokenでも成功する。
5. `matsu-auth` のtokenは `401`。
6. wrong audience tokenは `401`。

別スレッドのAuthが未完成の場合は、test fixtureによる検証を完了させ、実サービス結合だけを未確認として明記する。相手repoを変更しない。

## Docker

Docker Composeに次を含める。

- `api`
- 専用PostgreSQL `db`

要件:

- host port `18085`
- DB host port `15435`
- DB healthcheck
- APIがDB readyを適切に待つ
- migrationとseed手順
- hot reloadできるdevelopment構成
- production相当build
- Linux環境でもAuthへ到達させる必要がある場合の `host-gateway` 設定

## 必須コマンド

`package.json`:

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
- `npm run db:seed`
- `npm run openapi:generate`
- `npm run openapi:check`

Windows PowerShellでは `npm.cmd` を使う。Docker経由でもcheck、test、build、migration、seedを再現できるようにする。

## READMEに記載する内容

- Arcade APIの責務と非責務
- ゲーム本体やAuthを含まないこと
- API、DB、Authのポート
- JWT trust条件
- endpoint一覧
- migrationとseed
- Docker起動・停止
- lint、typecheck、test、build
- Swagger UI
- Arcade Authからtokenを取得する例
- leaderboardの順位規則

## 完了条件

- profile、game catalog、score、leaderboardが動作する。
- 全ユーザーデータがJWT `sub` で安全に分離される。
- Arcade Authのissuer/audience/JWKSだけを信頼する。
- 既存 `matsu-auth` のtokenを拒否する。
- OpenAPI、migration、seed、Docker Compose、READMEが揃う。
- lint、typecheck、format check、test、buildが成功する。
- 他repoを変更していない。
- commitとpushを実行していない。

## 最終報告

最終回答には次を含める。

- 実装機能
- JWT検証条件
- DB schemaとランキングquery方針
- 実行した検証と結果
- Arcade Authとの実結合を確認できたか
- 未確認項目と残課題
- 変更ファイル一覧

