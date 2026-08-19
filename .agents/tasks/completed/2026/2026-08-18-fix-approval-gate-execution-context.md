# 承認ゲートと実行コンテキストを整理する

- 状態: completed
- 完了日時: 2026-08-18
- タスクキー: `T1`
- 優先度: high
- 対象リポジトリ: `matsu-workspace`
- 親Issue: なし
- 承認済み計画: 2026-08-18の通常承認（会話内のT1、ユーザーの「承認」）
- 承認時source SHA-256: なし
- 承認時source境界owner comment ID: なし
- agent strategy: `worker-reviewer-parent`
- 検証モード: `normal`
- documentation mode: `explicit-update`（承認済み運用正本の更新だけを含み、README・`docs`本文は対象外）
- 実行コンテキスト: `local-direct`（Windows上のLocal workspace、local shell・Git checkoutをruntime情報として確認）
- 公開モード: `github-connector`（GitHub pluginで対象repositoryのpush権限とPull Request作成toolを開始時に確認）

実行コンテキストと公開モードは、承認済み作業の実行経路を制御するruntime bookkeepingであり、taskの目的・対象repository・作業内容・完了条件を変更しない結果記録の更新に追加承認を要求しない。

## 目的

承認済みtaskの完了記録だけで追加承認を要求しない承認モデルと、prompt本文から推測せず信頼できるruntime情報・tool capabilityから一度だけ確定して下流へ引き継ぐexecution context / publication modeを、既存のCloud / Local Issue駆動フローへ最小変更で追加する。

## 対象範囲

- `AGENTS.md`、`.agents/tasks/TEMPLATE.md`
- `plan-tasks`、`coordinate-approved-tasks`、`handle-github-issue-event`、`publish-task-pr`、`verify-changes`と、必要な既存skill・Issue protocol
- 前taskで追加されたChild Task Dispatcherのexecution packetと、今回の契約を検証する最小限のunit test・CI coverage
- 承認済みtaskのbookkeepingとscope変更を区別する共通方針、およびexecution context / publication modeの一元化された判定・引継ぎ契約

## 作業内容

- 実施結果、検証結果、CI結果、未実施検証、残るリスク、documentation follow-up、agent実行結果、Pull Request状態、commit情報、status、completed化、完了日時等を、taskの意味を変えないbookkeepingとして追加承認不要にする。
- 目的、作業内容の意味、対象repository、完了条件、対象外、新しい責務・機能、architecture判断、dependency gateの意味、未承認実装、承認済み計画を変更する場合だけ再計画・再承認へ戻す。
- `issue-cloud`、`cloud-direct`、`local-direct`、`unknown`とpublication modeを別概念として定義し、prompt本文や`@codex`文字列を判定材料にしない。
- trusted Issue event、runtime metadata、実際に提供されたtool capabilityから開始時にcontext / publicationを確定し、task planning・task creation・coordination・verification・publicationへ明示的に引き継ぐ。
- `local-direct + GitHub Connector available`はConnector公開、Cloudはremote操作なしでCodex Web UI委譲、`unknown`は実装・検証・review・commitまで許可してremote公開だけを停止する。
- 指定された承認モデル、Local prompt、execution context、publication modeの回帰ケースをunit testへ追加し、既存CIで実行する。

## 対象外

- Child Task Dispatcherの責務・配送方式の再設計
- cross-repository token、allowlist、dependency model・gateの再設計
- task schema全体、agent strategyの再設計
- README、DEVELOPMENT、`docs`等のdocumentation本文更新
- repository rename、submodule構成変更、unrelated refactor

## 依存関係

| 依存対象 | type | gate | 完了条件 | 現在状態と根拠 |
|---|---|---|---|---|
| `shu-matsukubo/matsu-workspace#19` | hard | start | 前taskのPull Requestが`main`へmerge済み | 完了。2026-08-18に`origin/main`を取得し、merge commit `ec51ab8`（PR #19）を確認 |

## 懸念事項

- Codexの全実行経路で同一のruntime metadataが提供される保証はないため、判定不能時は`unknown`へ落とし、prompt本文で補完しない必要がある。
- GitHub plugin toolの存在と対象repositoryへのwrite capabilityは別なので、Local publication前に実際のrepository permissionを確認する必要がある。
- 厳格なdispatch schemaを必要以上に変更せず、既存Issue flow、dispatcher、dependency logicの互換性を保つ必要がある。

## 完了条件

- [x] 承認済みtaskのbookkeepingだけでは追加承認を要求せず、scope・計画変更時だけ再承認へ戻る。
- [x] execution contextをtask本文や`Cloud`、`@codex`、`Codex Web`等の文字列から推測しない。
- [x] execution contextとpublication modeを一度確定し、task fileと必要な下流skillへ引き継ぐ。
- [x] `local-direct`かつGitHub Connector利用可能時はConnector経由のbranch公開・draft Pull Request作成へ進む。
- [x] `issue-cloud`と`cloud-direct`はlocal pushやConnector探索を行わずCodex Web UIへ委譲する。
- [x] `unknown`はpromptから補完せず、remote公開だけを停止する。
- [x] 指定された承認モデル、Local prompt、execution context、publication modeのunit testが追加・更新される。
- [x] 既存Issue flow、dispatcher、dependency logicの回帰テストが成功する。
- [x] self review、独立review、親reviewと必要な検証が完了する。
- [ ] Local方針に従いGitHub pluginでbranchを公開し、`main`向けdraft Pull Requestを作成する。

## 実施結果

- 変更内容: `.github/scripts/task-execution-policy.cjs`を共通の純粋policyとして追加し、承認済みbookkeepingと再承認が必要なscope変更、trusted runtime/eventからのexecution context、contextと実capabilityからのpublication modeを一元化した。task template、Issue protocol、planning・coordination・verification・review・documentation・publication関連skillへ確定済みcontextの引継ぎ契約を反映し、Child Task Dispatcherは既存v1 payload schemaを変えずtrusted child packetへ`issue-cloud / codex-web-ui`を明示するよう更新した。
- ローカル検証: `node --check` 4件成功。承認モデル・execution context・publication modeの新規policy test 9件と、既存Issue flow・dispatcher・dependency・hash test 82件の計91件がすべて成功。`git diff --check`成功。ローカルにYAML parserがなくDocker daemonも停止中のためworkflow YAML parseは未実施だが、CI workflow差分は既存syntax/test列への各1行追加に限定した。
- CI委譲: draft Pull Request公開後のGitHub Actionsにworkflow YAML解釈と同じ91 testを委譲する。結果はこのtask内でポーリングせず、現時点では成功扱いにしない。
- documentation follow-up: なし。承認範囲内の運用正本（`AGENTS.md`、task template、skills、Issue protocol）を更新済みで、README・DEVELOPMENT・`docs`本文への影響はない。
- agent実行結果: `worker-reviewer-parent`を使用。workerが実装・self review・検証を完了し、独立reviewerがLocal fallbackの完遂capability不足とその回帰テスト不足を指摘した。local pushとPull Request writeの両capabilityを必須化し、Cloud/unknownの全remote capability非探索とpush-only・PR-write-onlyを追加テストした後、独立再reviewと親reviewで指摘なしを確認した。
- commit情報: task作成`44ccc1a`、policy実装`ccacfcc`、review修正`8f6cfda`。GitHub Connector公開ではlocalとremoteのcommit SHAが異なり得るため、公開時は最終tree SHA一致を確認する。
- 残るリスク・未実施検証: workflow YAMLのローカルparseだけ未実施。GitHub Actionsが失敗した場合は同じtask・branch・Pull Requestで修正する。
- Pull Request: 未作成（次工程で`github-connector`によりbranchを公開し、`main`向けdraft Pull Requestを作成する）。
