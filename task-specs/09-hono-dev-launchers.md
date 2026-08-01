# 追加タスク書: Hono APIを開発モードでまとめて起動する

## 背景

`scripts/run-matsu.bat` はFront、BFF、Arcade APIを別windowの開発モードで起動しているが、Toolbox APIだけはdetachedのbuild済みserverとして起動している。

Honoで実装された次の2 APIは、Front/BFFと同様にsourceをbind mountし、`npm run dev` のhot reloadとログを確認できる状態で起動したい。

- `matsu-toolbox-api`
- `matsu-arcade-api`

このタスクは `08-simplify-local-compose.md` 完了後に実行する。タスク08の意図した未commit差分がある場合は、それを前提として保持・継続してよい。

## 作業対象

- `apps/matsu-toolbox-api`
- `apps/matsu-arcade-api`
- `scripts/run-matsu.bat`
- `scripts/run-toolbox-dev.bat`
- `scripts/run-arcade-api-dev.bat`
- 必要な親 `README.md` / `AGENTS.md` / `DEVELOPMENT.md`

Arcade AuthはHaskellのruntime serviceであり、Hono開発windowの対象に含めない。

## 1. Toolbox APIの開発モード

Toolbox APIの通常Compose `api` serviceを、BFF/Arcade APIと同じ考え方の開発モードへ変更する。

要件:

- sourceを `/app` へbind mountする
- container内の `node_modules` はhostの空directoryで隠さない
- `npm run dev` で起動する
- 起動前に必要なmigrationを実行する
- `tsx watch` の変更検知がWindows + Docker Desktopで動く
- `toolbox-db` のhealth待機を維持する
- port `18083` / DB port `15433` を変えない
- Auth issuer/audience/JWKS設定を変えない
- production用serviceを新設しない

Dockerfileはローカル開発に必要なdependencyをinstallするシンプルな構成にする。起動のたびに不要なproduction buildを要求しない。

## 2. Arcade APIの開発モード

Arcade APIは現在の `development` target、source mount、`npm run dev` を基準に確認・整理する。

要件:

- source bind mount
- container専用 `node_modules`
- migration / seed後に `npm run dev`
- DB health待機
- port `18085` / DB port `15435` 維持
- Auth設定維持
- production/test profileを再追加しない

不要な変更は行わない。

## 3. 個別launcher

`run-toolbox-dev.bat` と `run-arcade-api-dev.bat` は、Front/BFF用launcherと同じ性質にする。

- `ensure-docker.bat` を利用する
- 対象repoへ `cd /d` する
- `docker compose up --build` をforegroundで実行する
- hot reload logをwindow内で確認できる
- 失敗したservice名が分かるmessageを出す
- `-d` を付けない

## 4. 全体起動

`scripts/run-matsu.bat` は次を行う。

detachedで起動:

- matsu-api / MySQL
- matsu-auth / PostgreSQL
- matsu-arcade-auth / PostgreSQL

専用windowで開発モード起動:

- matsu-front
- matsu-bff / Redis
- matsu-toolbox-api / PostgreSQL
- matsu-arcade-api / PostgreSQL

要件:

- Toolbox APIを親scriptから先にdetached起動して、launcherでも二重起動しない
- Arcade APIも二重起動しない
- 4つのdev windowは識別できるtitleを持つ
- 途中失敗時のmessageを維持する
- 親に統合Composeを作らない
- 各repoのCompose独立性を維持する

## 5. 親文書

親README/AGENTS/DEVELOPMENTを実装に合わせる。

- Toolbox/Arcade APIがhot reloadのHono開発serviceであること
- `run-matsu.bat` のdetached serviceと別window service
- task08で削除したtest/production profileの古い記述を除去
- 通常のunit test / check / build commandは維持
- 存在しないCompose test commandを書かない

## 6. 検証

- 2 APIの `docker compose config --quiet`
- Toolboxのcommandがmigration後 `npm run dev`
- Arcade APIのcommandがmigration/seed後 `npm run dev`
- 2 APIのsource mountとcontainer専用node_modulesを確認
- `.bat` に同一serviceの二重起動がない
- `run-matsu.bat` 実行後、4 dev serviceがそれぞれ1 instanceだけ起動
- Front `/`、BFF `/health`、Toolbox `/health`、Arcade API `/health` が200
- Toolbox/Arcade APIのログにdev watcher起動が確認できる
- sourceへ無害な変更を加えて戻す検証を行う場合は、必ず元へ戻し差分を残さない
- `git diff --check`

既存DB volumeを削除しない。起動確認後もユーザーが利用中のserviceを勝手に停止しない。

## 完了条件

- Hono 2 APIがhot reload開発モード
- `run-matsu.bat` がFront/BFF/Hono 2 APIを別windowでまとめて起動
- 二重起動なし
- task08で削除したprofileを再導入していない
- 親文書が実装と一致

## 最終報告

- Toolbox/Arcade APIの開発commandとmount
- `.bat` の起動分類
- Compose静的検証
- 実起動service/container一覧
- health結果
- 変更ファイル
- task08由来差分との関係

commit・pushは実行しない。子repoのcommit/push後に、親gitlinkとdevelopment lockを別途更新する。
