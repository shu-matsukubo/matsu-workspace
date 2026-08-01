# matsuワークスペース

`matsu-workspace` は、matsuを構成する独立Gitリポジトリをまとめるスーパープロジェクトです。

アプリと設計文書は、これまでどおり個別に開発・commit・push・デプロイできます。親リポジトリは、ローカル開発で追従するbranchと、各環境へリリースする正確なcommitの組み合わせを管理します。

## モジュール管理の考え方

管理情報を3つに分けています。

| ファイル | 役割 |
|---|---|
| `.gitmodules` | サブモジュールのpathとリモートURLだけを管理する |
| `modules.dev.conf` | ローカル開発で追従するbranchを管理する |
| `modules.lock.conf` | `development`、`staging`、`production` ごとの固定commitを管理する |

`.gitmodules` は全環境で共通です。環境ごとに別の `.gitmodules` を用意したり、親branchのマージ時に書き換えたりしません。

`.conf` はGit config互換形式です。`git config --file` で安全に読み書きできるため、`yq` などの追加ツールは不要です。

## ディレクトリ構成

```text
matsu-workspace/
|-- .gitmodules
|-- modules.dev.conf
|-- modules.lock.conf
|-- README.md
|-- DEVELOPMENT.md
|-- AGENTS.md
|-- .agents/
|   `-- skills/
|-- .vscode/
|-- apps/
|   |-- matsu-front/         # submodule
|   |-- matsu-bff/           # submodule
|   |-- matsu-api/           # submodule
|   |-- matsu-auth/          # submodule
|   |-- matsu-toolbox-api/   # submodule
|   |-- matsu-arcade-auth/   # submodule
|   `-- matsu-arcade-api/    # submodule
|-- docs/                  # submodule
`-- scripts/
    |-- setup.sh
    |-- sync-dev.sh
    |-- sync-dev.bat
    |-- status.sh
    |-- update-lock.sh
    |-- apply-lock.sh
    |-- verify-lock.sh
    |-- promote-lock.sh
    |-- run-matsu.bat
    |-- run-front-dev.bat
    |-- run-bff-dev.bat
    |-- run-toolbox-dev.bat
    |-- run-arcade-auth-dev.bat
    |-- run-arcade-api-dev.bat
    `-- modules/
        |-- lib.sh
        `-- ensure-docker.bat
```

## サービス境界

ブラウザの通信先は `matsu-bff` だけです。Frontは各resource serverやAuthを直接呼びません。BFFはbrowser sessionとresource別tokenを管理し、明示的なrouteで次の3 APIを呼び分けます。

- 家計簿route: `matsu-api`
- `/api/toolbox/*`: `matsu-toolbox-api`
- `/api/arcade/*`: `matsu-arcade-api`

`matsu-auth` は家計簿とToolboxのidentity providerです。`matsu-arcade-auth` はArcade専用で、DB、issuer、署名鍵、refresh tokenを `matsu-auth` と共有しません。各repoは独立したComposeとdatabaseを維持し、親に統合Composeは置きません。

## ローカルURLとport

| モジュール | 責務 | HTTP | DB / cache公開port |
|---|---|---|---|
| `matsu-front` | ブラウザUI | `http://localhost:5173` | - |
| `matsu-bff` | browser sessionと3 APIへのgateway | `http://localhost:18082` | Redis `16379` |
| `matsu-api` | 家計簿domain API | `http://localhost:18080/api` | MySQL `13306` |
| `matsu-auth` | 家計簿・Toolbox向けAuth | `http://localhost:18081` | PostgreSQL `15432` |
| `matsu-toolbox-api` | note、bookmark、text tool | `http://localhost:18083` | PostgreSQL `15433` |
| `matsu-arcade-auth` | Arcade専用Auth | `http://localhost:18084` | PostgreSQL `15434` |
| `matsu-arcade-api` | profile、game、score、leaderboard | `http://localhost:18085` | PostgreSQL `15435` |

health確認先は次のとおりです。

- Front: `http://localhost:5173/`
- matsu-api: `http://localhost:18080/up`
- BFF、matsu-auth、Toolbox API、Arcade Auth、Arcade API: 各HTTP base URLの `/health`

## ローカルCompose構成

各Composeは次のservice、container、既存physical named volumeを使います。`-` のFrontにはnamed volumeがなく、`/app/node_modules` はanonymous volumeです。

| モジュール | Compose service | container | physical named volume |
|---|---|---|---|
| `matsu-front` | `front` | `matsu-front` | - |
| `matsu-bff` | `bff`、`bff-redis` | `matsu-bff`、`matsu-bff-redis` | `matsu-bff-redis-data` |
| `matsu-api` | `api`、`api-db` | `matsu-api`、`matsu-api-db` | `matsu-api-db-data`、`matsu-api-framework-data`、`matsu-api-vendor-data` |
| `matsu-auth` | `auth`、`auth-db` | `matsu-auth`、`matsu-auth-db` | `matsu-auth-db-data` |
| `matsu-toolbox-api` | `toolbox-api`、`toolbox-db` | `matsu-toolbox-api`、`matsu-toolbox-db` | `matsu-toolbox-db-data` |
| `matsu-arcade-auth` | `arcade-auth`、`arcade-auth-db` | `matsu-arcade-auth`、`matsu-arcade-auth-db` | `matsu-arcade-auth-db-data` |
| `matsu-arcade-api` | `arcade-api`、`arcade-db` | `matsu-arcade-api`、`matsu-arcade-api-db` | `matsu-arcade-api-db-data` |

これらはlocal runtime専用です。test / staging / production用のCompose service、profile、DB、networkはありません。`modules.lock.conf` の `development` / `staging` / `production` はリリース対象commitの区分であり、Compose環境ではありません。Compose healthcheckの `test:` とArcade domainの `player_profiles` もtest環境を意味しません。

## モジュール別の主なコマンド

コマンドは各module directoryで実行します。PowerShellでは `npm` の代わりに `npm.cmd` を使います。

| モジュール | start | build / quality / test |
|---|---|---|
| `matsu-front` | `docker compose up front` | `npm.cmd run check`、`npm.cmd run build` |
| `matsu-bff` | `docker compose up bff` | `npm.cmd run check`、`npm.cmd test`、`npm.cmd run build` |
| `matsu-api` | `docker compose up -d api` | `api` containerの `/var/www` で `composer pint:test`、`composer analyse`、`composer test` |
| `matsu-auth` | `docker compose up -d --build auth` | `docker compose build auth` |
| `matsu-toolbox-api` | `docker compose up --build toolbox-api` | `npm.cmd run check`、`npm.cmd test`、`npm.cmd run build` |
| `matsu-arcade-auth` | `docker compose up -d --build arcade-auth` | `docker compose build arcade-auth`、`cabal test all --test-show-details=direct` |
| `matsu-arcade-api` | `docker compose up --build arcade-api` | `npm.cmd run check`、`npm.cmd test`、`npm.cmd run build` |

Toolbox APIとArcade APIは、sourceをbind mountし、container専用の `node_modules` を使って `npm run dev` を実行するHono開発serviceです。Windows上の編集もDocker Desktop経由でhot reloadされます。Node.jsのDB integration testは、各moduleのREADMEに従って別途管理するtest databaseを指定します。Arcade AuthのCabal test-suiteも、必要な環境変数と別途管理するtest PostgreSQLを用意して実行します。

## 必要なもの

- Git
- Windowsで `sync-dev.bat` を使う場合は、標準の場所へインストールしたGit for Windows
- LinuxやCIではPOSIX互換shell

モジュール管理本体はすべて `.sh` です。Windowsの `.bat` は、ローカル開発用の `sync-dev.sh` をGit Bashで起動するだけのランチャーです。

## 最初のclone

```sh
git clone --recurse-submodules https://github.com/shu-matsukubo/matsu-workspace.git
cd matsu-workspace
sh scripts/setup.sh
```

`setup.sh` はサブモジュールを初期化し、親gitlinkが記録したcommitへ揃えます。リモートbranchの最新版を取得する処理ではありません。

親リポジトリを通常更新した後も同じです。

```sh
git pull --ff-only
sh scripts/setup.sh
```

## ローカル開発

Windowsでは `scripts\sync-dev.bat` をダブルクリックします。終了結果を確認できるよう、最後に画面を一時停止します。

ターミナルから実行する場合は次のとおりです。

```sh
sh scripts/sync-dev.sh
```

この処理は `modules.dev.conf` を読み、全モジュールを設定済みの開発branchへ切り替え、`origin` の最新版までfast-forwardします。7アプリと設計文書repoの `docs` は、すべて `develop` を追跡します。

未commit変更、未push commit、branchの分岐、想定外の作業branchが1つでもある場合は、更新前に停止します。commitやpushは自動実行しません。

開発は各子リポジトリで行います。

```sh
cd apps/matsu-front
git switch -c feature/example
# 開発、test、commit
git switch develop
git merge --ff-only feature/example
git push origin develop
```

運用に合わせてfeature branchをPull Requestで `develop` へマージしても構いません。アプリと `docs` の成果物はGitHub上で `develop` から `main` へマージし、ローカルで `main` を日常利用しません。

詳しい手順は [DEVELOPMENT.md](DEVELOPMENT.md) を参照してください。

## リリースするcommitの固定

現在の全モジュールHEADを環境へ記録する場合:

```sh
sh scripts/update-lock.sh development --from-worktree
```

特定モジュールをbranch、tag、または40桁SHAで更新する場合:

```sh
sh scripts/update-lock.sh staging apps/matsu-front v1.2.0
sh scripts/update-lock.sh staging apps/matsu-bff main
sh scripts/update-lock.sh production <module-path> <pushed-40-character-commit>
```

`update-lock.sh` は、全リポジトリがcleanであり、指定commitがoriginへpush済みのbranchまたはtagから到達できることを確認してから `modules.lock.conf` を更新します。worktreeのcheckout、commit、pushは行いません。

未使用の `staging` / `production` はlockなしで構いません。利用開始時に、その環境へ出す任意のpush済み40桁commitを固定します。環境を特定branchへ固定したり、架空SHAやplaceholderを先に追加したりしません。

最初のstaging lockは、developmentで確認した組み合わせを昇格して作れます。

```sh
sh scripts/promote-lock.sh development staging
```

staging試験に合格した組み合わせをproductionへ進めるときも、同じSHA一式をそのまま複製します。

```sh
sh scripts/promote-lock.sh staging production
```

この昇格はアプリソースの再修正ではなく、試験済みリリース情報の更新です。各環境用のSHAを手入力し直しません。

## CIからのリリース

CIはデプロイ対象環境を明示して、`.sh` を直接実行します。

```sh
sh scripts/setup.sh
sh scripts/apply-lock.sh staging
sh scripts/verify-lock.sh staging
# stagingへのbuild・deploy
```

商用の場合:

```sh
sh scripts/setup.sh
sh scripts/apply-lock.sh production
sh scripts/verify-lock.sh production
# productionへのbuild・deploy
```

タグだけではデプロイ先を一意に決められません。CIのworkflow、手動入力、または環境別jobのいずれかが `staging` / `production` を選び、その同じ値をデプロイ先と `apply-lock.sh` の引数に使います。

`apply-lock.sh` はlockの40桁SHAをfetch・検証してdetached HEADでcheckoutします。CIの使い捨てcheckoutでの利用を想定しており、失敗した場合は変更済みモジュールを開始時のcheckoutへ戻します。

## 状態確認

```sh
sh scripts/status.sh
git status
git submodule status
git diff --submodule=log
```

`status.sh` は親と全サブモジュールのbranch、commit、dirty状態に加え、各環境lockとの一致も表示します。

## 開発環境の起動

Windowsで全体を起動します。

```bat
scripts\run-matsu.bat
```

FrontまたはBFFだけの場合:

```bat
scripts\run-front-dev.bat
scripts\run-bff-dev.bat
```

新サービスを個別に起動する場合:

```bat
scripts\run-toolbox-dev.bat
scripts\run-arcade-auth-dev.bat
scripts\run-arcade-api-dev.bat
```

これらはDocker DesktopとDocker Engineの起動を待ってから、各repo固有のComposeで上表のapplication serviceを明示して起動します。依存するDB / RedisはComposeが同じproject内で起動します。`run-matsu.bat` は全application serviceをdetachedで起動するため、別windowを開かず、起動後は呼び出し元のcommand lineへ入力が戻ります。`front`、`bff`、`toolbox-api`、`arcade-api` のhot reloadはdetachedでも有効です。個別launcherは対象serviceをforegroundで起動し、ログを継続表示したい場合に使います。同じserviceを重複起動せず、親に統合Composeも作りません。

## Codex向けファイル

- ワークスペース共通指示は `AGENTS.md` に置きます。
- リポジトリ共通スキルは `.agents/skills/` に置きます。
- `.codex/` は必要になった `config.toml` などの設定専用です。
- 用途が決まっていない空設定や架空スキルは作りません。
