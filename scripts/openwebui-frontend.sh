#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OPENWEBUI_DIR="${OPENWEBUI_DIR:-$ROOT_DIR/.external/open-webui}"

if [[ -s "$HOME/.nvm/nvm.sh" ]]; then
  # Open WebUI currently supports Node <=22. Keep this local to the subprocess.
  # shellcheck source=/dev/null
  source "$HOME/.nvm/nvm.sh"
  nvm use 22 >/dev/null
fi

cd "$OPENWEBUI_DIR"
exec npm run dev
