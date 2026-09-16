#!/usr/bin/env bash

set -euo pipefail

readonly OWNERSHIP_MARKER='.gem-pr-review-copilot-owned'
readonly LEASE_MARKER='.gem-pr-review-copilot-lease'
readonly INSTALL_PREFIX='gem-pr-review-copilot.'
readonly STALE_INSTALL_RETENTION_SECONDS=$((7 * 24 * 60 * 60))

fail() {
  echo "::error title=Gem PR Review::$1" >&2
  exit 1
}

warn() {
  echo "::warning title=Gem PR Review::$1" >&2
}

canonical_directory() {
  local directory="$1"
  [ -d "$directory" ] && [ ! -L "$directory" ] || return 1
  (
    cd "$directory"
    pwd -P
  )
}

file_owner() {
  stat -c '%u' "$1" 2>/dev/null || stat -f '%u' "$1"
}

file_mode() {
  stat -c '%a' "$1" 2>/dev/null || stat -f '%Lp' "$1"
}

file_modified_at() {
  stat -c '%Y' "$1" 2>/dev/null || stat -f '%m' "$1"
}

validate_runner_temp() {
  local runner_temp
  local mode

  runner_temp="$(canonical_directory "$1")" || return 1
  [ "$(file_owner "$runner_temp")" = "$(id -u)" ] || return 1
  mode="$(file_mode "$runner_temp")"
  [[ "$mode" =~ ^[0-7]{3}$ ]] || return 1
  case "${mode:1}" in
    *[2367]*)
      return 1
      ;;
  esac
  printf '%s\n' "$runner_temp"
}

validate_install_path() {
  local install_path="$1"
  local parent_directory="$2"
  local canonical_install

  case "$install_path" in
    /*)
      ;;
    *)
      return 1
      ;;
  esac
  [ ! -L "$install_path" ] || return 1
  canonical_install="$(canonical_directory "$install_path")" || return 1
  [ "$(dirname "$canonical_install")" = "$parent_directory" ] || return 1
  [ "$(file_owner "$canonical_install")" = "$(id -u)" ] || return 1
  [ "$(file_mode "$canonical_install")" = '700' ] || return 1
  case "$(basename "$canonical_install")" in
    "$INSTALL_PREFIX"*)
      ;;
    *)
      return 1
      ;;
  esac
  printf '%s\n' "$canonical_install"
}

read_created_at() {
  local install_path="$1"
  local marker="$install_path/$OWNERSHIP_MARKER"
  local version
  local install_id
  local created_at
  local extra

  [ -f "$marker" ] && [ ! -L "$marker" ] || return 1
  {
    IFS= read -r version || return 1
    IFS= read -r install_id || return 1
    IFS= read -r created_at || return 1
    if IFS= read -r extra; then
      return 1
    fi
  } < "$marker"
  [ "$version" = 'version=2' ] || return 1
  case "$created_at" in
    created_at=*)
      created_at="${created_at#created_at=}"
      ;;
    *)
      return 1
      ;;
  esac
  [ "$install_id" = "install_id=$(basename "$install_path")" ] || return 1
  [[ "$created_at" =~ ^[0-9]{10}$ ]] || return 1
  printf '%s\n' "$created_at"
  return 0
}

process_start_time() {
  local pid="$1"

  ps -o lstart= -p "$pid" 2>/dev/null | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//'
}

process_state() {
  local pid="$1"

  ps -o stat= -p "$pid" 2>/dev/null | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//'
}

read_process_identity() {
  local marker="$1"
  local pid
  local started_at
  local extra

  [ -f "$marker" ] && [ ! -L "$marker" ] || return 1
  {
    IFS= read -r pid || return 1
    IFS= read -r started_at || return 1
    if IFS= read -r extra; then
      return 1
    fi
  } < "$marker"
  case "$pid" in
    pid=*)
      pid="${pid#pid=}"
      ;;
    *)
      return 1
      ;;
  esac
  case "$started_at" in
    started_at=*)
      started_at="${started_at#started_at=}"
      ;;
    *)
      return 1
      ;;
  esac
  [[ "$pid" =~ ^[1-9][0-9]*$ ]] || return 1
  [ -n "$started_at" ] && [[ "$started_at" != *'|'* ]] || return 1
  printf '%s|%s\n' "$pid" "$started_at"
  return 0
}

read_lease() {
  read_process_identity "$1/$LEASE_MARKER"
}

is_lease_active() {
  local pid="$1"
  local expected_started_at="$2"
  local actual_started_at
  local state

  kill -0 "$pid" 2>/dev/null || return 1
  state="$(process_state "$pid")" || return 1
  [[ "$state" != Z* ]] || return 1
  actual_started_at="$(process_start_time "$pid")" || return 1
  [ "$actual_started_at" = "$expected_started_at" ]
}

release_install_lock_if_owner() {
  local lock_directory="$1"
  local expected_identity="$2"
  local actual_identity

  if [ -n "$expected_identity" ]; then
    actual_identity="$(read_process_identity "$lock_directory/pid" || true)"
    [ -n "$actual_identity" ] && [ "$actual_identity" != "$expected_identity" ] &&
      return 0
  # An empty identity means lock setup did not finish, so remove only an
  # empty lock directory that no other invocation could have claimed.
  elif [ -e "$lock_directory/pid" ] || [ -L "$lock_directory/pid" ]; then
    return 0
  fi
  rm -f -- "$lock_directory/pid"
  rmdir -- "$lock_directory"
}

with_install_lock() (
  local install_path="$1"
  local runner_temp="$2"
  local lock_directory
  local lock_identity
  local lock_pid
  local lock_started_at
  local lock_modified_at
  local lock_owner_started_at
  local lock_owner_identity=''
  local now

  shift 2
  lock_directory="$runner_temp/.gem-pr-review-copilot-lock.$(basename "$install_path")"
  if ! (
    umask 077
    mkdir "$lock_directory"
  ); then
    [ -d "$lock_directory" ] && [ ! -L "$lock_directory" ] ||
      return 75
    [ "$(canonical_directory "$lock_directory")" = "$lock_directory" ] ||
      return 75
    [ "$(file_owner "$lock_directory")" = "$(id -u)" ] &&
      [ "$(file_mode "$lock_directory")" = '700' ] ||
      return 75
    if lock_identity="$(read_process_identity "$lock_directory/pid")"; then
      lock_pid="${lock_identity%%|*}"
      lock_started_at="${lock_identity#*|}"
      is_lease_active "$lock_pid" "$lock_started_at" && return 75
    else
      # Metadata that names no holder (never written, or a write cut short) is
      # reclaimed only once the lock itself is past the retention window, so a
      # lock another invocation is still setting up is never stolen.
      lock_modified_at="$(file_modified_at "$lock_directory")" || return 75
      now="$(date +%s)"
      [ "$lock_modified_at" -le "$now" ] &&
        [ $((now - lock_modified_at)) -ge "$STALE_INSTALL_RETENTION_SECONDS" ] ||
        return 75
    fi
    # An interrupted marker write can leave a staged file behind, so clear those too;
    # rmdir still fails closed on anything else the lock directory may hold.
    rm -f -- "$lock_directory/pid" "$lock_directory"/.gem-pr-review-copilot-marker.* &&
      rmdir -- "$lock_directory" || return 75
    (
      umask 077
      mkdir "$lock_directory"
    ) || return 75
  fi
  trap 'release_install_lock_if_owner "$lock_directory" "$lock_owner_identity"' EXIT
  lock_owner_started_at="$(process_start_time "$BASHPID")" || return 75
  lock_owner_identity="$BASHPID|$lock_owner_started_at"
  # Publish the record atomically: a partial pid file names no holder and would
  # keep every later invocation out of this install until the lock ages out.
  write_marker "$lock_directory/pid" "pid=$BASHPID" "started_at=$lock_owner_started_at" ||
    return 75
  "$@"
)

write_marker() {
  local marker="$1"
  local staged_marker

  shift
  staged_marker="$(mktemp "$(dirname "$marker")/.gem-pr-review-copilot-marker.XXXXXX")" ||
    return 1
  # Hard-link the staged file into place: link(2) never follows the marker path, and
  # -n keeps ln from treating a symlink to a directory as the destination directory.
  if ! printf '%s\n' "$@" > "$staged_marker" || ! ln -fn -- "$staged_marker" "$marker"; then
    rm -f -- "$staged_marker"
    return 1
  fi
  rm -f -- "$staged_marker"
}

initialize_install_locked() {
  local canonical_install="$1"
  local created_at="$2"
  local lease_pid="$3"
  local now
  local ownership_marker

  [[ "$created_at" =~ ^[0-9]{10}$ ]] ||
    fail 'Copilot CLI install ownership timestamp is invalid.'
  now="$(date +%s)"
  [ "$created_at" -le "$now" ] ||
    fail 'Copilot CLI install ownership timestamp is invalid.'
  ownership_marker="$canonical_install/$OWNERSHIP_MARKER"
  [ ! -e "$ownership_marker" ] && [ ! -L "$ownership_marker" ] ||
    fail 'Copilot CLI install ownership marker already exists.'
  write_marker "$ownership_marker" 'version=2' \
    "install_id=$(basename "$canonical_install")" "created_at=$created_at" ||
    fail 'Could not write Copilot CLI install ownership marker.'
  if ! update_lease "$canonical_install" "$lease_pid"; then
    rm -f -- "$ownership_marker"
    fail 'Copilot CLI install lease metadata is invalid.'
  fi
}

update_lease() {
  local install_path="$1"
  local lease_pid="$2"
  local marker="$install_path/$LEASE_MARKER"
  local started_at

  [[ "$lease_pid" =~ ^[1-9][0-9]*$ ]] ||
    return 1
  [ ! -L "$marker" ] ||
    return 1
  started_at="$(process_start_time "$lease_pid")" ||
    return 1
  write_marker "$marker" "pid=$lease_pid" "started_at=$started_at"
}

initialize_install() {
  local install_path="$1"
  local created_at="$2"
  local lease_pid="$3"
  local runner_temp_root="$4"
  local runner_temp
  local canonical_install

  runner_temp="$(validate_runner_temp "$runner_temp_root")" ||
    fail 'RUNNER_TEMP is unavailable.'
  canonical_install="$(validate_install_path "$install_path" "$runner_temp")" ||
    fail 'Unexpected Copilot CLI install path.'
  with_install_lock "$canonical_install" "$runner_temp" \
    initialize_install_locked "$canonical_install" "$created_at" "$lease_pid" ||
    fail 'Copilot CLI install is being changed by another invocation.'
}

activate_lease_locked() {
  local canonical_install="$1"
  local lease_pid="$2"

  read_created_at "$canonical_install" >/dev/null ||
    fail 'Copilot CLI install ownership marker is invalid.'
  update_lease "$canonical_install" "$lease_pid" ||
    fail 'Copilot CLI install lease metadata is invalid.'
}

activate_lease() {
  local install_path="$1"
  local lease_pid="$2"
  local runner_temp_root="$3"
  local runner_temp
  local canonical_install

  runner_temp="$(validate_runner_temp "$runner_temp_root")" ||
    fail 'RUNNER_TEMP is unavailable.'
  canonical_install="$(validate_install_path "$install_path" "$runner_temp")" ||
    fail 'Unexpected Copilot CLI install path.'
  with_install_lock "$canonical_install" "$runner_temp" \
    activate_lease_locked "$canonical_install" "$lease_pid" ||
    fail 'Copilot CLI install is being changed by another invocation.'
}

remove_install_via_quarantine() {
  local install_path="$1"
  local runner_temp="$2"
  local quarantine_root
  local quarantine_install

  quarantine_root="$(mktemp -d "$runner_temp/.gem-pr-review-copilot-quarantine.XXXXXX")" ||
    fail 'Could not create Copilot CLI cleanup quarantine.'
  quarantine_install="$quarantine_root/install"
  if ! mv "$install_path" "$quarantine_install"; then
    rm -rf -- "$quarantine_root"
    fail 'Copilot CLI install path changed during cleanup.'
  fi
  rm -rf -- "$quarantine_root"
}

remove_current_install_locked() {
  local canonical_install="$1"
  local runner_temp="$2"
  local created_at
  local lease
  local lease_pid
  local lease_started_at
  local now

  canonical_install="$(validate_install_path "$canonical_install" "$runner_temp")" ||
    fail 'Unexpected Copilot CLI install path.'
  created_at="$(read_created_at "$canonical_install")" ||
    fail 'Copilot CLI install ownership marker is invalid.'
  lease="$(read_lease "$canonical_install")" ||
    fail 'Copilot CLI install lease metadata is invalid.'
  lease_pid="${lease%%|*}"
  lease_started_at="${lease#*|}"
  if is_lease_active "$lease_pid" "$lease_started_at"; then
    fail 'Copilot CLI install is still active.'
  fi
  now="$(date +%s)"
  [ "$created_at" -le "$now" ] ||
    fail 'Copilot CLI install ownership marker is invalid.'
  remove_install_via_quarantine "$canonical_install" "$runner_temp"
}

remove_current_install() {
  local install_path="$1"
  local runner_temp_root="$2"
  local runner_temp
  local canonical_install

  runner_temp="$(validate_runner_temp "$runner_temp_root")" ||
    fail 'RUNNER_TEMP is unavailable.'
  canonical_install="$(validate_install_path "$install_path" "$runner_temp")" ||
    fail 'Unexpected Copilot CLI install path.'
  with_install_lock "$canonical_install" "$runner_temp" \
    remove_current_install_locked "$canonical_install" "$runner_temp" ||
    fail 'Copilot CLI install is being changed by another invocation.'
}

# Prints the canonical install when it is owned and past the retention window.
# Returns 1 when the install must be kept, warning when its metadata is unusable.
stale_install_candidate() {
  local install_path="$1"
  local runner_temp="$2"
  local now="$3"
  local canonical_install
  local created_at

  canonical_install="$(validate_install_path "$install_path" "$runner_temp")" || {
    warn 'Skipping Copilot CLI install with an invalid path.'
    return 1
  }
  created_at="$(read_created_at "$canonical_install")" || {
    warn 'Skipping Copilot CLI install without a valid ownership marker.'
    return 1
  }
  if [ "$created_at" -gt "$now" ]; then
    warn 'Skipping Copilot CLI install with future ownership metadata.'
    return 1
  fi
  [ $((now - created_at)) -ge "$STALE_INSTALL_RETENTION_SECONDS" ] ||
    return 1
  printf '%s\n' "$canonical_install"
}

prune_stale_install_locked() {
  local canonical_install="$1"
  local runner_temp="$2"
  local now="$3"
  local lease_marker
  local lease
  local lease_pid
  local lease_started_at

  # Re-check under the lock: the install may have changed since it was discovered.
  canonical_install="$(stale_install_candidate "$canonical_install" "$runner_temp" "$now")" ||
    return 0
  lease_marker="$canonical_install/$LEASE_MARKER"
  if [ ! -e "$lease_marker" ] && [ ! -L "$lease_marker" ]; then
    remove_install_via_quarantine "$canonical_install" "$runner_temp"
    return 0
  fi
  lease="$(read_lease "$canonical_install")" || {
    warn 'Skipping Copilot CLI install without valid lease metadata.'
    return 0
  }
  lease_pid="${lease%%|*}"
  lease_started_at="${lease#*|}"
  if is_lease_active "$lease_pid" "$lease_started_at"; then
    return 0
  fi
  remove_install_via_quarantine "$canonical_install" "$runner_temp"
}

prune_abandoned_quarantines() {
  local runner_temp="$1"
  local now="$2"
  local candidate
  local canonical_candidate
  local modified_at

  shopt -s nullglob
  for candidate in "$runner_temp"/.gem-pr-review-copilot-quarantine.*; do
    [ -d "$candidate" ] && [ ! -L "$candidate" ] || continue
    canonical_candidate="$(canonical_directory "$candidate")" || continue
    [ "$(dirname "$canonical_candidate")" = "$runner_temp" ] ||
      continue
    [ "$(file_owner "$canonical_candidate")" = "$(id -u)" ] &&
      [ "$(file_mode "$canonical_candidate")" = '700' ] ||
      continue
    modified_at="$(file_modified_at "$canonical_candidate")" || continue
    [[ "$modified_at" =~ ^[0-9]{10}$ ]] &&
      [ "$modified_at" -le "$now" ] &&
      [ $((now - modified_at)) -ge "$STALE_INSTALL_RETENTION_SECONDS" ] ||
      continue
    rm -rf -- "$canonical_candidate"
  done
}

prune_stale_installs() {
  local runner_temp_root="$1"
  local runner_temp
  local now
  local candidate
  local canonical_install
  local lock_status

  runner_temp="$(validate_runner_temp "$runner_temp_root")" ||
    fail 'RUNNER_TEMP is unavailable.'
  now="$(date +%s)"
  prune_abandoned_quarantines "$runner_temp" "$now"
  shopt -s nullglob
  for candidate in "$runner_temp"/"$INSTALL_PREFIX"*; do
    # Filter before locking so cleanup never contends for the locks of fresh
    # installs that concurrent invocations are still using.
    canonical_install="$(stale_install_candidate "$candidate" "$runner_temp" "$now")" ||
      continue
    if with_install_lock "$canonical_install" "$runner_temp" \
      prune_stale_install_locked "$canonical_install" "$runner_temp" "$now"; then
      continue
    else
      lock_status="$?"
    fi
    if [ "$lock_status" -eq 75 ]; then
      warn 'Skipping Copilot CLI install being changed by another invocation.'
    else
      fail 'Could not remove stale Copilot CLI install.'
    fi
  done
}

# The environment is read only here; operations receive their inputs explicitly.
runner_temp_root="${RUNNER_TEMP:-/tmp}"
case "${1:-}" in
  prune-stale)
    [ "$#" -eq 1 ] || fail 'Unexpected Copilot CLI cleanup arguments.'
    prune_stale_installs "$runner_temp_root"
    ;;
  cleanup-current)
    [ "$#" -eq 2 ] || fail 'Unexpected Copilot CLI cleanup arguments.'
    remove_current_install "$2" "$runner_temp_root"
    ;;
  # Leases belong to the invoking step shell, never to a caller-chosen PID.
  initialize-install)
    [ "$#" -eq 3 ] || fail 'Unexpected Copilot CLI cleanup arguments.'
    initialize_install "$2" "$3" "$PPID" "$runner_temp_root"
    ;;
  activate-lease)
    [ "$#" -eq 2 ] || fail 'Unexpected Copilot CLI cleanup arguments.'
    activate_lease "$2" "$PPID" "$runner_temp_root"
    ;;
  *)
    fail 'Unknown Copilot CLI cleanup command.'
    ;;
esac
