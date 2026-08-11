#!/usr/bin/env sh

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
# shellcheck source=modules/lib.sh
. "$SCRIPT_DIR/modules/lib.sh"

require_command git
init_workspace "$SCRIPT_DIR"

lock_file_list=$(make_temp_file matsu-dependency-lock-files)
cleanup() {
    rm -f "$lock_file_list"
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM

installed_projects=0

for module in $(module_paths); do
    ensure_module_initialized "$module"
    repository="$WORKSPACE_ROOT/$module"
    module_has_lock=false

    git -C "$repository" ls-files >"$lock_file_list" ||
        die "Git管理対象ファイルを取得できませんでした: module=$module"

    while IFS= read -r lock_file; do
        case "/$lock_file" in
            */node_modules/*|*/vendor/*) continue ;;
        esac

        case "$lock_file" in
            package-lock.json|*/package-lock.json)
                manager=npm
                manifest_name=package.json
                install_command='npm ci'
                ;;
            composer.lock|*/composer.lock)
                manager=composer
                manifest_name=composer.json
                install_command='composer install --no-interaction --prefer-dist'
                ;;
            *) continue ;;
        esac

        module_has_lock=true
        case "$lock_file" in
            */*) project_dir=${lock_file%/*} ;;
            *) project_dir=. ;;
        esac
        lock_name=${lock_file##*/}
        project_path="$repository/$project_dir"
        if [ "$project_dir" = . ]; then
            project_label=$module
        else
            project_label="$module/$project_dir"
        fi

        [ -f "$project_path/$lock_name" ] ||
            die "Git管理対象のlock fileが作業ツリーにありません: module=$module project=$project_label lock=$lock_file"
        [ -f "$project_path/$manifest_name" ] ||
            die "lock fileに対応するmanifestがありません: module=$module project=$project_label process=$install_command manifest=$manifest_name"
        command -v "$manager" >/dev/null 2>&1 ||
            die "依存関係のinstall commandが見つかりません: module=$module project=$project_label process=$install_command command=$manager"

        info "  install: module=$module project=$project_label process=$install_command"
        case "$manager" in
            npm)
                if ! (cd "$project_path" && npm ci); then
                    die "依存関係のinstallに失敗しました: module=$module project=$project_label process=$install_command"
                fi
                ;;
            composer)
                if ! (cd "$project_path" && composer install --no-interaction --prefer-dist); then
                    die "依存関係のinstallに失敗しました: module=$module project=$project_label process=$install_command"
                fi
                ;;
        esac

        installed_projects=$((installed_projects + 1))
    done <"$lock_file_list"

    if [ "$module_has_lock" = false ]; then
        info "  skip: module=$module reason=対応するGit管理対象lock fileなし"
    fi
done

info "依存関係のインストールが完了しました: projects=$installed_projects"
