#!/usr/bin/env node
// ---------------------------------------------------------------------------
// e2e-derive-peer-config — emit the public-mode peer config for sdk-e2e-infra.
//
// Reads the funded dev wallet seed (E2E_DEV_MNEMONIC) + the committed public
// testnet endpoints/addresses (e2e/testnets.json) and prints the per-peer
// settlement keys + chain config that `scripts/sdk-e2e-infra.sh --public`
// substitutes into the docker-compose peers.
//
// Per-peer keys are derived from the SAME single seed via the SAME SDK
// derivation as scripts/e2e-wallet.mjs (`fromMnemonicFull(mnemonic, {
// accountIndex })`). SDK #177 makes accountIndex vary keys on ALL chains:
//   EVM    m/44'/60'/{idx}                     (settlement private key)
//   Solana m/44'/501'/{idx}'/0'                (settlement keypair)
//   Mina   m/44'/12586'/{idx}'/0/0             (settlement key)
// Role → index (MUST match scripts/e2e-wallet.mjs ROLES):
//   idx0 = peer1 settlement, idx1 = peer2 settlement, idx2 = treasury/funder.
//
// Output formats:
//   (default)   sourceable `KEY=value` env lines for the harness (eval-able).
//   --json      a JSON object (for debugging / programmatic use).
//   --check     derive + validate ONLY; print a human summary with public
//               values (NO private keys), exit non-zero on any problem.
//               Used as the offline gate (no funds / no live chains needed).
//
// Mnemonic source (first hit wins):
//   1. $E2E_DEV_MNEMONIC
//   2. E2E_DEV_MNEMONIC="..." in ./.env.e2e.local (gitignored)
// In --check mode a throwaway mnemonic may be supplied with --mnemonic "<words>"
// so the derivation can be exercised offline without the real secret.
//
// Requires the SDK built once:  pnpm --filter @toon-protocol/sdk build
//
// SECURITY: private keys are emitted ONLY in the default/--json env output that
// the harness consumes in-process; they are NEVER printed in --check mode and
// NEVER written to disk by this script. The harness keeps them in env only.
// ---------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SDK_DIST = join(REPO_ROOT, 'packages', 'sdk', 'dist', 'index.js');
const SPL_PRIMITIVES = join(REPO_ROOT, 'infra', 'solana', 'spl-primitives.mjs');
const TESTNETS_JSON = join(REPO_ROOT, 'e2e', 'testnets.json');

// Role → BIP-32 account index. MUST stay in lockstep with
// scripts/e2e-wallet.mjs ROLES so the funded addresses match the transacting
// keys.
const PEER1_INDEX = 0;
const PEER2_INDEX = 1;

function fail(msg) {
  console.error(`[e2e-derive-peer-config] ${msg}`);
  process.exit(1);
}

async function loadSdk() {
  try {
    return await import(SDK_DIST);
  } catch (err) {
    fail(
      'Could not import the built SDK. Build it first:\n' +
        '  pnpm --filter @toon-protocol/sdk build\n' +
        `(looked for ${SDK_DIST})\n(original error: ${err?.message ?? err})`
    );
  }
}

function readMnemonicFromEnvFile() {
  try {
    const text = readFileSync(join(REPO_ROOT, '.env.e2e.local'), 'utf8');
    const m = text.match(
      /^\s*E2E_DEV_MNEMONIC\s*=\s*["']?([^"'\n]+)["']?\s*$/m
    );
    return m?.[1]?.trim() || undefined;
  } catch {
    return undefined;
  }
}

function readTestnets() {
  let raw;
  try {
    raw = readFileSync(TESTNETS_JSON, 'utf8');
  } catch (err) {
    fail(`Could not read ${TESTNETS_JSON}: ${err?.message ?? err}`);
  }
  let cfg;
  try {
    cfg = JSON.parse(raw);
  } catch (err) {
    fail(`${TESTNETS_JSON} is not valid JSON: ${err?.message ?? err}`);
  }

  // Refuse to run while any required address is null/empty — the file's own
  // $comment mandates this (addresses are null until the one-time deploy runs).
  const required = [
    ['evm.chainId', cfg.evm?.chainId],
    ['evm.rpcUrl', cfg.evm?.rpcUrl],
    ['evm.registryAddress', cfg.evm?.registryAddress],
    ['evm.tokenAddress', cfg.evm?.tokenAddress],
    ['evm.tokenNetworkAddress', cfg.evm?.tokenNetworkAddress],
    ['solana.rpcUrl', cfg.solana?.rpcUrl],
    ['solana.programId', cfg.solana?.programId],
    ['solana.tokenMint', cfg.solana?.tokenMint],
    ['mina.graphqlUrl', cfg.mina?.graphqlUrl],
    ['mina.zkAppAddress', cfg.mina?.zkAppAddress],
  ];
  const missing = required
    .filter(([, v]) => v === null || v === undefined || v === '')
    .map(([k]) => k);
  if (missing.length > 0) {
    fail(
      'REFUSING to run public mode: required testnet address(es) are null in ' +
        `e2e/testnets.json:\n  ${missing.join('\n  ')}\n` +
        'Run the one-time deploy and pin the addresses first (see docs/e2e-testnets.md).'
    );
  }
  return cfg;
}

// Derive the chain-id env-key suffix the connector uses for a chain id string:
//   "evm:base:84532" -> "EVM_BASE_84532"  (see docker/src/shared.ts).
function envSuffix(chainKey) {
  return chainKey.replace(/:/g, '_').toUpperCase();
}

// testnets.json stores the canonical CAIP id ("eip155:84532"); the connector's
// SUPPORTED_CHAINS / env-key convention uses the "evm:base:<id>" form. Extract
// the numeric id and build the connector chain key + env suffix from it.
function evmChainKeyFromCaip(caip) {
  const m = String(caip).match(/^eip155:(\d+)$/);
  if (!m) {
    fail(
      `Unexpected evm.chainId "${caip}" in testnets.json — expected "eip155:<id>".`
    );
  }
  return { chainKey: `evm:base:${m[1]}` };
}

function evmPrivHex(secretKey) {
  return '0x' + Buffer.from(secretKey).toString('hex');
}

async function derivePeers(mnemonic, testnets) {
  const { fromMnemonicFull } = await loadSdk();
  const { deriveATA } = await import(SPL_PRIMITIVES);

  const peer1 = await fromMnemonicFull(mnemonic, { accountIndex: PEER1_INDEX });
  const peer2 = await fromMnemonicFull(mnemonic, { accountIndex: PEER2_INDEX });

  const mint = testnets.solana.tokenMint;
  const { chainKey: evmChainKey } = evmChainKeyFromCaip(testnets.evm.chainId);
  return {
    evmChainKey, // e.g. evm:base:84532 (SUPPORTED_CHAINS form)
    evmSuffix: envSuffix(evmChainKey), // e.g. EVM_BASE_84532
    peer1: {
      evmAddress: peer1.evmAddress,
      evmPrivateKey: evmPrivHex(peer1.secretKey),
      solanaPubkey: peer1.solana.publicKey,
      solanaTokenAccount: deriveATA(peer1.solana.publicKey, mint),
      minaAccount: peer1.mina?.publicKey ?? '',
    },
    peer2: {
      evmAddress: peer2.evmAddress,
      evmPrivateKey: evmPrivHex(peer2.secretKey),
      solanaPubkey: peer2.solana.publicKey,
      solanaTokenAccount: deriveATA(peer2.solana.publicKey, mint),
      minaAccount: peer2.mina?.publicKey ?? '',
    },
  };
}

// The env var names the public-mode compose override (docker-compose-sdk-e2e.public.yml)
// substitutes. The EVM chain-id-suffixed keys are computed from testnets.json
// (Base Sepolia => *_EVM_BASE_84532), unlike local mode's fixed *_31337.
function toEnvLines(d, testnets) {
  const s = d.evmSuffix;
  return [
    // --- shared testnet endpoints/addresses (both peers) ---
    `E2E_EVM_CHAIN_SUFFIX=${s}`,
    `E2E_EVM_RPC_URL=${testnets.evm.rpcUrl}`,
    `E2E_EVM_REGISTRY_ADDRESS=${testnets.evm.registryAddress}`,
    `E2E_EVM_TOKEN_ADDRESS=${testnets.evm.tokenAddress}`,
    `E2E_EVM_TOKEN_NETWORK_ADDRESS=${testnets.evm.tokenNetworkAddress}`,
    `E2E_SOLANA_RPC_URL=${testnets.solana.rpcUrl}`,
    `E2E_SOLANA_PROGRAM_ID=${testnets.solana.programId}`,
    `E2E_SOLANA_TOKEN_MINT=${testnets.solana.tokenMint}`,
    `E2E_MINA_GRAPHQL_URL=${testnets.mina.graphqlUrl}`,
    `E2E_MINA_ZKAPP_ADDRESS=${testnets.mina.zkAppAddress}`,
    // --- peer1 (idx0) ---
    `PEER1_SETTLEMENT_PRIVATE_KEY=${d.peer1.evmPrivateKey}`,
    `PEER1_EVM_ADDRESS=${d.peer1.evmAddress}`,
    `PEER1_SOLANA_TOKEN_ACCOUNT=${d.peer1.solanaTokenAccount}`,
    `PEER1_MINA_ACCOUNT=${d.peer1.minaAccount}`,
    // --- peer2 (idx1) ---
    `PEER2_SETTLEMENT_PRIVATE_KEY=${d.peer2.evmPrivateKey}`,
    `PEER2_EVM_ADDRESS=${d.peer2.evmAddress}`,
    `PEER2_SOLANA_TOKEN_ACCOUNT=${d.peer2.solanaTokenAccount}`,
    `PEER2_MINA_ACCOUNT=${d.peer2.minaAccount}`,
  ];
}

async function main() {
  const args = process.argv.slice(2);
  const mode = args.includes('--json')
    ? 'json'
    : args.includes('--check')
      ? 'check'
      : 'env';

  const mIdx = args.indexOf('--mnemonic');
  const overrideMnemonic = mIdx >= 0 ? args[mIdx + 1] : undefined;

  if (overrideMnemonic && mode !== 'check') {
    fail('--mnemonic is only allowed with --check (offline derivation gate).');
  }

  const mnemonic =
    overrideMnemonic ||
    process.env.E2E_DEV_MNEMONIC?.trim() ||
    readMnemonicFromEnvFile();
  if (!mnemonic) {
    fail(
      'No mnemonic found. Set $E2E_DEV_MNEMONIC or put E2E_DEV_MNEMONIC="..." ' +
        'in .env.e2e.local (or pass --mnemonic "<words>" with --check).'
    );
  }

  const testnets = readTestnets();
  const derived = await derivePeers(mnemonic, testnets);

  if (mode === 'json') {
    console.log(JSON.stringify({ testnets, ...derived }, null, 2));
    return;
  }

  if (mode === 'check') {
    // PUBLIC values only — no private keys.
    const minaOk = derived.peer1.minaAccount && derived.peer2.minaAccount;
    console.log(
      'Public-mode peer config — derivation OK (no private keys shown).\n'
    );
    console.log(
      `EVM chain key       : ${derived.evmChainKey}  (CAIP ${testnets.evm.chainId})`
    );
    console.log(
      `EVM env-key suffix  : ${derived.evmSuffix}  (e.g. SETTLEMENT_ADDRESS_${derived.evmSuffix})`
    );
    console.log(`EVM RPC             : ${testnets.evm.rpcUrl}`);
    console.log(`EVM registry        : ${testnets.evm.registryAddress}`);
    console.log(`EVM token (USDC)    : ${testnets.evm.tokenAddress}`);
    console.log(`EVM TokenNetwork    : ${testnets.evm.tokenNetworkAddress}`);
    console.log(`Solana RPC          : ${testnets.solana.rpcUrl}`);
    console.log(`Solana program      : ${testnets.solana.programId}`);
    console.log(`Solana mint         : ${testnets.solana.tokenMint}`);
    console.log(`Mina GraphQL        : ${testnets.mina.graphqlUrl}`);
    console.log(`Mina zkApp          : ${testnets.mina.zkAppAddress}\n`);
    console.log(`[idx ${PEER1_INDEX}] peer1`);
    console.log(`  EVM address       : ${derived.peer1.evmAddress}`);
    console.log(`  Solana pubkey     : ${derived.peer1.solanaPubkey}`);
    console.log(`  Solana ATA        : ${derived.peer1.solanaTokenAccount}`);
    console.log(
      `  Mina account      : ${derived.peer1.minaAccount || '(unavailable — mina-signer not installed)'}`
    );
    console.log(`[idx ${PEER2_INDEX}] peer2`);
    console.log(`  EVM address       : ${derived.peer2.evmAddress}`);
    console.log(`  Solana pubkey     : ${derived.peer2.solanaPubkey}`);
    console.log(`  Solana ATA        : ${derived.peer2.solanaTokenAccount}`);
    console.log(
      `  Mina account      : ${derived.peer2.minaAccount || '(unavailable — mina-signer not installed)'}`
    );
    if (!minaOk) {
      console.error(
        '\nNote: a Mina account was unavailable (mina-signer not installed). ' +
          'Mina settlement will be skipped; install mina-signer to enable it.'
      );
    }
    return;
  }

  // mode === 'env': eval-able lines for the harness.
  for (const line of toEnvLines(derived, testnets)) console.log(line);
}

main().catch((err) => fail(err?.stack ?? String(err)));
