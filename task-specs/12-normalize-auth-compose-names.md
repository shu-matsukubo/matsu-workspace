# Task 12: AuthサービスのCompose名を機能単位へ揃える

## 対象

- `apps/matsu-auth`
- `apps/matsu-arcade-auth`

Task 08由来を含む既存の未commit差分を保持し、この2repo以外と親workspaceは変更しない。

## 命名方針

- `matsu-auth` は `auth` / `auth-db` を維持する。通常Authとして十分に識別可能か、container・volume・内部DNSも含めて整合を確認する。
- Arcade Authは `arcade-auth` / `arcade-auth-db` へ揃える。
- container名は `matsu-auth` / `matsu-auth-db`、`matsu-arcade-auth` / `matsu-arcade-auth-db` と一致させる。
- 内部DATABASE_URL、`depends_on`、`.env.example`、READMEのCompose service参照を同時に更新する。
- logical volume名は機能prefix付きにする。既存physical named volumeを再利用し、データを失わないよう、変更前に実volume名を確認して必要ならComposeの `name:` で固定する。

## 環境方針

- runtimeのAuthと専用PostgreSQLだけをComposeに残す。
- Task 08で削除したtest service/profile/networkを再導入しない。
- staging/production環境を追加しない。
- Cabal test-suiteは別途管理するtest PostgreSQLと必要な環境変数で実行する既存方針を維持する。

## 検証

- 実装前後のGit状態
- `docker compose config --quiet` とservice/volume一覧
- build、起動、両Authの `/health`
- 既存named volumeの継続mount
- staleな汎用名・test/production profile記述がないこと
- `git diff --check`

`down -v`、volume削除、git add/commit/pushは禁止。起動済みserviceを勝手に停止しない。
