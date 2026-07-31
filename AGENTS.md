# matsuワークスペース コンテキスト

## スーパープロジェクトの方針

- ワークスペースルートはGitスーパープロジェクト `matsu-workspace` です。
- `apps/matsu-front`、`apps/matsu-bff`、`apps/matsu-api`、`apps/matsu-auth`、`apps/matsu-toolbox-api`、`apps/matsu-arcade-auth`、`apps/matsu-arcade-api`、`docs` は、それぞれ独立したGitリポジトリをサブモジュールとして配置しています。
- `.gitmodules` はサブモジュールのpathとURLだけを管理します。
- `modules.dev.conf` はローカル開発で追従するbranch、`modules.lock.conf` は環境別の固定commitを管理します。
- 親gitlinkはclone直後の初期位置です。リリースの正本は `modules.lock.conf` の40桁SHAです。
- 各アプリと `docs` の開発はローカルの `develop` で行い、`origin/develop` へ直接pushします。リリースはGitHub上で `develop` から `main` へマージします。
- ローカル開発の同期は `scripts/sync-dev.sh` が行い、Windowsでは `scripts/sync-dev.bat` からGit Bashで起動します。
- リリースCIは `scripts/apply-lock.sh <environment>` と `scripts/verify-lock.sh <environment>` を直接実行します。
- environment間の昇格は `scripts/promote-lock.sh` で同じcommit一式をコピーし、アプリソースを再修正しません。
- 子リポジトリの変更は対象リポジトリで先にcommitします。その後、親リポジトリでlock差分を確認して別commitにします。
- commitやpushを自動実行してはいけません。

## プロジェクト構成

- `apps/matsu-front`: ブラウザ向けフロントエンド。
- `apps/matsu-bff`: Backend for Frontendおよびブラウザセッション境界。
- `apps/matsu-api`: 家計簿ドメインAPI。
- `apps/matsu-auth`: 認証サーバーおよびブラウザ向けログインUI。
- `apps/matsu-toolbox-api`: note、bookmark、text inspectionを提供する独立resource server。
- `apps/matsu-arcade-auth`: Arcade専用の認証サーバー。既存AuthとDB、issuer、鍵、tokenを共有しません。
- `apps/matsu-arcade-api`: player profile、game catalog、score、leaderboardを管理するArcade resource server。
- `docs`: プロジェクト横断のアーキテクチャ・技術文書。
- `scripts`: ワークスペースのセットアップ、状態確認、更新、開発環境起動スクリプト。
- `.agents/skills`: リポジトリが提供するCodexスキル。実在し、説明可能なスキルだけを追加します。
- `.codex`: 必要になった `config.toml` などのCodex設定用。リポジトリスキルは配置しません。

## 名前に関する注意

- 旧プロジェクト名はKakeiboですが、現在のワークスペース名は `matsu` です。
- 旧backendアプリは現在 `matsu-api` です。
- リモートURLなどに残るKakeibo名は、依頼がない限り変更しません。

## ワークスペースコマンド

- 親gitlinkのcommitを初期化・復元: `sh scripts/setup.sh`
- 親とサブモジュール、環境別lockの状態確認: `sh scripts/status.sh`
- ローカル開発branchの同期: `sh scripts/sync-dev.sh`、Windowsランチャーは `scripts\sync-dev.bat`
- 現在の全HEADをlockへ記録: `sh scripts/update-lock.sh <environment> --from-worktree`
- 1モジュールのlockを更新: `sh scripts/update-lock.sh <environment> <module-path> <ref>`
- 環境間で同じlockを昇格: `sh scripts/promote-lock.sh <from> <to>`
- CIでlockを適用・検証: `sh scripts/apply-lock.sh <environment>`、`sh scripts/verify-lock.sh <environment>`
- 開発環境全体を起動: `scripts\run-matsu.bat`
- FrontまたはBFFだけを起動: `scripts\run-front-dev.bat` または `scripts\run-bff-dev.bat`
- Toolbox、Arcade Auth、Arcade APIだけを起動: `scripts\run-toolbox-dev.bat`、`scripts\run-arcade-auth-dev.bat`、`scripts\run-arcade-api-dev.bat`
- 通常の親 `git pull` 後は `sh scripts/setup.sh` を実行します。開発branchの最新版追従は明示的に `sync-dev` を実行します。
- 詳細な開発フローは `DEVELOPMENT.md` を参照します。

## 設計文書

- `docs` は、プロジェクト横断のアーキテクチャ、サービス責務、技術選定、認証フローの正本です。
- サービス境界、認証、セッション処理、サービス間通信を変更する前に、関連文書を読みます。
  - 索引と文書方針: `docs/README.md`
  - システム全体: `docs/docs/architecture/system-overview.md`
  - 認証とセッション: `docs/docs/architecture/authentication.md`
  - コンポーネント責務と技術選定: `docs/docs/components/`
- 実装詳細、セットアップコマンド、リポジトリ固有の挙動は各アプリのリポジトリとREADMEで管理します。
- 実装変更がアーキテクチャ判断やサービス境界に影響する場合は、同じタスクで `docs` サブモジュールも更新します。
- 新しい文書は既存の `architecture` と `components` 構造を使います。新しいトップレベルカテゴリを追加する前にオーナーへ確認します。

## フロントエンド

- コマンドは `apps/matsu-front` で実行します。
- インストール: `npm install`
- 開発: `npm run dev`
- build: `npm run build`
- lint: `npm run lint`
- typecheck: `npm run typecheck`
- 統合チェック: `npm run check` でlint、typecheck、Prettierチェックを実行します。
- BFFのベースURLは既定で `http://localhost:18082` です。
- FrontはBFFだけを呼びます。resource serverやAuthをブラウザから直接呼ぶ実装を追加しません。
- `package.json` の `"name"` は `"matsu-front"` です。
- OpenAPI生成は `../matsu-bff/openapi/openapi.json` を読みます。FrontとBFFはどちらも `apps` 配下なので、構成変更がない限りこの相対パスを維持します。

## BFF

- Dockerコマンドは `apps/matsu-bff` で実行します。
- Docker開発起動: `docker compose up`
- ローカルスクリプト:
  - `npm run dev`: `tsx watch src/index.ts`
  - `npm run build`: `tsc`
  - `npm run start`: `node dist/index.js`
  - `npm run typecheck`: ソース、テスト、スクリプトのtypecheck
  - `npm run check`: lint、typecheck、Prettierチェック
  - `npm test`: コントラクトsmoke test
- API: `http://localhost:18082`
- Redis公開先: `localhost:16379`
- 既定のFrontend origin: `http://localhost:5173`
- DockerからのLaravel API既定接続先: `http://host.docker.internal:18080/api`
- DockerからのToolbox API既定接続先: `http://host.docker.internal:18083/api`
- DockerからのArcade API既定接続先: `http://host.docker.internal:18085/api`
- DockerからのAuth既定接続先: `http://host.docker.internal:18081`
- DockerからのArcade Auth既定接続先: `http://host.docker.internal:18084`
- BFFは家計簿、Toolbox、Arcadeのrouteとtokenを明示的に分け、3 APIを呼び分けます。
- OpenAPI JSONは `/openapi.json`、Swagger UIは `/docs` です。
- `apps/matsu-bff/openapi/openapi.json` は登録済みBFF routeから生成します。
- Frontend API型の生成先は `apps/matsu-front/src/api/generated/schema.d.ts` です。

## API

- Dockerコマンドは `apps/matsu-api` で実行します。
- Laravelアプリは `apps/matsu-api/src/www` にあります。
- 起動: `docker compose up -d`
- 初回セットアップ: `sh scripts/setup.sh`
- pull後の更新: `sh scripts/update.sh`
- Git hookのインストール: `sh scripts/setup-hooks.sh`
- API: `http://localhost:18080/api`
- MySQL公開先: `localhost:13306`
- コンテナ:
  - `matsu-web`: PHP 8.4 + Apache
  - `matsu-db`: MySQL 8.0
- DB既定値:
  - database: `matsu`
  - user: `test_user`
  - password: `test_user_pass`
  - root password: `test_root_pass`
- `apps/matsu-api/src/www/.env.local` の認証関連キー:
  - `AUTH_SERVER_ISSUER=http://localhost:18081`
  - `AUTH_SERVER_AUDIENCE=matsu-api`
  - `AUTH_SERVER_JWKS_URL=http://host.docker.internal:18081/.well-known/jwks.json`
  - `AUTH_SERVER_JWKS_CACHE_SECONDS=3600`
  - `AUTH_SERVER_CACHE_STORE=database`

## API品質ゲート

- `apps/matsu-api/src/www` で使うComposer script:
  - `composer pint`: Laravel PintでPHPをformat
  - `composer pint:test`: Pintのformatチェック
  - `composer analyse`: `--memory-limit=512M` でPHPStan/Larastanを実行
  - `composer test`: configをclearしてPHPUnitを実行
  - `composer test:coverage`: configをclearしてPHPUnit coverageを実行
- Git hookは `apps/matsu-api/.githooks` にあり、`scripts/setup-hooks.sh` で子リポジトリの `.git/hooks` へインストールします。
- `pre-commit` は `web` コンテナ内のPintでステージ済みPHPをformatし、変更ファイルを再ステージします。
- `pre-push` はpush対象のPHP差分に対して、`web` コンテナ内でPintとPHPStanを実行します。Pintがファイルを変更した場合、確認とcommitができるようpushを停止します。
- hookの実行にはAPI Dockerコンテナの起動が必要です。
- CIは `apps/matsu-api/.github/workflows/ci.yml` にあります。
- `main` 向けPull Requestで、MySQL 8.0、PHP 8.4、`composer install`、`.env.testing`、migration、seeder、Pintチェック、PHPStan、PHPUnitを実行します。
- 現在PHPStanには `continue-on-error: true` が設定されています。

## 認証サーバー

- Dockerコマンドは `apps/matsu-auth` で実行します。
- 起動: `docker compose up -d --build`
- build: `docker compose build`
- API: `http://localhost:18081`
- PostgreSQL公開先: `localhost:15432`
- PostgreSQLのdatabase/user/password:
  - database: `matsu-auth`
  - user: `matsu-auth`
  - password: `matsu-auth-pass`
- 主なendpoint:
  - `GET /health`
  - `POST /auth/register`
  - `POST /auth/login`
  - `POST /auth/refresh`
  - `GET /oauth/authorize`
  - `POST /oauth/authorize`
  - `POST /oauth/token`
  - `GET /.well-known/jwks.json`
  - `GET /.well-known/oauth-authorization-server`
- `apps/matsu-auth/keys/private.pem` と `apps/matsu-auth/keys/jwks.json` は開発専用の鍵です。本番secretとして扱いません。

## Toolbox API

- Dockerコマンドは `apps/matsu-toolbox-api` で実行します。
- 起動: `docker compose up -d --build`
- API: `http://localhost:18083`
- PostgreSQL公開先: `localhost:15433`
- database/user/password: `matsu-toolbox` / `matsu-toolbox` / `matsu-toolbox-pass`
- 主な品質gate: `npm.cmd run check`、`npm.cmd test`、`npm.cmd run build`
- DB integration test: `docker compose --profile test run --rm test`
- `matsu-auth` が発行する `aud=matsu-toolbox-api` tokenだけを受け入れます。

## Arcade Auth

- Dockerコマンドは `apps/matsu-arcade-auth` で実行します。
- 起動: `docker compose up -d --build auth`
- build: `docker compose build auth`
- test: `docker compose --profile test run --rm test`
- API: `http://localhost:18084`
- PostgreSQL公開先: `localhost:15434`
- database/user/password: `matsu-arcade-auth` / `matsu-arcade-auth` / `matsu-arcade-auth-pass`
- `keys/private.pem` と `keys/jwks.json` はArcade専用の開発鍵です。本番secretとして扱いません。

## Arcade API

- Dockerコマンドは `apps/matsu-arcade-api` で実行します。
- 開発起動: `docker compose up --build`
- API: `http://localhost:18085`
- PostgreSQL公開先: `localhost:15435`
- database/user/password: `matsu-arcade` / `matsu-arcade` / `matsu-arcade-pass`
- 主な品質gate: `npm.cmd run check`、`npm.cmd test`、`npm.cmd run build`
- DB integration test: `docker compose --profile test run --rm test`
- `matsu-arcade-auth` が発行する `iss=http://localhost:18084`、`aud=matsu-arcade-api` tokenだけを受け入れます。

## 作業上の注意

- 関係のないファイルを安易に書き換えません。
- 変更範囲はユーザーが依頼したタスクへ限定します。
- 旧workspace `C:\work\00_Docker\matsu` は変更しません。
- オーナーの明示的な依頼なしに既存の未commit変更を戻しません。
- lockを変更する前に、親の通常ファイルと全サブモジュール内に未commit変更がないことを確認します。
- 未使用のstaging/productionはlockなしで構いません。利用開始時に任意のpush済み40桁SHAを固定し、架空SHAやplaceholderを追加しません。
- `apply-lock.sh` 後の子リポジトリHEADと親gitlinkの差分は、リリース用の使い捨てcheckoutでは正常です。

## 主な実装位置

- Frontendの支出集計画面:
  - `apps/matsu-front/src/components/expenses/summary/SummaryPage.tsx`
  - `apps/matsu-front/src/hooks/expenses/summary/useSummary.ts`
  - `apps/matsu-front/src/hooks/expenses/api/useSummaryApi.ts`
  - `apps/matsu-front/src/api/expenses/summary.ts`
- Frontendの支出登録:
  - `apps/matsu-front/src/pages/expenses/CreateIndex.tsx`
  - `apps/matsu-front/src/api/expenses/create.ts`
  - `apps/matsu-front/src/hooks/expenses/create/`
- Frontend認証:
  - `apps/matsu-front/src/pages/auth/LoginPage.tsx`
  - `apps/matsu-front/src/auth/session.ts`
  - `apps/matsu-front/src/api/client.ts`
- BFF:
  - アプリentry: `apps/matsu-bff/src/index.ts`
  - 設定: `apps/matsu-bff/src/config.ts`
  - セッションmiddleware: `apps/matsu-bff/src/middleware/session.ts`
  - 認証route: `apps/matsu-bff/src/routes/auth.ts`
  - API proxy route: `apps/matsu-bff/src/routes/api.ts`
  - Toolbox route: `apps/matsu-bff/src/routes/toolbox.ts`
  - Arcade route: `apps/matsu-bff/src/routes/arcade.ts`
  - セッションstore: `apps/matsu-bff/src/services/sessionStore.ts`
  - Redis client: `apps/matsu-bff/src/services/redisClient.ts`
- API支出route:
  - route: `apps/matsu-api/src/www/routes/api.php`
  - controller: `apps/matsu-api/src/www/app/Http/Controllers/Api/Expenses/ExpensesController.php`
  - service: `apps/matsu-api/src/www/app/Services/Expenses/ExpenseService.php`
  - query: `apps/matsu-api/src/www/app/Queries/Expenses/ExpenseQuery.php`
  - 日付helper: `apps/matsu-api/src/www/app/Support/DateUtil.php`
- API認証:
  - middleware: `apps/matsu-api/src/www/app/Http/Middleware/AuthenticateWithJwt.php`
  - 設定: `apps/matsu-api/src/www/config/auth_server.php`
- 認証サーバー:
  - メインアプリ: `apps/matsu-auth/app/Main.hs`
  - Docker Compose: `apps/matsu-auth/docker-compose.yml`
  - DB schema: `apps/matsu-auth/db/init/001_schema.sql`
  - ローカル開発鍵: `apps/matsu-auth/keys/`
- Toolbox API:
  - entry: `apps/matsu-toolbox-api/src/index.ts`
  - app/route登録: `apps/matsu-toolbox-api/src/app.ts`
  - JWT認証: `apps/matsu-toolbox-api/src/auth/`
  - route: `apps/matsu-toolbox-api/src/routes/`
  - DB schema/repository: `apps/matsu-toolbox-api/src/db/`、`apps/matsu-toolbox-api/src/repositories/`
- Arcade Auth:
  - entry: `apps/matsu-arcade-auth/app/Main.hs`
  - API/app: `apps/matsu-arcade-auth/src/ArcadeAuth/API.hs`、`apps/matsu-arcade-auth/src/ArcadeAuth/App.hs`
  - token/JWKS: `apps/matsu-arcade-auth/src/ArcadeAuth/Token.hs`、`apps/matsu-arcade-auth/src/ArcadeAuth/Jwks.hs`
  - DB migration: `apps/matsu-arcade-auth/db/migrations/001_initial.sql`
- Arcade API:
  - entry: `apps/matsu-arcade-api/src/index.ts`
  - app/route: `apps/matsu-arcade-api/src/app.ts`、`apps/matsu-arcade-api/src/http/routes.ts`
  - JWT認証: `apps/matsu-arcade-api/src/auth.ts`
  - DB migration/schema/seed: `apps/matsu-arcade-api/src/db/`、`apps/matsu-arcade-api/migrations/`

## 検証時の注意

- Windows PowerShellでは実行ポリシーにより `npm.ps1` が拒否されることがあります。`npm run ...` ではなく `npm.cmd run ...` を使います。
- Frontend buildは `apps/matsu-front` で `npm.cmd run build` を実行します。
- FrontendのDocker開発起動は `apps/matsu-front` で `docker compose up` を実行します。Viteは `http://localhost:5173` でhot reloadします。
- BFF buildは `apps/matsu-bff` で `npm.cmd run build` を実行します。
- Toolbox APIとArcade APIのNode.js品質gateもPowerShellでは `npm.cmd` を使います。DB integration testは各repoのtest profileで実行し、開発DBを共有しません。
- Arcade Authの検証済み経路はDocker buildとtest profileです。host GHCのversion差を理由に子sourceを変更しません。
- API testは通常、`apps/matsu-api` のDocker `web` コンテナ内 `/var/www` で `composer test` または `php artisan test` を実行します。
- APIのconfig cacheにより `.env` の認証変更が隠れる場合があります。`AUTH_SERVER_*` 変更後は `php artisan config:clear` を実行します。
- JWT認証が `{"message":"Unauthenticated."}` を返す場合、`apps/matsu-api/src/www/storage/logs/laravel.log` を確認します。認証middlewareは理由とともに `JWT authentication failed` を記録します。
- LaravelがDockerからJWKSを取得するURLは `http://host.docker.internal:18081/.well-known/jwks.json` を使います。
- `AUTH_SERVER_CACHE_STORE=database` の場合、Laravel DB cacheには `cache` table migrationの実行が必要です。
- 認証サーバーの初回Docker buildは、CabalがHaskell依存関係をcompileするため時間がかかる場合があります。
- ホストGHCがDocker内のGHCより古い場合、ローカルの `cabal v2-build` が失敗することがあります。検証済み経路はDocker buildです。
- Viteを手動起動した場合、IPv6 loopbackへbindすることで `localhost:5173` は応答しても `127.0.0.1:5173` が応答しない場合があります。
- このローカル環境ではCodexのアプリ内ブラウザ操作が `AppData` 権限エラーで失敗する場合があります。その場合はbuild/testとHTTP確認を使い、ブラウザ制約を報告します。
