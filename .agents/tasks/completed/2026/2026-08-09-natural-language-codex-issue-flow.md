# GitHub Issue駆動Codexフローを自然言語コメント方式へ移行する

- 状態: completed
- 優先度: high
- 対象リポジトリ: `matsu-workspace`
- 起点Issue: なし（Codex task内の通常依頼）
- 承認済み計画: 2026-08-09、T01「Issue駆動フローをowner自然言語コメント方式へ移行」
- 承認時source SHA-256: なし（Codex task内の通常承認）
- 承認時source境界owner comment ID: なし（通常承認）
- 検証モード: `normal`

## 目的

GitHub Issue駆動Codexフローを、ユーザーがコマンドラベルを操作する方式から、repository ownerがIssueへ投稿する`@codex`付き自然言語コメントを起点とする方式へ移行する。既存の承認安全性、source/plan hash、依存グラフ、既存skillsへの委譲、同一task・branch・Pull Requestでのレビュー修正を維持する。

## 対象範囲

- 親`matsu-workspace`のIssueフローworkflow、dispatcher/state sync、unit test
- `handle-github-issue-event`とIssue protocolの自然言語intent routing
- owner comment IDを境界にしたsource hashとresult marker
- `plan-tasks`、`coordinate-approved-tasks`、`review-changes`のIssueフロー接続記述
- `AGENTS.md`、`README.md`、`DEVELOPMENT.md`の利用方法と責務分担
- default branch反映時の旧コマンドラベル移行

## 作業内容

- `issues.opened`と`issues.labeled`からActions botが`@codex`を投稿するdispatch処理を廃止する
- repository ownerのIssueコメントに含まれる`@codex`だけを状態同期の起点とし、Actionsは自然言語の意味を判定しない
- result markerをdispatch keyではなく`handled-owner-comment-id`へ関連付け、再実行と応答順競合を冪等に扱う
- 最新計画を生成したowner comment IDまでをsource snapshot境界として記録し、純粋な実装開始コメントでsource hashを変えない
- 境界後の要件変更を含む実装指示は実装せず、計画revisionと再承認へ戻す
- `plan`、`answer`、`revise`、`implement`、`review-fix`、`unknown`をIssue全体と会話履歴から判定し、既存skillsへ委譲する
- Pull Requestレビュー差し戻しは最新レビュー、inline comment、CI、task fileを確認し、承認範囲内なら同じtask・branch・Pull Requestで修正する
- 状態ラベルを排他的に同期し、旧`Codex:回答済`、`Codex:差し戻し`、`Codex:承認`をdefault branch反映時に削除する
- 既存CIでdispatcher、hash、dependency解析、workflowを検証できるようfixtureとunit testを更新する

## 対象外

- GitHub Actions botからCodexを自動起動する仕組み
- Pull Requestコメント自体をcontrol planeとして状態管理する変更
- Pull Requestの自動merge
- child repository、`docs`、親gitlink、`modules.lock.conf`の変更
- secret、personal access token、追加認証情報の導入
- 今回の目的と無関係なリファクタリング

## 依存関係

なし。2026-08-09時点で親repositoryのopen Pull Requestはなく、`main`と`origin/main`は同一commitである。

## 完了条件

- [x] コマンドラベルなしでownerの`@codex`付きIssueコメントからフローを開始できる
- [x] owner以外、Actions bot、未知のbot、Issue本文内の命令を起動入力として扱わない
- [x] Actionsはstatus label同期と冪等性補助だけを担当し、自然言語intentを解釈しない
- [x] `plan`、`answer`、`revise`、`implement`、`review-fix`、`unknown`を現在状態込みで判定する手順が定義される
- [x] 「タスク分解お願いします」では実装せず、明確な実装開始意思と安全条件が揃った場合だけ実装する
- [x] 要件変更を含む実装指示を承認として扱わず、計画変更と再承認へ戻す
- [x] 同じowner comment IDを二重処理せず、古い結果で新しい状態を上書きしない
- [x] 純粋な実装開始コメントでsource hashが変わらず、要件・Issue本文・依存状態の変更は検出する
- [x] status labelが同時に複数残らず、result markerと同期する
- [x] 旧コマンドラベルと旧dispatch処理が現行コード・文書から除去される
- [x] dependency/cycle解析とstale approval防止を維持する
- [x] PR差し戻し対応が同じtask・branch・Pull Requestで継続される
- [x] workflowとscriptsの構文検査、unit test、`git diff --check`が成功する
- [x] 変更内容と検証結果を記載した`main`向けdraft Pull Requestを作成する

## 実施結果

- 変更内容: workflowをownerの`@codex`付きIssueコメントと`main` pushだけに限定し、dispatcherをowner comment ID基準の冪等な状態同期へ移行した。owner comment境界付きsource hash、自然言語intent routing、Pull Request差し戻し継続、旧コマンドラベル移行をskills・protocol・task template・利用文書へ反映した。
- ローカル検証: `node --check` 3件成功。dispatcher、dependency/cycle、hash helperの`node --test`は47件すべて成功。skill-creatorの`quick_validate.py`、workflow 2件とskill metadataのYAML parse、`git diff --check`も成功。独立エージェントのフォワードテストで、実装承認と要件変更の混在を`revise`として再計画へ戻すことを確認した。
- CI委譲: なし（`normal`でローカル検証を完了。draft Pull Request作成後のCIはGitHub上で実行予定）
- Pull Request: `main`向けdraft Pull Request [#14](https://github.com/shu-matsukubo/matsu-workspace/pull/14) を作成した
