# Task 11: CoreサービスのCompose名を機能単位へ揃える

## 対象

- `apps/matsu-bff`
- `apps/matsu-api`

既存の未commit差分を保持し、この2repo以外と親workspaceは変更しない。

## 命名方針

- Compose serviceは汎用名を避け、機能が分かる名前にする。
- BFFは `bff` と `bff-redis`。
- Laravel APIは `api` と `api-db`。container名も `matsu-api` / `matsu-api-db` に揃える。
- 内部DNS、`depends_on`、README、`.env.example`、tracked local envなどの参照を同時に更新する。
- 汎用的なlogical volume名も機能prefix付きへ揃える。ただし既存のphysical named volumeを再利用し、データを失わないよう、変更前に実volume名を確認して必要ならComposeの `name:` で固定する。

## 環境方針

- 通常のローカルruntimeだけをComposeに残す。
- test/staging/production用service、profile、DB、networkを追加しない。
- healthcheckの `test:` はCompose環境ではなくhealthcheck commandなので維持してよい。

## 検証

- 実装前後のGit状態
- `docker compose config --quiet` と `docker compose config --services/--volumes`
- 内部DNS参照とservice名の整合
- build、起動、health
- 既存named volumeの継続mount
- 汎用service/volume名とtest/production profileが残っていないこと
- `git diff --check`

`down -v`、volume削除、git add/commit/pushは禁止。起動済みserviceを勝手に停止しない。
