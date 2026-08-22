# Codex Connector footer付きsemantic resultを正しく認識する

- 状態: completed
- 完了日: 2026-08-23
- タスクキー: `T1`
- 優先度: high
- 対象リポジトリ: `shu-matsukubo/matsu-workspace`
- 親Issue: なし（Local directの通常承認。Issue #26はE2E回帰根拠として参照）
- 承認済み計画: 2026-08-23の会話内で提示したT1をユーザーが「T1承認」と明示承認
- 承認時source SHA-256: なし
- 承認時source境界owner comment ID: なし
- agent strategy: `worker-reviewer-parent`
- 検証モード: `normal`
- documentation mode: `follow-up-only`
- 実行コンテキスト: `local-direct`
- 公開モード: `github-connector`
- 実行方針の根拠: Codex desktopが提供したローカルworkspace、shell、filesystemのtrusted runtime metadataからLocal実行を確定した。利用可能toolとrepository permissionを確認し、GitHub Connectorにbranch、commit、Pull Requestのwrite capabilityがあるため`github-connector`とした。task本文中のLocal、Issue、Connector等の文字列は判定根拠に使用していない。`.github/scripts/task-execution-policy.cjs`へ同runtime metadataとcapabilityを渡し、direct entryの実装・品質ゲート・draft Pull Request公開が許可されることを確認した。

実行コンテキストと公開モードは、`AGENTS.md`の共通契約と`.github/scripts/task-execution-policy.cjs`に従ってtask開始時に一度確定し、下流skillへ引き継ぐruntime bookkeepingである。承認済みplanの意味内容ではなく、確定後に各skillで再判定しない。これらを含む実施結果・検証結果・status・completed化・Pull Request状態等の記録だけでは追加承認を要求せず、目的、work、repository、completion、out-of-scopeその他の承認範囲を変える場合だけ再計画・再承認へ戻る。

agent strategyは人間が承認する利用可能なagent種別と必須review経路であり、人数や担当範囲を固定しない。承認済みagent strategy内のagent allocationはMainが実行時に決定し、実施結果へ記録するruntime bookkeepingである。承認されていないagent種別、またはtaskの目的、work、completion、out-of-scopeを変える担当範囲が必要な場合だけ再計画・再承認へ戻る。

## 目的

Codex Connectorがsemantic result markerの後ろへ自動付与する既知の`View task` footerを安全に認識し、footerがあるplan / revise / question / errorを既存のstrict grammarとsecurity boundaryを維持したまま処理できるようにする。Connectorのpresentation metadataを承認対象plan identityから除外し、同一candidateのfooter URL差分で不要なplan hash・revision差分を生じさせない。

## 対象範囲

- 親`matsu-workspace`の`.github/scripts/codex-issue-flow.cjs`
- semantic result parser、candidate parser、plan hashのConnector footer正規化
- `.github/scripts/codex-issue-flow.test.cjs`を中心とするIssue #26相当の回帰test
- 既存Issue Flow、Child Task Dispatcher、execution policy、dependency・hash関連testによる回帰確認

## 作業内容

- `semantic result markerのみ`と`semantic result marker + 既知のConnector footer`を一貫して解析するstrictなsuffix grammarを実装する。
- footer URLはHTTPS、`chatgpt.com`、`/s/<opaque task id>`の必要最小限の形式へ限定し、任意host、credential、port、query、fragment、追加path、追加本文を拒否する。
- 実際のConnector出力に合わせた`View task`表示文字列だけを許可し、footer後の任意content、marker重複、footerへの予約marker混入を拒否する。
- plan / reviseのcandidate JSON schema、人間向け表示完全一致、repository allowlist、agent strategy、dependency schema、revision・source hashのtrust boundaryを維持する。
- Connector footerを除外したprotocol本文からplan hashを計算し、footerなしの従来hashを変えず、footer URLだけ異なる同一candidateのplan identityを安定させる。
- footer付きplanがActions authoritative stateの`awaiting-approval`へ進むIssue #26相当ケースと、footerなし、任意文章、不正URL、marker重複、footer後追加content、全semantic type、hash安定性の回帰testを追加する。
- 実装、検証、Worker self review、独立Reviewer review、Main最終review後にtaskをcompleted化し、GitHub Connectorでbranchとdraft Pull Requestを公開する。

## 対象外

- ラベル承認UI、`/codex approve` UX、Issue #26のapplication feature実装
- Child Task Dispatcher、Actions authoritative state、revision・source hash、dispatch idempotency、allowlist、token、child Issue人間承認gate、execution policyの再設計
- PAT、Secret、credential、dependencyの追加・変更
- README、DEVELOPMENT、`docs`本文の更新
- unrelated refactor
- Pull Requestのmerge

## 依存関係

なし。2026-08-23にremote `main`の最新SHA `047821ed4db2ecbdbc650a2bc953b21624763b2c`をGitHub Connectorと`git fetch`で確認し、local `main`をfast-forwardした上でtask branchを作成した。依存循環はない。

## 懸念事項

- footer許可grammarを広げすぎるとmarker以後の任意contentを受理し、terminal markerのsecurity boundaryを弱める。
- parser、candidate切り出し、error fallback、plan hashが異なる本文正規化を使うと、Actions stateとDispatcherのidentity検証が不一致になる。
- URL parserの暗黙正規化でcredential、port、query、fragment、encoded separator、追加path等を誤受理しないよう、raw footer全体とURL構成要素の双方をstrictに検証する必要がある。
- CRLF、末尾改行、既存のtrailing whitespace正規化は維持し、footerなし従来形式のhashを変更しない必要がある。

## 完了条件

- [x] footer付きのplan / revise / question / errorを正常に認識する。
- [x] footerなしの従来semantic resultを引き続き正常に認識する。
- [x] 任意文章、不正footer URL、marker重複、footer後追加content、footer内予約markerを拒否する。
- [x] candidate schema、人間向け表示一致、allowlist、agent strategy、dependency、承認・dispatchのsecurity boundaryを弱めない。
- [x] footer付きplanがActions authoritative stateの`awaiting-approval`へ進む。
- [x] candidateが同一でfooter URLだけ異なる場合、承認対象plan hashが一致し、不要なrevision差分を生じさせない。
- [x] syntax check、Issue Flow・Dispatcher・execution policy・dependency・hash関連test、`git diff --check`が成功するか、未実施理由を記録する。
- [x] Worker self review、独立Reviewer review、Main最終reviewを完了する。
- [x] GitHub Connectorでbranchを公開し、`main`向けdraft Pull Requestを作成する。

## 実施結果

- 変更内容: semantic result本文をprotocol本体と既知Connector footerへ分離するstrict envelope parserを追加した。footerは`[View task →](https://chatgpt.com/s/<task id>)`と、Issue #26の実コメントで確認した行頭半角スペース1文字付き形式だけを許可し、task IDをASCII英数字開始の英数字・underscore・hyphen 1〜256文字へ限定した。raw Markdown grammarと`URL`構成要素の双方でHTTPS、exact host、credential・port・query・fragmentなし、単一`/s/<id>` pathを検証する。plan / revise / question / errorの全typeで同じenvelopeを使用し、plan / reviseのcandidate strict grammarはfooterを除外したprotocol本文へ従来どおり適用する。有効footerだけをplan hashから除外し、footerなしの従来hashを維持した。Issue #26実入力、全type、0/1半角space、任意content・不正URL・2 space・tab・全角space・marker重複・footer後content拒否、candidate改変拒否、hash・revision安定性、`awaiting-approval`、exact approval後projectionの回帰testを追加した。
- ローカル検証: `node --check`で`.github/scripts/codex-issue-flow.cjs`、`child-task-dispatcher.cjs`、`task-execution-policy.cjs`、`analyze-dependencies.mjs`の4/4成功。CI workflowと同じ5 test file（Issue Flow、Child Task Dispatcher、execution policy、dependency解析、source / plan hash）を実行し98/98成功（fail / skip / todo 0）。`git diff --check`成功（WindowsのLF→CRLF警告のみ）。baseからのdiffと`git status`を確認し、変更はtask file、Issue Flow本体、同testだけで、dependency・lockfile・生成物・対象外変更はない。
- 未実施検証・残るリスク: remote公開前のためGitHub Actions CIは未実行。runtimeのActionsとChild Task Dispatcherは共通の`.github/scripts/codex-issue-flow.cjs`の`planHash`を使うためidentityは一致する。一方、運用補助CLI `.agents/skills/handle-github-issue-event/scripts/hash-issue-state.mjs`はruntimeで使用されず、今回の承認範囲外として変更していないため、footer付き本文を直接与えるとfooterを含むhashを返す。補助CLIまでruntime canonicalizationへ合わせる場合は別の承認済みtaskが必要。
- CI委譲: なし。既存Parent CIが今回実行したNode syntax、5 test file、`git diff --check`を覆うことを確認した。draft Pull Request公開後のCI結果はこのタスク内でポーリングしない。
- documentation follow-up required: README、DEVELOPMENT、`docs`本文は対象外のため変更していない。`.agents/skills/handle-github-issue-event/references/issue-protocol.md`のsemantic result terminal grammarとplan hash説明、および補助CLIの位置付けをConnector footer対応へ揃える別documentation taskを検討する。
- agent allocation・実行結果: Mainが責務と変更対象の強い結合を評価し、parser・hash・testをWorker 1人へまとめ、統合差分を独立Reviewer 1人が確認した後にMainが最終reviewする順次構成を選択した。Workerは実装、98 test、`git diff --check`、self reviewを完了した。MainがGitHub ConnectorでIssue #26実コメントを再取得し、footer行頭に半角スペース1文字があることを確認した。独立Reviewerも現案が実入力を拒否するP1を指摘し、Workerへ0/1 spaceだけ許可し2 space・tab・全角spaceを拒否する修正と回帰testを差し戻した。Workerの修正・再self review後、独立Reviewer再reviewとMain最終reviewはいずれもactionable findingなし。
- commit: task定義 `390af31`、実装 `4fc40ce`、completed記録 `580668b`
- remote公開: GitHub Connectorで `codex/2026-08-23-accept-codex-connector-footer` を公開した。開始時と公開時のremote `main`は `047821ed4db2ecbdbc650a2bc953b21624763b2c`で一致した。初回公開remote commitは `2dc1cf9bec810477b3f3998b288b4d1d3aff4ae5`、local completed commitとremote commitのtree SHAは `6e53d86d3750cc032a96d47511af0b844f128328`で一致した。local git push、credential追加、mergeは行っていない。
- Pull Request: draft [#27](https://github.com/shu-matsukubo/matsu-workspace/pull/27)（base: `main`、head: `codex/2026-08-23-accept-codex-connector-footer`、CI実行待ち）
