#!/usr/bin/env sh

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
# shellcheck source=modules/lib.sh
. "$SCRIPT_DIR/modules/lib.sh"

require_command git
init_workspace "$SCRIPT_DIR"
validate_manifest_shape

info "サブモジュール設定を同期しています..."
git -C "$WORKSPACE_ROOT" submodule sync --recursive

info "親リポジトリが記録したcommitへサブモジュールを揃えています..."
case "$(uname -s 2>/dev/null || printf unknown)" in
    MINGW*|MSYS*|CYGWIN*)
        git -c http.sslBackend=schannel -C "$WORKSPACE_ROOT" \
            submodule update --init --recursive
        ;;
    *)
        git -C "$WORKSPACE_ROOT" submodule update --init --recursive
        ;;
esac

info "サブモジュールを親gitlinkのcommitへ揃えました。"
