#!/usr/bin/env bash
# Town EVM Devnet faucet — fund any address with ETH + Mock USDC.
#
# Reads the EVM RPC URL from deploy/akash/leases.json (or falls back to
# local devnet at http://localhost:28545 if no Akash lease is up). Issues:
#   1. anvil_setBalance to top up native ETH (instant, no key needed —
#      anvil exposes this dev-only RPC for any caller)
#   2. cast send / raw JSON-RPC ERC-20 transfer of Mock USDC from the
#      deployer key (account[0], holds the entire initial supply)
#
# Usage:
#   scripts/faucet-evm.sh <0xaddress> [usdc=10000] [eth=10]
#   scripts/faucet-evm.sh 0xabc...123 50000 100
#
# Mock USDC: 0x5FbDB2315678afecb367f032d93F642f64180aa3 (deterministic CREATE)
# Deployer:  0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 (Anvil account[0])

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LEASES_FILE="$ROOT/deploy/akash/leases.json"

ADDRESS="${1:-}"
USDC_AMOUNT="${2:-10000}"
ETH_AMOUNT="${3:-10}"

if [ -z "$ADDRESS" ]; then
  echo "Usage: $0 <0xaddress> [usdc=10000] [eth=10]" >&2
  exit 1
fi

if ! [[ "$ADDRESS" =~ ^0x[0-9a-fA-F]{40}$ ]]; then
  echo "ERROR: $ADDRESS is not a 0x-prefixed 40-hex address" >&2
  exit 1
fi

# Resolve RPC URL. Precedence:
#   1. Explicit override env (EVM_RPC_URL / ANVIL_HOST_RPC) — always wins.
#   2. deploy/akash/leases.json (a live Akash lease).
#   3. Local devnet fallback (http://localhost:28545).
# The explicit override exists so operators running the LOCAL dev/HS stack are
# not silently redirected to a stale Akash lease left in leases.json. When a
# lease is used, warn loudly so the operator notices they are funding a remote
# chain (set FAUCET_FORCE_LEASE=1 to suppress the warning).
RPC_URL="${EVM_RPC_URL:-${ANVIL_HOST_RPC:-}}"
if [ -n "$RPC_URL" ]; then
  echo "[faucet-evm] Using RPC override $RPC_URL (EVM_RPC_URL/ANVIL_HOST_RPC)" >&2
else
  if [ -f "$LEASES_FILE" ]; then
    RPC_URL="$(jq -r '.anvil.url // ""' "$LEASES_FILE")"
  fi
  if [ -z "$RPC_URL" ]; then
    RPC_URL="http://localhost:28545"
    echo "[faucet-evm] No RPC override or Akash lease — using local devnet $RPC_URL" >&2
  else
    echo "[faucet-evm] WARNING: funding a REMOTE Akash lease $RPC_URL (from $LEASES_FILE)." >&2
    echo "[faucet-evm] WARNING: to target the local devnet instead, set EVM_RPC_URL=http://localhost:28545 (or ANVIL_HOST_RPC)." >&2
  fi
fi

# Anvil's deterministic deployer (account[0]) has the entire Mock USDC supply.
DEPLOYER_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
USDC=0x5FbDB2315678afecb367f032d93F642f64180aa3

# 1. ETH via anvil_setBalance (RPC method, dev-only). Set the target's
#    balance to current + ETH_AMOUNT (in wei). Simplest path: read current,
#    add, set. Or just SET to ETH_AMOUNT (the user is requesting "give me
#    this much"). We go with the latter — set absolute balance.
# Use bc for hex conversion — printf '%x' overflows on values > 2^63.
ETH_WEI="0x$(echo "obase=16; $ETH_AMOUNT * 1000000000000000000 / 1" | bc | tr -d '\\\n')"
echo "[faucet-evm] Setting ETH balance of $ADDRESS to ${ETH_AMOUNT} ETH..."
RESP="$(curl -sS -X POST "$RPC_URL" \
  -H 'Content-Type: application/json' \
  -d "{\"jsonrpc\":\"2.0\",\"method\":\"anvil_setBalance\",\"params\":[\"$ADDRESS\",\"$ETH_WEI\"],\"id\":1}")"
if echo "$RESP" | jq -e '.error' >/dev/null 2>&1; then
  echo "[faucet-evm] ERROR: anvil_setBalance failed: $RESP" >&2
  exit 1
fi
echo "[faucet-evm] ETH set."

# 2. Mock USDC via ERC-20 transfer from deployer. transfer(address,uint256)
#    selector = 0xa9059cbb. Encode as: selector + addr (32 bytes, padded) +
#    amount (32 bytes, padded). USDC has 18 decimals (Mock OpenZeppelin
#    style — matches the dev compose entrypoint constants).
USDC_WEI_HEX="$(echo "obase=16; $USDC_AMOUNT * 1000000000000000000 / 1" | bc | tr -d '\\\n')"
ADDR_NO_PREFIX="${ADDRESS#0x}"
# Pad address to 32 bytes (64 hex chars), amount to 32 bytes
PADDED_ADDR="$(printf '%064s' "$ADDR_NO_PREFIX" | tr ' ' '0')"
PADDED_AMOUNT="$(printf '%064s' "$USDC_WEI_HEX" | tr ' ' '0')"
DATA="0xa9059cbb${PADDED_ADDR}${PADDED_AMOUNT}"

echo "[faucet-evm] Sending ${USDC_AMOUNT} Mock USDC from deployer to $ADDRESS..."

# Sending an EVM tx without `cast` requires us to (a) build the tx, (b) sign
# it with the deployer's key, (c) eth_sendRawTransaction. That's a lot of
# code in pure bash. For a Foundry-installed environment, prefer `cast`.
# Otherwise we use anvil's `anvil_impersonateAccount` + eth_sendTransaction
# (dev-only, available because this is anvil) which sidesteps signing.

# Impersonate the deployer so we can send unsigned txs from it.
curl -sS -X POST "$RPC_URL" -H 'Content-Type: application/json' \
  -d "{\"jsonrpc\":\"2.0\",\"method\":\"anvil_impersonateAccount\",\"params\":[\"0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266\"],\"id\":1}" >/dev/null

# Send the transfer via eth_sendTransaction.
TX_RESP="$(curl -sS -X POST "$RPC_URL" -H 'Content-Type: application/json' \
  -d "{\"jsonrpc\":\"2.0\",\"method\":\"eth_sendTransaction\",\"params\":[{\"from\":\"0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266\",\"to\":\"$USDC\",\"data\":\"$DATA\",\"gas\":\"0x100000\"}],\"id\":1}")"

# Stop impersonating so it doesn't leak.
curl -sS -X POST "$RPC_URL" -H 'Content-Type: application/json' \
  -d "{\"jsonrpc\":\"2.0\",\"method\":\"anvil_stopImpersonatingAccount\",\"params\":[\"0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266\"],\"id\":1}" >/dev/null

if echo "$TX_RESP" | jq -e '.error' >/dev/null 2>&1; then
  echo "[faucet-evm] ERROR: USDC transfer failed: $TX_RESP" >&2
  exit 1
fi
TX_HASH="$(echo "$TX_RESP" | jq -r '.result')"
echo "[faucet-evm] USDC sent. tx=$TX_HASH"

# Verify final balance.
BAL_HEX="$(curl -sS -X POST "$RPC_URL" -H 'Content-Type: application/json' \
  -d "{\"jsonrpc\":\"2.0\",\"method\":\"eth_call\",\"params\":[{\"to\":\"$USDC\",\"data\":\"0x70a08231000000000000000000000000$ADDR_NO_PREFIX\"},\"latest\"],\"id\":1}" | jq -r '.result')"
# Convert hex → decimal via bc (handles arbitrary precision).
BAL_DEC="$(echo "ibase=16; $(echo "${BAL_HEX#0x}" | tr 'a-f' 'A-F')" | bc)"
# Format as USDC (18 decimals) for human readability.
BAL_USDC="$(echo "scale=4; $BAL_DEC / 1000000000000000000" | bc)"
echo "[faucet-evm] Final USDC balance: $BAL_USDC USDC (raw 18-dec: $BAL_DEC)"
