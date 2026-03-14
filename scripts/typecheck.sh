#!/bin/bash
# Runs all 6 tsc project checks in parallel.
# Exits with failure if ANY project has type errors.

CONFIGS="main preload renderer cli daemon web"
TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT

for cfg in $CONFIGS; do
  (tsc --noEmit -p config/tsconfig.${cfg}.json > "$TMPDIR/${cfg}.out" 2>&1; echo $? > "$TMPDIR/${cfg}.ec") &
done

wait

FAILED=0
for cfg in $CONFIGS; do
  EC=$(cat "$TMPDIR/${cfg}.ec")
  if [ "$EC" -ne 0 ]; then
    echo "TypeScript errors in tsconfig.${cfg}.json:"
    cat "$TMPDIR/${cfg}.out"
    echo ""
    FAILED=1
  fi
done

exit $FAILED
