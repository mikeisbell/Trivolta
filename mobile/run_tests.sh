#!/bin/bash
# Run Trivolta Maestro test suite
# Usage: ./run_tests.sh [optional: single test filename]
# Example: ./run_tests.sh test_02_sign_up.yaml
#
# Prerequisites:
#   1. supabase start (from project root)
#   2. supabase functions serve --no-verify-jwt --env-file supabase/.env.local (separate terminal, from project root)
#   3. npx expo start then press 'i' (or npx expo run:ios --no-bundler for fresh build)
#   4. maestro/.env.maestro populated
#
# Maestro 2.5.0 parallelizes flows within a single shard, which breaks tests that share
# the test user created in test_02. We force sequential execution by running each flow
# as its own `maestro test` invocation.

set -a
source maestro/.env.maestro
set +a

# pipefail so the `maestro test ... | tee` pipeline reports maestro's exit
# code (PIPESTATUS[0]) instead of tee's. Without this the runner has been
# silently reporting [Passed] for every failed test since at least F2.
set -o pipefail

# Tests deferred as non-automatable under current architecture.
# Each requires manual verification before beta release.
# Reasons documented in each test_*.yaml header and in CLAUDE.md
# "Manual Test Verification" section.
# Single-file mode (./run_tests.sh test_NN_*.yaml) bypasses this list,
# so manual re-runs work without removing entries.
# test_18 has no yaml file — it is omitted from the suite by non-existence,
# not by this list.
SKIP_TESTS=("test_27_feedback_submit")

LOG=~/trivolta_test_output.txt
: > "$LOG"

run_one() {
  local file="$1"
  local name
  name=$(basename "$file" .yaml)
  echo "===== $name =====" | tee -a "$LOG"
  if maestro test \
        --env SUPABASE_URL="$SUPABASE_URL" \
        --env SUPABASE_SERVICE_KEY="$SUPABASE_SERVICE_KEY" \
        "$file" 2>&1 | tee -a "$LOG"; then
    echo "[Passed] $name" | tee -a "$LOG"
    return 0
  else
    echo "[Failed] $name" | tee -a "$LOG"
    return 1
  fi
}

if [ -n "$1" ]; then
  run_one "maestro/$1"
  exit $?
fi

passed=0
failed=0
skipped=0
failed_names=()
skipped_names=()
for f in maestro/test_*.yaml; do
  name=$(basename "$f" .yaml)
  skip=false
  for s in "${SKIP_TESTS[@]}"; do
    if [ "$name" = "$s" ]; then
      skip=true
      break
    fi
  done
  if [ "$skip" = "true" ]; then
    echo "[Skipped] $name" | tee -a "$LOG"
    skipped=$((skipped + 1))
    skipped_names+=("$name")
    continue
  fi
  if run_one "$f"; then
    passed=$((passed + 1))
  else
    failed=$((failed + 1))
    failed_names+=("$name")
  fi
done

echo "" | tee -a "$LOG"
echo "========================================" | tee -a "$LOG"
echo "Suite summary: $passed passed, $failed failed, $skipped skipped" | tee -a "$LOG"
if [ "$failed" -gt 0 ]; then
  echo "Failed flows:" | tee -a "$LOG"
  for n in "${failed_names[@]}"; do
    echo "  - $n" | tee -a "$LOG"
  done
fi
if [ "$skipped" -gt 0 ]; then
  echo "Skipped flows (manual verification required — see CLAUDE.md):" | tee -a "$LOG"
  for n in "${skipped_names[@]}"; do
    echo "  - $n" | tee -a "$LOG"
  done
fi
echo "========================================" | tee -a "$LOG"

[ "$failed" -eq 0 ]
