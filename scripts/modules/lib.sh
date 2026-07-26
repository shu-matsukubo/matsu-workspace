#!/usr/bin/env sh

# matsu-workspace のモジュール管理スクリプトで共有する関数です。
# Bash 固有機能を避け、Git Bash と一般的な POSIX shell の両方で動作させます。

die() {
    printf 'ERROR: %s\n' "$*" >&2
    exit 1
}

info() {
    printf '%s\n' "$*"
}

init_workspace() {
    script_dir=$1
    WORKSPACE_ROOT=$(git -C "$script_dir" rev-parse --show-toplevel 2>/dev/null) ||
        die "matsu-workspace のGitルートを特定できません。"
    GITMODULES_FILE="$WORKSPACE_ROOT/.gitmodules"
    DEV_MANIFEST_FILE="$WORKSPACE_ROOT/modules.dev.conf"
    LOCK_FILE="$WORKSPACE_ROOT/modules.lock.conf"

    [ -f "$GITMODULES_FILE" ] || die ".gitmodules が見つかりません。"
    [ -f "$DEV_MANIFEST_FILE" ] || die "modules.dev.conf が見つかりません。"
    [ -f "$LOCK_FILE" ] || die "modules.lock.conf が見つかりません。"
}

require_command() {
    command -v "$1" >/dev/null 2>&1 || die "必要なコマンドが見つかりません: $1"
}

validate_environment() {
    case "$1" in
        development|staging|production) ;;
        *) die "環境は development、staging、production のいずれかを指定してください: $1" ;;
    esac
}

module_paths() {
    git config --file "$GITMODULES_FILE" --get-regexp '^submodule\..*\.path$' |
        while IFS=' ' read -r _key path; do
            case "$path" in
                *[[:space:]]*) die "空白を含むサブモジュールpathには対応していません: $path" ;;
            esac
            printf '%s\n' "$path"
        done
}

module_exists() {
    module=$1
    configured=$(git config --file "$GITMODULES_FILE" --get "submodule.$module.path" 2>/dev/null || true)
    [ "$configured" = "$module" ]
}

module_url() {
    git config --file "$GITMODULES_FILE" --get "submodule.$1.url"
}

dev_branch() {
    git config --file "$DEV_MANIFEST_FILE" --get "module.$1.branch"
}

lock_commit_from() {
    lock_file=$1
    module=$2
    environment=$3
    git config --file "$lock_file" --get "module.$module.$environment" 2>/dev/null || true
}

lock_ref_from() {
    lock_file=$1
    module=$2
    environment=$3
    git config --file "$lock_file" --get "module.$module.${environment}Ref" 2>/dev/null || true
}

lock_commit() {
    lock_commit_from "$LOCK_FILE" "$1" "$2"
}

lock_ref() {
    lock_ref_from "$LOCK_FILE" "$1" "$2"
}

set_lock_value_in() {
    lock_file=$1
    module=$2
    environment=$3
    commit=$4
    source_ref=$5

    git config --file "$lock_file" --replace-all "module.$module.$environment" "$commit"
    if [ -n "$source_ref" ]; then
        git config --file "$lock_file" --replace-all "module.$module.${environment}Ref" "$source_ref"
    else
        git config --file "$lock_file" --unset-all "module.$module.${environment}Ref" 2>/dev/null || true
    fi
}

is_full_commit() {
    printf '%s\n' "$1" | grep -Eq '^[0-9a-f]{40}$'
}

ensure_module_initialized() {
    module=$1
    git -C "$WORKSPACE_ROOT/$module" rev-parse --is-inside-work-tree >/dev/null 2>&1 ||
        die "$module が初期化されていません。先に scripts/setup.sh を実行してください。"
}

ensure_module_clean() {
    module=$1
    ensure_module_initialized "$module"
    status=$(git -C "$WORKSPACE_ROOT/$module" status --porcelain --untracked-files=normal)
    if [ -n "$status" ]; then
        printf '%s\n' "$status" >&2
        die "$module に未commit変更があります。"
    fi
}

ensure_all_modules_clean() {
    for module in $(module_paths); do
        ensure_module_clean "$module"
    done
}

ensure_parent_files_clean() {
    # stage済みgitlinkは意図的な親変更なので拒否する。
    # 未stageのgitlink差分は、子リポジトリで開発していれば通常発生するため許可する。
    if ! git -C "$WORKSPACE_ROOT" diff --cached --quiet --ignore-submodules=none -- ||
       ! git -C "$WORKSPACE_ROOT" diff --quiet --ignore-submodules=all -- ||
       [ -n "$(git -C "$WORKSPACE_ROOT" ls-files --others --exclude-standard)" ]; then
        git -C "$WORKSPACE_ROOT" status --short >&2
        die "親リポジトリにstage済み変更、通常ファイルの変更、または未追跡ファイルがあります。"
    fi
}

git_fetch_all() {
    module=$1
    case "$(uname -s 2>/dev/null || printf unknown)" in
        MINGW*|MSYS*|CYGWIN*)
            git -c http.sslBackend=schannel -C "$WORKSPACE_ROOT/$module" fetch --prune --tags origin
            ;;
        *)
            git -C "$WORKSPACE_ROOT/$module" fetch --prune --tags origin
            ;;
    esac
}

sync_nested_submodules() {
    module=$1
    repository="$WORKSPACE_ROOT/$module"
    git -C "$repository" submodule sync --recursive

    case "$(uname -s 2>/dev/null || printf unknown)" in
        MINGW*|MSYS*|CYGWIN*)
            git -c http.sslBackend=schannel -C "$repository" \
                submodule update --init --recursive
            ;;
        *)
            git -C "$repository" submodule update --init --recursive
            ;;
    esac
}

commit_reachable_from_origin() {
    module=$1
    commit=$2
    repository="$WORKSPACE_ROOT/$module"

    for remote_ref in $(git -C "$repository" for-each-ref \
        --format='%(refname)' refs/remotes/origin); do
        if git -C "$repository" merge-base --is-ancestor "$commit" "$remote_ref" 2>/dev/null; then
            return 0
        fi
    done

    # local-only tagをpush済みと誤認しないよう、originが広告するtagを直接確認する。
    if git -C "$repository" ls-remote --tags origin 2>/dev/null |
        grep -Eq "^$commit[[:space:]]+refs/tags/"; then
        return 0
    fi

    return 1
}

resolve_ref() {
    module=$1
    requested=$2
    repository="$WORKSPACE_ROOT/$module"

    if is_full_commit "$requested"; then
        git -C "$repository" cat-file -e "$requested^{commit}" 2>/dev/null ||
            die "$module にcommitが存在しません: $requested"
        printf '%s|%s\n' "$requested" "$requested"
        return
    fi

    if git -C "$repository" show-ref --verify --quiet "refs/tags/$requested"; then
        commit=$(git -C "$repository" rev-parse "refs/tags/$requested^{commit}")
        printf '%s|refs/tags/%s\n' "$commit" "$requested"
        return
    fi

    if git -C "$repository" show-ref --verify --quiet "refs/remotes/origin/$requested"; then
        commit=$(git -C "$repository" rev-parse "refs/remotes/origin/$requested^{commit}")
        printf '%s|refs/remotes/origin/%s\n' "$commit" "$requested"
        return
    fi

    if git -C "$repository" rev-parse --verify --quiet "$requested^{commit}" >/dev/null; then
        commit=$(git -C "$repository" rev-parse "$requested^{commit}")
        printf '%s|%s\n' "$commit" "$requested"
        return
    fi

    die "$module でrefを解決できません: $requested"
}

restore_module_state() {
    module=$1
    branch=$2
    commit=$3
    repository="$WORKSPACE_ROOT/$module"

    if [ -n "$branch" ]; then
        git -C "$repository" switch "$branch" >/dev/null 2>&1 ||
            git -C "$repository" checkout "$branch" >/dev/null 2>&1
    else
        git -C "$repository" checkout --detach "$commit" >/dev/null 2>&1
    fi
    sync_nested_submodules "$module" >/dev/null 2>&1
}

validate_manifest_shape() {
    manifest_version=$(git config --file "$DEV_MANIFEST_FILE" --get manifest.version 2>/dev/null || true)
    lock_version=$(git config --file "$LOCK_FILE" --get lock.version 2>/dev/null || true)
    [ "$manifest_version" = "1" ] ||
        die "modules.dev.conf のversionが未対応です: $manifest_version"
    [ "$lock_version" = "1" ] ||
        die "modules.lock.conf のversionが未対応です: $lock_version"

    for module in $(module_paths); do
        branch=$(dev_branch "$module" 2>/dev/null || true)
        [ -n "$branch" ] || die "modules.dev.conf にbranchがありません: $module"
    done

    git config --file "$DEV_MANIFEST_FILE" --get-regexp '^module\..*\.branch$' |
        while IFS=' ' read -r key _branch; do
            module=${key#module.}
            module=${module%.branch}
            module_exists "$module" ||
                die "modules.dev.conf に未知のmoduleがあります: $module"
        done
}

make_temp_file() {
    template=$1
    mktemp "${TMPDIR:-/tmp}/$template.XXXXXX"
}
