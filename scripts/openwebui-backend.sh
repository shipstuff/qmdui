#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OPENWEBUI_DIR="${OPENWEBUI_DIR:-$ROOT_DIR/.external/open-webui}"
PYTHON_BIN="$OPENWEBUI_DIR/.venv/bin/python"

if [[ ! -x "$PYTHON_BIN" ]]; then
  echo "Missing Open WebUI Python environment at $PYTHON_BIN" >&2
  echo "Create it with: python3 -m venv $OPENWEBUI_DIR/.venv && $PYTHON_BIN -m pip install -r $OPENWEBUI_DIR/backend/requirements.txt" >&2
  exit 1
fi

cd "$OPENWEBUI_DIR/backend"
mkdir -p data

export PORT="${PORT:-8080}"
export HOST="${HOST:-0.0.0.0}"
export WEBUI_SECRET_KEY="${WEBUI_SECRET_KEY:-dev-secret}"
export DATABASE_URL="${DATABASE_URL:-sqlite:///./data/webui.db}"
export CORS_ALLOW_ORIGIN="${CORS_ALLOW_ORIGIN:-*}"

exec "$PYTHON_BIN" -m uvicorn open_webui.main:app --host "$HOST" --port "$PORT"
