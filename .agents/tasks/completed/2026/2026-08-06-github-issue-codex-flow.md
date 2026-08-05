# GitHub Issue起点のCodex作業フローを追加する

- 状態: completed
- 優先度: high
- 対象リポジトリ: `matsu-workspace`
- 起点Issue: 今回の承認済み依頼（GitHub Issue番号は未割当）
- 承認済み計画: 2026-08-06、T01、確認事項1〜6
- 承認時source SHA-256: なし（Codex task内の通常承認）
- 検証モード: `issue-ci-delegated`（受け入れ用unit testはローカルでも実行）
- 依存タスク: なし

## 目的

GitHub Issueを作業依頼と状態管理の正本として、調査・質問・計画・承認・実装・レビュー・draft Pull Request公開を既存skillsへ安全に接続する。

## 対象範囲

- Issueイベントを一元処理するGitHub Actions workflowとdispatcher/state sync
- Issue状態を判定して既存skillsへ委譲する専用skill
- hard、soft、ordering dependencyを扱う依存グラフ検査とunit test
- タスクテンプレート、既存skills、AGENTS.mdの最小限の接続変更
- 親リポジトリのCI、README.md、DEVELOPMENT.md

## 作業内容

- `issues.opened`、`issues.labeled` と状態同期用 `issue_comment.created` を一つのworkflowで扱う
- リポジトリownerだけを起動主体として許可し、Issue単位の直列化、再送の冪等性、コマンドラベル消費、最小権限を実装する
- コマンドラベルとprompt対応を一箇所で管理し、未検証のIssue本文やコメントをshellへ展開しない
- Issue全体とGitHub上の現在状態を再取得し、最新revisionと承認範囲を判定する専用skillを追加する
- 依存関係の型、gate、完了条件、根拠を正規化し、循環と着手可否を決定論的に検査する
- 通常実行とIssue駆動実行の検証責務が矛盾しないよう既存skillsと文書を更新する

## 対象外

- Pull Requestレビューイベントの自動起動
- Pull Requestの自動merge
- child repositoryのgitlinkまたは`modules.lock.conf`更新（T03）
- Actions投稿の`@codex`から実タスクが起動するE2E受け入れ試験（T04、親Pull Request merge後）
- personal access token、GitHub App tokenなど追加認証情報の導入

## 完了条件

- [x] owner以外、状態ラベル、Actions/Codex自身の再帰イベントではdispatchされない
- [x] 同一Issueイベントの再送、workflow再実行、処理中の再承認で二重dispatchまたは二重実装しない
- [x] 質問、回答済、差し戻し、承認、依存待ち、循環依存、PR作成済みの状態遷移とmarkerが定義される
- [x] hard、soft、ordering dependencyとIssue、task、Pull Requestの完了条件を現在状態から評価できる
- [x] 自己、2件、3件以上、Issue/PR/task横断、merge条件/実装条件の循環を検出するunit testがある
- [x] CI委譲した検証を成功扱いせず、タスクとPull Requestへ記録する既存skill契約になる
- [x] workflow/dispatcher/依存検査の軽量検証とunit testが親CIで実行される
- [x] default branch要件とT04のE2E試験手順が文書化される

## 実施結果

- 変更内容: Issue単位の直列dispatcher/state sync、信頼済みbot markerと冪等reconcile、専用skill/protocol、locale非依存のsource/plan hash helper、node別依存・循環検査、親CIを追加した。task template、既存5 skills、AGENTS.md、README.md、DEVELOPMENT.mdを通常実行とIssue駆動実行の両立に必要な範囲で更新した。
- ローカル検証:
  - `node --check`（dispatcher、dependency analyzer、hash helper）: 成功
  - `node --test ...`: 38件成功（ordinal orderingと入力配列順非依存の回帰testを含む）
  - `quick_validate.py .agents/skills/handle-github-issue-event`: 成功（同梱Python、一時PyYAML、UTF-8 mode）
  - PyYAMLによる2 workflowと`agents/openai.yaml`の構文parse: 成功
  - `git diff --check`: 成功
  - fresh subagent forward-test 2件: dependency-wait判定とanswered後の計画委譲に成功。2件目のsource SHA-256はhelper再計算と一致
  - 親レビュー: 完了。P1指摘2系列（locale依存、node/edge入力配列順依存）を同一taskで修正し、再レビュー指摘なし
- CI委譲: `.github/workflows/ci.yml`の`issue-flow` jobが同じJavaScript構文検査、38件のunit test、whitespace検査を実行する。draft Pull Request未作成のためCIは未実行・成功扱いしない。
- Pull Request: 未作成（親レビュー後に同じbranchからdraftで作成予定）
- 残る確認: Actionsが`GITHUB_TOKEN`で投稿した`@codex`から実際にCodexタスクが起動するE2Eは、workflowがdefault branchへmergeされた後のT04で行う。
