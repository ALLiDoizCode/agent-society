#!/usr/bin/env bash
# Townhouse 3-Node HS E2E — one-command client pay-to-all-three over the apex .anon
#
# Drives a single client through the public ATOR hidden service to pay packets
# to all three townhouse node types over ONE channel + ONE BTP session:
#   TOWN: kind:1 publish            → ILP FULFILL (eventId)
#   DVM:  kind:5094 hero-image blob → ILP FULFILL (Arweave txId)
#   MILL: streamSwap EVM→Solana USDC→ swap state + signed claim (non-fatal)
#
# Prints a PASS/FAIL summary per node. Exit 0 iff TOWN+DVM both FULFILL; MILL
# is reported but never fails the run (the deployed mill image returns ILP T00
# live — handler accepts in local repro; PR #94 fixes the masking logger).
#
# The harness logic lives in:
#   packages/client/scripts/all-three-nodes-hs-LOCAL.ts
#
# Usage:
#   bash scripts/townhouse-3node-e2e.sh            # preflight + run
#   SOCKS_PROXY=socks5h://1.2.3.4:9052 bash scripts/townhouse-3node-e2e.sh
#
# Env passthrough: SOCKS_PROXY, HANDOFF, ANVIL_RPC, MILL_PUBKEY, SOLANA_RECIPIENT.
#
# PREREQUISITES: the townhouse HS stack must already be UP and healthy
# (operator bring-up, or scripts/townhouse-dev-infra.sh). This script does NOT
# start or stop any containers — it only verifies and drives traffic.

set -euo pipefail

# ── Colored log helpers ──────────────────────────────────────────────────────
if [ -t 1 ]; then
  C_RESET=$'\033[0m'; C_RED=$'\033[31m'; C_GRN=$'\033[32m'
  C_YEL=$'\033[33m'; C_BLU=$'\033[34m'; C_BLD=$'\033[1m'
else
  C_RESET=''; C_RED=''; C_GRN=''; C_YEL=''; C_BLU=''; C_BLD=''
fi
info()  { echo "${C_BLU}[3node-e2e]${C_RESET} $*"; }
ok()    { echo "${C_GRN}[3node-e2e] ✓${C_RESET} $*"; }
warn()  { echo "${C_YEL}[3node-e2e] ⚠${C_RESET} $*"; }
err()   { echo "${C_RED}[3node-e2e] ✗${C_RESET} $*" >&2; }
banner(){ echo; echo "${C_BLD}════════════════════════════════════════════════════════════════════${C_RESET}"; echo "${C_BLD}  $*${C_RESET}"; echo "${C_BLD}════════════════════════════════════════════════════════════════════${C_RESET}"; }

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# ── Config (env-overridable) ─────────────────────────────────────────────────
CONNECTOR_ADMIN_URL="${CONNECTOR_ADMIN_URL:-http://127.0.0.1:9401}"
ANVIL_RPC="${ANVIL_RPC:-http://127.0.0.1:28545}"
SOLANA_RPC="${SOLANA_RPC:-http://127.0.0.1:28899}"
HANDOFF="${HANDOFF:-/tmp/toon-e2e/handoff.json}"
HARNESS="${REPO_ROOT}/packages/client/scripts/all-three-nodes-hs-LOCAL.ts"
# Client wallet (Anvil acct[6]) — must hold ETH + MockUSDC to open the channel.
CLIENT_EVM_ADDRESS="0x976EA74026E726554dB657fA54763abd0C3a0aa9"
MOCK_USDC="0x5FbDB2315678afecb367f032d93F642f64180aa3"

# ── Preflight ────────────────────────────────────────────────────────────────
banner "Preflight — verifying the live townhouse HS stack"

PREFLIGHT_OK=1

# 1. Connector admin health
if curl -fsS --max-time 5 "${CONNECTOR_ADMIN_URL}/health" >/dev/null 2>&1; then
  ok "connector admin healthy at ${CONNECTOR_ADMIN_URL}/health"
else
  err "connector admin NOT healthy at ${CONNECTOR_ADMIN_URL}/health"
  PREFLIGHT_OK=0
fi

# 2. Peers: town + mill must be connected (dvm connected:false is EXPECTED —
#    it receives via connector localDelivery HTTP, not a BTP session).
PEERS_JSON="$(curl -fsS --max-time 5 "${CONNECTOR_ADMIN_URL}/admin/peers" 2>/dev/null || echo '')"
if [ -n "$PEERS_JSON" ]; then
  if command -v jq >/dev/null 2>&1; then
    # /admin/peers shape: { peers: [ { id, connected, ilpAddresses:[...] }, ... ] }
    TOWN_CONN="$(echo "$PEERS_JSON" | jq -r '(.peers[]? | select(.id=="town") | .connected) // "?"' 2>/dev/null | head -1 || echo '?')"
    MILL_CONN="$(echo "$PEERS_JSON" | jq -r '(.peers[]? | select(.id=="mill") | .connected) // "?"' 2>/dev/null | head -1 || echo '?')"
    DVM_CONN="$(echo "$PEERS_JSON" | jq -r '(.peers[]? | select(.id=="dvm") | .connected) // "?"' 2>/dev/null | head -1 || echo '?')"
    info "peers: town.connected=${TOWN_CONN} mill.connected=${MILL_CONN} dvm.connected=${DVM_CONN} (dvm connected:false EXPECTED — localDelivery HTTP, not a BTP session)"
    if [ "$TOWN_CONN" != "true" ]; then warn "town peer not reporting connected=true — paid TOWN traffic may reject"; fi
    if [ "$MILL_CONN" != "true" ]; then warn "mill peer not reporting connected=true (mill is non-fatal)"; fi
  else
    warn "jq not found — skipping peer-connected parse (raw len=${#PEERS_JSON})"
  fi
  ok "/admin/peers reachable"
else
  err "/admin/peers unreachable at ${CONNECTOR_ADMIN_URL}/admin/peers"
  PREFLIGHT_OK=0
fi

# 3. Anvil reachable (a JSON-RPC error object still proves it's up).
if curl -fsS --max-time 5 -X POST "$ANVIL_RPC" \
     -H 'content-type: application/json' \
     --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' >/dev/null 2>&1; then
  ok "anvil reachable at ${ANVIL_RPC}"
else
  err "anvil NOT reachable at ${ANVIL_RPC}"
  PREFLIGHT_OK=0
fi

# 4. Solana test-validator reachable.
if curl -fsS --max-time 5 -X POST "$SOLANA_RPC" \
     -H 'content-type: application/json' \
     --data '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' >/dev/null 2>&1; then
  ok "solana reachable at ${SOLANA_RPC}"
else
  warn "solana NOT reachable at ${SOLANA_RPC} (mill is non-fatal; continuing)"
fi

if [ "$PREFLIGHT_OK" -ne 1 ]; then
  err "Preflight FAILED — the townhouse HS stack must be up and healthy."
  err "Bring it up first, e.g.:"
  err "   scripts/townhouse-dev-infra.sh up        # contributor dev stack"
  err "   (or your operator apex: npx @toon-protocol/townhouse init && hs up && node add)"
  err "Then re-run: bash scripts/townhouse-3node-e2e.sh"
  exit 1
fi

# ── Fund the client wallet (idempotent) ──────────────────────────────────────
banner "Funding — ensure client wallet has ETH + MockUSDC"

ETH_HEX="$(curl -fsS --max-time 5 -X POST "$ANVIL_RPC" \
  -H 'content-type: application/json' \
  --data "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"eth_getBalance\",\"params\":[\"${CLIENT_EVM_ADDRESS}\",\"latest\"]}" \
  | { command -v jq >/dev/null 2>&1 && jq -r '.result // "0x0"' || cat; } 2>/dev/null || echo '0x0')"
USDC_HEX="$(curl -fsS --max-time 5 -X POST "$ANVIL_RPC" \
  -H 'content-type: application/json' \
  --data "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"eth_call\",\"params\":[{\"to\":\"${MOCK_USDC}\",\"data\":\"0x70a08231000000000000000000000000${CLIENT_EVM_ADDRESS:2}\"},\"latest\"]}" \
  | { command -v jq >/dev/null 2>&1 && jq -r '.result // "0x0"' || cat; } 2>/dev/null || echo '0x0')"

info "client ${CLIENT_EVM_ADDRESS}: eth(wei)=${ETH_HEX} usdc(raw)=${USDC_HEX}"

# Need >= ~1 ETH (1e18) and >= ~50 USDC (18-dec) to open a 100-USDC channel.
# Length heuristic (jq/bc-free, overflow-safe): strip 0x + leading zeros;
# a value >= 1e18 needs >= 16 significant hex digits (1e18 ≈ 0x0DE0B6B3A7640000).
NEED_FUND=0
strip_hex() { local h="${1#0x}"; while [ "${h:0:1}" = "0" ] && [ "${#h}" -gt 1 ]; do h="${h:1}"; done; echo "$h"; }
ETH_TRIM="$(strip_hex "$ETH_HEX")"
USDC_TRIM="$(strip_hex "$USDC_HEX")"
if [ "$ETH_TRIM" = "0" ] || [ "${#ETH_TRIM}" -lt 16 ]; then NEED_FUND=1; fi
if [ "$USDC_TRIM" = "0" ] || [ "${#USDC_TRIM}" -lt 16 ]; then NEED_FUND=1; fi

if [ "$NEED_FUND" -eq 1 ]; then
  # Fund DIRECTLY against the LOCAL anvil ($ANVIL_RPC). We avoid
  # scripts/faucet-evm.sh here because it resolves its RPC from
  # deploy/akash/leases.json (a REMOTE Akash anvil), not this local devnet.
  info "topping up ${CLIENT_EVM_ADDRESS} on ${ANVIL_RPC} (anvil_setBalance + ERC20 transfer)…"
  # 1. ETH via anvil_setBalance (dev-only RPC): 100 ETH.
  curl -fsS --max-time 8 -X POST "$ANVIL_RPC" -H 'content-type: application/json' \
    --data "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"anvil_setBalance\",\"params\":[\"${CLIENT_EVM_ADDRESS}\",\"0x56BC75E2D63100000\"]}" \
    >/dev/null 2>&1 && ok "set ETH balance to 100" || warn "anvil_setBalance failed"
  # 2. MockUSDC: impersonate the deployer (acct[0], holds full supply) and
  #    transfer 1000 USDC (18-dec) to the client. impersonate → eth_sendTransaction.
  DEPLOYER="0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"
  curl -fsS --max-time 8 -X POST "$ANVIL_RPC" -H 'content-type: application/json' \
    --data "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"anvil_impersonateAccount\",\"params\":[\"${DEPLOYER}\"]}" >/dev/null 2>&1 || true
  # transfer(address,uint256): selector 0xa9059cbb + addr + 1000e18 amount.
  XFER_DATA="0xa9059cbb000000000000000000000000${CLIENT_EVM_ADDRESS:2}00000000000000000000000000000000000000000000003635c9adc5dea00000"
  curl -fsS --max-time 8 -X POST "$ANVIL_RPC" -H 'content-type: application/json' \
    --data "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"eth_sendTransaction\",\"params\":[{\"from\":\"${DEPLOYER}\",\"to\":\"${MOCK_USDC}\",\"data\":\"${XFER_DATA}\"}]}" \
    >/dev/null 2>&1 && ok "transferred 1000 MockUSDC to client" || warn "MockUSDC transfer failed (channel-open may still succeed if balance sufficient)"
  curl -fsS --max-time 8 -X POST "$ANVIL_RPC" -H 'content-type: application/json' \
    --data "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"anvil_stopImpersonatingAccount\",\"params\":[\"${DEPLOYER}\"]}" >/dev/null 2>&1 || true
else
  ok "client wallet already funded (ETH + USDC sufficient)"
fi

# ── Handoff note (optional — the TS falls back to constants) ──────────────────
if [ -f "$HANDOFF" ]; then
  ok "handoff present at ${HANDOFF} (harness will read .anon + node config from it)"
else
  warn "handoff ${HANDOFF} absent — harness falls back to env/hardcoded constants"
fi

# ── Resolve a tsx runner ─────────────────────────────────────────────────────
TSX_BIN=""
if [ -x "${REPO_ROOT}/node_modules/.bin/tsx" ]; then
  TSX_BIN="${REPO_ROOT}/node_modules/.bin/tsx"
elif command -v tsx >/dev/null 2>&1; then
  TSX_BIN="$(command -v tsx)"
fi

# ── Run the harness ──────────────────────────────────────────────────────────
banner "Running harness — pay all three nodes over the apex .anon HS"
info "harness: ${HARNESS}"
info "proxy:   ${SOCKS_PROXY:-<from handoff/default>}  anvil: ${ANVIL_RPC}"

set +e
if [ -n "$TSX_BIN" ]; then
  HANDOFF="$HANDOFF" ANVIL_RPC="$ANVIL_RPC" "$TSX_BIN" "$HARNESS"
else
  info "no local tsx — falling back to: pnpm --filter @toon-protocol/client exec tsx"
  HANDOFF="$HANDOFF" ANVIL_RPC="$ANVIL_RPC" \
    pnpm --filter @toon-protocol/client exec tsx "$HARNESS"
fi
HARNESS_EXIT=$?
set -e

# ── Final banner ─────────────────────────────────────────────────────────────
banner "Result"
if [ "$HARNESS_EXIT" -eq 0 ]; then
  ok "TOWN + DVM both FULFILLed over the apex .anon HS (MILL reported, non-fatal). PASS."
else
  err "TOWN and/or DVM did not FULFILL (exit ${HARNESS_EXIT}). See per-node SUMMARY above."
fi
exit "$HARNESS_EXIT"
