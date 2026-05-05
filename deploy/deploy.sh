#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
K8S_DIR="$SCRIPT_DIR/k8s"
NAMESPACE="${NAMESPACE:-open-webui}"
IMAGE="${IMAGE:-registry.local:30500/shipstuff/qmdui}"
COMMIT_SHA="${COMMIT_SHA:-$(git rev-parse HEAD)}"
SEED_TIMEOUT="${SEED_TIMEOUT:-600s}"

create_secret_if_missing() {
  if kubectl -n "$NAMESPACE" get secret qmdui-secrets >/dev/null 2>&1; then
    return
  fi

  local token
  if command -v openssl >/dev/null 2>&1; then
    token="$(openssl rand -hex 32)"
  else
    token="$(date +%s%N | sha256sum | awk '{print $1}')"
  fi

  kubectl -n "$NAMESPACE" create secret generic qmdui-secrets \
    --from-literal="QMDUI_API_TOKEN=$token"
}

echo "Deploying QMDUI to $NAMESPACE..."
kubectl apply -f "$K8S_DIR/namespace.yaml"
create_secret_if_missing
kubectl apply \
  -f "$K8S_DIR/pvc.yaml" \
  -f "$K8S_DIR/configmap.yaml" \
  -f "$K8S_DIR/deployment.yaml" \
  -f "$K8S_DIR/service.yaml" \
  -f "$K8S_DIR/ingress.yaml"

kubectl -n "$NAMESPACE" set image deployment/qmdui \
  api="$IMAGE:$COMMIT_SHA"
kubectl -n "$NAMESPACE" annotate deployment/qmdui \
  "qmdui.shipstuff/deployed-at=$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --overwrite
kubectl -n "$NAMESPACE" rollout status deployment/qmdui --timeout=180s

echo "Running seed job..."
kubectl -n "$NAMESPACE" delete job qmdui-seed --ignore-not-found
TMP_JOB="$(mktemp)"
trap 'rm -f "$TMP_JOB"' EXIT
sed "s|image: registry.local:30500/shipstuff/qmdui:latest|image: $IMAGE:$COMMIT_SHA|" \
  "$K8S_DIR/seed-job.yaml" > "$TMP_JOB"
kubectl apply -f "$TMP_JOB"

if ! kubectl -n "$NAMESPACE" wait --for=condition=complete job/qmdui-seed --timeout="$SEED_TIMEOUT"; then
  kubectl -n "$NAMESPACE" logs job/qmdui-seed --tail=200 || true
  exit 1
fi
kubectl -n "$NAMESPACE" logs job/qmdui-seed --tail=80 || true

echo "Checking deployed health..."
kubectl -n "$NAMESPACE" exec deployment/qmdui -- \
  node -e "const r=await fetch('http://127.0.0.1:8765/health'); if(!r.ok) process.exit(1); console.log(await r.text())"

echo "QMDUI deploy complete."
kubectl -n "$NAMESPACE" get pods -l app=qmdui
