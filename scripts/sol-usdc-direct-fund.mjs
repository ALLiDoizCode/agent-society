#!/usr/bin/env node
/**
 * Direct SOL USDC drip — local SPL transfer via the deterministic faucet
 * authority key. Replicates `dripSol` from packages/townhouse/src/api/routes/faucet.ts
 * but runs in the OPERATOR's process (with reliable clearnet RPC access to
 * Akash-Solana) instead of inside the Akash faucet container (whose ethers/web3
 * fetch layer keeps timing out under cross-Akash-provider TLS load).
 *
 * Used by scripts/townhouse-e2e-local-hs.sh when the faucet's /faucet endpoint
 * fails repeatedly for the Solana leg.
 *
 * Usage:
 *   node scripts/sol-usdc-direct-fund.mjs <recipient> <amount-usdc> [rpc-url]
 *
 *   recipient   — base58 Solana pubkey (the foreign pod's ephemeral SOL key)
 *   amount-usdc — whole USDC units (default: 100)
 *   rpc-url     — Akash-Solana RPC (default: reads from deploy/akash/leases.json)
 *
 * Exits 0 on success, prints the tx signature. Exits non-zero on failure with
 * the error on stderr.
 *
 * Security: the faucet authority key at infra/solana/keys/faucet-authority.json
 * is a PUBLIC deterministic dev key, per memory `project_solana_mock_usdc_keys`.
 * NEVER use on real chains.
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  makeRpc,
  keypairFromJsonArray,
  deriveATA,
  createAssociatedTokenAccount,
  transferChecked,
  getAccountInfo,
} from '../infra/solana/spl-primitives.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');

// Constants mirror packages/townhouse/src/api/routes/faucet.ts L63-65
const SOLANA_USDC_MINT = '6GbdrVghwNKTz9raga7y3Y4qqX5Zgg3AC4d48Kt7C59Q';
const SOLANA_USDC_DECIMALS = 6;
const SOLANA_FAUCET_AUTHORITY = 'ATEh3koyCrwmCMr3cNBVEmARhSFmP9tHokjDxhtaE8m3';

function die(msg) {
  console.error(`[sol-usdc-direct-fund] ERROR: ${msg}`);
  process.exit(1);
}

function readLeaseSolUrl() {
  const leasesPath = join(REPO_ROOT, 'deploy', 'akash', 'leases.json');
  const leases = JSON.parse(readFileSync(leasesPath, 'utf-8'));
  return leases?.solana?.url ?? null;
}

async function main() {
  const [, , recipient, amountStr, rpcArg] = process.argv;
  if (!recipient) die('usage: sol-usdc-direct-fund.mjs <recipient> [amount-usdc] [rpc-url]');

  const amount = amountStr ? Number(amountStr) : 100;
  if (!Number.isFinite(amount) || amount <= 0) die(`amount must be > 0, got: ${amountStr}`);

  const rpcUrl = rpcArg ?? readLeaseSolUrl();
  if (!rpcUrl) die('no Solana RPC URL — pass as 3rd arg or ensure deploy/akash/leases.json has solana.url');

  // Load faucet authority keypair (deterministic dev key)
  const authPath = join(REPO_ROOT, 'infra', 'solana', 'keys', 'faucet-authority.json');
  const authArr = JSON.parse(readFileSync(authPath, 'utf-8'));
  const authority = keypairFromJsonArray(authArr);
  if (authority.pubkeyBase58 !== SOLANA_FAUCET_AUTHORITY) {
    die(`faucet authority pubkey mismatch: file=${authority.pubkeyBase58} expected=${SOLANA_FAUCET_AUTHORITY}`);
  }

  console.log(`[sol-usdc-direct-fund] recipient=${recipient} amount=${amount} USDC`);
  console.log(`[sol-usdc-direct-fund] RPC=${rpcUrl}`);
  console.log(`[sol-usdc-direct-fund] authority=${authority.pubkeyBase58}`);

  const rpc = makeRpc(rpcUrl);

  // 1) Verify mint exists at the expected address (sanity check — catches a
  //    fresh Solana validator that hasn't been bootstrapped yet)
  const mintInfo = await getAccountInfo(rpc, SOLANA_USDC_MINT);
  if (!mintInfo) die(`USDC mint ${SOLANA_USDC_MINT} not found — Solana validator not bootstrapped`);

  // 2) Ensure recipient has an ATA (idempotent — short-circuits if it exists)
  console.log('[sol-usdc-direct-fund] ensuring recipient ATA…');
  const recipientAta = await createAssociatedTokenAccount(rpc, authority, recipient, SOLANA_USDC_MINT);

  // 3) Treasury ATA (owned by the faucet authority, created at bootstrap)
  const treasuryAta = deriveATA(SOLANA_FAUCET_AUTHORITY, SOLANA_USDC_MINT);

  // 4) Build + send the transferChecked transaction
  const baseUnits = BigInt(Math.floor(amount)) * 10n ** BigInt(SOLANA_USDC_DECIMALS);
  console.log(`[sol-usdc-direct-fund] transferChecked ${baseUnits} (${amount} USDC at decimals=${SOLANA_USDC_DECIMALS})`);
  const sig = await transferChecked(
    rpc,
    authority,
    treasuryAta,
    SOLANA_USDC_MINT,
    recipientAta,
    authority,
    baseUnits,
    SOLANA_USDC_DECIMALS
  );

  console.log(`[sol-usdc-direct-fund] tx=${sig}`);
  console.log('OK');
}

main().catch((e) => {
  console.error(`[sol-usdc-direct-fund] ${e?.message ?? e}`);
  if (e?.stack) console.error(e.stack);
  process.exit(1);
});
