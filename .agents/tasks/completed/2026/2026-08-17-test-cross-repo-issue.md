# GitHub Actionsからmatsu-frontへのIssue作成を検証する

- 状態: completed
- 優先度: normal
- 対象リポジトリ: `C:\work\00_Docker\matsu-workspace`
- 起点Issue: なし
- 承認済み計画: 2026-08-17の通常承認（会話内のT1）
- 承認時source SHA-256: なし
- 承認時source境界owner comment ID: なし
- 検証モード: `normal`

## 目的

`matsu-workspace` のGitHub Actionsから、専用のfine-grained Personal Access Tokenを使って `shu-matsukubo/matsu-front` に検証用Issueを1件作成できる最小構成を追加する。

## 対象範囲

- `.github/workflows/test-cross-repo-issue.yml`
- `DEVELOPMENT.md` の検証workflow実行手順

## 作業内容

- `workflow_dispatch` だけで起動する検証workflowを追加する。
- workflowの `GITHUB_TOKEN` 権限を `permissions: {}` で無効化する。
- Actions Secret `CROSS_REPO_ISSUE_TOKEN` を `GH_TOKEN` としてGitHub CLIへ渡す。
- Secretが未設定の場合、Issue作成前に分かりやすいエラーで停止する。
- GitHub CLIのREST API呼び出しで `shu-matsukubo/matsu-front` に固定内容の検証Issueを1件作成する。
- fine-grained PATの対象repositoryと必要最小限の権限、merge後の手動実行手順を既存文書へ記載する。
- YAML構文、Secret未設定時の処理、対象repository、GitHub write操作の範囲、差分を検証する。

## 対象外

- Codexコメントのparse
- タスクごとのIssue自動生成
- 複数repositoryへのIssue配送
- Issue作成後の `@codex` 自動メンション
- 親Issueへの結果コメント
- 親Issueと子Issueの依存関係管理
- GitHub Appの新規作成
- Personal Access Tokenの自動発行
- Pull Request、branchの自動作成
- repository sourceの変更
- 既存Issue駆動workflowの変更
- 実Issueの作成およびdefault branch反映前の実地疎通確認
- 関係のないリファクタリング

## 依存関係

なし。

## 完了条件

- [x] `workflow_dispatch` で手動実行可能な検証workflowが追加されている。
- [x] `CROSS_REPO_ISSUE_TOKEN` を使って `shu-matsukubo/matsu-front` へのIssue作成だけを試行する。
- [x] Secret未設定時はIssue作成前に明示的に失敗する。
- [x] workflowの `GITHUB_TOKEN` にwrite権限を付与せず、tokenをソース、ログ、Issue本文、remote URLへ露出しない。
- [x] fine-grained PATの対象repositoryと最小権限、merge後の手動実行方法が文書化されている。
- [x] 既存のCodex Issue駆動フローを変更していない。
- [x] YAML構文、静的なセキュリティ要件、`git diff --check` の検証と自己レビューが完了している。
- [x] 変更がcommitされ、`main` 向けdraft Pull Requestを作成できる状態になっている。

## 実施結果

- 変更内容: `workflow_dispatch` 専用の検証workflowを追加し、専用Secretによる `matsu-front` への単一Issue作成、Secret未設定時の事前失敗、空の `GITHUB_TOKEN` 権限を実装した。`DEVELOPMENT.md` にSecret、fine-grained PATの対象repositoryと最小権限、merge後の手動実行手順を記載した。
- ローカル検証: actionlint v1.7.12、既存Node構文確認2件、Nodeテスト47件、Secret未設定分岐、対象repositoryとwrite操作の静的確認、`git diff --check` がすべて成功した。親レビューも指摘なしで完了した。
- CI委譲: なし
- Pull Request: `main` 向けdraft Pull Request [#18](https://github.com/shu-matsukubo/matsu-workspace/pull/18) を作成した
- 実地確認: 実Issueは作成していない。`main` へのmerge後、ユーザーがActions画面から手動実行する。
- 残るリスク: fine-grained Personal Access Tokenを使った実際のcross-repository疎通は未実施であり、merge後の手動実行で確認する。
