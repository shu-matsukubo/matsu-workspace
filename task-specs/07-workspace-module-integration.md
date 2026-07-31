# 追加タスク書: 新3リポジトリを親ワークスペースへ統合する

## 背景

`apps/matsu-toolbox-api`、`apps/matsu-arcade-auth`、`apps/matsu-arcade-api` はclone済みで
各 `origin/develop` へpush済みだが、親から見ると未追跡directoryである。

現在、次に含まれていない。

- `.gitmodules`
- `modules.dev.conf`
- `modules.lock.conf`
- workspace README / DEVELOPMENT / AGENTS
- 全体起動script

このタスクを親ワークスペースの「くい打ちcommit」直前の最後の統合作業とする。

## 実行前提

次が完了し、各子リポジトリの変更がcommit・push済みであること。

1. `04-bff-multi-api-routing.md`
2. `05-service-test-isolation.md`
3. `06-docs-multi-service-architecture.md`

子リポジトリに未commit変更、未push commit、意図しないbranchが1つでもあれば停止する。
親のcommitとpushは実行しない。ユーザーが差分確認後に実行する。

## 作業対象

親 `matsu-workspace` のみ。

新3directory内のsourceを編集しない。既存directoryを削除・再cloneしない。

## 1. 事前監査

全moduleについて次を一覧化する。

- path
- origin URL
- current branch
- HEAD 40桁SHA
- `origin/<branch>` SHA
- dirty有無
- local-only commit有無

アプリ7件:

```text
apps/matsu-front
apps/matsu-bff
apps/matsu-api
apps/matsu-auth
apps/matsu-toolbox-api
apps/matsu-arcade-auth
apps/matsu-arcade-api
```

docs:

```text
docs
```

全アプリは `develop` かつ `HEAD == origin/develop` を必須とする。

`docs` はアプリではなく、既存workspace方針とremote実態が `main` のため、明示的な方針変更が
ない限り `main` を維持する。「ローカル用はすべてdevelop」にdocsも含める意図がある場合は、
勝手に切り替えず、先にユーザーへ確認して `origin/develop` 作成後にmanifestと文書方針を
まとめて変更する。

## 2. サブモジュール登録

次をsubmoduleとして登録する。

| path | URL |
|---|---|
| `apps/matsu-toolbox-api` | `https://github.com/shu-matsukubo/matsu-toolbox-api.git` |
| `apps/matsu-arcade-auth` | `https://github.com/shu-matsukubo/matsu-arcade-auth.git` |
| `apps/matsu-arcade-api` | `https://github.com/shu-matsukubo/matsu-arcade-api.git` |

要件:

- 既存cloneを活かす。
- sourceや `.git` 内の履歴を失わない。
- `.gitmodules` にはpathとURLだけを記録する。
- `.gitmodules` にbranch設定を追加しない。
- 親gitlinkが各repoの最終HEADを指す。
- 既存5submoduleの設定を変えない。

## 3. develop manifest

`modules.dev.conf` に新3moduleを追加する。

```text
[module "apps/matsu-toolbox-api"]
    branch = develop

[module "apps/matsu-arcade-auth"]
    branch = develop

[module "apps/matsu-arcade-api"]
    branch = develop
```

既存アプリもすべて `develop` であることを再確認する。docsは前項の判断に従う。

## 4. development lock

全子リポジトリの最終commitがpush済みになった後、既存scriptを使って現在の組合せを記録する。

```text
sh scripts/update-lock.sh development --from-worktree
```

ただし親に通常ファイルや未追跡task-specがあると安全機構で停止するため、実行順を設計する。
必要なら、先にsubmodule/manifest登録だけを整え、task-specやREADME変更との順序を分ける。
scriptを回避してSHAを推測・手入力しない。

各moduleについて:

- `development` は40桁SHA
- applicationの `developmentRef` は `refs/remotes/origin/develop`
- docsは選択branchのremote ref
- lock SHAは実際のHEADと一致
- origin上のbranch/tagから到達可能

## 5. staging / production

現時点で商用運用しないため、架空のproduction SHAやplaceholderを追加しない。

既存設計どおり、必要になった時点で任意のpush済み40桁commitを指定できることを維持する。

```text
sh scripts/update-lock.sh production <module-path> <40-character-commit>
```

`resolve_ref` と `commit_reachable_from_origin` の既存挙動を壊さない。productionをbranch名へ
固定しない。環境間昇格では `promote-lock.sh` が同じSHA一式をコピーする。

README/DEVELOPMENTへ「未使用環境はlockなしでよい」「利用開始時は任意のpush済みcommitを
固定する」と明記する。

## 6. 全体起動script

`scripts/run-matsu.bat` から全ローカルサービスを起動できるようにする。

対象:

- matsu-api / MySQL
- matsu-auth / PostgreSQL
- matsu-toolbox-api / PostgreSQL
- matsu-arcade-auth / PostgreSQL
- matsu-arcade-api / PostgreSQL
- matsu-bff / Redis
- matsu-front

要件:

- 各repoのCompose独立性を維持する。
- 親に巨大な統合Composeを新設しない。
- 既存のDocker起動待機を再利用する。
- 途中失敗時にどのserviceが失敗したか分かる。
- 開発ログを見たいNode serviceは専用launcherに分けてよい。
- 同一serviceを二重起動しない。
- port一覧をREADMEへ反映する。
- scriptはAuth/API間をCompose `depends_on` で直結しない。

必要に応じて追加する。

```text
scripts/run-toolbox-dev.bat
scripts/run-arcade-auth-dev.bat
scripts/run-arcade-api-dev.bat
```

## 7. 親文書と指示

更新する。

- `README.md`
- `DEVELOPMENT.md`
- `AGENTS.md`

反映内容:

- 7アプリ + docsのdirectory tree
- 新3repoの責務
- URL/port/DB port
- build/test/start command
- 主な実装位置
- BFFが3APIを呼び分けること
- FrontはBFFだけを呼ぶこと
- 全アプリのdevelop運用
- lockは環境別の任意commit SHA
- docsのbranch方針
- 子repoを先にcommit/pushし、親を最後にcommitする手順

過去の「現在は4アプリ」という記述を残さない。

## 8. 検証

最低限:

```text
git config --file .gitmodules --get-regexp ^submodule
git config --file modules.dev.conf --get-regexp ^module
sh scripts/status.sh
git submodule status
git diff --submodule=log
```

さらに一時的なclean checkout相当で次を確認する。

- `scripts/setup.sh` が8moduleを初期化できる設計。
- `scripts/sync-dev.sh` が7アプリをdevelopへ同期する。
- `scripts/apply-lock.sh development` が全moduleへlockを適用できる。
- `scripts/verify-lock.sh development` が成功する。
- 任意40桁SHAをproduction lockへ指定できる既存機能が維持される。
- 全体起動script後、Front/BFF/全API/Authのhealthが応答する。

作業中のcheckoutを壊す恐れがある検証は、cleanな使い捨てcheckoutか、全状態を確認したうえで
行う。既存の未commit変更を戻さない。

## 親commit直前の期待状態

- 全子repoがclean。
- 全アプリが `develop == origin/develop`。
- docsが選択branchとremoteで一致。
- 親gitlinkが最終HEADを指す。
- development lockが全moduleの最終HEADと一致。
- 新3repoが未追跡directoryではなくsubmodule。
- 親の差分は意図したgitlink、manifest、script、文書、task-specだけ。
- staging/productionに架空値がない。

この状態をユーザーへ報告して停止する。親の `git add`、commit、pushは自動実行しない。

## 最終報告

- 全moduleのbranch/HEAD/origin対応表
- `.gitmodules` 追加内容
- dev manifestとdevelopment lock
- staging/productionの扱い
- 起動script変更
- 実行したworkspace検証
- 親commit対象の差分一覧
- docs branchに関する判断

