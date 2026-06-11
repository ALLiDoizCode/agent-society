#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# deploy-e2e-testnet-solana — one-time Solana deploy for the public-testnet
# E2E mode. Deploys the payment-channel program (contracts/solana) at its
# deterministic program ID and creates a mock USDC SPL mint, then records both
# into e2e/testnets.json.
#
# Deployer/fee-payer: the funded E2E_DEV_MNEMONIC Solana account at the index
# below (default 2 — the treasury; the only funded role today).
#
# Prerequisites:
#   - A STABLE solana CLI. Agave 4.0.x mishandles fresh-program deploys
#     ("AccountNotFound … error sending request"); use 1.18.x:
#       sh -c "$(curl -sSfL https://release.anza.xyz/v1.18.26/install)"
#   - spl-token CLI (ships with the solana tools).
#   - SDK built (pnpm --filter @toon-protocol/sdk build) — used to derive the key.
#   - ~1.5 SOL on the deployer for the 104 KB program's rent-exemption.
#
# Solana devnet RESETS periodically — re-run this to redeploy + refresh the
# addresses after a reset.
#
# Usage (repo root):
#   ./scripts/deploy-e2e-testnet-solana.sh
# ---------------------------------------------------------------------------
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INDEX="${E2E_DEPLOYER_INDEX:-2}"
RPC="${SOLANA_DEVNET_RPC_URL:-https://api.devnet.solana.com}"
PROGRAM_KEYPAIR="$REPO/contracts/solana/payment_channel-keypair.json"
PROGRAM_SO="$REPO/contracts/solana/payment_channel.so"
DEPLOYER_KP="$(mktemp /tmp/e2e-sol-deployer.XXXXXX.json)"
trap 'rm -f "$DEPLOYER_KP"' EXIT

command -v solana >/dev/null || { echo "solana CLI not found (see header)"; exit 1; }
command -v spl-token >/dev/null || { echo "spl-token CLI not found"; exit 1; }

# Derive the idx Solana keypair (64-byte JSON) from the dev mnemonic via the SDK
# (matches `e2e-wallet addresses`). Secret — written to a temp file, removed on exit.
node --input-type=module -e "
import { fromMnemonicFull } from '$REPO/packages/sdk/dist/index.js';
import { readFileSync, writeFileSync } from 'node:fs';
const m = (process.env.E2E_DEV_MNEMONIC || readFileSync('$REPO/.env.e2e.local','utf8').match(/E2E_DEV_MNEMONIC\s*=\s*[\"']?([^\"'\n]+)/)[1]).trim();
const id = await fromMnemonicFull(m, { accountIndex: $INDEX });
writeFileSync('$DEPLOYER_KP', JSON.stringify(Array.from(id.solana.secretKey)));
console.error('Deployer:', id.solana.publicKey);
"

solana config set --url "$RPC" --keypair "$DEPLOYER_KP" >/dev/null
echo "Balance: $(solana balance)"

PROGRAM_ID="$(solana-keygen pubkey "$PROGRAM_KEYPAIR")"
echo "Deploying program $PROGRAM_ID ($(wc -c < "$PROGRAM_SO") bytes)…"
solana program deploy \
  --program-id "$PROGRAM_KEYPAIR" \
  --upgrade-authority "$DEPLOYER_KP" \
  "$PROGRAM_SO"

echo "Creating mock USDC SPL mint (6 decimals)…"
MINT="$(spl-token create-token --decimals 6 | grep -oE 'Address: *[A-HJ-NP-Za-km-z1-9]{32,}' | grep -oE '[A-HJ-NP-Za-km-z1-9]{32,}' | head -1)"
echo "Mint: $MINT"

node -e "
const fs=require('fs'); const p='$REPO/e2e/testnets.json';
const t=JSON.parse(fs.readFileSync(p));
t.solana.programId='$PROGRAM_ID'; t.solana.tokenMint='$MINT';
fs.writeFileSync(p, JSON.stringify(t,null,2)+'\n');
console.log('Recorded solana.programId + tokenMint in e2e/testnets.json');
"
echo "=== Solana deploy complete ==="
echo "programId: $PROGRAM_ID"
echo "tokenMint: $MINT"
