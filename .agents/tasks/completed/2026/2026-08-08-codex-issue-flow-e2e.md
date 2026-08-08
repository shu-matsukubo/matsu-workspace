# GitHub Issue駆動Codexフローの実地受け入れ試験

- 状態: completed
- 優先度: normal
- 対象リポジトリ: `matsu-workspace`
- 起点Issue: `shu-matsukubo/matsu-workspace#10`（https://github.com/shu-matsukubo/matsu-workspace/issues/10）
- 承認済み計画: 2026-08-08のユーザー承認（推奨案、確認事項1〜6、T01〜T04）およびT03/T04続行指示
- 承認時source SHA-256: なし（通常承認）
- 検証モード: `normal`

## 目的

default branchへ反映済みのGitHub Issue駆動Codexフローについて、Actionsが`GITHUB_TOKEN`で投稿する`@codex`コメントから実際のCodexタスクが起動し、結果コメントと状態ラベルが同期されることを実地確認する。

## 対象範囲

- 親`matsu-workspace`に専用の受け入れ試験Issueを作成する
- `issues.opened`からActions dispatch、Codex result、状態ラベル同期までの証跡を確認する
- actor、dispatch/result marker、hash、revision、重複実行の有無を確認する
- 試験結果をこのtask fileへ記録し、試験Issueをcloseする

## 作業内容

- 実装を要求しない自己完結した試験Issueをrepository ownerとして作成する
- Actionsが`github-actions[bot]`として投稿したdispatch marker付き`@codex`コメントを確認する
- そのコメントから`chatgpt-codex-connector[bot]`のCodexタスクが起動し、result marker付きの質問または計画を返すことを確認する
- handled dispatch key、source/plan hash形式、revision、author login/id/type、状態ラベル、同一dispatchの重複有無を照合する
- 最大10分程度の有界確認とし、secret、PAT、追加認証を導入しない

## 対象外

- アプリケーションコード、workflow、skill、文書の変更
- 承認ラベルを付けた実装フローの開始
- Pull Requestのmerge
- secret、personal access token、追加認証情報の作成
- 無期限のActionsまたはCodex結果ポーリング

## 依存関係

| 依存対象 | type | gate | 完了条件 | 現在状態と根拠 |
|---|---|---|---|---|
| `shu-matsukubo/matsu-workspace` Pull Request #8 | hard | start | Issue workflowを含むPull Requestが`main`へmerge済み | merged、merge commit `833dd05809215c68619b6385921cf586dd6d3afc`（2026-08-08にGitHub上の現在状態を確認） |

## 完了条件

- [x] 専用試験IssueのURL、番号、作成者を記録している
- [x] Actions dispatchコメントのauthorとmarkerを確認している
- [x] Actions投稿の`@codex`からCodex resultが返るかを実地確認している
- [x] dispatch/result marker、hash、revision、状態ラベル、重複有無を照合している
- [x] 起動不能時に認証情報を追加せず、原因と安全な代替を記録している
- [x] 試験Issueをcloseしている
- [x] 自己レビューでアプリコードとworkflowに変更がないことを確認している

## 実施結果

- 変更内容:
  - 受け入れ試験Issue #10を2026-08-08 09:51:45Zにrepository owner `shu-matsukubo`（id `170013127`、type `User`）として作成した。
  - Issue #10を2026-08-08 10:02:33Zに`completed`理由でcloseした。ファイル、branch、Pull Request、secret、PATはIssue処理側から変更されていない。
  - 結論は**受け入れ失敗**。Actionsによるdispatch作成までは成功したが、その`@codex`からCodex resultが返ることを確認できなかった。
- Actions証跡:
  - workflow run: `Codex Issue Flow` run `31251505323`（https://github.com/shu-matsukubo/matsu-workspace/actions/runs/31251505323）
  - run状態: `completed/success`、event `issues`、2026-08-08 09:51:47Z開始、09:52:01Z完了、head `833dd05809215c68619b6385921cf586dd6d3afc`
  - 起動actor: `shu-matsukubo`（id `170013127`、type `User`）
  - job: `dispatch-or-sync` id `93088479331`。checkoutと`Dispatch Codex or synchronize state`を含む全stepが成功した。
  - job logで`GITHUB_TOKEN`権限が`Contents: read`、`Issues: write`、`Metadata: read`、secret sourceが`Actions`であることを確認した。
- dispatch照合:
  - comment: https://github.com/shu-matsukubo/matsu-workspace/issues/10#issuecomment-5225590407
  - author: `github-actions[bot]`（id `41898282`、type `Bot`）、作成時刻2026-08-08 09:51:57Z
  - marker: `dispatch-key=b1d3a03a23d09fbd00b7d972930c8b4c4582032fa5583585a6c0d02711c6d540`、`event=opened`
  - `@codex`を含む同dispatch commentは1件だけで、重複はなかった。
- result・状態照合:
  - 2026-08-08 09:51:45Zから10:02:18Zまで約10分33秒の有界確認を行った。
  - `chatgpt-codex-connector[bot]`（期待id `199175422`、type `Bot`）のresult commentは0件、Actions commentへのreactionも0件だった。
  - result markerが存在しないため、`handled-dispatch-key`、`source-sha256`、`plan-sha256`、`revision`は照合不能であり、成功扱いにしていない。
  - 状態ラベルは全期間を通して`Codex:処理中`の1個だけで、resultに対応する状態への同期は行われなかった。close後も同ラベルが残っている。
- 原因の切り分けと安全な代替:
  - Actions run、dispatch step、`GITHUB_TOKEN`投稿、actor/markerはすべて正常であり、失敗境界はActions botのmention投稿後からCodex connectorの受理前にある。
  - 同repositoryのIssue #6では、ownerの手動`@codex` comment（https://github.com/shu-matsukubo/matsu-workspace/issues/6#issuecomment-5199266175、2026-08-06 01:13:43Z）に対し、`chatgpt-codex-connector[bot]`（id `199175422`、type `Bot`）が6秒後に応答しているため、Codex Appの導入とowner手動mention経路は有効だった。
  - Codex側のwebhook delivery、installation/mention policy、実行キューは今回取得できず、プラットフォーム側の正確な拒否理由は断定しない。
  - 安全な代替は、repository ownerがIssueへ手動で`@codex`を投稿して起動すること。実行前にCodex environmentとusage limitを確認する。secret、PAT、追加認証は導入しない。
- ローカル検証:
  - `git diff --check`: 成功
  - `main...HEAD`の差分確認: task fileのみ
  - アプリケーションコード、workflow、skill、文書に差分がないことを確認
- 親レビュー: 2026-08-08にIssue #10の最終状態、Actions run/job、dispatch comment、Codex result不在、対照Issue #6、差分境界と検証記録を再取得して確認し、指摘なし。
- CI委譲: なし。外部受け入れ試験であり、コード変更もない。
- Pull Request: 未作成（親エージェントが親レビュー後に同task branchからdraft Pull Requestを作成する）
- 残るリスク:
  - Actions bot投稿をCodex connectorが受理しない正確なプラットフォーム条件は未確定。
  - resultがない場合に`Codex:処理中`が残留するため、現状はownerによる手動起動と状態確認が必要。
