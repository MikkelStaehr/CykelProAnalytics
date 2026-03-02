#!/usr/bin/env bash
# fetch_all_results.sh — Batch-fetch PCS results for all (or filtered) form_races.
#
# Usage:
#   bash scripts/fetch_all_results.sh                        # all profiles
#   bash scripts/fetch_all_results.sh cobbled mixed          # specific profiles
#   bash scripts/fetch_all_results.sh hilly                  # one profile
#
# All arguments are forwarded as --profile values to fetch_all_results.py.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PY=python3

if [ $# -gt 0 ]; then
  "$PY" "$SCRIPT_DIR/fetch_all_results.py" --profile "$@"
else
  "$PY" "$SCRIPT_DIR/fetch_all_results.py"
fi
