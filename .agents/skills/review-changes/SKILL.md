---
name: review-changes
description: 承認済み要件に対する変更差分を、正しさ、回帰、境界違反、文書の事実性、検証不足の観点から重要度順にレビューする。自己レビュー、サブエージェント成果の親レビュー、Pull Request前の最終レビューで使用する。
---

# 変更をレビューする

## レビュー範囲を確定する

1. 明示されたタスクファイルから、承認済みタスク、完了条件、確認事項、対象外を読み直す。明示pathがない場合だけ対象リポジトリの `.agents/tasks/active/` を確認し、過去判断が必要でなければ `completed/` を読まない。
2. 対象までの `AGENTS.md` と関連README、設計文書を確認する。
3. `git status` とbaseからのdiffを確認し、対象外のファイルや別タスクの差分を分離する。
4. Issue駆動では承認済みrevision・plan/source hash・source境界のowner comment IDに加え、dispatch-idとchild Issue execution packetを照合する。計画、dispatch、child Issue、task file、実装差分でkey、repository、work、agent strategy、completion、dependencies、concernsが変わっていないこと、境界後または実装開始後の前提変更や承認範囲外の差分がないことを確認する。
5. task開始時に確定した実行コンテキスト、公開モード、判定根拠がtask fileまたはtrusted execution packetから下流へ引き継がれ、task・prompt本文から再判定されていないことを確認する。実施・検証結果やcompleted化等のbookkeepingだけをscope変更として扱っていないことも確認する。
6. 複数Workerを利用した場合は、承認済みagent strategy内のagent allocation、各Workerの担当範囲とself review、統合済みdiff、担当間の依存・前提を確認する。人数と担当範囲のbookkeepingをagent strategy変更として扱わず、承認外のagent種別やworkが追加されていないことを確認する。

## 重要度順に確認する

次の順で、利用者や運用へ影響する具体的な問題を探す。

1. 要件未達、誤動作、データ損失、認証・secret・権限の問題
2. サービス境界、独立リポジトリ、API契約、生成物の不整合
3. 回帰を検出できないテストや検証の不足
4. README・docs・AGENTS・skillの責務混在、事実と異なる説明、将来予定の既成事実化、通常実装taskへdocumentation本文を混ぜる境界違反、必要な`documentation follow-up required`の記録漏れ
5. 不要な複雑化、重複、認知コストを上げる記述

独立ReviewerまたはMainが複数Workerの統合差分を確認する場合は、個別実装の細部だけでなく、Worker間の契約・前提・生成物の整合、task全体の仕様充足、責務境界、重複・欠落、統合後の回帰、全体検証の不足を確認する。各Workerへの専属Reviewerは要求せず、review範囲を分ける場合も必要最小限にする。MainはReviewerの報告だけで完了判定せず、統合差分と検証結果を最終確認する。

タスクファイル自体の差分では、承認範囲が正しく固定されていること、完了時には実施結果と検証結果が事実と一致すること、task file stem、branch、Pull Requestの対応が保たれていることを確認する。同一リポジトリの実装commit SHAは必須にしない。別リポジトリの依存commitなどが記載されている場合だけ、その到達可能性と対応関係を確認する。コードやGit履歴から確認できる詳細の複製は求めない。

文書の事実は、OpenAPIが存在する契約ではOpenAPIを優先し、それ以外は実装と自動テストで確認する。CIやコマンドはworkflowとmanifestを正本にする。

Issue駆動のCI委譲では、必要なテストコードが差分に含まれること、対象workflowがそのテスト・静的解析・buildを実行すること、未実行項目が成功と記載されていないことを確認する。CI coverageがなければコード変更を合格扱いにしない。公開モードが`codex-web-ui`または`remote-stopped`ならremote publishやPull Request作成を試行していないこと、`github-connector`または`local-git-fallback`なら公開前に`publish-task-pr`の手順へ進むことも確認する。

Pull Request差し戻しのレビューでは、Pull Requestの最新review、未解決thread、inline comment、CI結果と現在コードを正本にし、同じtask・branch・Pull Requestの承認範囲内であることを確認する。解決済みまたは現在コードと一致しない古い指摘を再適用しない。

## 指摘を提示する

- 問題を先に、重要度順に提示する。
- 各指摘に対象ファイルと位置、問題が発生する条件、影響、期待する修正を含める。
- 好みだけの指摘や依頼範囲外のリファクタリング要求は行わない。
- 問題がなければ明示し、残るリスクや未実施の検証だけを伝える。

## 差し戻し後を確認する

修正diffを再確認し、指摘が解消したか、追加の回帰がないか、必要な検証が再実行されたかを確認する。新しく見つかった承認外の改善は別タスクとして提案する。
