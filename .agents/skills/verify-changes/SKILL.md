---
name: verify-changes
description: 変更内容と対象リポジトリに応じた最小十分な品質ゲートを選び、format、lint、型・静的解析、テスト、build、生成物整合を安全に検証する。実装後、レビュー修正後、Pull Request作成前に使用する。
---

# 変更を検証する

## 検証経路を決める

1. 対象リポジトリの `AGENTS.md`、README、manifest、workflow、テスト設定を読む。
2. 変更した責務に対応する既存コマンドを選ぶ。別リポジトリの手順を推測で持ち込まない。
3. 文書だけの変更では、リンク、format、生成規則、`git diff --check` を優先し、無関係な全テストを必須にしない。
4. コードや設定の変更では、format、lint・静的解析、型チェック、対象テスト、buildを影響に比例して選ぶ。
5. OpenAPIや生成型を変更した場合は、再生成とGit管理中の生成物の一致を確認する。
6. 検証モードを`normal`または`issue-ci-delegated`として明示する。通常実行では従来どおり必要な品質ゲートを実行する。
7. 通常実装taskでdocumentation影響がある場合は本文を変更せず、`documentation follow-up required`の対象と理由が実施結果へ記録されていることを確認する。
8. task fileまたはtrusted execution packetに開始時点の実行コンテキスト、公開モード、判定根拠が記録され、`.github/scripts/task-execution-policy.cjs`の結果が下流から再判定されていないことを確認する。prompt本文は判定材料にしない。`unknown` / `remote-stopped`でもremote公開以外の検証・review・commitを止めない。

## Issue駆動のCI委譲を判定する

- `issue-ci-delegated`では必要なテストコードを追加・更新し、対象repositoryの既存workflowが変更責務のtest、lint・静的解析、buildを確実に実行することをファイルとjob単位で確認する。
- テストスイート本体をローカル実行しない場合は「未実行・CI委譲中」と記録する。未実行を成功扱いにしない。
- `git diff --check`、差分確認、YAML・設定構文など安全で軽量な検証は必要に応じて実行する。
- Issue flowまたはChild Task Dispatcherを変更した場合は、対応するNode.js syntax checkとunit test、dependency/hash tests、workflow YAMLの構文確認を既存CI coverageと同じ組み合わせで実行する。trusted author、厳格schema、allowlist、冪等性、partial rerun、dependency保持、secret未設定を回帰対象に含める。
- コード変更を覆うCIが存在しない、またはcoverageを確定できない場合は実装前の確認事項として止める。文書だけの変更は、軽量検証と残るリスクを明示できる。
- CI結果を同じCodexタスク内でポーリングしない。失敗後の修正と再検証は同じtask、branch、Pull Requestで扱う。

## 安全に実行する

- Windows PowerShellでNode.jsコマンドを実行するときは、必要に応じて `npm.cmd` を使う。
- リポジトリが指定するDocker経路を優先し、host toolchainの差を理由にソースを変更しない。
- DB統合テストは専用のテストDBを使い、通常の開発DB、named volume、別サービスのDBを共有しない。
- テストのためにsecretや本番認証情報を作成・記録しない。
- 自動修正コマンドを使った場合はdiffを再確認し、対象外の変更を混入させない。

## 結果を記録する

実行したコマンド、成功・失敗、対象範囲をtask fileへbookkeepingとして記録し、この更新だけで追加承認を要求しない。CIへ委譲した項目はworkflow/job、対象コマンド、現在の未実行状態をtask fileとPull Requestへ記録する。環境不足や外部要因で実行できない検証は、未実施理由、代替確認、残るリスクを明示する。失敗を無視して合格扱いにしない。

最後に `git diff --check`、`git status`、baseからのdiffを確認し、生成物、lockfile、意図しないファイルが残っていないことを確認する。
