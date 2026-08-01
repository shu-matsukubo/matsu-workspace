# 不具合対応タスク書: 家計簿summary APIの502を解消する

## 現象

FrontからBFFへ次を送ると502になる。

```text
GET http://localhost:18082/api/expenses/summary?start_date=2026-08-01&end_date=2026-08-31&group_by=category
502 Bad Gateway
```

BFFは内部で既存Laravel APIの次のrouteへ変換している。

```text
GET /api/expenses?mode=summary&start_date=2026-08-01&end_date=2026-08-31&group_by=category
```

## 事前に得られている証拠

- `matsu-bff`、`matsu-web`、`matsu-db` は起動中
- BFF logでは上流Laravel APIが500を返している
- Laravel logの直接原因:

```text
Database file at path [/var/www/database/database.sqlite] does not exist.
Connection: sqlite
```

- `apps/matsu-api/src/www/.env` が存在しない
- `.env.local` には正しいMySQL設定がある

```text
APP_ENV=local
DB_CONNECTION=mysql
DB_HOST=db
DB_PORT=3306
DB_DATABASE=matsu
DB_USERNAME=test_user
```

- `apps/matsu-api/docker-compose.yml` のweb serviceは `.env.local` をenvironmentとして読み込んでいない
- `scripts/setup.sh` は `.env.local` をignored `.env` へcopyするが、通常の `docker compose up` や親 `run-matsu.bat` はこのcopyを保証しない

このためLaravelが既定のSQLite設定へフォールバックしている可能性が高い。仮説を実測確認した上で修正する。

## 作業対象

原則として `apps/matsu-api` のみ。

- `docker-compose.yml`
- `.env.local` / Laravel config
- `scripts/setup.sh` / `scripts/update.sh`
- repo README
- 必要な回帰test

BFFは上流500を502へ変換しているだけなので、証拠なしにBFFのrouteやerror mappingを変更しない。

## 1. 再現と原因確定

修正前に次を確認する。

- container内の `APP_ENV`
- `php artisan config:show database` または同等手段でdefault connection
- `/var/www/.env` の有無
- MySQL containerのhealthと接続可否
- config cacheの有無
- Laravel logの最新例外

機密値を最終報告へ出力しない。

## 2. 恒久修正

次の状態を満たす方法を選ぶ。

- `docker compose up -d` だけでweb containerへローカルMySQL/Auth設定が渡る
- 親 `scripts/run-matsu.bat` から起動しても同じ
- ignored `.env` の手動copy有無に依存しない
- `DB_CONNECTION=mysql`、`DB_HOST=db` が確実に有効
- `.env.local` のAuth/JWKS設定も失わない
- stale config cacheが修正を隠さない
- 開発用設定をimageへ本番secretとして焼き込まない

候補はComposeの `env_file` 等だが、実装前にLaravel/Docker Composeの挙動を確認し、最小で再現性の高い方法を選ぶ。

`setup.sh` の `.env` copyを残す場合は、二重の正本や挙動差を生まないことを説明する。不要ならREADMEと合わせて整理する。

## 3. 回帰防止

可能な範囲で、次のいずれかを追加・更新する。

- Compose configの期待値確認
- local setup/update手順
- DB connectionのsmoke check
- READMEの通常起動手順

`.env` がたまたま残っている場合だけ成功する検証にしない。

## 4. 検証

開発DB volumeを削除せず、web containerだけを安全にrecreateして確認する。

- `docker compose config --quiet`
- container内のdefault DB connectionが `mysql`
- hostが `db`、databaseが `matsu`
- MySQLへ簡単なqueryが成功
- migration状態を確認
- `http://localhost:18080/up` が200
- 認証なしAPIが401であり、DB例外500ではない
- 有効なログインsession/tokenで家計簿summaryを呼び、200になる
- BFF経由のユーザー提示URLが200になり、502が解消
- Laravel logに新しいSQLite missing errorが出ない
- BFFの家計簿route以外（Toolbox/Arcade）を壊していない
- APIの既存quality gateを可能な範囲で実行

有効なsessionを自動取得できない場合は、Auth/BFFの既存フローを使ってtoken/sessionを作る。どうしても不可能なら、MySQL接続とAPI directの検証結果、ユーザーがブラウザで行う最終確認手順を明記する。

## 完了条件

- summary APIの502原因が説明できる
- 通常起動でMySQL設定が確実に有効
- `.env` 手動copyへの隠れた依存がない
- BFF経由summaryが200
- 既存DBデータを失っていない
- 不要なBFF変更がない

## 最終報告

- 根本原因
- 変更ファイルと採用した環境注入方式
- config cacheへの対処
- DB/migration確認
- direct API/BFF APIのstatus
- 実行したtest
- 残る手動確認があればその内容

commit・pushは実行しない。
