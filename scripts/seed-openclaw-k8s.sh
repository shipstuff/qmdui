#!/usr/bin/env bash
set -euo pipefail

NAMESPACE="${NAMESPACE:-open-webui}"
SERVICE="${SERVICE:-qmdui}"
SOURCE_ROOT="${SOURCE_ROOT:-/home/carl}"
SOURCE_TARBALL="${SOURCE_TARBALL:-}"
REMOTE_ROOT="${REMOTE_ROOT:-/data/seeds/openclaw}"
LOCAL_PORT="${LOCAL_PORT:-18765}"
TIMEOUT_SECONDS="${TIMEOUT_SECONDS:-900}"
EXCLUDE_DIRS="${EXCLUDE_DIRS:-node_modules .npm .cache .nv .local .ollama}"

if [[ -n "$SOURCE_TARBALL" && ! -f "$SOURCE_TARBALL" ]]; then
  echo "Missing source tarball: $SOURCE_TARBALL" >&2
  exit 1
fi

if [[ -z "$SOURCE_TARBALL" && ! -d "$SOURCE_ROOT" ]]; then
  echo "Missing source root: $SOURCE_ROOT" >&2
  exit 1
fi

POD="$(kubectl -n "$NAMESPACE" get pod -l app=qmdui -o jsonpath='{.items[0].metadata.name}')"
if [[ -z "$POD" ]]; then
  echo "No QMDUI pod found in namespace $NAMESPACE" >&2
  exit 1
fi

if [[ -n "$SOURCE_TARBALL" || -r "$SOURCE_ROOT" ]]; then
  SUDO=()
else
  SUDO=(sudo -n)
fi

if [[ -n "$SOURCE_TARBALL" ]]; then
  echo "Copying markdown from $SOURCE_TARBALL to $POD:$REMOTE_ROOT"
else
  echo "Copying markdown from $SOURCE_ROOT to $POD:$REMOTE_ROOT"
fi
kubectl -n "$NAMESPACE" exec "$POD" -- sh -lc "rm -rf '$REMOTE_ROOT' && mkdir -p '$REMOTE_ROOT'"
if [[ -n "$SOURCE_TARBALL" ]]; then
  cat "$SOURCE_TARBALL" | kubectl -n "$NAMESPACE" exec -i "$POD" -- tar -xzf - -C "$REMOTE_ROOT"
else
  FIND_ARGS=("$SOURCE_ROOT")
  if [[ -n "$EXCLUDE_DIRS" ]]; then
    FIND_ARGS+=(\( -type d \()
    FIRST=1
    for DIR in $EXCLUDE_DIRS; do
      if [[ "$FIRST" -eq 1 ]]; then
        FIRST=0
      else
        FIND_ARGS+=(-o)
      fi
      FIND_ARGS+=(-name "$DIR")
    done
    FIND_ARGS+=(\) -prune \) -o)
  fi
  FIND_ARGS+=(-type f -name '*.md' -printf '%P\0')

  "${SUDO[@]}" find "${FIND_ARGS[@]}" \
    | "${SUDO[@]}" tar --null -C "$SOURCE_ROOT" -T - -czf - \
    | kubectl -n "$NAMESPACE" exec -i "$POD" -- tar -xzf - -C "$REMOTE_ROOT"
fi

TOKEN="$(kubectl -n "$NAMESPACE" get secret qmdui-secrets -o jsonpath='{.data.QMDUI_API_TOKEN}' | base64 -d)"
if [[ -z "$TOKEN" ]]; then
  echo "Missing QMDUI_API_TOKEN in secret qmdui-secrets" >&2
  exit 1
fi

PF_LOG="$(mktemp)"
kubectl -n "$NAMESPACE" port-forward "svc/$SERVICE" "$LOCAL_PORT:80" >"$PF_LOG" 2>&1 &
PF_PID="$!"
cleanup() {
  kill "$PF_PID" >/dev/null 2>&1 || true
  rm -f "$PF_LOG"
}
trap cleanup EXIT

for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:$LOCAL_PORT/health" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

RESPONSE="$(curl -fsS \
  -X POST "http://127.0.0.1:$LOCAL_PORT/api/admin/seed" \
  -H "authorization: Bearer $TOKEN" \
  -H "x-open-webui-role: admin" \
  -H "content-type: application/json" \
  --data '{"requireSource":true,"ingest":true,"includeHidden":true,"useDefaultIgnore":false,"flattenOutput":true,"cleanOutput":true,"ignore":[],"pattern":"**/*.md"}')"
JOB_ID="$(node -e "const data=JSON.parse(process.argv[1]); console.log(data.job.id)" "$RESPONSE")"
echo "Started seed job: $JOB_ID"

STARTED="$(date +%s)"
while true; do
  JOB="$(curl -fsS \
    "http://127.0.0.1:$LOCAL_PORT/api/jobs/$JOB_ID" \
    -H "authorization: Bearer $TOKEN" \
    -H "x-open-webui-role: admin")"
  STATUS="$(node -e "const data=JSON.parse(process.argv[1]); console.log(data.job.status)" "$JOB")"
  echo "Seed status: $STATUS"

  if [[ "$STATUS" == "completed" ]]; then
    node -e "const data=JSON.parse(process.argv[1]); console.log(JSON.stringify(data.job.result, null, 2))" "$JOB"
    exit 0
  fi
  if [[ "$STATUS" == "failed" || "$STATUS" == "cancelled" ]]; then
    node -e "const data=JSON.parse(process.argv[1]); console.error(JSON.stringify(data.job, null, 2))" "$JOB"
    exit 1
  fi
  if (( "$(date +%s)" - STARTED > TIMEOUT_SECONDS )); then
    echo "Timed out waiting for seed job $JOB_ID" >&2
    exit 1
  fi
  sleep 5
done
