#!/usr/bin/env sh

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

printf '%s\n' '[Cloud setup 1/2] サブモジュールを親gitlinkのcommitへ揃えます。'
sh "$SCRIPT_DIR/setup.sh"

printf '%s\n' '[Cloud setup 2/2] 各モジュールを開発branchへ同期します。'
sh "$SCRIPT_DIR/sync-dev-cloud.sh"

printf '%s\n' 'Codex Cloud用セットアップが完了しました。'
