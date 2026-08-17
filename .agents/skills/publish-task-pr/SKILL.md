---
name: publish-task-pr
description: 承認済みtaskのレビュー済み変更について実行環境を判定し、Codex Cloudではremote publishをCodex Web UIへ委ね、LocalではGitHubプラグインを優先して適切なbaseへのdraft Pull Requestを公開する。
---

# タスクのPull Requestを公開する

## 実行環境を先に判定する

Codex Cloudと安全に判定できる場合、このskillではremote状態を読み書きするtool探索も含め、GitHub CLI login、PAT・credential追加や保存、`git push`、GitHub API・Connector・pluginによるbranch公開、draft Pull Request作成を一切試行しない。実装、検証、self review、指定されたreview、commitが完了していることを確認し、ユーザーへ次を明確に返して終了する。

```text
実装とレビューが完了しました。Pull Requestの公開はCodex Web UIから行ってください。
```

Cloudでremote publishしないことは失敗ではなく設計上の完了条件である。remote認証の有無を試すための通信も行わない。

Localと安全に判定できる場合だけ、以降の公開手順を実行する。実行環境を判定できない場合はremoteを変更せず、CloudかLocalかをユーザーへ確認する。

## Localの公開前条件を確認する

1. タスクファイルが `.agents/tasks/completed/<完了年>/` にあり、状態、実施結果、検証結果が更新されていることを確認する。
2. タスクID、承認範囲、親レビュー、必要な検証が完了していることを確認する。
3. 対象リポジトリ、現在のbranch、base branch、remoteを確認する。
4. `git status`、baseとの差分、直近commitを確認し、対象外の変更、secret、未解決の競合がないことを確認する。
5. branch名が `codex/<task-file-stem>` になっていることを確認する。
6. Issue駆動でテスト実行をCIへ委譲した場合は、必要なテストコード、既存workflowのcoverage、ローカル未実行の記録を確認する。CI未実行はdraft Pull Request公開を妨げないが、成功扱いにしない。

子リポジトリと `docs` のbaseは `develop`、親スーパープロジェクトのbaseは `main` とする。各repoのbaseへ直接pushしない。

## Localで変更を記録する

- 対象ファイルだけを明示的にstageする。`git add .` で別タスクやサブモジュール差分を取り込まない。
- commit前にstaged diffを確認し、1タスクの責務だけが含まれることを確認する。
- 既存commitが要件を満たす場合は、不要な追加commitを作らない。
- タスク定義、実装、完了記録を同じtask branchにcommitし、1つのdraft Pull Requestへ含める。
- commitとdraft Pull Request作成は承認済みタスクの範囲内で実行する。

## LocalでGitHubプラグインからbranchを公開する

local gitはbranch作成、stage、commit、検証に使用する。GitHub側のcommitとbranchの作成・更新は、GitHubプラグインがローカルの最終commit treeを安全に表現できる限り、プラグインを第一選択とする。このワークスペースでは、GitHubプラグイン付属の `github:yeet` など一般的な公開skillの順序より本skillを優先する。この節はLocal専用でありCloudから呼び出さない。

1. `git rev-parse "HEAD^{tree}"` でローカルの最終tree SHAを記録する。
2. remoteのbase branchと対象task branchのheadを読み、想定外の更新がないことを確認する。
3. ローカルのcommit treeを正本として、blob、削除、file mode、symlinkやsubmoduleを含むオブジェクト種別を保ったremote treeを構築できるか事前確認する。
4. 安全に表現できる場合は、既存task branchのremote head、または新規branchならbase branchのheadを親としてremote commitを作り、対象task branchだけを作成または更新する。base branchを変更しない。
5. remote headのtree SHAを再取得し、ローカルのtree SHAと一致することを確認する。不一致なら公開完了と扱わない。

GitHubプラグイン経由ではローカルとremoteのcommit SHAが異なることがある。同一リポジトリのlocal commit SHAをタスクファイルへ必須記録せず、tree SHAの一致とtask file stem、branch、Pull Requestの対応を正本とする。別リポジトリの依存commitなど、対応確認に必要なcommitだけを記録する。

## Localでlocal git pushへfallbackする

GitHubプラグインが利用できない、またはローカルtreeを安全に表現できない場合だけ、forceを付けずに対象task branchを `git push` する。pushは `GIT_TERMINAL_PROMPT=0` と `GCM_INTERACTIVE=Never` をそのプロセスに設定し、新しい対話認証を開始しない形で試す。プラグインがremote branchを更新した後は自動でpushへ切り替えず、remote状態を確認する。

pushで認証に失敗した場合や対話認証を求められた場合は、browser login、device login、credential保存を自動で開始しない。remote branchを公開するためのlocal git認証が利用できないことをユーザーへ説明し、認証または手動pushを依頼して停止する。

## Localでdraft Pull Requestを作成する

remote branchの公開後、GitHubプラグインでdraft Pull Requestを作成する。本文に次を含める。

- 対応したタスクと目的
- 完了済みタスクファイルのpath
- 主な変更
- 実行した検証と結果
- CIへ委譲したworkflow/job、未実行項目、CI失敗時に同じtask・branch・Pull Requestで修正すること
- 疑問点メモ、未実施検証、残るリスク
- 依存するPull Requestやmerge順序

公開後にURL、head、base、draft状態、remote headとローカルのtree SHA一致を確認する。Pull Requestをmergeしない。

CI結果待ちのために同じCodexタスク内でポーリングしない。draft Pull RequestとIssueへ「CI待ち」を明記して終了する。

既存Pull Requestへのレビュー修正は、承認範囲が変わらない限り新しいタスクやbranchを作らず、同じtask branchを上記手順で更新する。

## スーパープロジェクトの順序を守る

子リポジトリの変更は子側で先に公開する。親gitlinkや `modules.lock.conf` の更新は、参照する子commitがpushされ、必要な子Pull Requestがmergeされた後に別タスクで行う。架空SHAや未pushのcommitをlockへ記録しない。
