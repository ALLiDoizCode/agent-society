#!/usr/bin/env node
/**
 * Idempotent bootstrap: creates a Mock USDC SPL mint + faucet treasury on the
 * local Solana validator. Designed to run once per fresh ledger from the
 * Solana entrypoint after `getHealth` is OK.
 *
 * Pre-baked deterministic keypairs (committed to repo as public dev keys —
 * same security model as Anvil's deterministic accounts):
 *   - keys/usdc-mint.json         (mint keypair; pubkey known + checked-in)
 *   - keys/faucet-authority.json  (mint authority; treasury ATA owner;
 *                                   transfer signer for the dev faucet)
 *
 * On already-bootstrapped ledgers (mint account exists), the script logs the
 * known constants and exits 0. Lease close = ledger reset = re-bootstrap on
 * next boot. This matches the "ephemeral by design" comment in the SDLs.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  makeRpc,
  getAccountInfo,
  requestAirdrop,
  waitForConfirmation,
  keypairFromJsonArray,
  deriveATA,
  createMint,
  createAssociatedTokenAccount,
  mintTo,
  getSplTokenBalance,
} from './spl-primitives.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Default to 127.0.0.1 (not 'localhost') because Node's undici fetch tries
// IPv6 (::1) first; solana-test-validator binds IPv4 only, so a localhost
// lookup races to ECONNREFUSED on ::1 before falling back. Explicit 127.0.0.1
// avoids that whole dance.
const RPC_URL = process.env.SOLANA_BOOTSTRAP_RPC || 'http://127.0.0.1:8899';
const USDC_DECIMALS = 6;
// 1B USDC initial supply (in base units, 6-decimal). Mintable on-demand by the
// faucet authority anyway, so this just bounds the visible "treasury balance".
const INITIAL_SUPPLY = 1_000_000_000n * 1_000_000n;
// Authority needs SOL to pay tx fees. ~0.5 SOL is plenty for thousands of drips.
const AUTHORITY_AIRDROP_LAMPORTS = 500_000_000;

function loadKeypair(filename) {
  const path = join(__dirname, 'keys', filename);
  const arr = JSON.parse(readFileSync(path, 'utf8'));
  return keypairFromJsonArray(arr);
}

async function main() {
  const rpc = makeRpc(RPC_URL);
  const authority = loadKeypair('faucet-authority.json');
  const mint = loadKeypair('usdc-mint.json');
  const treasury = deriveATA(authority.pubkeyBase58, mint.pubkeyBase58);

  console.log(`[bootstrap-usdc] RPC ${RPC_URL}`);
  console.log(`[bootstrap-usdc] mint     = ${mint.pubkeyBase58}`);
  console.log(`[bootstrap-usdc] authority= ${authority.pubkeyBase58}`);
  console.log(`[bootstrap-usdc] treasury = ${treasury}`);

  // Idempotency: if the mint account exists, ledger is already bootstrapped.
  const mintInfo = await getAccountInfo(rpc, mint.pubkeyBase58);
  if (mintInfo) {
    const bal = await getSplTokenBalance(rpc, treasury);
    console.log(`[bootstrap-usdc] mint already exists; treasury bal = ${bal}`);
    return;
  }

  // Fund the authority — solana-test-validator requestAirdrop is unrestricted.
  console.log(`[bootstrap-usdc] airdropping ${AUTHORITY_AIRDROP_LAMPORTS} lamports to authority...`);
  const airdropSig = await requestAirdrop(
    rpc,
    authority.pubkeyBase58,
    AUTHORITY_AIRDROP_LAMPORTS
  );
  await waitForConfirmation(rpc, airdropSig);

  // Create the mint with authority as both fee payer and mint authority.
  console.log(`[bootstrap-usdc] createMint (decimals=${USDC_DECIMALS})...`);
  await createMint(rpc, authority, mint, authority.pubkeyBase58, USDC_DECIMALS);

  // Create the treasury ATA owned by authority.
  console.log(`[bootstrap-usdc] createAssociatedTokenAccount (treasury)...`);
  await createAssociatedTokenAccount(
    rpc,
    authority,
    authority.pubkeyBase58,
    mint.pubkeyBase58
  );

  // Mint the initial supply into treasury.
  console.log(`[bootstrap-usdc] mintTo treasury (${INITIAL_SUPPLY} base units)...`);
  await mintTo(rpc, authority, mint.pubkeyBase58, treasury, authority, INITIAL_SUPPLY);

  const finalBal = await getSplTokenBalance(rpc, treasury);
  console.log(`[bootstrap-usdc] done. treasury bal = ${finalBal}`);
}

main().catch((err) => {
  console.error('[bootstrap-usdc] FAILED:', err);
  process.exit(1);
});
