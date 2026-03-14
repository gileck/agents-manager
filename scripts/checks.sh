#!/bin/bash
# Runs typecheck, lint, and tests in parallel.
# Shows a summary of each check and exits with failure if any check fails.

RED='\033[0;31m'
GREEN='\033[0;32m'
DIM='\033[2m'
BOLD='\033[1m'
RESET='\033[0m'

TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT

echo ""
echo -e "${DIM}Running TypeScript, ESLint, Tests in parallel...${RESET}"
echo ""

# Wrapper that records wall-clock seconds into a file
run_timed() {
  local name=$1; shift
  local start=$SECONDS
  "$@" > "$TMPDIR/${name}.out" 2>&1
  echo $? > "$TMPDIR/${name}.ec"
  echo $(( SECONDS - start )) > "$TMPDIR/${name}.time"
}

run_timed typecheck yarn typecheck &
run_timed lint yarn lint &
run_timed test yarn test &

wait

EC_TC=$(cat "$TMPDIR/typecheck.ec")
EC_LINT=$(cat "$TMPDIR/lint.ec")
EC_TEST=$(cat "$TMPDIR/test.ec")
TIME_TC=$(cat "$TMPDIR/typecheck.time")
TIME_LINT=$(cat "$TMPDIR/lint.time")
TIME_TEST=$(cat "$TMPDIR/test.time")

FAILED=0

# --- TypeScript ---
if [ "$EC_TC" -eq 0 ]; then
  echo -e "${GREEN}${BOLD}✓ TypeScript${RESET}  ${DIM}${TIME_TC}s${RESET}"
else
  echo -e "${RED}${BOLD}✗ TypeScript${RESET}  ${DIM}${TIME_TC}s${RESET}"
  cat "$TMPDIR/typecheck.out"
  FAILED=1
fi

# --- ESLint ---
if [ "$EC_LINT" -eq 0 ]; then
  echo -e "${GREEN}${BOLD}✓ ESLint${RESET}  ${DIM}${TIME_LINT}s${RESET}"
else
  echo -e "${RED}${BOLD}✗ ESLint${RESET}  ${DIM}${TIME_LINT}s${RESET}"
  cat "$TMPDIR/lint.out"
  FAILED=1
fi

# --- Tests ---
if [ "$EC_TEST" -eq 0 ]; then
  FILES=$(sed 's/\x1b\[[0-9;]*m//g' "$TMPDIR/test.out" | grep -E '^\s*Test Files\s' | xargs)
  TESTS=$(sed 's/\x1b\[[0-9;]*m//g' "$TMPDIR/test.out" | grep -E '^\s*Tests\s' | xargs)
  echo -e "${GREEN}${BOLD}✓ Tests${RESET}  ${DIM}${TIME_TEST}s${RESET}  ${FILES} | ${TESTS}"
else
  echo -e "${RED}${BOLD}✗ Tests${RESET}  ${DIM}${TIME_TEST}s${RESET}"
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
