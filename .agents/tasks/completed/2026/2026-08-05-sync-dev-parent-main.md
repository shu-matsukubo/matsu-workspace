# sync-devで親ワークスペースをmainへ戻す

- 状態: completed
- 優先度: normal
- 対象リポジトリ: `matsu-workspace`
- 依存タスク: なし

## 目的

`scripts/sync-dev.bat` または `scripts/sync-dev.sh` による開発branch同期が正常終了したとき、親ワークスペースを `main`、各子モジュールを設定された開発branchへ揃える。

## 対象範囲

- `scripts/sync-dev.sh` の親 `main` 切替処理
- `scripts/sync-dev.bat` の正常完了メッセージ
- `README.md` と `DEVELOPMENT.md` の同期動作説明

## 作業内容

- 親と全子モジュールのclean検査および全モジュールの更新可否事前確認後、実変更フェーズの先頭で親を `main` へ切り替える
- module preflight前に親のlocal `main` が存在し、現在branchの `.gitmodules` と `modules.dev.conf` がlocal `main` と一致することを検証する
- 子モジュールを `modules.dev.conf` の開発branchへ揃える既存処理と安全策を維持する
- Git Bashからの直接実行とWindowsランチャーからの実行で同じ結果になるようにする
- 利用者向け文書とWindowsランチャーの正常完了メッセージを実装に合わせる

## 対象外

- 親ワークスペースのfetch、fast-forward、commit、push
- 子モジュールの同期方法や `modules.dev.conf` の変更
- サブモジュールgitlinkまたは `modules.lock.conf` の更新
- 実際の `sync-dev` 実行（branch切替とnetwork fetchを伴うため、構文・差分確認で検証する）
- push、Pull Request作成、merge

## 完了条件

- [x] 正常終了時に親ワークスペースが `main`、子モジュールが各開発branchになる
- [x] dirtyな親または子がある場合、いずれのbranchも切り替える前に停止する
- [x] 親 `main` が存在しない場合、branch切替前に停止する
- [x] 現在branchとlocal `main` で `.gitmodules` または `modules.dev.conf` が異なる場合、module preflight前かつbranch切替前に停止する
- [x] 同期処理がcommitまたはpushを行わず、親のfetchとfast-forwardも行わない
- [x] `README.md` と `DEVELOPMENT.md` が実装と一致する
- [x] `sh -n scripts/sync-dev.sh`、`git diff --check`、statusおよびbase差分確認が成功する

## 実施結果

- 変更内容: 全preflight後に親を `main` へ切り替える処理と、local `main` および同期定義の事前検査を追加した。Windowsランチャーの完了表示と利用者向け文書も実装に合わせて更新した。
- 検証結果: `sh -n scripts/sync-dev.sh`、`git diff --check`、`git diff --check main...HEAD`、statusおよびbase差分確認に成功した。サブモジュールgitlinkと `modules.lock.conf` に差分がないことを確認し、親レビューに合格した。
- 残るリスク: 実際の `sync-dev` 実行はbranch切替とnetwork fetchを伴うため対象外として未実施であり、end-to-end動作は未確認。
