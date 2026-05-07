#!/usr/bin/env bash
#
# Opens payment channels apex -> {town, mill} via the apex connector's admin
# API (POST /channels). Run AFTER `docker compose ... up` reports all
# townhouse-hs services healthy and AFTER the apex's EVM treasury (Anvil
# acct[3] = 0x90F79...) has been topped up with USDC via the faucet at
# http://127.0.0.1:3500/api/request — Mock USDC is minted only to acct[0]
# (deployer) and pre-distributed to acct[2] + acct[3] by
# contracts/evm/script/DeployLocal.s.sol; if `cast call USDC balanceOf` shows
# zero on the apex address, drip via the faucet first.
#
# IMPORTANT: Anvil chain restart wipes channel state. Re-run this script
# after every `docker compose down && up` of the localnet profile (or every
# time the anvil container restarts and re-runs DeployLocal.s.sol).
#
# Per-child target addresses (DEV-ONLY — Anvil deterministic):
#   apex (caller)  → acct[3] = 0x90F79bf6EB2c4f870365E785982E1f101E93b906
#   town  child    → acct[4] = 0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65
#   mill  child    → acct[5] = 0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc
# These mirror docker/configs/townhouse-hs-connector.yaml peers[*].evmAddress.

set -euo pipefail

# The connector image's admin API mounts under /admin (not /). We probe both
# in case the image revs the prefix later.
ADMIN_BASE=${ADMIN_URL:-http://127.0.0.1:9401}
if curl -fsS "$ADMIN_BASE/admin/channels" >/dev/null 2>&1; then
  ADMIN="$ADMIN_BASE/admin"
elif curl -fsS "$ADMIN_BASE/channels" >/dev/null 2>&1; then
  ADMIN="$ADMIN_BASE"
else
  echo "[hs-open-channels] FATAL: neither $ADMIN_BASE/admin/channels nor $ADMIN_BASE/channels responded; is the apex up?" >&2
  exit 1
fi

# Map peer-id -> child EVM treasury (apex's view of the child).
# `client` is the test peer used by packages/client/scripts/social-flow-hs-e2e.ts
# (Anvil acct[6]) — opening a channel to it lets the test send signed
# balance-proof claims through the apex.
declare -A PEER_ADDRS=(
  [town]='0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65'
  [mill]='0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc'
  [client]='0x976EA74026E726554dB657fA54763abd0C3a0aa9'
)

# Localnet defaults (override via env). chain-id 31337 matches the apex
# config's chainProviders entry; initialDeposit is in token base units (USDC
# is 18 decimals here, MockERC20 — so 1e9 = 0.000000001 USDC, fine for dev).
# `token` MUST be a 0x-prefixed EVM address (admin API validates the format)
# and that address MUST resolve in the connector's tokenAddressMap. The
# connector seeds the map with both the resolved ERC-20 symbol AND the raw
# token address — passing the address itself is the most portable choice.
# The default below is the localnet MockERC20 USDC (deterministic from
# DeployLocal.s.sol acct[0] nonce=0).
CHAIN=${CHAIN:-evm:base:31337}
TOKEN=${TOKEN:-0x5FbDB2315678afecb367f032d93F642f64180aa3}
INITIAL_DEPOSIT=${INITIAL_DEPOSIT:-1000000000}
SETTLEMENT_TIMEOUT=${SETTLEMENT_TIMEOUT:-86400}

echo "[hs-open-channels] admin=$ADMIN chain=$CHAIN token=$TOKEN deposit=$INITIAL_DEPOSIT timeout=$SETTLEMENT_TIMEOUT"

# Fund each child's settlement signer with ETH (gas) + USDC (initialDeposit
# for the reverse channel). The apex opens channels TO children, but each
# child's embedded ConnectorNode also auto-opens a reverse channel back to
# the apex on startup (default deposit: 1e18 base units in MockERC20 USDC,
# which on localnet uses 18 decimals). Without funding, the deposit step
# reverts with InsufficientBalance and the child never establishes its
# outbound channel.
#
# Faucet at http://127.0.0.1:3500 drips ETH (100) + USDC (10000 — but only
# 10000e6 base units, see packages/faucet — well below the 1e18 needed for
# the default deposit). To unblock the reverse channel we fall back to
# transferring USDC directly from acct[0] (deployer) via `cast send`. Both
# the faucet drip (for ETH) and the direct transfer (for USDC) are
# DEV-ONLY — production deployments must fund children out of band before
# they boot.
ANVIL_CONTAINER=${ANVIL_CONTAINER:-townhouse-hs-anvil}
ANVIL_RPC_URL=${ANVIL_RPC_URL:-http://localhost:8545}
ACCT0_PRIVKEY=${ACCT0_PRIVKEY:-0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80}
CHILD_USDC_AMOUNT=${CHILD_USDC_AMOUNT:-100000000000000000000} # 100 USDC (18-dec)
FAUCET_BASE=${FAUCET_BASE:-http://127.0.0.1:3500}

if [ "${SKIP_CHILD_FUNDING:-0}" != "1" ]; then
  echo "[hs-open-channels] Funding child settlement signers (ETH via faucet + USDC via cast)..."
  for peer_id in "${!PEER_ADDRS[@]}"; do
    addr="${PEER_ADDRS[$peer_id]}"
    # ETH drip via faucet (best-effort — faucet may be down or out of profile)
    curl -fsS -X POST "$FAUCET_BASE/api/request" \
      -H 'content-type: application/json' \
      -d "{\"address\":\"$addr\",\"chain\":\"evm\"}" >/dev/null 2>&1 || true
    # USDC transfer from acct[0] — bypass faucet decimal mismatch
    if ! docker exec "$ANVIL_CONTAINER" cast send "$TOKEN" \
        "transfer(address,uint256)" "$addr" "$CHILD_USDC_AMOUNT" \
        --private-key "$ACCT0_PRIVKEY" --rpc-url "$ANVIL_RPC_URL" \
        >/dev/null 2>&1; then
      echo "[hs-open-channels] WARN: USDC transfer to $peer_id ($addr) failed" >&2
    else
      echo "[hs-open-channels] Funded $peer_id ($addr) with $CHILD_USDC_AMOUNT base-units USDC"
    fi
  done
fi

# `peers` is iterated in declared order; declare -A is unordered in bash so
# we drive iteration from a literal list. Sequential (NOT parallel) — the
# apex's PaymentChannelSDK shares a single signer and back-to-back tx submits
# from the same nonce hit `nonce has already been used`. Per-iteration sleep
# gives the previous tx time to land (Anvil ~50ms, real chains ~12s).
PEER_ORDER=(town mill client)
INTER_PEER_SLEEP=${INTER_PEER_SLEEP:-3}

first=1
for peer_id in "${PEER_ORDER[@]}"; do
  if [ $first -eq 0 ]; then
    sleep "$INTER_PEER_SLEEP"
  fi
  first=0
  peer_addr="${PEER_ADDRS[$peer_id]}"
  echo "[hs-open-channels] Opening apex -> $peer_id ($peer_addr)..."
  # Allow the call to fail (e.g. 409 if the channel already exists) without
  # aborting the loop — we still want to print confirmation at the end.
  if ! curl -fsS -X POST "$ADMIN/channels" \
    -H 'content-type: application/json' \
    -d "{
      \"peerId\": \"$peer_id\",
      \"chain\": \"$CHAIN\",
      \"token\": \"$TOKEN\",
      \"peerAddress\": \"$peer_addr\",
      \"initialDeposit\": \"$INITIAL_DEPOSIT\",
      \"settlementTimeout\": $SETTLEMENT_TIMEOUT
    }"; then
    echo "[hs-open-channels] WARN: $peer_id channel-open returned non-2xx (already exists?)" >&2
  fi
  echo
done

echo "[hs-open-channels] Confirmation:"
if command -v python3 >/dev/null 2>&1; then
  curl -fsS "$ADMIN/channels" | python3 -m json.tool || curl -fsS "$ADMIN/channels"
else
  curl -fsS "$ADMIN/channels"
fi
echo
