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
|   |-- matsu-front/       # submodule
|   |-- matsu-bff/         # submodule
|   |-- matsu-api/         # submodule
|   `-- matsu-auth/        # submodule
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
    `-- modules/
        |-- lib.sh
        `-- ensure-docker.bat
```

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

この処理は `modules.dev.conf` を読み、全モジュールを設定済みの開発branchへ切り替え、`origin` の最新版までfast-forwardします。現在は4アプリが `develop`、`docs` が `main` です。

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

運用に合わせてfeature branchをPull Requestで `develop` へマージしても構いません。アプリの成果物はGitHub上で `develop` から `main` へマージし、ローカルで `main` を日常利用しません。

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
```

`update-lock.sh` は、全リポジトリがcleanであり、指定commitがoriginへpush済みのbranchまたはtagから到達できることを確認してから `modules.lock.conf` を更新します。worktreeのcheckout、commit、pushは行いません。

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

これらはDocker DesktopとDocker Engineの起動を待ってから、従来と同じ構成でサービスを起動します。

## Codex向けファイル

- ワークスペース共通指示は `AGENTS.md` に置きます。
- リポジトリ共通スキルは `.agents/skills/` に置きます。
- `.codex/` は必要になった `config.toml` などの設定専用です。
- 用途が決まっていない空設定や架空スキルは作りません。
