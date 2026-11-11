#!/usr/bin/env bash
# Install: bash setup.sh; uninstall: bash setup.sh --uninstall
set -euo pipefail

HOOKS_SRC="$(cd "$(dirname "$0")" && pwd)"
if command -v python3 >/dev/null 2>&1; then
    PYTHON_BIN="$(command -v python3)"
elif command -v python >/dev/null 2>&1; then
    PYTHON_BIN="$(command -v python)"
else
    echo "[clawgod-hooks] Python 3 is required" >&2
    exit 1
fi

exec "$PYTHON_BIN" "$HOOKS_SRC/setup_hooks.py" "$@"
