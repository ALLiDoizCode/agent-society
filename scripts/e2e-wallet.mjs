#!/usr/bin/env node
// ---------------------------------------------------------------------------
// e2e-wallet — dev-wallet helper for the public-testnet E2E mode.
//
// Manages the single BIP-39 dev wallet whose derived keys submit txs on Base
// Sepolia, Solana devnet, and Mina devnet. One seed → all chains, at distinct
// account indices per role (peers + a test treasury).
//
// Commands:
//   generate            Print a fresh BIP-39 mnemonic (does NOT store it).
//   addresses           Read E2E_DEV_MNEMONIC and print the PUBLIC addresses to
//                       fund, per role per chain. Never prints private keys.
//
// Mnemonic source for `addresses` (first hit wins):
//   1. $E2E_DEV_MNEMONIC
//   2. E2E_DEV_MNEMONIC="..." in ./.env.e2e.local (gitignored)
//
// Requires the SDK to be built once:  pnpm --filter @toon-protocol/sdk build
//
// SECURITY: this tool prints ONLY public addresses. It never writes the seed
// anywhere and never logs private keys. Keep the mnemonic in .env.e2e.local
// (local) and the org GitHub secret E2E_DEV_MNEMONIC (CI). See
// docs/e2e-testnets.md.
// ---------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SDK_DIST = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'packages',
  'sdk',
  'dist',
  'index.js'
);

// Role → BIP-32 account index. The public-testnet harness MUST derive its
// per-peer settlement keys and the test treasury at these same indices, or the
// addresses you fund here won't match the keys that actually transact.
const ROLES = [
  { index: 0, role: 'peer1 settlement (also EVM contract deployer)' },
  { index: 1, role: 'peer2 settlement' },
  { index: 2, role: 'test treasury / participant funder' },
];

async function loadSdk() {
  try {
    return await import(SDK_DIST);
  } catch (err) {
    console.error(
      'Could not import the built SDK. Build it first:\n' +
        '  pnpm --filter @toon-protocol/sdk build\n\n' +
        `(looked for ${SDK_DIST})\n(original error: ${err?.message ?? err})`
    );
    process.exit(1);
  }
}

function readMnemonicFromEnvFile() {
  try {
    const text = readFileSync(join(process.cwd(), '.env.e2e.local'), 'utf8');
    const m = text.match(
      /^\s*E2E_DEV_MNEMONIC\s*=\s*["']?([^"'\n]+)["']?\s*$/m
    );
    return m?.[1]?.trim() || undefined;
  } catch {
    return undefined;
  }
}

async function cmdGenerate() {
  const { generateMnemonic } = await loadSdk();
  const mnemonic = generateMnemonic();
  console.log(mnemonic);
  console.error(
    '\n^ Fresh BIP-39 mnemonic (printed to stdout). This is a SECRET.\n' +
      '  • Save it as E2E_DEV_MNEMONIC in .env.e2e.local (local) and the org\n' +
      '    GitHub secret (CI). Use a TESTNET-ONLY wallet — never mainnet.\n' +
      '  • Then run:  node scripts/e2e-wallet.mjs addresses\n'
  );
}

async function cmdAddresses() {
  const mnemonic =
    process.env.E2E_DEV_MNEMONIC?.trim() || readMnemonicFromEnvFile();
  if (!mnemonic) {
    console.error(
      'No mnemonic found. Set $E2E_DEV_MNEMONIC or put E2E_DEV_MNEMONIC="..." ' +
        'in .env.e2e.local.\nGenerate one with: node scripts/e2e-wallet.mjs generate'
    );
    process.exit(1);
  }

  const { fromMnemonicFull } = await loadSdk();
  console.log('Addresses to fund (public testnets). NO private keys shown.\n');

  let minaMissing = false;
  for (const { index, role } of ROLES) {
    const id = await fromMnemonicFull(mnemonic, { accountIndex: index });
    console.log(`[index ${index}] ${role}`);
    console.log(`  Base Sepolia (EVM): ${id.evmAddress}`);
    console.log(`  Solana devnet     : ${id.solana.publicKey}`);
    if (id.mina?.publicKey) {
      console.log(`  Mina devnet       : ${id.mina.publicKey}`);
    } else {
      console.log(
        '  Mina devnet       : (unavailable — mina-signer not installed)'
      );
      minaMissing = true;
    }
    console.log('');
  }

  console.log('Fund each via the faucets in docs/e2e-testnets.md, then deploy');
  console.log('contracts and record their addresses in e2e/testnets.json.\n');
  console.log(
    'NOTE: each role index derives a DISTINCT key on every chain — EVM/Nostr\n' +
      "(m/44'/1237'|60'/…/{idx}), Solana (m/44'/501'/{idx}'/0'), and Mina\n" +
      "(m/44'/12586'/{idx}'/0/0), via the accountIndex-varied SDK derivation\n" +
      '(SDK #177). Index 0 matches the historical fixed paths (backward compatible).'
  );
  if (minaMissing) {
    console.error(
      '\nNote: Mina addresses were skipped because mina-signer is not installed ' +
        'in this workspace. Install it (it is an optional dep) to print them.'
    );
  }
}

const cmd = process.argv[2];
if (cmd === 'generate') await cmdGenerate();
else if (cmd === 'addresses') await cmdAddresses();
else {
  console.error('Usage: node scripts/e2e-wallet.mjs <generate|addresses>');
  process.exit(1);
}
