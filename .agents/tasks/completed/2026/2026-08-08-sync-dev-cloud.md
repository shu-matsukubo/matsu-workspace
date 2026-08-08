# Codex Cloud用の開発branch同期を追加する

- 状態: completed
- 優先度: normal
- 対象リポジトリ: `matsu-workspace`
- 起点Issue: なし
- 承認済み計画: 2026-08-08の通常承認 T01
- 承認時source SHA-256: なし
- 検証モード: `normal`

## 目的

Codex Cloudのセットアップ時に、親リポジトリのbranchやHEADを変更せず、各サブモジュールを `modules.dev.conf` で定義された開発branchの最新commitへ安全に同期できる専用処理を追加する。

## 対象範囲

- `scripts/sync-dev-cloud.sh` の追加
- `README.md` と `DEVELOPMENT.md` へのCloud用セットアップ手順と安全性の説明追加
- `AGENTS.md` へのCloud同期で発生するgitlink差分の扱いの追記
- 既存共通関数を利用したサブモジュールclean検査、fetch、fast-forward、nested submodule同期
- 構文検査と一時Git fixtureによるCloud同期の動作検証

## 作業内容

- `scripts/setup.sh` 実行後の初期化済みサブモジュールを前提にする
- 親のlocal `main` を要求せず、親リポジトリでbranch切替、HEAD変更、commit、pushを行わない
- 全モジュールのclean状態、対象remote branch、detached HEADやlocal開発branchの安全性を更新前に検査する
- local-only commit、ahead、分岐、想定外branch、未commit変更を検出した場合は強制破棄せず停止する
- 安全性確認後、各モジュールを対象開発branchへ切り替え、`origin/<branch>` へfast-forwardしてnested submoduleを同期する
- Local用 `scripts/sync-dev.sh` とCloud用処理の責務を文書で分離する
- Cloud同期による未stageのgitlink差分は、明示された親統合タスク以外でcommitしないことをAI共通ルールへ記録する

## 対象外

- `scripts/setup.sh` と `scripts/sync-dev.sh` の責務変更
- `modules.dev.conf`、`.gitmodules`、`modules.lock.conf`、親gitlinkの更新
- `reset --hard` などによる変更やlocal commitの強制破棄
- Windows用batch launcherの追加
- Cloud / Local共通化のための大規模リファクタリング
- Pull Requestのmerge

## 依存関係

なし。2026-08-08時点の `origin/main` (`0030c9b37d4edcd000a52ea35c883c8f497b01fa`) から専用worktreeを作成済み。

## 完了条件

- [x] `scripts/sync-dev-cloud.sh` が追加され、local `main` なしで実行できる
- [x] 全サブモジュールが `modules.dev.conf` の開発branchに切り替わり、`origin/<branch>` の最新commitへfast-forwardされる
- [x] 未commit変更、local-only commit、ahead、分岐、想定外branchを強制破棄せず安全に停止する
- [x] 必要なnested submoduleが同期される
- [x] 親リポジトリのbranch、HEAD、index、commit履歴を変更しない
- [x] Cloud同期による未stageのgitlink差分を通常状態として扱い、明示要求なしにcommitしないことが文書化される
- [x] Local用 `scripts/sync-dev.sh`、`scripts/setup.sh`、manifest、lock、gitlinkに不要な変更がない
- [x] shell構文検査、isolated fixtureの動作検証、`git diff --check`、base差分確認が成功する
- [ ] 親レビューに合格し、`main` 向けdraft Pull Requestが作成される

## 実施結果

- 変更内容: 親checkoutを変更せず、全モジュールの安全性を事前確認してから開発branch最新へfast-forwardする `scripts/sync-dev-cloud.sh` を追加した。Local版との使い分けと、Cloud同期で生じる未stageのgitlink差分の扱いを `README.md`、`DEVELOPMENT.md`、`AGENTS.md` へ記録した。
- ローカル検証: Git Bashで `sh -n scripts/setup.sh`、`sh -n scripts/sync-dev.sh`、`sh -n scripts/sync-dev-cloud.sh` に成功した。isolated local Git fixtureでlocal `main` 不在の成功系、2モジュールとnested submoduleの同期、親branch・HEAD・index・commit履歴不変、意図したgitlink差分だけの発生、想定外branch・dirty・ahead・diverged・detached local-only commitの安全停止を確認した。`git diff --check origin/main...HEAD`、対象外ファイルとgitlinkのbase差分なし、worktree clean確認にも成功した。ShellCheckは環境に未導入のため未実施。
- CI委譲: なし
- Pull Request: 未作成（task完了commitの公開後に `main` 向けdraft Pull Requestを作成する）
- 残るリスク: 実worktreeの8サブモジュールを変更しないため実remoteに対するend-to-end同期は未実施。local bare remoteを用いた同一Git操作経路で代替検証した。
