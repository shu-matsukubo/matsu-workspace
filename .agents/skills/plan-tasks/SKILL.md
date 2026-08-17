---
name: plan-tasks
description: 変更作業を始める前に、要件をレビュー可能な単一責務のタスクへ分解し、依存関係・完了条件・懸念点・確認事項を整理して承認を求める。実装、修正、文書更新など書き込みを伴う依頼で使用し、調査・説明・レビューだけの読み取り作業では使用しない。
---

# タスクを計画する

## 前提を確認する

1. ワークスペースルートから対象までの `AGENTS.md` を読み、より近い指示を優先して統合する。
2. 関連するREADME、設計文書、manifest、workflowを読み、現在の構成と正本を確認する。
3. 公式の仕様や推奨構成が関係する場合は最新版を確認する。依頼と差異があれば、理由と影響を示して提案する。
4. 読み取りだけの依頼か、ファイルや外部状態を変更する依頼かを区別する。読み取りだけなら承認待ちタスク一覧は要求しない。

## タスクを分割する

- 1タスクを1つの責務と1つのレビュー可能な成果へ限定する。
- 独立リポジトリをまたぐ変更は、原則としてリポジトリごとに分ける。
- 子モジュールの変更を先に置き、そのmerge後に必要となる親gitlink・lock更新を別タスクにする。
- 依頼範囲外の改善は実装へ混ぜず、任意の追加タスクとして分離する。
- 不明点が結果を大きく変える場合は確認事項にする。現状から確定できる内容を質問しない。
- 依存タスクは着手可否を決める制約として整理し、着手可能なタスクの優先度を `high`、`normal`、`low` から選ぶ。明確な理由がなければ `normal` とする。
- Issue駆動では最新計画コメントを承認前の正本とし、revision、comment URL、plan SHA-256、source SHA-256、source境界のowner comment IDを付ける。過去の計画や単なる実装開始コメントを承認対象にしない。
- 各taskへ一意なkey、title、repository、work、agent strategy、completion、dependencies、parent Issue、approved plan、concernsを付ける。priority、verification mode、out-of-scopeも必要に応じて明示し、計画、dispatch、child Issue、task fileを同じ承認内容のprojectionとして扱う。
- agent strategyは、軽量で明確な変更に`parent-only`、通常は`worker-parent-review`、高リスク・大規模・境界が複雑な変更だけに`worker-reviewer-parent`を選ぶ。どの方式でも実装担当はself reviewし、親agentがいる方式では親がdiffと検証結果を直接確認する。
- documentation modeは通常taskの`follow-up-only`を既定とし、ユーザーが文書本文の更新をtaskへ明示的に含めた場合だけ`explicit-update`とする。`explicit-update`でも承認されたwork、out-of-scope、completionを越えて文書範囲を広げない。
- 依存関係ごとに対象、`hard`・`soft`・`ordering`、`start`・`complete`・`publish`・`merge`のgate、完了条件、現在状態の根拠を記録する。softは着手禁止にせず、orderingは実装開始ではなく公開・merge順だけを制約する。
- 計画時に現在状態から依存グラフを構築し、自己依存、直接・間接循環、Issue・task・Pull Request・child change・parent gitlink/lockをまたぐ循環を検査する。循環時は全taskを依存待ちにせず、経路、解消案、先行可能なtask、必要なユーザー判断を示す。

## レビュー用一覧を提出する

各タスクに次を含める。

- タスクIDと概要
- 優先度と対象リポジトリ
- 作業内容
- 完了条件
- 依存対象（Issue、task、Pull Request、child change、parent gitlink・lock）
- 依存関係の種類、gate、完了条件、現在状態の根拠
- 想定される懸念事項
- agent strategy
- 親Issueと承認対象のrevision、plan/source SHA-256、source境界owner comment ID（通常承認では会話内の承認識別情報）
- ユーザーへ確認したい事項（必要な場合のみ）

推奨案がある確認事項は、推奨する選択肢と理由を明記する。タスク一覧、想定ディレクトリ構成、文書ごとの責務、横断的な懸念点をまとめ、変更を開始せずユーザーの承認を待つ。

## 承認範囲を固定する

承認されたタスクID、選択された確認事項、対象リポジトリ、agent strategy、明示的に除外された内容を固定する。Issue駆動では承認対象のrevision、comment URL、plan/source SHA-256、source境界のowner comment IDも固定し、dispatch直前に未回答質問、境界後のowner入力、前提変更、依存対象とCIの現在状態を再取得する。純粋な承認コメントはsource境界を動かさず、要件変更を含む場合はdispatchせず再計画へ戻す。

Cloudの親Issueでは承認後に対象repositoryを実装せず、承認済みtaskを変更しないversioned dispatch blockへ変換してGitHub Actionsへ渡す。child Issueが人間に確認され明示起動された後、そのexecution packetから対象repositoryのactive task fileを実施記録として生成する。Issueを経由しないLocal実行では、対象リポジトリと `YYYY-MM-DD-<short-kebab-case-summary>.md` のファイル名を実装担当へ引き継ぎ、実装前に承認内容をactive task fileとしてcommitさせる。いずれもtask fileへ第二の承認内容を作らず、承認外の変更が必要なら新しいタスクとして提示する。
