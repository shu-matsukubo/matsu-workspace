#!/usr/bin/env sh

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
# shellcheck source=modules/lib.sh
. "$SCRIPT_DIR/modules/lib.sh"

usage() {
    printf 'Usage: sh scripts/promote-lock.sh <from-environment> <to-environment>\n' >&2
    exit 2
}

[ "$#" -eq 2 ] || usage
from_environment=$1
to_environment=$2

require_command git
require_command grep
init_workspace "$SCRIPT_DIR"
validate_manifest_shape
validate_environment "$from_environment"
validate_environment "$to_environment"
[ "$from_environment" != "$to_environment" ] || die "昇格元と昇格先が同じです。"
ensure_parent_files_clean
ensure_all_modules_clean

temp_lock=$(make_temp_file matsu-modules-lock)
cp "$LOCK_FILE" "$temp_lock"
promotion_complete=0

cleanup_promotion() {
    result=$?
    rm -f "$temp_lock"
    exit "$result"
}
trap cleanup_promotion EXIT HUP INT TERM

for module in $(module_paths); do
    commit=$(lock_commit "$module" "$from_environment")
    source_ref=$(lock_ref "$module" "$from_environment")
    [ -n "$commit" ] || die "$from_environment のlockがありません: $module"
    is_full_commit "$commit" || die "$from_environment のcommitは40桁SHAではありません: $module = $commit"
    set_lock_value_in "$temp_lock" "$module" "$to_environment" "$commit" "$source_ref"
    info "  昇格: $module @ $(printf '%s' "$commit" | cut -c1-12)"
done

mv "$temp_lock" "$LOCK_FILE"
promotion_complete=1
trap - EXIT HUP INT TERM

info "$from_environment と同じcommit一式を $to_environment へ昇格しました。"
info "commitやpush、worktreeの切替は行っていません。"
git -C "$WORKSPACE_ROOT" diff -- modules.lock.conf
