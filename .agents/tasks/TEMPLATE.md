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
- Pull Request: 未作成
