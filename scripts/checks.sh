#!/bin/bash
# Runs typecheck, lint, and tests in parallel.
# Shows a summary of each check and exits with failure if any check fails.

RED='\033[0;31m'
GREEN='\033[0;32m'
BOLD='\033[1m'
RESET='\033[0m'

TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT

# Run all three checks in parallel, capturing output and exit codes
yarn typecheck > "$TMPDIR/typecheck.out" 2>&1 &
PID_TC=$!

yarn lint > "$TMPDIR/lint.out" 2>&1 &
PID_LINT=$!

yarn test > "$TMPDIR/test.out" 2>&1 &
PID_TEST=$!

# Wait for each and capture exit codes
wait $PID_TC
EC_TC=$?

wait $PID_LINT
EC_LINT=$?

wait $PID_TEST
EC_TEST=$?

FAILED=0
echo ""

# --- TypeScript ---
if [ $EC_TC -eq 0 ]; then
  echo -e "${GREEN}${BOLD}✓ TypeScript${RESET}"
else
  echo -e "${RED}${BOLD}✗ TypeScript${RESET}"
  cat "$TMPDIR/typecheck.out"
  FAILED=1
fi

# --- ESLint ---
if [ $EC_LINT -eq 0 ]; then
  echo -e "${GREEN}${BOLD}✓ ESLint${RESET}"
else
  echo -e "${RED}${BOLD}✗ ESLint${RESET}"
  cat "$TMPDIR/lint.out"
  FAILED=1
fi

# --- Tests ---
if [ $EC_TEST -eq 0 ]; then
  FILES=$(sed 's/\x1b\[[0-9;]*m//g' "$TMPDIR/test.out" | grep -E '^\s*Test Files\s' | xargs)
  TESTS=$(sed 's/\x1b\[[0-9;]*m//g' "$TMPDIR/test.out" | grep -E '^\s*Tests\s' | xargs)
  echo -e "${GREEN}${BOLD}✓ Tests${RESET}  ${FILES} | ${TESTS}"
else
  echo -e "${RED}${BOLD}✗ Tests${RESET}"
  cat "$TMPDIR/test.out"
  FAILED=1
fi

echo ""
if [ $FAILED -ne 0 ]; then
  echo -e "${RED}${BOLD}Checks failed${RESET}"
  exit 1
else
  echo -e "${GREEN}${BOLD}All checks passed${RESET}"
fi
