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

set -a
source maestro/.env.maestro
set +a

TARGET=${1:-maestro/}
if [ -n "$1" ]; then
  TARGET="maestro/$1"
fi

maestro test \
  --env SUPABASE_URL="$SUPABASE_URL" \
  --env SUPABASE_SERVICE_KEY="$SUPABASE_SERVICE_KEY" \
  "$TARGET" 2>&1 | tee ~/trivolta_test_output.txt
