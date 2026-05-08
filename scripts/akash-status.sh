#!/usr/bin/env bash
# Akash lease health check for TOON demo chain nodes.
#
# Reads deploy/akash/leases.json and probes each lease's RPC endpoint.
# Exit code: 0 if all healthy, 1 if any unreachable. Used by the demo
# preset's pre-flight check and as a CI cron to alert on lease expiry.
#
# Usage:
#   scripts/akash-status.sh           # human-readable
#   scripts/akash-status.sh --json    # machine-readable

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LEASES_FILE="$ROOT/deploy/akash/leases.json"

if [ ! -f "$LEASES_FILE" ]; then
  echo "ERROR: $LEASES_FILE not found — run scripts/akash-deploy.sh first" >&2
  exit 1
fi

JSON_MODE=false
if [ "${1:-}" = "--json" ]; then
  JSON_MODE=true
fi

probe_evm_rpc() {
  local url="$1"
  curl -sf -m 5 -X POST "$url" \
    -H 'Content-Type: application/json' \
    -d '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}' \
    2>/dev/null | grep -q '"result"'
}

probe_solana_rpc() {
  local url="$1"
  curl -sf -m 5 -X POST "$url" \
    -H 'Content-Type: application/json' \
    -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' \
    2>/dev/null | grep -q '"result":"ok"'
}

probe_http() {
  local url="$1"
  curl -sf -m 5 -o /dev/null -w '%{http_code}' "$url" 2>/dev/null | grep -qE '^(200|301|302|404)$'
}

check_lease() {
  local name="$1" url="$2" probe_fn="$3"
  if "$probe_fn" "$url"; then
    echo "ok"
  else
    echo "down"
  fi
}

ANVIL_URL="$(jq -r '.anvil.url // ""' "$LEASES_FILE")"
SOLANA_URL="$(jq -r '.solana.url // ""' "$LEASES_FILE")"
OTTERSCAN_URL="$(jq -r '.otterscan.url // ""' "$LEASES_FILE")"
BLOCKSCOUT_URL="$(jq -r '.blockscout.url // ""' "$LEASES_FILE")"
SOLANA_EXPLORER_URL="$(jq -r '."solana-explorer".url // ""' "$LEASES_FILE")"

ANVIL_STATUS=skip
SOLANA_STATUS=skip
OTTERSCAN_STATUS=skip
BLOCKSCOUT_STATUS=skip
SOLANA_EXPLORER_STATUS=skip
EXIT=0

if [ -n "$ANVIL_URL" ]; then
  ANVIL_STATUS="$(check_lease anvil "$ANVIL_URL" probe_evm_rpc)"
  [ "$ANVIL_STATUS" = "down" ] && EXIT=1
fi

if [ -n "$SOLANA_URL" ]; then
  SOLANA_STATUS="$(check_lease solana "$SOLANA_URL" probe_solana_rpc)"
  [ "$SOLANA_STATUS" = "down" ] && EXIT=1
fi

if [ -n "$OTTERSCAN_URL" ]; then
  OTTERSCAN_STATUS="$(check_lease otterscan "$OTTERSCAN_URL" probe_http)"
  [ "$OTTERSCAN_STATUS" = "down" ] && EXIT=1
fi

if [ -n "$BLOCKSCOUT_URL" ]; then
  BLOCKSCOUT_STATUS="$(check_lease blockscout "$BLOCKSCOUT_URL" probe_http)"
  [ "$BLOCKSCOUT_STATUS" = "down" ] && EXIT=1
fi

if [ -n "$SOLANA_EXPLORER_URL" ]; then
  SOLANA_EXPLORER_STATUS="$(check_lease solana-explorer "$SOLANA_EXPLORER_URL" probe_http)"
  [ "$SOLANA_EXPLORER_STATUS" = "down" ] && EXIT=1
fi

if [ "$JSON_MODE" = "true" ]; then
  jq -n \
    --arg a "$ANVIL_STATUS" --arg au "$ANVIL_URL" \
    --arg s "$SOLANA_STATUS" --arg su "$SOLANA_URL" \
    --arg o "$OTTERSCAN_STATUS" --arg ou "$OTTERSCAN_URL" \
    --arg b "$BLOCKSCOUT_STATUS" --arg bu "$BLOCKSCOUT_URL" \
    --arg se "$SOLANA_EXPLORER_STATUS" --arg seu "$SOLANA_EXPLORER_URL" \
    '{anvil:           {status: $a,  url: $au},
      solana:          {status: $s,  url: $su},
      otterscan:       {status: $o,  url: $ou},
      blockscout:      {status: $b,  url: $bu},
      "solana-explorer": {status: $se, url: $seu}}'
else
  printf '%-18s %-8s %s\n' "service" "status" "url"
  printf '%-18s %-8s %s\n' "anvil"           "$ANVIL_STATUS"           "${ANVIL_URL:-<not deployed>}"
  printf '%-18s %-8s %s\n' "solana"          "$SOLANA_STATUS"          "${SOLANA_URL:-<not deployed>}"
  printf '%-18s %-8s %s\n' "otterscan"       "$OTTERSCAN_STATUS"       "${OTTERSCAN_URL:-<not deployed>}"
  printf '%-18s %-8s %s\n' "blockscout"      "$BLOCKSCOUT_STATUS"      "${BLOCKSCOUT_URL:-<not deployed>}"
  printf '%-18s %-8s %s\n' "solana-explorer" "$SOLANA_EXPLORER_STATUS" "${SOLANA_EXPLORER_URL:-<not deployed>}"
fi

exit "$EXIT"
