# 追加タスク書: サービスごとのテスト環境を分離する

## 背景

各本体サービスと永続DBは概ね疎結合になっているが、次の不足がある。

1. `matsu-arcade-auth` のDocker test serviceが開発用 `auth-db` と
   `auth_db_data` volumeを共有し、integration testのユーザーを開発DBへ残す。
2. `matsu-toolbox-api` の自動testはmemory repository中心で、実PostgreSQL migrationと
   Drizzle repositoryの結合を独立した一時DBで検証する経路がない。

本番サービス間の結合を増やさず、各リポジトリ内だけで再現可能なtest環境を作る。

## 作業対象

- `apps/matsu-arcade-auth`
- `apps/matsu-toolbox-api`

両者は独立Gitリポジトリである。変更と検証を分け、commitとpushは実行しない。

他アプリ、docs、親ワークスペースは変更しない。

## Arcade Auth

Docker Composeのtest profileへ専用 `test-db` を追加する。

要件:

- 開発用 `auth-db` をtestから参照しない。
- database/user/passwordをtest専用にする。
- named development volumeをmountしない。
- DB dataは `tmpfs` または明示的な使い捨てvolume。
- host portを公開しない。
- healthcheck後にmigrationとtestを実行する。
- `ARCADE_AUTH_DATABASE_URL` はtest service内でtest DBを指す。
- test終了後、開発DBのrow数やmigration状態が変わらない。
- testを連続2回実行して成功する。

推奨コマンド:

```text
docker compose --profile test run --rm test
docker compose --profile test stop test-db
```

## Toolbox API

Docker Composeのtest profileへ、専用API test serviceと一時PostgreSQLを追加する。

要件:

- `TEST_DATABASE_URL` またはtest専用 `DATABASE_URL` を使用する。
- migrationを適用してからtestを実行する。
- notes/bookmarksについて実Drizzle repositoryを通すintegration testを追加する。
- UUID、owner分離、update順、tag filter、deleteを検証する。
- migrationを繰り返しても成功する。
- 開発用 `toolbox_db_data` を共有しない。
- host portを公開しない。
- test終了後にデータを残さない。
- memory repository testは高速なcontract/unit testとして残してよい。

## 疎結合性の確認

次を実際に確認する。

- 各API/Authは自分のComposeと専用DBだけでbuild/testできる。
- `matsu-auth`、BFF、他APIを起動しなくてもtest fixtureで認証testができる。
- 実サービス接続先は環境変数で差し替え可能。
- 他サービスのDB、Redis、volume、migrationを参照しない。
- `docker compose down` が別リポジトリのcontainer/volumeへ影響しない。

## 品質ゲート

`matsu-arcade-auth`:

```text
docker compose build auth
docker compose --profile test run --rm test
```

`matsu-toolbox-api`:

```text
npm run check
npm test
npm run build
docker compose --profile test run --rm test
```

## 完了条件

- Arcade Auth testが開発DBを一切使用しない。
- Toolboxの実DB integration testが存在する。
- 両test環境が一時DBだけを使う。
- 他サービス停止中でも各品質ゲートが成功する。
- 開発DBの既存データを削除・変更していない。
- commitとpushを実行していない。

## 最終報告

- 変更したCompose service
- test DBのライフサイクル
- 追加したintegration test
- 開発DB非変更の確認方法
- 実行結果
- リポジトリ別変更ファイル

