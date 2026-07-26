#!/usr/bin/env sh

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
# shellcheck source=modules/lib.sh
. "$SCRIPT_DIR/modules/lib.sh"

usage() {
    cat >&2 <<'USAGE'
Usage:
  sh scripts/update-lock.sh <environment> <module-path> <ref>
  sh scripts/update-lock.sh <environment> --from-worktree

Examples:
  sh scripts/update-lock.sh staging apps/matsu-front v1.2.0
  sh scripts/update-lock.sh staging --from-worktree
USAGE
    exit 2
}

[ "$#" -ge 2 ] || usage
environment=$1
mode=$2

require_command git
require_command grep
init_workspace "$SCRIPT_DIR"
validate_manifest_shape
validate_environment "$environment"
ensure_parent_files_clean
ensure_all_modules_clean

temp_lock=$(make_temp_file matsu-modules-lock)
cp "$LOCK_FILE" "$temp_lock"
update_complete=0

cleanup_update() {
    result=$?
    rm -f "$temp_lock"
    exit "$result"
}
trap cleanup_update EXIT HUP INT TERM

if [ "$mode" = "--from-worktree" ]; then
    [ "$#" -eq 2 ] || usage
    info "現在の全モジュールHEADを $environment lockへ記録します..."

    for module in $(module_paths); do
        repository="$WORKSPACE_ROOT/$module"
        git_fetch_all "$module"
        commit=$(git -C "$repository" rev-parse HEAD)
        commit_reachable_from_origin "$module" "$commit" ||
            die "$module のHEADはoriginへpush済みのbranchまたはtagで確認できません: $commit"

        branch=$(git -C "$repository" branch --show-current)
        if [ -n "$branch" ] &&
           git -C "$repository" show-ref --verify --quiet "refs/remotes/origin/$branch" &&
           [ "$(git -C "$repository" rev-parse "refs/remotes/origin/$branch")" = "$commit" ]; then
            source_ref="refs/remotes/origin/$branch"
        else
            source_ref="$commit"
            for tag_ref in $(git -C "$repository" for-each-ref --format='%(refname)' --points-at "$commit" refs/tags); do
                source_ref=$tag_ref
                break
            done
        fi

        set_lock_value_in "$temp_lock" "$module" "$environment" "$commit" "$source_ref"
        info "  記録: $module @ $(printf '%s' "$commit" | cut -c1-12)"
    done
else
    [ "$#" -eq 3 ] || usage
    module=$mode
    requested_ref=$3
    module_exists "$module" || die ".gitmodules に存在しないmoduleです: $module"

    git_fetch_all "$module"
    resolved=$(resolve_ref "$module" "$requested_ref")
    commit=${resolved%%|*}
    source_ref=${resolved#*|}
    commit_reachable_from_origin "$module" "$commit" ||
        die "$module の指定commitをoriginのbranchまたはtagで確認できません: $commit"

    set_lock_value_in "$temp_lock" "$module" "$environment" "$commit" "$source_ref"
    info "更新候補: $environment / $module = $commit ($source_ref)"
fi

mv "$temp_lock" "$LOCK_FILE"
update_complete=1
trap - EXIT HUP INT TERM

info "modules.lock.conf を更新しました。commitやpush、worktreeの切替は行っていません。"
info "差分を確認してください:"
git -C "$WORKSPACE_ROOT" diff -- modules.lock.conf
