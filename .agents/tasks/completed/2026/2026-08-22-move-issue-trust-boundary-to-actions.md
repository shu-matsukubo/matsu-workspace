# GitHub Issue Flowのtrust boundaryをActionsへ移す

- 状態: completed
- 完了日: 2026-08-22
- タスクキー: `T1`
- 優先度: high
- 対象リポジトリ: `shu-matsukubo/matsu-workspace`
- 親Issue: なし（Local directの通常承認。Issue #24はE2E回帰根拠として参照）
- 承認済み計画: 2026-08-22の会話内で提示したT1をユーザーが「T1承認」と明示承認
- 承認時source SHA-256: なし
- 承認時source境界owner comment ID: なし
- agent strategy: `worker-reviewer-parent`
- 検証モード: `normal`
- documentation mode: `explicit-update`
- 実行コンテキスト: `local-direct`
- 公開モード: `github-connector`
- 実行方針の根拠: Codex desktopが提供したローカルworkspace、shell、filesystemのruntime metadataからLocal実行を確定した。利用可能toolを確認し、GitHub Connectorにbranch、commit、Pull Requestのwrite capabilityがあるため`github-connector`とした。task本文中のCloud、Issue、`@codex`等の文字列は判定根拠に使用していない。

実行コンテキストと公開モードは、`AGENTS.md`の共通契約と`.github/scripts/task-execution-policy.cjs`に従ってtask開始時に一度確定し、下流skillへ引き継ぐruntime bookkeepingである。承認済みplanの意味内容ではなく、確定後に各skillで再判定しない。これらを含む実施結果・検証結果・status・completed化・Pull Request状態等の記録だけでは追加承認を要求せず、目的、work、repository、completion、out-of-scopeその他の承認範囲を変える場合だけ再計画・再承認へ戻る。

agent strategyは人間が承認する利用可能なagent種別と必須review経路であり、人数や担当範囲を固定しない。承認済みagent strategy内のagent allocationはMainが実行時に決定し、実施結果へ記録するruntime bookkeepingである。承認されていないagent種別、またはtaskの目的、work、completion、out-of-scopeを変える担当範囲が必要な場合だけ再計画・再承認へ戻る。

## 目的

GitHub Actionsを親Issue control-planeのtrust boundaryとし、native Codex runtimeにIssue番号、comment ID、author metadata等がない正常ケースでも、Codexが非破壊なplan候補を生成できるようにする。owner、Issue / Pull Request、revision、hash、processed state、approval、dispatchはGitHub Actionsのverified stateで確定し、親Issueから直接implementationしないhard gateとChild Task Dispatcherのsecurity boundaryを維持する。

## 対象範囲

- 親`matsu-workspace`のIssue Flow workflow、Actions script、task execution policy、Child Task Dispatcherとtests
- GitHub Actions管理のauthoritative state、revision、source / plan hash、processed owner comment、approval検証
- GitHub metadataを含まないCodex semantic resultとplan task候補schema
- metadata不足時のplan-only gateとIssue / Pull Requestの`unknown`扱い
- owner専用のActions承認command `/codex approve`と承認済みplanの直接projection
- `AGENTS.md`、`handle-github-issue-event`、`plan-tasks`、Issue protocolの責務契約更新
- Issue #24相当を含む指定7ケースの回帰test

## 作業内容

- native Codex runtimeのGitHub metadata不足をerrorの十分条件にせず、利用可能な要件からplan候補を生成する非破壊経路を追加する。
- 未検証integration contextではevent typeを推測せず`unknown`として扱い、implementation、approval確定、dispatch、revision/hash確定、processed state確定を禁止するpure policyを実装する。
- Codex resultを意味結果とtask候補へ限定し、Issue番号、comment ID、author判定、authoritative revision/hashを要求しないmachine-readable contractへ分離する。
- Actionsが`issue_comment.created` payloadと再取得したIssue、comments、labelsからIssue / Pull Request、repository owner、trusted Codex bot、最新plan、source境界、processed stateを検証する。
- Actions authorのmachine-readable state comment等を用い、revision、source / plan SHA-256、plan comment ID、source / handled owner comment ID、stateを冪等に保持する。
- repository ownerのexact command `/codex approve`だけをapprovalとして受理し、最新authoritative plan、hash、時系列、未処理状態を再検証して、Codexへ再計画させずChild Task Dispatcherへ投影する。
- 差し戻しはownerの`@codex`コメントからnative Codexへ意味判断を委譲し、次のplan候補に対するrevisionとGitHub metadataはActionsが確定する。
- candidate taskへActionsがparent Issue、approved plan、dispatch-id、runtime bookkeepingを付与し、既存child Issue execution packetへ変換する。
- Actions stateとDispatcherのrerun、partial failure、同一owner comment、同一revision、同一dispatch-idの冪等性を維持する。
- 人間向けのplan、question、revise、approval、dispatch、error、次操作を日本語で出力する。
- 明示承認された運用契約として`AGENTS.md`、`.agents/skills/handle-github-issue-event/SKILL.md`、同`references/issue-protocol.md`、`.agents/skills/plan-tasks/SKILL.md`を必要範囲だけ更新する。

## 対象外

- Issue #24のapplication feature実装または子repositoryの変更
- native Codex integrationやGitHub App自体の変更
- `openai/codex-action`、OpenAI API key、PAT、Cloud GitHub CLI login、追加credentialの導入
- dependency追加、探索的install、lockfile更新
- Child Task Dispatcherのallowlist、token境界、1 task = 1 child Issue、人間確認gateの緩和または全面再設計
- 自動承認、承認前dispatch、child Issueへの自動`@codex`、親Issueからの直接implementation
- README、DEVELOPMENT、`docs`本文の更新
- unrelated refactor
- Pull Requestのmerge

## 依存関係

| 依存対象 | type | gate | 完了条件 | 現在状態と根拠 |
|---|---|---|---|---|
| `shu-matsukubo/matsu-workspace@main` | hard | start | PR #23を含む最新`main`からtask branchを作成する | 完了。2026-08-22にGitHub APIと`git fetch`で`79e268092723defa4d201dc556dc9919dd94c50d`を確認し、このSHAからbranchを作成した |

依存循環はない。

## 懸念事項

- plan resultとapproval / dispatchを処理するworkflow間の競合で古いstateが上書きされないよう、共通の時系列・再取得・concurrency契約が必要になる。
- Issue bodyやplan commentの編集、同時刻comment、rerun、partial failureでもhash、revision、processed stateを一意に保つ必要がある。
- legacy result markerやユーザーが偽装したActions state markerをauthoritative stateとして誤認しない後方互換境界が必要になる。
- 承認操作が`@codex ...`から`/codex approve`へ変わるため、Issue上の日本語案内とskill contractを一致させる必要がある。
- native Codexへ最新コメント群が渡らない差し戻しでは、利用可能なIssue要件と差し戻し内容だけで安全に再planできない場合にquestionへ止める必要がある。

## 完了条件

- [x] native Codex runtimeにIssue番号、comment ID、author metadataがなくても初回plan候補を生成できる。
- [x] metadata不足状態からimplementation、approval確定、dispatch、authoritative revision/hash生成へ進めない。
- [x] Issue / Pull Request、owner、trusted bot、comment IDの真正性をActionsがGitHub eventと再取得stateから判定する。
- [x] revision、source / plan hash、processed owner comment、latest plan identityをActionsがauthoritative stateとして管理する。
- [x] Codex resultはtask key、title、repository、work、agent strategy、completion、dependencies、out-of-scope、verification、concerns等の意味内容に集中する。
- [x] 最新planへのrepository ownerのexact approvalだけを受理し、古いrevision、unknown user、unknown bot、改変済みplanを拒否する。
- [x] approval後にCodexがplanを再構築せず、Actionsが承認済み内容をDispatcherへ一対一でprojectionする。
- [x] 同一owner comment、revision、dispatch-idのrerunでchild Issueを重複作成しない。
- [x] allowlist、`CROSS_REPO_ISSUE_TOKEN`非出力、1 task = 1 child Issue、自動`@codex`禁止、人間確認gateを維持する。
- [x] 親Issueから直接implementationしないhard gateを維持する。
- [x] Issue #24相当、owner verification、Pull Request comment、approval、dispatch、rerun、reviseの回帰testを追加する。
- [x] plan、question、revise、approval、dispatch、error、次操作の人間向け出力を日本語で維持する。
- [x] Node syntax、Issue Flow、execution policy、Dispatcher、revision/hash、dependency、E2E回帰test、workflow YAML、skill validation、`git diff --check`が成功するか、未実施理由を記録する。
- [x] Worker self review、独立Reviewer review、Main最終reviewを完了する。
- [ ] commit後、GitHub Connectorでbranchを公開し、`main`向けdraft Pull Requestを作成する。

## 実施結果

- 変更内容: Codex出力をmetadata-freeなstrict semantic result / candidate contractへ限定し、ActionsがGitHub eventと再取得stateからauthoritative revision、source / plan hash、processed owner comment、owner exact approvalを確定するようIssue Flowを更新した。candidateの全fieldを決定的な可視JSONへ投影し、hidden payloadとの完全一致、unsafe文字escape、terminal marker 1件のexact grammarを検証する。承認済みcandidateはActionsが一対一projectionし、authoritative stateを`approved`へ更新した後、`workflow_dispatch`でDispatcherを明示起動する。Dispatcherはinputsから親Issueとcommentsを再取得し、approved identity、Actions bot、owner exact approval、時系列、hash、schema、一対一projectionを再検証する。rerun、partial failure、malformed current dispatch、stale owner comment、label修復の冪等性を追加し、allowlist、token境界、1 task = 1 child Issue、人間確認gate、自動mention禁止を維持した。承認範囲内の`AGENTS.md`、2 skills、Issue protocolも同じ契約へ更新した。
- ローカル検証: Node構文確認5/5成功。Issue Flow、Dispatcher、execution policy、source / plan hash、dependency解析のNode test 94/94成功（fail / skip / todo 0）。workflowの`actions: write`、明示`workflow_dispatch`、approved-only再検証、manual forged inputs拒否、token scope、Actions本文のliteral mention禁止をtestで確認した。`git diff --check`成功（WindowsのLF→CRLF警告のみ）。変更skill 2件のfrontmatter、placeholder、candidate contractを手動検証し2/2成功した。
- 未実施検証・残るリスク: default branch反映後の実GitHub Actionsで、`workflow_dispatch`からcross-repository child Issue作成とpartial rerunまでを通すlive E2Eは未実施。workflow YAMLとskill自動validatorはCodex同梱PythonにPyYAMLがなく`ModuleNotFoundError: No module named 'yaml'`となったため未実施であり、dependency追加禁止に従ってinstallせず、Nodeのworkflow contract testと手動構造確認で補完した。
- CI委譲: なし。既存Parent CIが同じNode構文、5 test file、`git diff --check`を覆うことを確認したが、remote公開前のためCI結果は未取得。
- documentation follow-up required: READMEとDEVELOPMENT本文は承認範囲外のため変更していない。`README.md`のIssue起動・状態説明、および`DEVELOPMENT.md`のGitHub Issue駆動フロー、承認操作、workflow権限、result marker、実地試験を、exact `/codex approve`、Actions authoritative state、`actions: write`、`workflow_dispatch`、approved-only Dispatcher契約へ更新する別documentation taskが必要。`docs`本文への影響はない。
- agent allocation・実行結果: Worker 1人がIssue Flow、Dispatcher、policy、tests、明示承認文書を実装してself reviewした。MainはGITHUB_TOKEN起点のIssue commentでDispatcher workflowを起動できない点とmalformed current dispatch時のlabel同期を指摘し、Workerが明示`workflow_dispatch`とmarker非依存failure identityへ修正した。独立Reviewer 1人はquestion / error案内、candidate可視内容との同一性、rerun label修復、authoritative state exact grammarの4点を指摘し、Workerが修正した。Worker再self review、独立Reviewer再review、Main最終reviewはいずれも最終actionable findingなし。
- commit: task定義 `4d3c604`、実装 `1e92a1d`
- Pull Request: GitHub Connectorでdraft作成待ち
