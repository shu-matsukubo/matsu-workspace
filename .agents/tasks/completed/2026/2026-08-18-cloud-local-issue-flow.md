# GitHub Issue駆動フローをCloud / Local両対応へ再設計する

- 状態: completed
- タスクキー: `T1`
- 優先度: high
- 対象リポジトリ: `shu-matsukubo/matsu-workspace`
- 親Issue: なし
- 承認済み計画: 2026-08-18の通常承認（会話内のT1）
- 承認時source SHA-256: なし
- 承認時source境界owner comment ID: なし
- agent strategy: `worker-reviewer-parent`
- 検証モード: `normal`
- documentation mode: `explicit-update`

## 目的

親Issueをcontrol planeとするGitHub Issue駆動フローを、Codex Cloudの実行・公開制約とLocal実行時のGitHub公開能力の両方に整合させる。承認済みtaskを再分解せず、GitHub Actionsが信頼境界と冪等性を保って子repositoryへ自己完結したIssueとして配送できる構成へ変更する。

## 対象範囲

- `AGENTS.md` の高レベルなCloud / Local、承認、repository、documentation方針
- `.agents/tasks/TEMPLATE.md` の統一task schema
- `plan-tasks`、`coordinate-approved-tasks`、`handle-github-issue-event`、`publish-task-pr`、`review-changes`、`verify-changes`、`update-documentation` skillsとIssue protocol
- `.github/scripts/codex-issue-flow.cjs` と既存テストのdispatch状態連携
- 本番用Child Task Dispatcher workflow、script、unit test
- `.github/workflows/ci.yml` の品質ゲート
- 本タスクのtask file

## 作業内容

- task schemaへkey、agent strategy、親Issue、承認済みplan、懸念事項を追加し、plan、dispatch、child Issue、task fileを同一承認内容のprojectionとして扱う。
- Cloud親Issueでは `plan -> revise / answer -> approval -> dispatch` と遷移し、承認後にsubmodule実装へ直接進まないようprotocolとskillsを整理する。
- 1件のCodex result comment内へ、version付きの厳格なmachine-readable task payloadと人間向け表示を複数格納できるdispatch形式を定義する。
- trusted Codex bot、親repository、承認済みplan識別情報、marker形式、task schema、明示的allowlistを検証するChild Task Dispatcherを追加する。
- 現在の8つの子repositoryだけをallowlistとし、`.gitmodules` の旧repository名を配送先の正本にしない。
- 親repository、親Issue番号、task key、plan revisionから一意なdispatch IDを再計算し、既存子Issueのmachine-readable markerを検索して重複作成を防ぐ。
- partial failure後のrerunでは作成済みIssueを再利用し、未作成taskだけを処理する。
- 子Issueを自己完結したexecution packetとして生成し、自動 `@codex` は行わない。
- 親Issueへtaskと子Issueの対応を冪等な追跡コメントとして作成または更新する。
- Cloudではcommitと完了報告まででremote publishを試行せず、LocalではGitHub pluginを優先してdraft Pull Requestを公開するようskillsを分離する。
- 通常実装ではdocumentation本文を変更せず、必要な影響をfollow-upとして記録する方針へ整理する。
- parse、trust boundary、allowlist、冪等性、partial failure、dependency保持、secret未設定をunit testし、既存Issue Flow、hash、依存解析を回帰確認する。

## 対象外

- Codex CloudへのPAT、Git credential、GitHub loginの追加
- Cloudからの `git push`、remote branch公開、Pull Request作成
- child Issueへの自動 `@codex` メンション
- Pull Requestの自動merge
- GitHub Appの新規作成
- README、DEVELOPMENT、`docs`を含むdocumentation本文の更新
- 全child repositoryへのskills複製
- repository renameと `.gitmodules` の旧URL修正
- PoC workflowの削除（本番workflowのdefault branch反映後の実地確認までは保持する）
- unrelated refactor

## 依存関係

| 依存対象 | type | gate | 完了条件 | 現在状態と根拠 |
|---|---|---|---|---|
| `shu-matsukubo/matsu-workspace#18` | hard | start | cross-repository Issue作成PoCが`main`へmerge済み | merged、2026-08-17、https://github.com/shu-matsukubo/matsu-workspace/pull/18 |

循環依存はなく、開始を止める未完了dependencyはない。

## 懸念事項

- 現在の `CROSS_REPO_ISSUE_TOKEN` はPoC時点で `matsu-front` のみに限定されている。ほかのallowlist repositoryへ配送する前に、ユーザー側で対象repositoryを追加する必要がある。
- `.gitmodules` には `matsu-front`、`matsu-bff`、`matsu-api`、`matsu-auth` の旧repository名が残るが、本タスクでは変更せず、dispatcherのallowlistへGitHub上の現行名を明示する。
- READMEとDEVELOPMENTには旧フローの説明が残るため、実装結果へ `documentation follow-up required` として影響箇所を記録する。
- PoC workflowは本番dispatcherのdefault branch反映後の実地確認までは残し、不要化後の削除をfollow-upとする。

## 完了条件

- [x] Cloud親Issueでは承認後に直接submodule実装へ進まず、承認済みtaskをdispatch blockへ変換する。
- [x] 1件のresult commentから `1 task block = 1 child Issue` として配送できる。
- [x] trusted Codex bot、承認済みplan識別情報、厳格なmarker、allowlistを検証する。
- [x] 同一dispatch IDのrerunとpartial failureで子Issueが重複しない。
- [x] 子Issueが自己完結したexecution packetで、自動 `@codex` を含まない。
- [x] 親Issueからtaskと子Issueの対応を追跡できる。
- [x] dependencyの現在状態をGitHubから再取得し、hard、soft、orderingと各gateを維持する。
- [x] taskごとのagent strategyを計画・dispatch・実装で維持する。
- [x] Cloudではremote publishを試行せず、LocalではGitHub plugin経由の公開を維持する。
- [x] documentation impactを通常実装へ混ぜずfollow-upとして記録する。
- [x] tokenやsecretをログ、Issue本文、repositoryへ露出しない。
- [x] 指定されたdispatcher testsと既存Issue Flow、dependency、hash testsが成功する。
- [x] workflow YAML、skill構成、`git diff --check`を検証し、実装担当・独立reviewer・親agentのレビューが完了する。

## 実施結果

- 変更内容: version 1の厳格なJSON dispatch block、8 repository allowlist、承認時系列・plan identity検証、owner作成Issueのdispatch markerによる冪等再利用、partial failure、token未設定・prepare失敗の親tracking、stale runのstate上書き防止を備えたChild Task Dispatcherを追加した。既存Issue Flowへ`tasks-dispatched`と`Codex:子タスク確認待ち`を連携し、task schema、Cloud / Local公開、agent strategy、dependency、documentation modeをAGENTS、skills、protocol、templateへ反映した。
- ローカル検証: `node --check` 4ファイル成功。Issue Flow、dispatcher、dependency、hashの統合Node testは82/82成功。workflow raw-text test、skill metadata test、`git diff --check`、新規3ファイルの末尾空白検査、対象外ファイル不変確認に成功。専用YAML parser / actionlintはローカル環境にないため未実施で、workflowの目視確認とraw-text unit test、追加したCI coverageで代替した。
- CI委譲: なし。`.github/workflows/ci.yml`へdispatcherのsyntax checkとunit testを追加したが、本taskではremoteへ公開せずCI結果待ちも行っていない。
- documentation follow-up: README、DEVELOPMENTの旧Issueフロー説明をCloud / Local分離へ更新する。`CROSS_REPO_ISSUE_TOKEN`をallowlist 8 repositoryの`Issues: Read and write`へ設定する運用を記載する。本番dispatcherのdefault branch反映・実地確認後にPoC workflow削除を別taskで判断する。
- Pull Request: 未作成。Cloud方針に従いpushとremote publishを試行せず、Codex Web UIからの公開へ委譲する。
