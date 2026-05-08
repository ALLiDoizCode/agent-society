#!/usr/bin/env node
/**
 * Town SOL Devnet — Mock USDC drip helper.
 *
 * Used by scripts/faucet-sol.sh after the SOL airdrop. Loads the bootstrap
 * faucet authority keypair (infra/solana/keys/faucet-authority.json) and
 * issues a TransferChecked of `usdc_amount` whole USDC to `recipient`,
 * creating the recipient's ATA on the fly if needed. Idempotent on the ATA
 * step. No-ops cleanly if the mint isn't bootstrapped yet (older lease).
 *
 * Usage:
 *   node scripts/faucet-sol-usdc.mjs <rpc_url> <recipient_pubkey> <usdc_amount>
 *
 * Designed to be called from a shell script — emits one line of JSON on
 * success: {"sig":"...","ata":"...","amount":"<base_units>"}, exits 1 with
 * an error message on stderr otherwise. Exits 0 with `{"skipped":"..."}`
 * when the mint or authority isn't available — caller should treat this
 * as "USDC drip unavailable, SOL-only succeeded".
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import {
  createAssociatedTokenAccount,
  deriveATA,
  getAccountInfo,
  keypairFromJsonArray,
  makeRpc,
  transferChecked,
} from '../infra/solana/spl-primitives.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const AUTHORITY_PATH = resolve(REPO_ROOT, 'infra/solana/keys/faucet-authority.json');

const USDC_MINT = '6GbdrVghwNKTz9raga7y3Y4qqX5Zgg3AC4d48Kt7C59Q';
const USDC_DECIMALS = 6;
const USDC_AUTHORITY = 'ATEh3koyCrwmCMr3cNBVEmARhSFmP9tHokjDxhtaE8m3';

const [, , rpcUrl, recipient, amountStr] = process.argv;
if (!rpcUrl || !recipient || !amountStr) {
  console.error('Usage: faucet-sol-usdc.mjs <rpc_url> <recipient> <usdc_amount>');
  process.exit(1);
}

const amount = Number(amountStr);
if (!Number.isFinite(amount) || amount <= 0) {
  console.error(`Invalid usdc_amount: ${amountStr}`);
  process.exit(1);
}

let authority;
try {
  authority = keypairFromJsonArray(JSON.parse(readFileSync(AUTHORITY_PATH, 'utf8')));
} catch (err) {
  console.log(JSON.stringify({ skipped: `authority keypair unavailable: ${err.message}` }));
  process.exit(0);
}

if (authority.pubkeyBase58 !== USDC_AUTHORITY) {
  console.error(
    `Authority pubkey mismatch: file=${authority.pubkeyBase58} const=${USDC_AUTHORITY}`
  );
  process.exit(1);
}

const rpc = makeRpc(rpcUrl);

const mintInfo = await getAccountInfo(rpc, USDC_MINT);
if (!mintInfo) {
  console.log(JSON.stringify({ skipped: 'mint not bootstrapped on this validator' }));
  process.exit(0);
}

const recipientAta = await createAssociatedTokenAccount(rpc, authority, recipient, USDC_MINT);
const treasuryAta = deriveATA(USDC_AUTHORITY, USDC_MINT);
const baseUnits = BigInt(Math.floor(amount)) * 10n ** BigInt(USDC_DECIMALS);

const sig = await transferChecked(
  rpc,
  authority,
  treasuryAta,
  USDC_MINT,
  recipientAta,
  authority,
  baseUnits,
  USDC_DECIMALS
);

console.log(JSON.stringify({ sig, ata: recipientAta, amount: baseUnits.toString() }));
