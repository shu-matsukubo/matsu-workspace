# Task 14: Compose命名の親workspace統合と全体検証

Task 11〜13完了後に実行する。

## 対象

- 親 `README.md` / `AGENTS.md` / `DEVELOPMENT.md`
- `scripts/*.bat` のうちservice名を明示するもの
- 必要なTask 11〜13対象repoの読み取り検証

Task 08〜13およびその他の既存未commit差分を保持する。子repo実装は原則変更せず、問題があれば該当Taskへ差し戻す。

## 統合要件

- 親文書のservice/container/volume/command表記を実Composeへ一致させる。
- test/staging/production用Compose環境がなく、local runtimeだけであることを明記する。
- healthcheckの `test:` やドメイン用語のplayer profileをtest環境と誤認しない。
- `run-matsu.bat` と個別launcherが新service名で動作し、同一containerを二重起動しないことを確認する。
- 親に統合Composeは作らない。

## 全体検証

- 7アプリすべての `docker compose config --quiet` とservice/volume一覧
- 汎用service名 `db` / `redis` / `web` / `api` / `auth` が、定めた例外以外に残っていないこと
- `profiles:`、`--profile`、`test-db`、`api-production`、production/staging serviceがないこと
- `run-matsu.bat` 実行後のservice/container一意性
- 全health endpoint
- named volumeの継続mount
- 全対象repoと親の `git diff --check`

`down -v`、volume削除、git add/commit/pushは禁止。起動済みserviceを勝手に停止しない。
