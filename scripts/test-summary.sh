#!/bin/bash
# Runs tests and shows only the summary on success, or full output on failure.

OUTPUT=$(yarn test 2>&1)
EXIT_CODE=$?

if [ $EXIT_CODE -eq 0 ]; then
  echo "$OUTPUT" | sed 's/\x1b\[[0-9;]*m//g' | grep -E '^\s*(Test Files|Tests)\s'
else
  echo "$OUTPUT"
  exit $EXIT_CODE
fi
