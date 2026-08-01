# Task 13: Resource APIのCompose名を機能単位へ揃える

## 対象

- `apps/matsu-toolbox-api`
- `apps/matsu-arcade-api`

Task 08/09由来の未commit差分を必ず保持し、この2repo以外と親workspaceは変更しない。

## 命名方針

- Toolboxは `toolbox-api` / `toolbox-db`。
- Arcade APIは `arcade-api` / `arcade-db`。
- container名は `matsu-toolbox-api` / `matsu-toolbox-db`、`matsu-arcade-api` / `matsu-arcade-api-db` に揃える。
- DATABASE_URL、`depends_on`、READMEの `docker compose run/exec`、`.env.example` のCompose内hostnameを同時に更新する。
- logical volume名は既に機能prefix付きなら維持する。既存physical named volumeを削除・置換しない。
- Task 09のsource bind mount、container専用`node_modules`、migration/seed後の`npm run dev`、pollingを維持する。

## 環境方針

- hot reloadのlocal runtime APIと専用PostgreSQLだけをComposeに残す。
- Task 08で削除したtest/production service、profile、networkを再導入しない。
- staging/production環境を追加しない。

## 検証

- 実装前後のGit状態
- 両Composeのconfig・service・volume一覧
- build、起動、両 `/health`
- source mount、container専用`node_modules`、watcher/hot reload
- API/DBが各1 instance
- 既存named DB volumeの継続mount
- staleな汎用名・test/production profile記述がないこと
- `git diff --check`

`down -v`、volume削除、git add/commit/pushは禁止。起動済みserviceを勝手に停止しない。
