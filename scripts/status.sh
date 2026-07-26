#!/usr/bin/env sh

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
# shellcheck source=modules/lib.sh
. "$SCRIPT_DIR/modules/lib.sh"

require_command git
init_workspace "$SCRIPT_DIR"
validate_manifest_shape

print_repository() {
    label=$1
    repository=$2

    printf '\n[%s]\n' "$label"
    if ! git -C "$repository" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
        printf '  state:    not initialized\n'
        return
    fi

    branch=$(git -C "$repository" branch --show-current)
    [ -n "$branch" ] || branch="(detached)"
    commit=$(git -C "$repository" rev-parse --short=12 HEAD 2>/dev/null || printf '(no commits)')
    dirty=$(git -C "$repository" status --porcelain --untracked-files=normal)
    [ -z "$dirty" ] && state=clean || state=dirty

    printf '  branch:   %s\n' "$branch"
    printf '  commit:   %s\n' "$commit"
    printf '  state:    %s\n' "$state"
}

printf 'matsu workspace status\n'
printf '======================\n'
print_repository parent "$WORKSPACE_ROOT"

for module in $(module_paths); do
    print_repository "$module" "$WORKSPACE_ROOT/$module"
    printf '  dev:      origin/%s\n' "$(dev_branch "$module")"
    actual=$(git -C "$WORKSPACE_ROOT/$module" rev-parse HEAD 2>/dev/null || true)

    for environment in development staging production; do
        commit=$(lock_commit "$module" "$environment")
        if [ -z "$commit" ]; then
            printf '  lock %-11s (未設定)\n' "$environment:"
        elif [ "$actual" = "$commit" ]; then
            printf '  lock %-11s %.12s (HEADと一致)\n' "$environment:" "$commit"
        else
            printf '  lock %-11s %.12s\n' "$environment:" "$commit"
        fi
    done
done
