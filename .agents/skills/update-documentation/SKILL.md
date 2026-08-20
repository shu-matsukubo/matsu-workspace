---
name: update-documentation
description: 通常の実装taskでは文書影響をdocumentation follow-upとして記録し、別schedulerまたはユーザーが明示承認したdocumentation taskでだけREADME、横断docs、AGENTS.md、skillsの適切な一箇所を日本語で更新する。
---

# documentation影響を分離して扱う

## 呼び出しモードを確定する

このskillは次の2つの責務を混同しない。

1. 通常の実装taskから呼ばれた場合は、文書影響を判定してfollow-upを記録するだけで本文を変更しない。
2. 別schedulerまたはユーザーが明示承認したdocumentation taskから呼ばれた場合だけ、正本の文書を更新して検証する。

呼び出し元の承認範囲でどちらか確定できない場合は、文書を書き換えずfollow-up記録へ限定する。

documentation modeはtask作成時または実装開始時に確定する。実装後に判明したdocumentation影響は新しい方針ではなく`documentation follow-up required`等の実施結果として記録し、そのbookkeepingだけで追加承認を要求しない。文書本文を新たに更新する、対象文書や責務を広げる、または承認済みwork・out-of-scope・completionを変える場合だけ再計画・再承認へ戻る。

開始時に確定した実行コンテキスト、公開モード、判定根拠は、`AGENTS.md`の共通契約と`.github/scripts/task-execution-policy.cjs`から下流skillへ引き継ぐruntime bookkeepingである。このskillはtask・prompt本文から再判定せず、documentation判断によって公開モードを変更しない。

## 更新要否を判定する

次のいずれかが変わる場合に文書更新を検討する。

- 利用者が行うセットアップ、起動、開発、最小運用
- サービス責務、依存関係、システム構成
- API契約、認証・セッション境界
- CI、静的解析、品質ゲート
- AIが毎回守る共通ルール、または再利用する詳細手順

通常実装では、影響があってもREADME、`docs`、利用者・開発者向け文書を変更しない。task fileまたは実施結果へ`documentation follow-up required`として、何が変わったか、影響する可能性がある既存文書、更新が必要な理由だけを記録する。内部実装だけが変わり、設計や利用方法へ影響しない場合はfollow-up不要と記録する。ユーザーが文書更新を元のtaskへ明示的に含めた場合だけ例外とする。

## 明示的なdocumentation taskで配置先を選ぶ

- `README.md`: 新規参加者向けの概要、環境構築、起動、開発、最小運用
- 横断 `docs`: 基本設計、API、認証、CI、静的解析、システム構成
- `AGENTS.md`: AIが毎回守る短い共通ルールと開発方針
- `skills`: 反復可能な詳細手順。1skillを1責務に限定する

子モジュール固有の内容は子側を優先し、横断設計だけを `matsu-docs` に置く。別リポジトリへ同時に変更が必要なら、独立したタスクとPull Requestに分ける。新しいトップレベル文書カテゴリはユーザー承認なしに追加しない。

## 事実を確認する

- API契約はOpenAPIが存在する場合にOpenAPIを正本とし、存在しない場合は実装と自動テストで確認する。
- コマンドとCIはmanifest、Compose、workflowを確認する。
- 未導入のCIや将来案を、現在の機能として記載しない。
- secret、実運用の認証情報、不要な内部実装を記載しない。

## 明示承認された文書を簡潔に更新する

日本語で、読者が判断や作業に必要な内容だけを書く。詳細手順の重複を避け、正本へのリンクを使う。子READMEから横断設計へリンクするときは、`matsu-docs` の `main` 上の該当文書を参照する。

明示的なdocumentation taskで本文を更新した場合は、見出し構造、相対リンクと外部リンク、用語、隣接文書との重複、formatを確認する。コード差分の説明を文書へ転記しない。通常実装のfollow-up記録では、対象候補と理由が具体的で、文書本文の変更が混入していないことを確認する。
