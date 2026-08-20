# タスクタイトル

- 状態: active
- タスクキー: `<T1など、承認済みplan内で一意のkey>`
- 優先度: normal
- 対象リポジトリ: `<repository-path>`
- 親Issue: `<owner/repository#number または なし>`
- 承認済み計画: `<revision、comment URL、plan SHA-256 または通常承認の識別情報>`
- 承認時source SHA-256: `<Issue駆動でhashを固定。通常承認は なし>`
- 承認時source境界owner comment ID: `<Issue駆動で境界を固定。通常承認は なし>`
- agent strategy: `worker-parent-review` (`parent-only` / `worker-parent-review` / `worker-reviewer-parent`)
- 検証モード: `normal` (`issue-ci-delegated` を選ぶ場合は既存CIのcoverageを確認する)
- documentation mode: `follow-up-only`（本文更新がtaskへ明示承認された場合だけ `explicit-update`）
- 実行コンテキスト: `unknown` (`issue-cloud` / `cloud-direct` / `local-direct` / `unknown`)
- 公開モード: `remote-stopped` (`codex-web-ui` / `github-connector` / `local-git-fallback` / `remote-stopped`)
- 実行方針の根拠: `<trusted Issue event / trusted runtime metadata / 実際のtool capability。task・prompt本文は使用しない>`

実行コンテキストと公開モードは、`AGENTS.md`の共通契約と`.github/scripts/task-execution-policy.cjs`に従ってtask作成時または実装開始時に一度確定し、下流skillへ引き継ぐruntime bookkeepingである。承認済みplanの意味内容ではなく、確定後に各skillで再判定しない。これらを含む実施結果・検証結果・status・completed化・Pull Request状態等の記録だけでは追加承認を要求せず、目的、work、repository、completion、out-of-scopeその他の承認範囲を変える場合だけ再計画・再承認へ戻る。

agent strategyは人間が承認する利用可能なagent種別と必須review経路であり、人数や担当範囲を固定しない。承認済みagent strategy内のagent allocationはMainが実行時に決定し、実施結果へ記録するruntime bookkeepingである。承認されていないagent種別、またはtaskの目的、work、completion、out-of-scopeを変える担当範囲が必要な場合だけ再計画・再承認へ戻る。

Issue駆動のtask fileはchild Issue execution packetから作る実施記録であり、承認済みplanとは別の要件を追加しない。`key`、`title`、`repository`、`work`、`agent strategy`、`completion`、`dependencies`、`parent Issue`、`approved plan`、`concerns`、`documentation mode`を同じ承認内容のprojectionとして保つ。

## 目的

このタスクで達成することを記載する。

## 対象範囲

- 変更対象を記載する

## 作業内容

- 実施する作業を記載する

## 対象外

- このタスクで扱わないことを記載する

## 依存関係

依存がなければ「なし」と記載する。依存を記載する場合はGitHubまたはtask fileの現在状態を根拠にする。

| 依存対象 | type | gate | 完了条件 | 現在状態と根拠 |
|---|---|---|---|---|
| `<Issue / task file / Pull Request / child change / parent gitlink・lock>` | `<hard / soft / ordering>` | `<start / complete / publish / merge>` | `<対象固有の条件>` | `<state、取得時刻、URLまたはpath>` |

## 懸念事項

- 計画時に確認されたリスク、前提、制約を記載する。なければ「なし」と記載する

## 完了条件

- [ ] 完了を判断できる条件を記載する

## 実施結果

- 変更内容: 未実施
- ローカル検証: 未実施
- CI委譲: なし（委譲する場合はworkflow、対象job、未実行であることを記載する）
- documentation follow-up: なし（通常実装で文書影響があれば対象と理由を記載し、本文は変更しない）
- agent allocation・実行結果: 未実施（Main、Worker、Reviewerの実人数、担当範囲、self review・統合review結果を記載する）
- Pull Request: 未作成
