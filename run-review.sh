#!/usr/bin/env bash
# run-review.sh
#
# Runs the automated conformance-review pass against a single commit and
# writes the structured markdown review to reviews/<full-sha>.md.
#
# Usage:
#   bash run-review.sh <commit-sha> <instructions-file-path>
#   bash run-review.sh --help
#
# Pass the literal string "none" as the second argument for ad-hoc commits
# that have no matching INSTRUCTIONS_*.md.
#
# Flags:
#   --force   Re-run and overwrite an existing reviews/<sha>.md.
#   --help    Print this header and exit 0.
#
# Exit codes:
#   0  approve   — no findings.
#   0  comment   — findings exist but none are blockers.
#   2  request_changes — at least one [blocker] finding; implementer must fix.
#   3  unparseable verdict — review file produced but verdict couldn't be read.
#   1  any setup / subprocess failure (bad SHA, missing files, claude error).
#
# Local-only. Do NOT call this from CI, git hooks, or any indirect mechanism.
# The implementer Claude Code session invokes it explicitly as the final
# verification step after simplify-and-verify.sh.

set -euo pipefail

# ---------------------------------------------------------------------------
# Argument + flag parsing
# ---------------------------------------------------------------------------
FORCE=false
ARGS=()
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
    --force)
      FORCE=true
      ;;
    *)
      ARGS+=("$arg")
      ;;
  esac
done

if [[ ${#ARGS[@]} -ne 2 ]]; then
  echo "Usage: bash run-review.sh <commit-sha> <instructions-file-path|none>" >&2
  exit 1
fi

COMMIT_SHA_INPUT="${ARGS[0]}"
INSTRUCTIONS_PATH="${ARGS[1]}"

if [[ -z "$COMMIT_SHA_INPUT" ]]; then
  echo "ERROR: empty commit SHA." >&2
  exit 1
fi

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"
if [[ -z "$REPO_ROOT" ]]; then
  echo "ERROR: not inside a git repository." >&2
  exit 1
fi
cd "$REPO_ROOT"

if ! COMMIT_SHA="$(git rev-parse --verify "$COMMIT_SHA_INPUT^{commit}" 2>/dev/null)"; then
  echo "ERROR: commit SHA does not resolve: $COMMIT_SHA_INPUT" >&2
  exit 1
fi
SHORT_SHA="${COMMIT_SHA:0:7}"
BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"

if [[ "$INSTRUCTIONS_PATH" != "none" && -n "$INSTRUCTIONS_PATH" ]]; then
  if [[ ! -f "$INSTRUCTIONS_PATH" ]]; then
    echo "ERROR: INSTRUCTIONS file not found: $INSTRUCTIONS_PATH" >&2
    exit 1
  fi
fi

REVIEWS_DIR="$REPO_ROOT/reviews"
PROMPT_FILE="$REVIEWS_DIR/PROMPT.md"
OUTPUT_FILE="$REVIEWS_DIR/${COMMIT_SHA}.md"

if [[ ! -f "$PROMPT_FILE" ]]; then
  echo "ERROR: prompt template missing: $PROMPT_FILE" >&2
  exit 1
fi

if [[ -f "$OUTPUT_FILE" && "$FORCE" != "true" ]]; then
  echo "Review already exists: ${OUTPUT_FILE#$REPO_ROOT/}"
  echo "Re-run with --force to overwrite."
  exit 0
fi

# ---------------------------------------------------------------------------
# Capture inputs to temp files (avoids shell quoting on diff/spec content)
# ---------------------------------------------------------------------------
TMPDIR_REVIEW="$(mktemp -d -t trivolta-review-XXXXXX)"
trap 'rm -rf "$TMPDIR_REVIEW"' EXIT

DIFF_FILE="$TMPDIR_REVIEW/diff.txt"
INSTRUCTIONS_TMP="$TMPDIR_REVIEW/instructions.txt"
CLAUDE_MD_TMP="$TMPDIR_REVIEW/claude_md.txt"
WORKFLOW_TMP="$TMPDIR_REVIEW/workflow_criteria.txt"
PROMPT_TMP="$TMPDIR_REVIEW/final_prompt.txt"

# git show: try with parent first; fall back to --root for the initial commit.
if git rev-parse --verify "$COMMIT_SHA^" >/dev/null 2>&1; then
  git show --stat --patch "$COMMIT_SHA" > "$DIFF_FILE"
else
  git show --stat --patch --root "$COMMIT_SHA" > "$DIFF_FILE"
fi

if [[ "$INSTRUCTIONS_PATH" != "none" && -n "$INSTRUCTIONS_PATH" ]]; then
  cat "$INSTRUCTIONS_PATH" > "$INSTRUCTIONS_TMP"
else
  printf '(no INSTRUCTIONS file — ad-hoc commit)\n' > "$INSTRUCTIONS_TMP"
fi

cat "$REPO_ROOT/CLAUDE.md" > "$CLAUDE_MD_TMP"

# Extract just the four-criteria section from WORKFLOW.md.
awk '
  /^## Diff Review — Four Criteria/ { capture = 1 }
  capture { print }
  capture && /^---$/ && NR > 1 { exit }
' "$REPO_ROOT/WORKFLOW.md" > "$WORKFLOW_TMP"

# ---------------------------------------------------------------------------
# Build the final prompt with Python (no sed/awk corruption of diff bodies)
# ---------------------------------------------------------------------------
python3 - "$PROMPT_FILE" "$COMMIT_SHA" "$INSTRUCTIONS_PATH" "$DIFF_FILE" "$INSTRUCTIONS_TMP" "$CLAUDE_MD_TMP" "$WORKFLOW_TMP" "$PROMPT_TMP" <<'PY'
import sys
prompt_file, commit_sha, instr_path_arg, diff_file, instr_tmp, claude_tmp, workflow_tmp, out_file = sys.argv[1:9]
with open(prompt_file, "r", encoding="utf-8") as f:
    template = f.read()
def read(p):
    with open(p, "r", encoding="utf-8") as fh:
        return fh.read()
sub = {
    "{{COMMIT_SHA}}": commit_sha,
    "{{INSTRUCTIONS_FILE}}": read(instr_tmp),
    "{{DIFF}}": read(diff_file),
    "{{CLAUDE_MD}}": read(claude_tmp),
    "{{WORKFLOW_CRITERIA}}": read(workflow_tmp),
}
for k, v in sub.items():
    template = template.replace(k, v)
with open(out_file, "w", encoding="utf-8") as fh:
    fh.write(template)
PY

# ---------------------------------------------------------------------------
# Invoke the reviewer subprocess
# ---------------------------------------------------------------------------
echo "Running conformance review for ${SHORT_SHA}..."

if ! claude -p "$(cat "$PROMPT_TMP")" --output-format text > "$OUTPUT_FILE" 2>"$TMPDIR_REVIEW/claude.err"; then
  echo "ERROR: reviewer subprocess failed:" >&2
  cat "$TMPDIR_REVIEW/claude.err" >&2
  rm -f "$OUTPUT_FILE"
  exit 1
fi

if [[ ! -s "$OUTPUT_FILE" ]]; then
  echo "ERROR: reviewer produced empty output." >&2
  rm -f "$OUTPUT_FILE"
  exit 1
fi

# ---------------------------------------------------------------------------
# Parse verdict + counts from YAML front matter
# ---------------------------------------------------------------------------
parse_field() {
  local field="$1"
  awk -v field="$field" '
    BEGIN { in_fm = 0 }
    /^---$/ { in_fm += 1; next }
    in_fm == 1 {
      if ($0 ~ "^[[:space:]]*"field"[[:space:]]*:") {
        sub("^[[:space:]]*"field"[[:space:]]*:[[:space:]]*", "")
        gsub(/^["'\'' ]+|["'\'' ]+$/, "")
        print tolower($0)
        exit
      }
    }
  ' "$OUTPUT_FILE"
}

VERDICT="$(parse_field verdict)"
FINDINGS_COUNT="$(parse_field findings_count)"
BLOCKERS_COUNT="$(parse_field blockers_count)"

REL_PATH="${OUTPUT_FILE#$REPO_ROOT/}"

case "$VERDICT" in
  approve)
    echo "Review for ${SHORT_SHA}: approve — ${FINDINGS_COUNT:-0} findings (${BLOCKERS_COUNT:-0} blocker[s]). See ${REL_PATH}."
    exit 0
    ;;
  comment)
    echo "Review for ${SHORT_SHA}: comment — ${FINDINGS_COUNT:-0} findings (${BLOCKERS_COUNT:-0} blocker[s]). See ${REL_PATH}."
    exit 0
    ;;
  request_changes)
    echo "Review for ${SHORT_SHA}: request_changes — ${FINDINGS_COUNT:-0} findings (${BLOCKERS_COUNT:-0} blocker[s]). See ${REL_PATH}."
    exit 2
    ;;
  *)
    echo "Review for ${SHORT_SHA}: review file produced but verdict is unparseable; manual inspection required. See ${REL_PATH}."
    exit 3
    ;;
esac
