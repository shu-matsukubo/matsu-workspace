# matsu開発・リリースフロー

## 3種類の状態を分けて考える

このワークスペースでは、次の3種類を別々に管理します。

| 状態 | 正本 | 用途 |
|---|---|---|
| サブモジュールの取得先 | `.gitmodules` | リポジトリのURLと配置path |
| ローカル開発branch | `modules.dev.conf` | 日々の開発で追従するmoving branch |
| 環境別リリース | `modules.lock.conf` | 実際にデプロイするimmutableな40桁commit SHA |

親リポジトリは `main` だけでも運用できます。環境を表すために親の `develop`、`stg`、`main` を作り分ける必要はなく、`.gitmodules` の環境別差分やマージ競合も発生しません。

環境はlock内のキーとして同時に存在します。

```text
development -> staging -> production
     同じcommit一式を昇格していく
```

branchやtagは「どのcommitをlockへ採用するか」を指定する入力です。CIが実際にcheckoutする正本は、常にlockへ記録された40桁SHAです。

## 子リポジトリbranchの方針

| リポジトリ | ローカル開発branch | 成果物branch |
|---|---|---|
| `apps/matsu-front` | `develop` | `main` |
| `apps/matsu-bff` | `develop` | `main` |
| `apps/matsu-api` | `develop` | `main` |
| `apps/matsu-auth` | `develop` | `main` |
| `apps/matsu-toolbox-api` | `develop` | `main` |
| `apps/matsu-arcade-auth` | `develop` | `main` |
| `apps/matsu-arcade-api` | `develop` | `main` |
| `docs` | `develop` | `main` |

7アプリと `docs` は `develop` へ直接pushします。成果物にするときはGitHub上で `develop` から `main` へマージします。日常のローカル作業で各子リポジトリを `main` へ切り替える必要はありません。

## 1. 開発開始

全モジュールを開発branchの最新版へ揃えます。

Windowsでダブルクリック:

```bat
scripts\sync-dev.bat
```

Git Bash、Linux、macOS:

```sh
sh scripts/sync-dev.sh
```

`sync-dev.sh` は全モジュールを先に検査し、未commit変更、未push commit、分岐、想定外branchがあればcheckout前に停止します。

## 2. 子リポジトリで開発

例としてFrontを変更します。

```sh
cd apps/matsu-front
git switch -c feature/example
# 実装、build、test
git add <変更ファイル>
git commit -m "<変更内容>"
```

現在の小規模運用で `develop` へ直接入れる場合:

```sh
git switch develop
git merge --ff-only feature/example
git push origin develop
```

チーム開発へ移行した場合は、feature branchをpushし、Pull Requestで `develop` へマージする形へ変更できます。

## 3. developmentの組み合わせを固定

複数アプリを組み合わせて開発環境で試験する前に、全子リポジトリがcleanでpush済みであることを確認します。

複数repoを変更した統合作業では、次の順序を守ります。

1. 変更した各子repoでbuild/testを実行する。
2. 各子repoをcommitし、`origin/develop` へpushする。
3. 全moduleでlocal-only commitと未commit変更がないことを確認する。
4. 親でgitlink、manifest、development lockを更新する。
5. 親差分を確認し、親を最後に別commitとしてpushする。

子repoのsource変更と親の組み合わせ記録を同じcommitに混ぜません。

```sh
cd ../..
sh scripts/update-lock.sh development --from-worktree
git diff -- modules.lock.conf
sh scripts/status.sh
```

`modules.lock.conf` の差分が、開発環境で試験する組み合わせそのものです。内容を確認して親リポジトリへcommitします。

```sh
git add modules.lock.conf
git commit -m "Update development module lock"
git push origin main
```

子リポジトリのcommitと、親のlock更新は別のcommitです。親のcommitはソース修正ではなく、複数リポジトリの組み合わせを記録するリリース管理情報です。

## 4. 子リポジトリの成果物をmainへマージ

リリース対象の各アプリと `docs` で、GitHub上の `develop` から `main` へPull Requestを作成します。

lockにはcommit SHAを保存するため、merge commit、squash merge、rebase mergeのいずれでも技術的には指定できます。ただし「developmentで試験したcommitをそのまま昇格した」ことを分かりやすくするなら、履歴が残るmerge commitまたはfast-forwardを推奨します。

必要なら各アプリの `main` 上でrelease tagを付けます。lock更新はbranch名、tag名、40桁SHAのいずれも受け付けます。

## 5. stagingへ昇格

まだ利用していない環境はlockなしで構いません。利用開始時に、originへpush済みで到達可能な任意のcommitを40桁SHAとして固定します。架空SHAや将来値のplaceholderは記録しません。

developmentで試験した同じSHA一式をそのまま使う場合:

```sh
sh scripts/promote-lock.sh development staging
git diff -- modules.lock.conf
git add modules.lock.conf
git commit -m "Promote module lock to staging"
git push origin main
```

アプリの `main` mergeによって別commitをstaging対象にする場合は、対象だけ明示的に更新します。

```sh
sh scripts/update-lock.sh staging apps/matsu-front main
sh scripts/update-lock.sh staging apps/matsu-bff v1.2.0
```

ここで行うのは、stagingへ出すcommitの選択です。アプリソースへstaging用の修正を入れる工程ではありません。

同じ仕組みで、必要ならproductionへ直接任意のpush済み40桁commitを指定できます。

```sh
sh scripts/update-lock.sh production <module-path> <pushed-40-character-commit>
```

productionをbranch名へ固定する設計ではありません。通常の昇格では次節のとおり、試験済みのSHA一式をコピーします。

staging CIは次を実行します。

```sh
sh scripts/setup.sh
sh scripts/apply-lock.sh staging
sh scripts/verify-lock.sh staging
# build、test、staging deploy
```

## 6. productionへ昇格

staging試験に合格したら、試験済みSHA一式をそのままproductionへコピーします。

```sh
sh scripts/promote-lock.sh staging production
git diff -- modules.lock.conf
git add modules.lock.conf
git commit -m "Promote module lock to production"
git push origin main
```

production CI:

```sh
sh scripts/setup.sh
sh scripts/apply-lock.sh production
sh scripts/verify-lock.sh production
# production deploy
```

productionのバージョンをもう一度入力する必要はありません。`promote-lock.sh` がstagingと完全に同じSHAを転記するため、「stagingで試験したもの」と「productionへ出したもの」を一致させられます。

## CIはどう環境を選ぶか

タグを付けるだけでは、stagingかproductionかは決まりません。CI側に明示的な選択が1つ必要です。たとえば次のいずれかです。

- 手動実行の `environment` 入力
- staging用jobとproduction用job
- タグ命名規則とworkflow内の対応表

選ばれた環境名を、デプロイ先と `apply-lock.sh` の両方へ同じ値で渡します。

```sh
environment=staging
sh scripts/apply-lock.sh "$environment"
# "$environment" に対応するデプロイ先へ送る
```

スクリプトが親branch名から環境を推測する設計にはしていません。明示指定にすることで、タグ名・branch名・デプロイ先の偶然の不一致を避けます。

## 親gitlinkの位置づけ

Gitサブモジュールには親gitlinkが必須です。親gitlinkはclone直後や `setup.sh` の初期位置として使います。

リリース時の正本は `modules.lock.conf` です。`apply-lock.sh` の後は、lockと親gitlinkが異なる場合に親の作業ツリーへgitlink差分が表示されますが、CIの使い捨てcheckoutでは正常です。

ローカルで `apply-lock.sh` を試した後、開発branchへ戻す場合は、子リポジトリ内に変更がないことを確認して `sync-dev.sh` を実行します。

## ローカル統合時の通信境界

Frontの接続先はBFFの `http://localhost:18082` だけです。Frontからresource serverやAuthへ直接requestを追加しません。

BFFはbrowser session内にresource別tokenを保持し、routeごとにupstreamを明示的に分けます。

| BFF route | upstream | Auth |
|---|---|---|
| 既存の家計簿 `/api/*` | `matsu-api` (`18080`) | `matsu-auth` (`18081`) |
| `/api/toolbox/*` | `matsu-toolbox-api` (`18083`) | `matsu-auth` (`18081`) |
| `/api/arcade/*` | `matsu-arcade-api` (`18085`) | `matsu-arcade-auth` (`18084`) |

各repoのComposeは独立しており、Auth/API間を親Composeの `depends_on` で結びません。親に統合Composeは作らず、`scripts\run-matsu.bat` はそれぞれのComposeを起動するだけです。

local runtimeのapplication serviceは `front`、`bff`、`api`、`auth`、`toolbox-api`、`arcade-auth`、`arcade-api` です。依存serviceは順に `bff-redis`、`api-db`、`auth-db`、`toolbox-db`、`arcade-auth-db`、`arcade-db` で、Frontに依存serviceはありません。serviceとcontainerは各repo内でも他repo間でも一意に対応し、既存のphysical named volumeを継続mountします。正確なcontainer名とvolume名は `README.md` の「ローカルCompose構成」を正本とします。

これらのComposeはlocal runtime専用です。test / staging / production用のservice、profile、DB、networkはありません。`modules.lock.conf` のenvironmentはリリース対象commitを選ぶための区分です。healthcheckの `test:` とArcade domainの `player_profiles` はCompose環境を表しません。

`scripts\run-matsu.bat` は全application serviceをdetachedで起動します。別windowは開かず、起動処理が終わると呼び出し元のcommand lineへ入力が戻ります。`front`、`bff`、`toolbox-api`、`arcade-api` はdetachedでもsourceを監視し、Windows上の編集をDocker Desktop経由でhot reloadします。対象serviceのログをforegroundで継続表示したい場合は個別launcherを使います。各launcherはapplication serviceを明示し、同じserviceを二重起動しません。

## 安全策

- どの管理スクリプトもcommitやpushを自動実行しません。
- `sync-dev.sh`、`update-lock.sh`、`promote-lock.sh` は親にstage済み変更・通常ファイル変更・未追跡ファイルがある場合、または全子リポジトリがcleanでない場合に停止します。未stageのgitlink差分だけは子リポジトリ開発中の通常状態として許可します。
- `update-lock.sh` はoriginで確認できないlocal-only commitをlockへ記録しません。
- `apply-lock.sh` は全モジュールをfetch・検証してからcheckoutを開始します。
- `apply-lock.sh` の途中で失敗した場合、変更済みモジュールを開始時のbranch/commitへ戻します。
- `verify-lock.sh` は全HEAD、dirty状態、40桁SHA、tag指定時のtag解決結果を検証します。
