#!/usr/bin/env bash
# FR34 — thin wrapper for the 49.5 live E2E gate.
#
# PRIMARY gate: townhouse-dvm-arweave-e2e.test.ts (self-contained — manages
#   its own hs up / B connector / DVM / teardown). Requires NO pre-existing
#   local-hs stack. Ports 9401/28090 MUST be free when this script is run.
#
# FALLBACK gate (earnings-only, ATOR-stable test): if the DVM gate times out
#   on ATOR bootstrap, bring the stack up separately and run the earnings gate:
#     bash scripts/townhouse-e2e-local-hs.sh up
#     RUN_LOCAL_HS_E2E=1 pnpm --filter @toon-protocol/townhouse test:integration \
#       src/__integration__/local-docker-hs-paid-earnings-smoke.test.ts
#
# OQ-1 resolution: townhouse-dvm-arweave-e2e.test.ts IS the canonical gate;
#   local-docker-hs-paid-earnings-smoke.test.ts is the ATOR-unstable fallback.
#
# NFR6: This gate runs real .anyone transport + real Akash chains.
#       NEVER add on: push/pull_request to .github/workflows/e2e-real-hs.yml.
#
# NODE_TLS_REJECT_UNAUTHORIZED=0: Akash providers ship self-signed TLS certs
#   (project_akash_ws_probe_false_negative memory note; 49.3 precedent).
#   Scoped to this script only — not a general policy.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

export RUN_DOCKER_INTEGRATION=1
export NODE_TLS_REJECT_UNAUTHORIZED=0

TS="$(date +%s)"
LOG_DIR="${REPO_ROOT}/e2e-real-hs-logs/${TS}"
mkdir -p "${LOG_DIR}"

# Trap: on any error emit a FAIL message + log dir pointer
on_failure() {
  echo ""
  echo "FAIL: 49.5 gate exited non-zero. Logs: ${LOG_DIR}"
  echo "  gate log: ${LOG_DIR}/gate.log"
  echo ""
  echo "If failure was ATOR bootstrap timeout (>240s on SOCKS5 probe):"
  echo "  Use the FALLBACK earnings-only gate:"
  echo "    bash scripts/townhouse-e2e-local-hs.sh up"
  echo "    RUN_LOCAL_HS_E2E=1 NODE_TLS_REJECT_UNAUTHORIZED=0 \\"
  echo "      pnpm --filter @toon-protocol/townhouse test:integration \\"
  echo "        src/__integration__/local-docker-hs-paid-earnings-smoke.test.ts"
}
trap on_failure ERR

echo "[e2e-real-hs] Running 49.5 DVM Arweave gate (self-contained)..."
echo "[e2e-real-hs] Logs: ${LOG_DIR}/gate.log"
echo "[e2e-real-hs] Wall budget: ~20-25 min (B anon ~4min, apex ~5min, publishes ~3min)"
echo ""

# townhouse-dvm-arweave-e2e.test.ts is self-contained: manages its own hs up/down
# in beforeAll/afterAll. The smoke step below pre-validates the local-HS stack
# (chain RPCs reachable, containers healthy) before the full self-contained gate runs.
bash "${SCRIPT_DIR}/townhouse-e2e-local-hs.sh" smoke 2>&1 | tee "${LOG_DIR}/smoke.log"

pnpm --filter @toon-protocol/townhouse test:integration \
  src/__integration__/townhouse-dvm-arweave-e2e.test.ts \
  2>&1 | tee "${LOG_DIR}/gate.log"

echo ""
echo "PASS: 49.5 gate green. Logs: ${LOG_DIR}"
