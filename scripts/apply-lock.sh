#!/usr/bin/env sh

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
# shellcheck source=modules/lib.sh
. "$SCRIPT_DIR/modules/lib.sh"

usage() {
    printf 'Usage: sh scripts/apply-lock.sh <development|staging|production>\n' >&2
    exit 2
}

[ "$#" -eq 1 ] || usage
environment=$1

require_command git
require_command grep
init_workspace "$SCRIPT_DIR"
validate_manifest_shape
validate_environment "$environment"
ensure_all_modules_clean

info "$environment lockの適用可否を確認しています..."
for module in $(module_paths); do
    commit=$(lock_commit "$module" "$environment")
    [ -n "$commit" ] || die "$environment のlockがありません: $module"
    is_full_commit "$commit" || die "$environment のcommitは40桁SHAではありません: $module = $commit"

    info "  fetch: $module"
    git_fetch_all "$module"
    git -C "$WORKSPACE_ROOT/$module" cat-file -e "$commit^{commit}" 2>/dev/null ||
        die "$module にlock commitが存在しません: $commit"
    commit_reachable_from_origin "$module" "$commit" ||
        die "$module のlock commitをoriginのbranchまたはtagで確認できません: $commit"
done

state_file=$(make_temp_file matsu-module-state)
apply_complete=0

cleanup_apply() {
    result=$?
    if [ "$apply_complete" -ne 1 ]; then
        printf '適用に失敗したため、変更済みモジュールを元のcheckoutへ戻します。\n' >&2
        while IFS='|' read -r module branch commit; do
            [ -n "$module" ] || continue
            restore_module_state "$module" "$branch" "$commit" || true
        done < "$state_file"
    fi
    rm -f "$state_file"
    exit "$result"
}
trap cleanup_apply EXIT HUP INT TERM

for module in $(module_paths); do
    repository="$WORKSPACE_ROOT/$module"
    branch=$(git -C "$repository" branch --show-current)
    current_commit=$(git -C "$repository" rev-parse HEAD)
    printf '%s|%s|%s\n' "$module" "$branch" "$current_commit" >> "$state_file"

    commit=$(lock_commit "$module" "$environment")
    git -C "$repository" checkout --detach "$commit"
    sync_nested_submodules "$module"
    info "  適用: $module @ $(printf '%s' "$commit" | cut -c1-12)"
done

sh "$SCRIPT_DIR/verify-lock.sh" "$environment"
apply_complete=1
info "$environment lockを適用しました。親gitlinkとの差分が出る場合があります。"
