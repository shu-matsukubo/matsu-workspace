# Codex Cloudセットアップの集約

- 状態: completed
- 優先度: normal
- 対象リポジトリ: `matsu-workspace`
- 起点Issue: なし
- 承認済み計画: 2026-08-10 通常承認 T01
- 承認時source SHA-256: なし
- 承認時source境界owner comment ID: なし
- 検証モード: `normal`

## 目的

Codex Cloudの新規環境とキャッシュ再開環境を、リポジトリ管理の単一コマンドから、サブモジュール同期とlock fileに基づく依存関係インストールまで実行可能にする。

## 対象範囲

- 親スーパープロジェクトのCloud用セットアップentrypointと依存関係インストールscript
- `README.md` のCloud用setup／maintenanceコマンド
- `DEVELOPMENT.md` のCloud用entrypoint、委譲順、lock file判定、対応manager、fail-fast方針

## 作業内容

- `scripts/setup-cloud.sh` から `scripts/setup.sh`、`scripts/sync-dev-cloud.sh`、lock file駆動の依存関係インストールを順に委譲する
- `.gitmodules` と `scripts/modules/lib.sh` のmodule一覧を正本に、初期化済みmodule内のGit管理対象lock fileを自動検出する
- `package-lock.json` は同階層の `package.json` を確認して `npm ci`、`composer.lock` は同階層の `composer.json` を確認して `composer install --no-interaction --prefer-dist` を実行する
- lock fileなしのmoduleは明示的にskipし、manifest・command不足またはinstall失敗は対象module、project directory、処理を示して即時停止する
- 新規scriptの構文、isolated fixture、Cloud checkout、既存Frontend品質ゲート、差分境界を検証する

## 対象外

- 子リポジトリ、gitlink、`modules.lock.conf`、`modules.dev.conf`、`.gitmodules` の変更
- `scripts/setup.sh`、`scripts/sync-dev.sh`、`scripts/sync-dev-cloud.sh` の責務変更
- Frontendへの `npm run test` 追加（現行未定義のため、既存の `npm run check` と `npm run build` を検証する）
- Codex Cloud UI、runtime、internet access、allowlist、HTTP method、GitHub認証情報・secretの設定
- 未使用の言語、tool、package managerへの先行対応

## 依存関係

なし。

## 完了条件

- [x] Codex Cloudの新規環境とcache maintenanceを原則 `sh scripts/setup-cloud.sh` から実行できる
- [x] local `main` を前提にせず、既存Cloud同期scriptへ委譲する
- [x] 初期化済みmoduleのGit管理対象 `package-lock.json` と `composer.lock` を自動検出し、対応する再現可能なinstallを実行する
- [x] lock fileなしは正常skipし、manifest・command不足またはinstall失敗は対象と処理が分かるログでfail fastする
- [x] 通常のローカル開発flowと承認対象外ファイル・子リポジトリを変更しない
- [x] `sh -n`、isolated fixture、Frontend `npm run check`／`npm run build`、`git diff --check` と差分境界の確認を行う

## 実施結果

- 変更内容: `setup.sh`、`sync-dev-cloud.sh`、`install-dependencies.sh` へ順に委譲する `setup-cloud.sh` と、Git管理対象の `package-lock.json`／`composer.lock` から依存関係を再現する `install-dependencies.sh` を追加した。Cloudのsetup／maintenanceコマンドとlock file規約を `README.md`、`DEVELOPMENT.md` へ記録した。
- ローカル検証: `sh -n scripts/setup.sh scripts/sync-dev.sh scripts/sync-dev-cloud.sh scripts/install-dependencies.sh scripts/setup-cloud.sh` に成功した。local bare remoteを使うisolated fixtureで、local `main` なしのwork branchにおけるsetup→sync→installの委譲順、親branch・HEAD・indexの不変、全moduleの `origin/develop` 一致、Git管理対象lock fileだけの検出、`node_modules`／`vendor`／未追跡lockの除外、lockなしskip、manifest・command不足とinstall失敗のfail-fastを確認した。親レビューではfake `npm`／`composer` により、現行4 Node projectと1 Composer projectの実行directory・引数、および3 moduleのskipを再確認した。Frontendで `npm run check` と `npm run build`、親で `git diff --check`、対象外ファイル・gitlink・lock差分なし、全module cleanを確認した。ShellCheckは環境に未導入のため未実施。実remoteを使うdesktop E2EはGitのhost key確認ダイアログが発生した時点で中止し、認証を進めずisolated fixtureで代替した。
- CI委譲: なし
- Pull Request: `main` 向けdraft Pull Requestを作成予定
- 残るリスク: desktopから実remoteを使う `setup-cloud.sh` の完走は、対話的なGit認証を避けるため未確認。Codex Cloud上の実行はPull Request反映後に環境setup／maintenanceから確認する必要がある。
