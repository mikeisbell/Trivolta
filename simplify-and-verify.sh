#!/usr/bin/env bash
# simplify-and-verify.sh
#
# Quality-pass wrapper: runs `claude /simplify` on the current HEAD, then
# re-runs the project's verification commands (from simplify-verify.cmds).
# If verification still passes, the simplifications are committed as a
# `chore: /simplify — <short-sha>` commit. If verification fails, the
# working tree is hard-reset to the pre-simplify HEAD and the run exits
# 0 (a revert is correct behavior, not a script failure).
#
# Usage:
#   bash simplify-and-verify.sh
#   bash simplify-and-verify.sh --dry-run   # run /simplify, never commit/revert
#   bash simplify-and-verify.sh --help
#
# Exit codes:
#   0  Always — including the "no simplifications" and "reverted" cases.
#      Verification failures inside the suite cause a revert, not a
#      script failure; that is by design.
#   1  Pre-flight error (uncommitted changes, missing tooling, bad git state).
#
# Local-only. Do not call from CI or any indirect mechanism.

set -euo pipefail

# ---------------------------------------------------------------------------
# Flag parsing
# ---------------------------------------------------------------------------
DRY_RUN=false
for arg in "$@"; do
  case "$arg" in
    --help|-h)
      awk '
        NR == 1 { next }
        /^#/ { sub(/^# ?/, ""); print; next }
        { exit }
      ' "${BASH_SOURCE[0]}"
      exit 0
      ;;
    --dry-run)
      DRY_RUN=true
      ;;
    *)
      echo "ERROR: unknown flag: $arg" >&2
      echo "Run with --help for usage." >&2
      exit 1
      ;;
  esac
done

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"
if [[ -z "$REPO_ROOT" ]]; then
  echo "ERROR: not inside a git repository." >&2
  exit 1
fi
cd "$REPO_ROOT"

VERIFY_CMDS="$REPO_ROOT/simplify-verify.cmds"
if [[ ! -f "$VERIFY_CMDS" ]]; then
  echo "ERROR: missing $VERIFY_CMDS" >&2
  exit 1
fi

# Require a clean tree — /simplify needs a known starting point.
if [[ -n "$(git status --porcelain)" ]]; then
  echo "ERROR: uncommitted changes detected. Commit or stash before running simplify." >&2
  git status --short >&2
  exit 1
fi

PRE_SIMPLIFY_SHA="$(git rev-parse HEAD)"
SHORT_SHA="${PRE_SIMPLIFY_SHA:0:7}"

REVIEWS_DIR="$REPO_ROOT/reviews"
mkdir -p "$REVIEWS_DIR"
LOG_FILE="$REVIEWS_DIR/${SHORT_SHA}.simplify-log.md"

# ---------------------------------------------------------------------------
# Version gate — /simplify shipped in claude 2.1.63.
# ---------------------------------------------------------------------------
if ! command -v claude >/dev/null 2>&1; then
  echo "claude CLI not found in PATH; skipping /simplify pass."
  exit 0
fi

CLAUDE_VERSION_RAW="$(claude --version 2>/dev/null | head -1)"
CLAUDE_VERSION="$(printf '%s' "$CLAUDE_VERSION_RAW" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)"

version_ge() {
  # version_ge X Y  →  returns 0 if X >= Y semver-style.
  local a b
  a="$(printf '%s\n' "$1" "$2" | sort -V | head -1)"
  [[ "$a" == "$2" ]]
}

if [[ -z "$CLAUDE_VERSION" ]] || ! version_ge "$CLAUDE_VERSION" "2.1.63"; then
  echo "/simplify requires claude >= 2.1.63 (detected: ${CLAUDE_VERSION:-unknown}). Skipping."
  exit 0
fi

# ---------------------------------------------------------------------------
# Run /simplify in a non-interactive subprocess
# ---------------------------------------------------------------------------
{
  echo "# /simplify forensic log — ${SHORT_SHA}"
  echo
  echo "claude version: ${CLAUDE_VERSION_RAW}"
  echo "pre-simplify HEAD: ${PRE_SIMPLIFY_SHA}"
  echo "dry-run: ${DRY_RUN}"
  echo
  echo "## stdout"
  echo
  echo '```'
} > "$LOG_FILE"

set +e
claude -p '/simplify' --output-format text >> "$LOG_FILE" 2>&1
SIMPLIFY_EXIT=$?
set -e

{
  echo '```'
  echo
  echo "claude /simplify exit: ${SIMPLIFY_EXIT}"
} >> "$LOG_FILE"

if [[ -z "$(git status --porcelain)" ]]; then
  echo "no simplifications suggested"
  echo "(forensic log: ${LOG_FILE#$REPO_ROOT/})"
  exit 0
fi

# ---------------------------------------------------------------------------
# Dry-run: report changes but do not commit.
# ---------------------------------------------------------------------------
if [[ "$DRY_RUN" == "true" ]]; then
  echo "dry-run: /simplify produced changes (not committed):"
  git status --short
  echo "(forensic log: ${LOG_FILE#$REPO_ROOT/})"
  exit 0
fi

# ---------------------------------------------------------------------------
# Verification suite
# ---------------------------------------------------------------------------
run_verification() {
  while IFS= read -r cmd; do
    [[ -z "$cmd" || "$cmd" =~ ^# ]] && continue
    echo "+ $cmd"
    if ! bash -c "$cmd"; then
      echo "Verification failed: $cmd" >&2
      return 1
    fi
  done < "$VERIFY_CMDS"
  return 0
}

CHANGED_FILE_COUNT="$(git status --porcelain | wc -l | tr -d ' ')"

if run_verification; then
  git add -A
  git commit -m "chore: /simplify — ${SHORT_SHA}" >/dev/null
  echo "simplification accepted, ${CHANGED_FILE_COUNT} files changed"
  echo "(forensic log: ${LOG_FILE#$REPO_ROOT/})"
  exit 0
else
  git reset --hard "$PRE_SIMPLIFY_SHA" >/dev/null
  echo "simplification reverted (verification failed)"
  echo "(forensic log preserved: ${LOG_FILE#$REPO_ROOT/})"
  exit 0
fi
