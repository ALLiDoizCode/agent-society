#!/usr/bin/env bash
# Town SOL Devnet faucet — airdrop SOL + drip Mock USDC to any pubkey.
#
# Reads the Solana RPC URL from deploy/akash/leases.json (or falls back to
# local devnet at http://localhost:28899). The SOL airdrop uses the
# unrestricted `requestAirdrop` JSON-RPC (test-validator dev RPC, no key).
# The USDC drip is delegated to faucet-sol-usdc.mjs, which signs a
# TransferChecked from the bootstrap-baked faucet treasury (skipped silently
# if the mint hasn't been bootstrapped on this lease).
#
# Usage:
#   scripts/faucet-sol.sh <pubkey> [sol_amount=10] [usdc_amount=100]
#   scripts/faucet-sol.sh AbCd... 100 500

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LEASES_FILE="$ROOT/deploy/akash/leases.json"

PUBKEY="${1:-}"
SOL_AMOUNT="${2:-10}"
USDC_AMOUNT="${3:-100}"

if [ -z "$PUBKEY" ]; then
  echo "Usage: $0 <pubkey> [sol=10] [usdc=100]" >&2
  exit 1
fi

# Loose pubkey validation: base58, 32-44 chars (Solana pubkeys are 32 bytes
# = 43-44 base58 chars typically, sometimes 32 due to leading zeros).
if ! [[ "$PUBKEY" =~ ^[1-9A-HJ-NP-Za-km-z]{32,44}$ ]]; then
  echo "ERROR: $PUBKEY does not look like a base58 pubkey" >&2
  exit 1
fi

# Resolve RPC URL.
RPC_URL=""
if [ -f "$LEASES_FILE" ]; then
  RPC_URL="$(jq -r '.solana.url // ""' "$LEASES_FILE")"
fi
if [ -z "$RPC_URL" ]; then
  RPC_URL="http://localhost:28899"
  echo "[faucet-sol] No Akash lease — using local devnet $RPC_URL" >&2
else
  echo "[faucet-sol] Using Akash lease $RPC_URL" >&2
fi

# requestAirdrop takes lamports as u64 (integer). Force scale=0 + truncate
# via /1 so fractional SOL input (0.5 SOL → 500000000) doesn't leave a `.0`.
LAMPORTS="$(echo "scale=0; ($SOL_AMOUNT * 1000000000) / 1" | bc)"
echo "[faucet-sol] Airdropping ${SOL_AMOUNT} SOL ($LAMPORTS lamports) to $PUBKEY..."

RESP="$(curl -sS -X POST "$RPC_URL" \
  -H 'Content-Type: application/json' \
  -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"requestAirdrop\",\"params\":[\"$PUBKEY\",$LAMPORTS]}")"

if echo "$RESP" | jq -e '.error' >/dev/null 2>&1; then
  echo "[faucet-sol] ERROR: requestAirdrop failed: $RESP" >&2
  exit 1
fi

SIG="$(echo "$RESP" | jq -r '.result')"
echo "[faucet-sol] Airdrop signature: $SIG"
echo "[faucet-sol] Waiting for confirmation..."

# Poll getSignatureStatuses until confirmed (or 30s timeout).
for i in 1 2 3 4 5 6; do
  CONF="$(curl -sS -X POST "$RPC_URL" -H 'Content-Type: application/json' \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"getSignatureStatuses\",\"params\":[[\"$SIG\"]]}" \
    | jq -r '.result.value[0].confirmationStatus // "null"')"
  if [ "$CONF" = "confirmed" ] || [ "$CONF" = "finalized" ]; then
    echo "[faucet-sol] Confirmed."
    break
  fi
  sleep 2
done

# Verify final balance.
BAL_LAMPORTS="$(curl -sS -X POST "$RPC_URL" -H 'Content-Type: application/json' \
  -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"getBalance\",\"params\":[\"$PUBKEY\"]}" \
  | jq -r '.result.value')"
BAL_SOL="$(echo "scale=4; $BAL_LAMPORTS / 1000000000" | bc)"
echo "[faucet-sol] Final SOL balance: $BAL_SOL SOL ($BAL_LAMPORTS lamports)"

# USDC drip — delegated to a Node helper so we don't have to reimplement
# ed25519 signing + Solana tx serialization in bash. Helper exits 0 with
# `{"skipped":"..."}` if the mint isn't bootstrapped or the authority key
# is unavailable; that's a SOL-only success, not an error.
echo "[faucet-sol] Dripping ${USDC_AMOUNT} Mock USDC to $PUBKEY..."
USDC_RESULT="$(node "$ROOT/scripts/faucet-sol-usdc.mjs" "$RPC_URL" "$PUBKEY" "$USDC_AMOUNT" 2>&1)" || {
  echo "[faucet-sol] USDC drip failed: $USDC_RESULT" >&2
  exit 1
}
if echo "$USDC_RESULT" | jq -e '.skipped' >/dev/null 2>&1; then
  echo "[faucet-sol] USDC drip skipped: $(echo "$USDC_RESULT" | jq -r '.skipped')"
else
  USDC_SIG="$(echo "$USDC_RESULT" | jq -r '.sig')"
  USDC_ATA="$(echo "$USDC_RESULT" | jq -r '.ata')"
  echo "[faucet-sol] USDC tx: $USDC_SIG"
  echo "[faucet-sol] USDC ATA: $USDC_ATA"
fi
