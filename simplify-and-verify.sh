#!/usr/bin/env bash
# simplify-and-verify.sh
#
# Quality-pass wrapper: runs `claude /simplify` on the current HEAD, then
# re-runs the project's verification commands (from simplify-verify.cmds).
# Every successful invocation lands exactly one `chore:` commit on HEAD,
# so the next run starts on a clean working tree:
#   chore: /simplify — <sha>            (changes accepted)
#   chore: /simplify reverted — <sha>   (changes failed verification)
#   chore: /simplify ran clean — <sha>  (no changes suggested)
# In all three cases the forensic log is committed under
# reviews/<short-sha>.simplify-log.md.
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
# Constants
# ---------------------------------------------------------------------------

# /simplify non-interactive flags. Tested against claude 2.1.126.
# Without --permission-mode acceptEdits, `claude -p '/simplify'` pauses
# asking for permission to apply file edits and the subprocess hangs
# (observed in commit 81c59d8's forensic log). acceptEdits is the
# narrowest of the available permission modes — it auto-accepts file
# edits only, not arbitrary tool use. See INSTRUCTIONS_REVIEW_PIPELINE_FIXES.md
# for the discovery procedure.
CLAUDE_SIMPLIFY_FLAGS=(--output-format text --permission-mode acceptEdits)

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

# Forensic log lives outside the working tree until we know whether we're
# committing or reverting. After the decision, we copy it into
# reviews/<short-sha>.simplify-log.md as part of a single chore commit.
# This keeps the working tree clean across runs (Defect B fix).
EXTERNAL_LOG_DIR="${TMPDIR:-/tmp}/trivolta-simplify-logs"
mkdir -p "$EXTERNAL_LOG_DIR"
EXTERNAL_LOG="$EXTERNAL_LOG_DIR/${SHORT_SHA}.md"
REPO_LOG="$REVIEWS_DIR/${SHORT_SHA}.simplify-log.md"
LOG_FILE="$EXTERNAL_LOG"

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
  local a
  a="$(printf '%s\n' "$1" "$2" | sort -V | head -1)"
  [[ "$a" == "$2" ]]
}

if [[ -z "$CLAUDE_VERSION" ]] || ! version_ge "$CLAUDE_VERSION" "2.1.63"; then
  echo "/simplify requires claude >= 2.1.63 (detected: ${CLAUDE_VERSION:-unknown}). Skipping."
  exit 0
fi

# ---------------------------------------------------------------------------
# commit_log_artifact — single helper that closes every branch.
# Copies the external forensic log into reviews/, stages it, optionally
# stages all other changes (when /simplify produced accepted changes),
# and commits with the supplied message.
# ---------------------------------------------------------------------------
commit_log_artifact() {
  local commit_msg="$1"
  local stage_all="${2:-no}"
  cp "$EXTERNAL_LOG" "$REPO_LOG"
  git add "$REPO_LOG"
  if [[ "$stage_all" == "yes" ]]; then
    git add -A
  fi
  git commit -m "$commit_msg" >/dev/null
}

# ---------------------------------------------------------------------------
# Run /simplify in a non-interactive subprocess. Output goes to the
# external log (outside the working tree).
# ---------------------------------------------------------------------------
{
  echo "# /simplify forensic log — ${SHORT_SHA}"
  echo
  echo "claude version: ${CLAUDE_VERSION_RAW}"
  echo "pre-simplify HEAD: ${PRE_SIMPLIFY_SHA}"
  echo "dry-run: ${DRY_RUN}"
  echo "claude flags: ${CLAUDE_SIMPLIFY_FLAGS[*]}"
  echo
  echo "## stdout"
  echo
  echo '```'
} > "$LOG_FILE"

set +e
claude -p '/simplify' "${CLAUDE_SIMPLIFY_FLAGS[@]}" >> "$LOG_FILE" 2>&1
SIMPLIFY_EXIT=$?
set -e

{
  echo '```'
  echo
  echo "claude /simplify exit: ${SIMPLIFY_EXIT}"
} >> "$LOG_FILE"

# ---------------------------------------------------------------------------
# Branch on /simplify's actual effect on the working tree.
# ---------------------------------------------------------------------------
if [[ -z "$(git status --porcelain)" ]]; then
  if [[ "$DRY_RUN" == "true" ]]; then
    echo "dry-run: no simplifications suggested"
    echo "(external forensic log: ${EXTERNAL_LOG})"
    exit 0
  fi
  commit_log_artifact "chore: /simplify ran clean — ${SHORT_SHA}" no
  echo "no simplifications suggested (committed log artifact)"
  echo "(external forensic log: ${EXTERNAL_LOG})"
  exit 0
fi

# ---------------------------------------------------------------------------
# Dry-run: report changes but do not commit or revert. Discard them
# from the working tree so subsequent runs start clean.
# ---------------------------------------------------------------------------
if [[ "$DRY_RUN" == "true" ]]; then
  echo "dry-run: /simplify produced changes (not committed):"
  git status --short
  echo "(external forensic log: ${EXTERNAL_LOG})"
  git reset --hard "$PRE_SIMPLIFY_SHA" >/dev/null
  echo "dry-run: working tree restored to ${SHORT_SHA}"
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
  commit_log_artifact "chore: /simplify — ${SHORT_SHA}" yes
  echo "simplification accepted, ${CHANGED_FILE_COUNT} files changed (committed log artifact)"
  echo "(external forensic log: ${EXTERNAL_LOG})"
  exit 0
else
  git reset --hard "$PRE_SIMPLIFY_SHA" >/dev/null
  commit_log_artifact "chore: /simplify reverted — ${SHORT_SHA}" no
  echo "simplification reverted (verification failed; committed log artifact)"
  echo "(external forensic log: ${EXTERNAL_LOG})"
  exit 0
fi
