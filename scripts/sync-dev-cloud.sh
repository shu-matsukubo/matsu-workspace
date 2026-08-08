#!/usr/bin/env sh

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
# shellcheck source=modules/lib.sh
. "$SCRIPT_DIR/modules/lib.sh"

require_command git
require_command grep
init_workspace "$SCRIPT_DIR"
validate_manifest_shape
ensure_all_modules_clean

info "Cloud用の開発branch更新可否を確認しています..."
for module in $(module_paths); do
    branch=$(dev_branch "$module")
    repository="$WORKSPACE_ROOT/$module"

    info "  fetch: $module (origin/$branch)"
    git_fetch_all "$module"
    git -C "$repository" show-ref --verify --quiet "refs/remotes/origin/$branch" ||
        die "$module に origin/$branch がありません。"

    current_branch=$(git -C "$repository" branch --show-current)
    if [ -n "$current_branch" ] && [ "$current_branch" != "$branch" ]; then
        die "$module は $current_branch 上です。$branch またはdetached HEADで実行してください。"
    fi

    if [ -n "$current_branch" ]; then
        if ! git -C "$repository" merge-base --is-ancestor HEAD "refs/remotes/origin/$branch"; then
            die "$module のHEADは origin/$branch へfast-forwardできません。local commitや分岐を確認してください。"
        fi
    else
        detached_commit=$(git -C "$repository" rev-parse HEAD)
        commit_reachable_from_origin "$module" "$detached_commit" ||
            die "$module のdetached HEADはoriginで確認できません。local-only commitを失わないよう停止します。"
    fi

    if git -C "$repository" show-ref --verify --quiet "refs/heads/$branch" &&
       ! git -C "$repository" merge-base --is-ancestor "refs/heads/$branch" "refs/remotes/origin/$branch"; then
        die "$module のlocal $branch は origin/$branch へfast-forwardできません。"
    fi
done

info "全モジュールをCloud用の開発branchへ揃えています..."
for module in $(module_paths); do
    branch=$(dev_branch "$module")
    repository="$WORKSPACE_ROOT/$module"
    current_branch=$(git -C "$repository" branch --show-current)

    if [ -z "$current_branch" ]; then
        if git -C "$repository" show-ref --verify --quiet "refs/heads/$branch"; then
            git -C "$repository" switch "$branch"
        else
            git -C "$repository" switch --track -c "$branch" "refs/remotes/origin/$branch"
        fi
    fi

    git -C "$repository" merge --ff-only "refs/remotes/origin/$branch"
    sync_nested_submodules "$module"
    info "  完了: $module -> $branch @ $(git -C "$repository" rev-parse --short=12 HEAD)"
done

info "Cloud用の開発branch同期が完了しました。親のcheckoutは変更せず、commitやpushも行っていません。"
