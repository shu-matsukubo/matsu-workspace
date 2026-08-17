---
name: coordinate-approved-tasks
description: ユーザー承認済みtaskを、依存関係、リポジトリ境界、taskごとのagent strategyを保って割り当て、実装・self review・親review・差し戻しを完了まで管理する。
---

# 承認済みタスクを統括する

このskillはIssueを経由しないLocalの承認済みtask、または配送済みCloud child Issueの実装を統括する。Cloudの親`matsu-workspace` Issueで承認されたtaskはここで直接実装せず、`handle-github-issue-event`がdispatchへ変換する。

## 実行条件を確認する

1. 承認されたタスクID、確認事項の回答、除外範囲を固定する。
2. 承認は、各タスクに必要なbranch作成、実装、検証、明示的なcommitまでを許可する。Localではremoteへの公開とdraft Pull Request作成までを含むが、Codex Cloudではremote publishを試行せずCodex Web UIへ委ねる。
3. Pull Requestのmergeは許可に含めない。ユーザーの明示的な指示なしにmergeしない。
4. 承認外の改善や追加変更を見つけた場合は、作業へ混ぜず新しいタスクとして記録する。
5. 各タスクについて、実装を所有するGitリポジトリと `.agents/tasks/active/` の明示pathを確定する。タスクファイルがまだなければ、親ワークスペースの `.agents/tasks/TEMPLATE.md` から作成し、実装前にそのファイルだけをcommitする。Cloud child Issueではexecution packetのkey、title、repository、work、agent strategy、completion、dependencies、parent Issue、approved plan、concerns、documentation modeを意味変更せず投影し、第二の承認内容を作らない。
6. Cloud child Issueでは親のapproved plan revision/hash、dispatch-id、親Issue、現在のchild Issue本文が一致することを確認する。実装開始前に依存Issue・task・Pull Request、対象CIをGitHubから再取得し、計画時点の状態だけで開始しない。execution packetへの要件追加は実装せず親Issueの再計画・再配送へ戻す。

## 割り当てる

- taskのagent strategyを維持する。`parent-only`では親agentが実装とself review、`worker-parent-review`では1つの作業用sub-agentが実装とself reviewを行って親agentが直接review、`worker-reviewer-parent`ではさらに独立review agentが確認してから親agentが最終reviewする。
- 1つの作業用sub-agentへ、原則として1タスクと1つの責務を割り当てる。Cloud child taskは指定された1repository内だけで完結させる。
- 同じリポジトリを同時に編集する割り当てを避ける。独立リポジトリのタスクは依存関係がなければ並列化する。
- `start`を止めるhard dependencyが完了したタスクだけを着手可能とし、ユーザーの明示指定、`high`、`normal`、`low`、作成日の古い順で選ぶ。soft dependencyとordering dependencyは実装開始を止めない。`high` のタスクを止めている依存タスクは、記録値を変えず実効的に `high` として扱う。
- 依存グラフをtaskごとに評価し、一つの未完了依存を理由に独立taskまで停止しない。循環時は単純な依存待ちにせず、経路と解消案をIssueへ報告する。
- 各依頼にタスクファイルの明示path、対象ファイル、完了条件、禁止事項、必要な検証、agent strategy、branch名、base branchを明記する。
- 子リポジトリと `docs` は `develop` をbaseにし、親スーパープロジェクトは `main` をbaseにする。
- branch名は `codex/<task-file-stem>` とする。

## 進行を管理する

- サブエージェントには実装と自己レビューを続けさせ、作業可能な疑問は「疑問点メモ」として報告させる。
- 進行不能な疑問だけを親へ即時エスカレーションさせる。
- 関係のない変更、既存の未commit変更、別タスクの差分をstageまたは修正させない。
- 子リポジトリの成果を先にreview・公開し、親gitlinkやlockは子Pull Requestのmerge後に扱う。
- hard dependencyまたはCI結果を同じCodexタスク内でポーリングしない。Issueへ現在状態、先行可能なtask、再開条件とユーザー操作を記録して終了する。
- Issue駆動の`issue-ci-delegated`では必要なテストコードを実装に含め、`verify-changes`で既存CI coverageを確認する。ローカル未実行のテストを成功扱いにしない。
- Pull Requestレビューの差し戻し対応では、最新review、未解決thread、inline comment、CI、現在コードを確認し、承認範囲内の修正を同じtask、branch、Pull Requestで続ける。
- documentation modeが`follow-up-only`の通常実装taskへREADMEやdocsの変更を混ぜない。影響があれば変更内容、影響候補、更新理由を`documentation follow-up required`として実施結果へ記録し、明示的なdocumentation taskへ委ねる。`explicit-update`では`update-documentation`へ委譲し、execution packetで承認されたwork、out-of-scope、completionの範囲だけを更新する。

## 親レビューを行う

1. サブエージェントの報告だけでなく、diff、status、検証結果を親が直接確認する。
2. 要件、リポジトリ境界、文書の正本、テスト範囲に照らしてレビューする。
3. 修正が必要なら同じタスクとbranchへ具体的に差し戻し、既に公開済みなら同じPull Requestで修正commitと再検証を求める。
4. 承認範囲を超える問題は別タスクへ分ける。
5. 合格したタスクは実行環境に応じて完了処理へ進める。Cloudではcommitと完了報告後、remote操作を試さずCodex Web UIからの公開を案内する。Localでは`publish-task-pr`へ委譲してdraft Pull Requestを公開する。

## 完了を報告する

親レビューに合格した後、activeタスクファイルへ実施結果と検証結果を記録し、状態を `completed` にして `.agents/tasks/completed/<完了年>/` へ移す。この更新と移動はtask完了commitとする。同一リポジトリの実装commit SHAは必須にせず、別リポジトリの依存commitなど対応関係の確認に必要な場合だけ記録する。

タスク定義、実装、完了記録は同じtask branchへ含める。task file stem、branch、検証結果、未解決の疑問点、documentation follow-upをタスクごとに集約する。Cloudではcommitまで完了したら「実装とレビューが完了し、Pull Request公開はCodex Web UIから行う」旨を返す。Localでは1つのdraft Pull Requestへ公開する。公開後のレビュー修正も承認範囲が変わらない限り同じtask、branch、Pull Requestで扱い、責務や対象範囲が増える場合だけ新しいタスクへ分ける。
