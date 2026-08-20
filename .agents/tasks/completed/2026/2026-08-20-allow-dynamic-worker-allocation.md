# 承認済みエージェント種別内で動的配員を可能にする

- 状態: completed
- 完了日時: 2026-08-20
- タスクキー: `T1`
- 優先度: normal
- 対象リポジトリ: `matsu-workspace`
- 親Issue: なし
- 承認済み計画: 2026-08-20の通常承認（会話内のT1、ユーザーの「承認」）
- 承認時source SHA-256: なし
- 承認時source境界owner comment ID: なし
- agent strategy: `worker-reviewer-parent`
- 検証モード: `normal`
- documentation mode: `explicit-update`（承認済みのAI運用正本とIssue execution packetだけを更新する）
- 実行コンテキスト: `local-direct`
- 公開モード: `github-connector`
- 実行方針の根拠: Windows上のLocal workspace、local shell、Git checkoutをtrusted runtime metadataとして確認し、GitHub Connectorの対象repositoryへのadmin権限とPull Request操作toolを確認した。

実行コンテキストと公開モードは、`AGENTS.md`の共通契約と`.github/scripts/task-execution-policy.cjs`に従って開始時に確定したruntime bookkeepingである。承認されたagent strategyは利用するagent種別を固定し、その範囲内の人数、担当範囲、並列化はMainが実行時に決定する。

## 目的

人間がtask開始前に承認したagent種別を維持しながら、Mainが責務境界、依存関係、変更競合、統合コストを評価し、必要最小限のWorker数とReviewerの担当方法を決定できるようにする。

## 対象範囲

- `AGENTS.md`の共通agent strategy契約
- `plan-tasks`、`coordinate-approved-tasks`、`review-changes`の責務分担
- task template、Issue protocol、Child Task Dispatcherのexecution packet
- task execution policyのbookkeeping分類と関連unit test

## 作業内容

- agent strategyを固定人数ではなく、人間が承認するagent種別と必須review経路として定義する。
- Worker利用strategyでは、Mainが独立性、依存、変更競合、統合コストから1人以上の必要最小限のWorker数と担当範囲を決める。
- 行数やtask規模だけを人数決定の基準にせず、小さいtaskの過剰分割、強く依存する作業、同一ファイルの大幅な競合変更を避ける。
- 各Workerの担当範囲のself reviewを維持し、Mainが全成果の統合と最終reviewに責任を持つ。
- Reviewer利用strategyではWorkerごとの専属Reviewerを要求せず、統合差分、Worker間整合、仕様充足、責務境界、統合後の検証を確認できるようにする。
- 承認済みagent種別内の人数と担当割当をruntime bookkeepingとして扱い、agent strategyやtask scopeを変えない限り追加承認を要求しない。
- LocalとIssue駆動で同じ意味を保ち、既存agent strategy enumとdispatch schema v1を維持する。

## 対象外

- agent strategy名またはenumの変更
- Worker数、Reviewer数、担当範囲をdispatch schemaの承認fieldとして追加すること
- 配員専用の新しいSkillを追加すること
- Workerごとの専属Reviewerまたは多段review階層を導入すること
- README、DEVELOPMENT、横断`docs`、子repositoryの変更
- 行数や固定値に基づく配員ルールエンジンの導入

## 依存関係

| 依存対象 | type | gate | 完了条件 | 現在状態と根拠 |
|---|---|---|---|---|
| `shu-matsukubo/matsu-workspace#20` | hard | start | 承認ゲートと実行コンテキストの先行変更が`main`へmerge済み | 完了。2026-08-20にGitHub Connectorでmerged状態とmerge commit `41937c3`を確認し、local `main`をfast-forwardした。 |

## 懸念事項

- 実行時の担当分割と、承認済みtaskの再分解を混同しない必要がある。
- agent strategyを単なる任意利用へ弱めず、既存のWorker self review、独立Reviewer、Main最終reviewの経路を維持する必要がある。
- Cloud child Issueは親workspaceのlocal Skillを前提にできないため、execution packetにも必要な配員・統合原則を自己完結して含める必要がある。
- 配員詳細を厳格schemaへ追加せず、既存Issue flowとの互換性を保つ必要がある。

## 完了条件

- [x] `parent-only`、`worker-parent-review`、`worker-reviewer-parent`の既存enumと人間による事前承認フローが維持される。
- [x] Worker利用strategyで、Mainが固定値や行数ではなく責務境界、依存、競合、統合コストから必要最小限のWorker数を決定できる。
- [x] Worker間で同一ファイルの大幅変更、強い依存、過剰分割を避け、各Workerのself reviewとMainの統合責任が明記される。
- [x] Reviewerが専属配置を前提とせず、統合差分、Worker間整合、task全体の仕様充足、責務境界、統合後の問題を確認する。
- [x] 承認済みagent種別内の人数と担当割当がruntime bookkeepingとして扱われ、agent strategy変更と区別される。
- [x] Child Issue execution packetが同じ意味を自己完結して伝え、dispatch schema v1を変更しない。
- [x] 関連unit test、Node.js syntax check、`git diff --check`が成功する。
- [x] 各Workerのself review、独立Reviewerの統合review、Mainの最終reviewが完了する。

## 実施結果

- 変更内容: agent strategyを人間が承認するagent種別と必須review経路として維持し、`coordinate-approved-tasks`へ責務境界・独立性・依存・変更競合・統合コストに基づく必要最小限の配員判断を追加した。各Workerのself review、Reviewerの統合観点、Mainの統合・最終review責任をAGENTS、planning・coordination・review Skill、task template、Issue protocolへ反映した。`agentAllocation`をruntime bookkeepingへ追加し、Child Task Dispatcherの自己完結packetと回帰testを更新した。新Skill、agent strategy enum、dispatch schema v1は変更していない。
- ローカル検証: Node.js syntax check 4件成功。Issue flow、Child Task Dispatcher、task execution policy、dependency、hashのunit testは92/92件成功。Reviewer指摘修正後もdispatcher syntax、同じ92 test、`git diff --check`が成功した。
- CI委譲: draft Pull Request公開後、既存Parent CIの同じsyntax check、unit test、whitespace checkへ委譲する。現時点では未実行であり、同じCodex task内ではポーリングしない。
- documentation follow-up: なし。承認範囲内の運用正本である`AGENTS.md`、既存Skill、task template、Issue protocolを更新し、README、DEVELOPMENT、横断`docs`、子repositoryへの影響はない。
- agent allocation・実行結果: Main 1名、Workerは同時1名の必要最小構成、独立Reviewer 1名を選択した。意味契約とpacket/testの結合が強く変更規模も小さいため複数Workerへ並列分割しなかった。初期Workerが`AGENTS.md`を実装し、ツール適用停滞後に交代Workerへ順次引き継いだが追加の実装差分はなく、Mainが残りを統合した。初期Workerは担当した`AGENTS.md`をself reviewしてfindingsなし。独立Reviewerは統合packetのreview順序逆転を1件指摘し、Mainが「Worker self review → Main統合 → Reviewerが統合差分review → Main最終review」へ修正して順序testを追加した。独立再reviewとMain最終reviewはfindingsなし。
- commit情報: task作成 `ab31c8a`、実装 `85df5df`。
- 残るリスク・未実施検証: 配員契約は文言・policy unit testで検証しており、実際の複数Worker配員と統合を通すE2E testはない。AI運用判断のため固定的な自動化は追加していない。
- Pull Request: 未作成（task完了commit後、GitHub Connectorで`main`向けdraft Pull Requestを公開する）
