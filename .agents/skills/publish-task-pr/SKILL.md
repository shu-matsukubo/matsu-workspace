---
name: publish-task-pr
description: 承認済みタスクのレビュー済み変更を、リポジトリ境界を保って明示的にcommit・pushし、適切なbaseへdraft Pull Requestとして公開する。タスク実装と検証が完了し、ユーザー承認に公開権限が含まれるときに使用する。
---

# タスクのPull Requestを公開する

## 公開前条件を確認する

1. タスクファイルが `.agents/tasks/completed/<完了年>/` にあり、状態、実施結果、検証結果、実装commitが更新されていることを確認する。
2. タスクID、承認範囲、親レビュー、必要な検証が完了していることを確認する。
3. 対象リポジトリ、現在のbranch、base branch、remoteを確認する。
4. `git status`、baseとの差分、直近commitを確認し、対象外の変更、secret、未解決の競合がないことを確認する。
5. branch名が `codex/<task-file-stem>` になっていることを確認する。

子リポジトリと `docs` のbaseは `develop`、親スーパープロジェクトのbaseは `main` とする。各repoのbaseへ直接pushしない。

## 変更を記録する

- 対象ファイルだけを明示的にstageする。`git add .` で別タスクやサブモジュール差分を取り込まない。
- commit前にstaged diffを確認し、1タスクの責務だけが含まれることを確認する。
- 既存commitが要件を満たす場合は、不要な追加commitを作らない。
- commit、push、draft Pull Request作成は承認済みタスクの範囲内で実行する。

## draft Pull Requestを作成する

branchをremoteへpushし、draft Pull Requestを作成する。本文に次を含める。

- 対応したタスクと目的
- 完了済みタスクファイルのpath
- 主な変更
- 実行した検証と結果
- 疑問点メモ、未実施検証、残るリスク
- 依存するPull Requestやmerge順序

公開後にURL、head、base、draft状態を確認する。Pull Requestをmergeしない。

## スーパープロジェクトの順序を守る

子リポジトリの変更は子側で先に公開する。親gitlinkや `modules.lock.conf` の更新は、参照する子commitがpushされ、必要な子Pull Requestがmergeされた後に別タスクで行う。架空SHAや未pushのcommitをlockへ記録しない。
