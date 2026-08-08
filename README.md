# matsuワークスペース

`matsu-workspace` は、matsuを構成するアプリケーションと設計文書をGitサブモジュールとしてまとめるスーパープロジェクトです。各モジュールは独立したリポジトリとして開発し、親リポジトリは開発時とリリース時の組み合わせを管理します。

## 必要なもの

- Git
- Docker DesktopまたはDocker Engine
- WindowsではGit for Windows（Git Bashを含む）
- LinuxやCIではPOSIX互換shell

言語ランタイムなど、各モジュール固有の要件は対象モジュールのREADMEを確認してください。

## セットアップ

```sh
git clone --recurse-submodules https://github.com/shu-matsukubo/matsu-workspace.git
cd matsu-workspace
sh scripts/setup.sh
```

`setup.sh` はサブモジュールを初期化し、親リポジトリが記録したcommitへ揃えます。通常の `git pull` 後にも実行してください。

```sh
git pull --ff-only
sh scripts/setup.sh
```

ローカル開発では、親ワークスペースを `main`、各モジュールを開発branchの最新版へ切り替えるため、親の通常ファイルに変更がなく、各モジュールがcleanであることを確認して次を実行します。

```sh
sh scripts/sync-dev.sh
```

Windowsでは `scripts\sync-dev.bat` から同じ処理を実行できます。

親ではlocal `main` の存在と、現在branchの `.gitmodules` および `modules.dev.conf` がlocal `main` と一致することを確認してから `main` へ切り替えます。親のfetchやfast-forwardは行いません。子モジュールに未commit変更、未push commit、分岐、または想定外branchがある場合もbranch切替前に停止します。

Codex Cloudでは、環境セットアップに次を指定します。

```sh
sh scripts/setup.sh
sh scripts/sync-dev-cloud.sh
```

`sync-dev-cloud.sh` は親のlocal `main` を要求せず、親のbranch、HEAD、indexを変更しません。初期化済みの各モジュールがcleanで、local-only commit、分岐、または想定外branchがないことを全件確認してから、`modules.dev.conf` の開発branchへ切り替え、`origin` の最新版までfast-forwardします。nested submoduleも同期します。親gitlinkとの差分はCloud作業環境を開発branchの最新へ合わせた意図した状態であり、明示された親統合タスクでない限りcommitしません。

## 開発環境の起動

Windowsで全アプリケーションを起動します。

```bat
scripts\run-matsu.bat
```

対象だけを起動する場合は、次のランチャーを使います。

```bat
scripts\run-front-dev.bat
scripts\run-bff-dev.bat
scripts\run-toolbox-dev.bat
scripts\run-arcade-auth-dev.bat
scripts\run-arcade-api-dev.bat
```

APIまたはAuthだけを起動する方法や、停止方法、環境変数、品質確認コマンドは各モジュールのREADMEを参照してください。通常の停止でnamed volumeを削除しないでください。

## 状態確認

```sh
sh scripts/status.sh
```

必要に応じてGitの状態も確認します。

```sh
git status
git submodule status
git diff --submodule=log
```

## モジュール

| モジュール | 責務 | ローカルURL |
|---|---|---|
| [matsu-front](apps/matsu-front/README.md) | ブラウザ向けフロントエンド | `http://localhost:5173` |
| [matsu-bff](apps/matsu-bff/README.md) | ブラウザセッション境界とAPI gateway | `http://localhost:18082` |
| [matsu-api](apps/matsu-api/README.md) | 家計簿ドメインAPI | `http://localhost:18080/api` |
| [matsu-auth](apps/matsu-auth/README.md) | 家計簿・Toolbox向け認証サーバー | `http://localhost:18081` |
| [matsu-toolbox-api](apps/matsu-toolbox-api/README.md) | note、bookmark、text inspection API | `http://localhost:18083` |
| [matsu-arcade-auth](apps/matsu-arcade-auth/README.md) | Arcade専用認証サーバー | `http://localhost:18084` |
| [matsu-arcade-api](apps/matsu-arcade-api/README.md) | Arcade resource server | `http://localhost:18085` |
| [docs](docs/README.md) | 横断アーキテクチャ・技術文書 | - |

ブラウザはBFFだけを呼びます。サービス境界、認証、API、CIなどの設計判断は [docs](docs/README.md) を正本とします。

## 開発時の入口

- タスクのbranch、Pull Request、サブモジュール、lock、リリースの手順: [DEVELOPMENT.md](DEVELOPMENT.md)
- AIが毎回守る共通ルール: [AGENTS.md](AGENTS.md)
- 各アプリのセットアップ、起動、テスト: 上表の各README
- システム全体の設計: [docs/README.md](docs/README.md)

日常の作業は、対象の子リポジトリでbranchを作成し、実装と検証を完結させます。親リポジトリのgitlinkや `modules.lock.conf` は、子リポジトリの変更が承認・mergeされた後に別タスクとして更新します。

## GitHub IssueからCodexへ依頼する

親`matsu-workspace`のIssueを作業依頼と状態管理の正本にできます。Issueを作成した後、repository ownerが`@codex`付きの自然言語コメントでタスク分解を依頼します。質問への回答、計画の差し戻し、実装開始、Pull Requestレビュー修正も同じ方法で伝えます。Actions botによるメンションやコマンド用ラベルは使用しません。

CodexはIssue全体と現在状態からコメントの意味を判断します。「タスク分解お願いします」では実装せず、最新計画に対する明確な実装開始意思があり、前提・依存・CIを再確認できた場合だけ実装します。実装開始と要件変更を同じコメントで依頼した場合は、計画を更新して再承認を待ちます。

`Codex:処理中`、`Codex:回答待ち`、`Codex:承認待ち`、`Codex:依存待ち`、`Codex:要判断`、`Codex:PR作成済`は現在状態を示すActions管理ラベルです。Pull Requestはdraftで作成され、自動mergeされません。詳細な状態遷移、依存関係、再開方法、受け入れ試験は [DEVELOPMENT.md](DEVELOPMENT.md#github-issue駆動のcodexフロー) を確認してください。
