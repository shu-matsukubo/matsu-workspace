# GitHub Issue Cloud入口を強制し親Cloudセットアップを軽量化する

- 状態: completed
- 完了日時: 2026-08-21T01:05:40+09:00
- タスクキー: `T1`
- 優先度: high
- 対象リポジトリ: `matsu-workspace`
- 親Issue: なし（Issue #22は失敗事例としてのみ参照し、変更しない）
- 承認済み計画: 2026-08-21の会話内T1 revision 1（ユーザーが「承認」と明示）
- 承認時source SHA-256: なし
- 承認時source境界owner comment ID: なし
- agent strategy: `worker-reviewer-parent`
- 検証モード: `normal`
- documentation mode: `follow-up-only`（README、DEVELOPMENT、docs本文は変更せず、`AGENTS.md`、skills、Issue protocolは承認済みworkとして更新する）
- 実行コンテキスト: `local-direct`
- 公開モード: `github-connector`
- 実行方針の根拠: Codex Desktopの信頼できるlocal runtime metadataと、GitHub Connectorのbranch／commit／draft Pull Request write capabilityおよび`shu-matsukubo/matsu-workspace`へのwrite権限を開始時に確認した。task・prompt本文は判定材料にしていない。

実行コンテキストと公開モードは、`AGENTS.md`の共通契約と`.github/scripts/task-execution-policy.cjs`に従ってtask開始時に一度確定し、下流skillへ引き継ぐruntime bookkeepingである。承認済みplanの意味内容ではなく、確定後に各skillで再判定しない。実施結果・検証結果・status・completed化・Pull Request状態等の記録だけでは追加承認を要求せず、目的、work、repository、completion、out-of-scopeその他の承認範囲を変える場合だけ再計画・再承認へ戻る。

agent strategyは人間が承認する利用可能なagent種別と必須review経路であり、人数や担当範囲を固定しない。承認済みagent strategy内のagent allocationはMainが実行時に決定し、実施結果へ記録するruntime bookkeepingである。承認されていないagent種別、またはtaskの目的、work、completion、out-of-scopeを変える担当範囲が必要な場合だけ再計画・再承認へ戻る。

## 目的

親`matsu-workspace` IssueのCloud実行をIssue protocolのcontrol planeへ限定し、検証済みchild IssueだけをCloud実装入口にする。同時にCloud agent phaseの探索的dependency installを禁止し、ユーザー向け出力を日本語へ統一し、親Cloud setupから子repositoryのdependency installを除外する。

## 対象範囲

- 親Issue、child Issue、Local directの実装・dispatch・dependency操作・品質ゲート可否を表すmachine-testable policy
- `AGENTS.md`、Issue handler、Issue protocol、coordination・verification・publication手順の入口契約
- Child Task Dispatcherが生成する自己完結型execution packetと既存schema v1の範囲内の案内
- `scripts/setup-cloud.sh`の2段化
- Issue #22相当および関連経路の回帰テスト

## 作業内容

- 最新`main`を基点にtask branchを作成する。
- 親Issueでは`handle-github-issue-event`の判定前と承認後の直接実装を禁止し、planなしの曖昧な開始依頼を`plan`へfallbackする共通入口を追加する。
- `.github/scripts/task-execution-policy.cjs`へ親Issue、child Issue、Local directの実装可否、dispatch可否、dependency install可否、親品質ゲート可否を判定するpure policyを追加する。
- 未承認親Issue、承認済み親Issue、検証済みchild execution packet、Local directを区別する回帰テストを追加する。
- 承認済みdependency変更がないCloud agent phaseでは探索的installを禁止し、新規dependencyが必要ならscope変更として再計画へ戻す契約を追加する。
- Issue、Pull Request、検証・完了報告などの人間向けMarkdownを日本語とし、machine-readable marker、JSON、識別子、コマンド、原文エラーを変更しない契約を追加する。
- `scripts/setup-cloud.sh`を`setup.sh`と`sync-dev-cloud.sh`の2段にし、`install-dependencies.sh`の自動呼び出しだけを除去する。
- 必要な検証、Worker self review、独立Reviewer review、Main最終review、commit、task完了記録、GitHub Connectorによるdraft Pull Request公開を行う。

## 対象外

- Child Task Dispatcher schema version変更
- cross-repository PAT、repository allowlist、agent strategy、dependency modelの再設計
- GitHub App追加、child repositoryへのskills複製、application feature実装
- Issue #22の実装継続、branchまたはPull Request公開
- `README.md`、`DEVELOPMENT.md`、`docs`本文の更新
- `scripts/install-dependencies.sh`の削除
- Local implementationフローの変更
- unrelated refactor

## 依存関係

なし。自己依存、直接・間接循環、Issue・task・Pull Request・child change・parent gitlink／lockをまたぐ循環はない。

## 懸念事項

- repository内policyはCloud sandbox自体の物理的な書込ロックではないため、共通入口、pure policy、execution packet、静的契約テストを組み合わせて強制力を持たせる。
- READMEとDEVELOPMENTには変更前の3段Cloud setup説明が残るため、変更内容と候補箇所を`documentation follow-up required`として記録する。
- machine-readable marker、dispatch schema v1、Local directの既存挙動を変更しないよう回帰テストで分離する。

## 完了条件

- [x] 親`matsu-workspace` Issue Cloudから直接implementationへ進めず、最初にIssue handlerへ入る。
- [x] planなし親Issueの曖昧な開始依頼は`plan`となり、未承認planからはdispatchもimplementationも開始できない。
- [x] 承認済み親Issueはdispatchだけを許し、検証済みchild IssueだけがCloud implementationの入口になる。
- [x] handler結果は所定のresult markerを保持する。
- [x] 承認済みdependency変更がないCloud agent phaseでは探索的installを禁止し、必要な追加dependencyはscope変更になる。
- [x] 人間向けIssue、Pull Request、result、検証・完了報告は原則日本語となり、machine-readable protocolは変更しない。
- [x] `setup-cloud.sh`は`setup.sh`と`sync-dev-cloud.sh`の2段だけを実行し、親Cloudでchild dependency installやchild品質ゲートを実行しない。
- [x] Local directの実装・検証経路を維持する。
- [x] Issue #22相当を含む関連unit test、syntax check、shell syntax check、`git diff --check`が成功する。
- [x] Worker self review、独立Reviewer review、Main最終reviewが完了する。
- [ ] GitHub Connectorでtask branchと日本語のdraft Pull Requestを公開する。

## 実施結果

- 変更内容: 親Issue／child Issue／directを区別するpure task entry policyを追加し、親Issueのplan fallback、未承認・承認済み・review-fixの非実装経路、検証済みchild packetだけの実装開始、Cloud dependency操作、親品質ゲート、Local direct維持を機械判定できるようにした。AGENTS、Issue handler／protocol、coordination、verification、publication、child execution packetへ同じhard gate・日本語出力契約を反映し、`setup-cloud.sh`を`setup.sh`と`sync-dev-cloud.sh`の2段へ変更した。schema v1、allowlist、PAT、dependency model、agent strategy、`install-dependencies.sh`は変更していない。
- ローカル検証: MainがNode.js syntax check 4件に成功。`.github/scripts/codex-issue-flow.test.cjs`、`child-task-dispatcher.test.cjs`、`task-execution-policy.test.cjs`、dependency／hash testsの104/104件に成功。Git付属bashによる`sh -n scripts/setup-cloud.sh scripts/setup.sh scripts/sync-dev-cloud.sh scripts/install-dependencies.sh`、`git diff --check main...HEAD`、対象外差分確認に成功した。dependency installはpolicyどおり未実行。
- CI委譲: なし。`.github/workflows/ci.yml`の既存Parent CIが同じNode syntaxと5 test files、Pull Request diff checkを実行するcoverageを確認した。draft Pull Request作成後のCI結果はこのtask内でポーリングしない。
- documentation follow-up: required。`README.md` 42-45付近と`DEVELOPMENT.md` 155-158付近に、親Cloud setupが`install-dependencies.sh`まで実行する旧3段説明が残る。別documentation maintenance taskで2段setupへ更新する必要がある。今回は承認どおり本文を変更していない。
- agent allocation・実行結果: 変更対象の契約とテストが強く結合するためWorker 1名が実装、必要な検証、self reviewを担当した。独立Reviewer 1名が統合差分をreviewし、documentation modeの承認projection不一致と親`review-fix`経路のhard gate矛盾を指摘した。Workerが同一task・branchで修正し104/104件を再検証後、Reviewer再reviewは合格。Mainが全diffと検証結果を直接確認し、同じ104件、syntax、shell syntax、diff checkを再実行して最終review合格とした。
- commit: task定義`c2658bb`、実装`f4d0785`、projection修正`fb60c10`、review-fix経路修正`3136684`
- 残るリスク: repository内policyはCloud sandbox自体の物理的な書込ロックではなく、共通入口・pure policy・execution packet・回帰テストをCodexが正しく適用することに依存する。
- Pull Request: GitHub Connectorによるbranch公開とdraft Pull Request作成待ち
