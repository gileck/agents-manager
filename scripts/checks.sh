#!/bin/bash
# Runs typecheck, lint, and tests sequentially.
# Shows a summary of each check and exits with failure if any check fails.

RED='\033[0;31m'
GREEN='\033[0;32m'
DIM='\033[2m'
BOLD='\033[1m'
RESET='\033[0m'

FAILED=0
echo ""

# --- TypeScript ---
START=$SECONDS
yarn typecheck > /tmp/checks-typecheck.out 2>&1
EC_TC=$?
TIME_TC=$(( SECONDS - START ))

if [ "$EC_TC" -eq 0 ]; then
  echo -e "${GREEN}${BOLD}✓ TypeScript${RESET}  ${DIM}${TIME_TC}s${RESET}"
else
  echo -e "${RED}${BOLD}✗ TypeScript${RESET}  ${DIM}${TIME_TC}s${RESET}"
  cat /tmp/checks-typecheck.out
  FAILED=1
fi

# --- ESLint ---
START=$SECONDS
yarn lint > /tmp/checks-lint.out 2>&1
EC_LINT=$?
TIME_LINT=$(( SECONDS - START ))

if [ "$EC_LINT" -eq 0 ]; then
  echo -e "${GREEN}${BOLD}✓ ESLint${RESET}  ${DIM}${TIME_LINT}s${RESET}"
else
  echo -e "${RED}${BOLD}✗ ESLint${RESET}  ${DIM}${TIME_LINT}s${RESET}"
  cat /tmp/checks-lint.out
  FAILED=1
fi

# --- Tests ---
START=$SECONDS
TEST_TIMEOUT=${TEST_TIMEOUT:-30000}
yarn test --testTimeout "$TEST_TIMEOUT" > /tmp/checks-test.out 2>&1
EC_TEST=$?
TIME_TEST=$(( SECONDS - START ))

if [ "$EC_TEST" -eq 0 ]; then
  FILES=$(sed 's/\x1b\[[0-9;]*m//g' /tmp/checks-test.out | grep -E '^\s*Test Files\s' | xargs)
  TESTS=$(sed 's/\x1b\[[0-9;]*m//g' /tmp/checks-test.out | grep -E '^\s*Tests\s' | xargs)
  echo -e "${GREEN}${BOLD}✓ Tests${RESET}  ${DIM}${TIME_TEST}s${RESET}  ${FILES} | ${TESTS}"
else
  echo -e "${RED}${BOLD}✗ Tests${RESET}  ${DIM}${TIME_TEST}s${RESET}"
  cat /tmp/checks-test.out
  FAILED=1
fi

echo ""
if [ $FAILED -ne 0 ]; then
  echo -e "${RED}${BOLD}Checks failed${RESET}"
  exit 1
else
  echo -e "${GREEN}${BOLD}All checks passed${RESET}"
fi
