#!/usr/bin/env sh

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
# shellcheck source=modules/lib.sh
. "$SCRIPT_DIR/modules/lib.sh"

usage() {
    printf 'Usage: sh scripts/verify-lock.sh <development|staging|production>\n' >&2
    exit 2
}

[ "$#" -eq 1 ] || usage
environment=$1

require_command git
require_command grep
init_workspace "$SCRIPT_DIR"
validate_manifest_shape
validate_environment "$environment"

failed=0
info "$environment lockを検証しています..."
for module in $(module_paths); do
    commit=$(lock_commit "$module" "$environment")
    source_ref=$(lock_ref "$module" "$environment")

    if [ -z "$commit" ]; then
        printf '  NG: %s - lockなし\n' "$module" >&2
        failed=1
        continue
    fi
    if ! is_full_commit "$commit"; then
        printf '  NG: %s - 40桁SHAではありません: %s\n' "$module" "$commit" >&2
        failed=1
        continue
    fi
    if ! git -C "$WORKSPACE_ROOT/$module" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
        printf '  NG: %s - 未初期化\n' "$module" >&2
        failed=1
        continue
    fi

    actual=$(git -C "$WORKSPACE_ROOT/$module" rev-parse HEAD)
    dirty=$(git -C "$WORKSPACE_ROOT/$module" status --porcelain --untracked-files=normal)
    if [ "$actual" != "$commit" ]; then
        printf '  NG: %s - HEAD=%s / lock=%s\n' "$module" "$actual" "$commit" >&2
        failed=1
    elif [ -n "$dirty" ]; then
        printf '  NG: %s - 未commit変更あり\n' "$module" >&2
        failed=1
    elif ! git -C "$WORKSPACE_ROOT/$module" cat-file -e "$commit^{commit}" 2>/dev/null; then
        printf '  NG: %s - commit objectなし: %s\n' "$module" "$commit" >&2
        failed=1
    else
        printf '  OK: %s @ %s' "$module" "$(printf '%s' "$commit" | cut -c1-12)"
        [ -n "$source_ref" ] && printf ' (source: %s)' "$source_ref"
        printf '\n'
    fi

    case "$source_ref" in
        refs/tags/*)
            tag_commit=$(git -C "$WORKSPACE_ROOT/$module" rev-parse "$source_ref^{commit}" 2>/dev/null || true)
            if [ "$tag_commit" != "$commit" ]; then
                printf '  NG: %s - tagとlock SHAが一致しません: %s\n' "$module" "$source_ref" >&2
                failed=1
            fi
            ;;
    esac
done

[ "$failed" -eq 0 ] || die "$environment lockの検証に失敗しました。"
info "$environment lockと全モジュールのHEADが一致しています。"
