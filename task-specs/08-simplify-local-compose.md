# 追加タスク書: 新3サービスのローカルComposeを簡素化する

## 背景

`matsu-toolbox-api`、`matsu-arcade-auth`、`matsu-arcade-api` のComposeには、学習用に追加したtest profileやproduction serviceが残っている。

現時点では商用環境をComposeで起動する予定はなく、日常利用するのはローカル開発環境だけである。`apps/matsu-bff/docker-compose.yml` のように、通常の `docker compose up` で必要なアプリと永続DBだけが起動する、読みやすい構成へ戻す。

このタスクはComposeの実行サービスを簡素化するものであり、テストコードや通常の品質gateそのものを削除するタスクではない。

## 作業対象

- `apps/matsu-toolbox-api`
- `apps/matsu-arcade-auth`
- `apps/matsu-arcade-api`

各repoの次のファイルを必要な範囲で変更する。

- `docker-compose.yml`
- `Dockerfile`
- repo固有の `README.md`
- Composeから削除したtarget/profileだけに使われる設定

親workspaceの起動 `.bat` はこのタスクでは変更しない。後続の `09-hono-dev-launchers.md` で扱う。

## 事前監査

3repoそれぞれについて、次を確認してから作業する。

- current branchが `develop`
- `HEAD == origin/develop`
- 未commit変更がない
- 現在のCompose service/profile一覧
- Dockerfileのstageと、その参照元

意図しない差分がある場合は停止して報告する。

## 1. Toolbox API

`docker-compose.yml` から次を削除する。

- `test` service
- `test-db` service
- test専用network
- test profileにだけ必要な設定

通常起動で残すのは次だけとする。

- `api`
- `toolbox-db`
- 開発DBのnamed volume

`tests/`、`npm test`、`npm run test:integration` などのテストコード／scriptは削除しない。

## 2. Arcade Auth

`docker-compose.yml` から次を削除する。

- `test` service
- `test-db` service
- test専用network
- test profileにだけ必要なanchor、volume、設定

通常起動で残すのは次だけとする。

- `auth`
- `auth-db`
- 開発DBのnamed volume

Dockerfileの `test` stageがCompose削除後にどこからも使われない場合は削除する。ただしHaskellのtest source、Cabal test-suite、通常の `cabal test` 能力は削除しない。`build` と実行用の軽量 `runtime` stageは維持する。

## 3. Arcade API

`docker-compose.yml` から次を削除する。

- `api-production` service
- `production` profile
- `test` service
- `test-db` service
- test profileにだけ必要な設定

通常起動で残すのは次だけとする。

- 開発用 `api`
- `db`
- 開発DBのnamed volume

Dockerfileのproduction/build stageが削除後に使われず、現時点のローカル開発構成にも不要なら削除する。開発用dependency/installと `npm run dev` に必要な構成は維持する。

`tests/`、`npm test`、lint、typecheck、OpenAPI check等の品質gateは削除しない。

## 4. 文書

各repoのREADMEから、削除した次の手順を除去または現状に合わせて修正する。

- `docker compose --profile test ...`
- `docker compose --profile production ...`
- `test-db` / `api-production` の説明

Composeはローカルruntime専用であり、通常のunit testやquality gateは引き続き利用できることを明記する。存在しないコマンドを代替として捏造しない。

親の `README.md` / `AGENTS.md` に残るtest profile記述は、後続タスク09で最終的に整合させる。このタスクの最終報告で修正必要箇所を一覧化する。

## 5. 検証

各repoで最低限、次を行う。

```text
docker compose config --quiet
docker compose config --services
```

期待service:

- Toolbox: `api`, `toolbox-db`
- Arcade Auth: `auth`, `auth-db`
- Arcade API: `api`, `db`

次も確認する。

- `profiles:`、`test-db`、`api-production` がComposeに残っていない
- `docker compose up -d --build` が成功する
- 各DBがhealthyになる
- Toolbox `/health` が200
- Arcade Auth `/health` が200
- Arcade API `/health` が200
- 通常のunit test / lint / typecheck / buildが削除されていない
- 開発用named volumeを削除していない

既存データvolumeを削除する `docker compose down -v` は実行しない。

## 完了条件

- 3repoのComposeがローカル開発用2 serviceだけになっている
- test/production profileがない
- 未使用Dockerfile stageとREADME記述が整理されている
- テストコードと通常の品質gateは維持されている
- 3サービスのhealthが200
- 他repoを変更していない

## 最終報告

- repoごとの削除service/profile
- Dockerfile変更
- 残したtest/quality gate
- `docker compose config --services` の結果
- 起動・health結果
- 後続タスク09で直す親文書箇所
- 各repoの最終差分

commit・pushは実行しない。
