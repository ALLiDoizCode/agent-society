#!/usr/bin/env node
// ---------------------------------------------------------------------------
// deploy-e2e-mina-zkapp-bare — one-time BARE Mina zkApp deploy for the
// public-testnet E2E mode (issue #185).
//
// Why "bare": the connector settles a Mina channel with
//   claimFromChannel → channelHash = Poseidon(apex.x, client.x, 0)
// A zkApp deployed WITH init (the default `deploy-mina-zkapp.ts` path) writes a
// SINGLE-PARTY channelHash = Poseidon(deployer.x, deployer.x, 0), which the
// connector can NEVER reproduce — settlement fails with "Supplied participant
// keys do not match the on-chain channelHash". So for the real settle run we
// deploy the zkApp BARE (MINA_SKIP_INIT=1, channelState=0) and let the CLIENT's
// `openMinaChannel` write the correct (client, apex) channelHash on-chain.
//
// You cannot re-init over an existing account, so the bare deploy MUST land on a
// FRESH zkApp address. We therefore use a DEDICATED, documented account index
// (E2E_MINA_ZKAPP_INDEX, default 98) distinct from the roles in
// scripts/e2e-wallet.mjs (0/1/2) and from the prior deploy's idx-99 key — its
// `MINA_ZKAPP_PRIVATE_KEY` is derived deterministically from E2E_DEV_MNEMONIC,
// so the address is reproducible.
//
// Deployer/fee-payer: the funded treasury role (E2E_DEPLOYER_INDEX, default 2 —
// the only funded role today), the same key `e2e-wallet addresses` prints and
// `deploy-e2e-testnet-evm.mjs` uses. Fund it from the Mina faucet first
// (https://faucet.minaprotocol.com — see docs/e2e-testnets.md).
//
// On success this writes the bare zkApp address into e2e/testnets.json
// `mina.zkAppAddress` (and drops the placeholder `mina.$comment`).
//
// Usage (from repo root, packages built, deployer funded):
//   pnpm --filter @toon-protocol/sdk build   # builds @toon-protocol/core too
//   E2E_DEV_MNEMONIC=… node scripts/deploy-e2e-mina-zkapp-bare.mjs
//   # or put E2E_DEV_MNEMONIC=… in .env.e2e.local
//
// Idempotency: NOT idempotent against a fresh index — re-running after a
// successful deploy hits the "account already exists, channelState=0, SKIP_INIT"
// no-op branch in deploy-mina-zkapp.ts and re-reports the SAME address. To
// deploy a genuinely fresh bare channel, bump E2E_MINA_ZKAPP_INDEX.
//
// ⚠️ Slow: o1js compile (~30-120s) + multi-minute public-devnet slots. Keep
//    Mina nightly, not per-PR. Requires real testnet MINA + the E2E_DEV_MNEMONIC
//    org secret — only an operator with those can run this for real.
// ---------------------------------------------------------------------------

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join, dirname } from 'node:path';
import { spawn } from 'node:child_process';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const TESTNETS = join(REPO, 'e2e', 'testnets.json');
const SDK_DIST = pathToFileURL(
  join(REPO, 'packages', 'sdk', 'dist', 'index.js')
).href;

// Funded fee-payer role (treasury). Matches deploy-e2e-testnet-evm.mjs.
const DEPLOYER_INDEX = Number(process.env.E2E_DEPLOYER_INDEX ?? '2');
// Dedicated, documented zkApp account index (NOT a peer/treasury role, NOT the
// prior idx-99 deploy). Bump to redeploy a fresh bare channel.
const ZKAPP_INDEX = Number(process.env.E2E_MINA_ZKAPP_INDEX ?? '98');

function readMnemonic() {
  const fromEnv = process.env.E2E_DEV_MNEMONIC?.trim();
  if (fromEnv) return fromEnv;
  const m = readFileSync(join(REPO, '.env.e2e.local'), 'utf8').match(
    /^\s*E2E_DEV_MNEMONIC\s*=\s*["']?([^"'\n]+)["']?\s*$/m
  );
  if (!m) throw new Error('E2E_DEV_MNEMONIC not set and not in .env.e2e.local');
  return m[1].trim();
}

async function main() {
  const config = JSON.parse(readFileSync(TESTNETS, 'utf8'));
  const mina = config.mina;
  if (!mina?.graphqlUrl) {
    throw new Error('e2e/testnets.json: mina.graphqlUrl is missing');
  }
  const graphqlUrl = process.env.MINA_GRAPHQL_URL || mina.graphqlUrl;

  // Derive both keys via the SDK so they match `e2e-wallet addresses` (the
  // Mina identity exposes the private key as HEX). Convert to the base58 "EK…"
  // form deploy-mina-zkapp.ts expects via @toon-protocol/core's
  // hexToMinaBase58PrivateKey (resolved through the SDK package, which depends
  // on core — it is not re-exported from the SDK's public surface).
  const { fromMnemonicFull } = await import(SDK_DIST);
  // @toon-protocol/core is a workspace package; load its built ESM entry by
  // path (its `exports` map has no `require`/`./package.json` condition, so a
  // bare `require.resolve` throws ERR_PACKAGE_PATH_NOT_EXPORTED). This mirrors
  // the repo-relative SDK_DIST import above — both are dev scripts run from a
  // built workspace, like deploy-e2e-testnet-evm.mjs.
  const CORE_DIST = pathToFileURL(
    join(REPO, 'packages', 'core', 'dist', 'index.js')
  ).href;
  const core = await import(CORE_DIST);
  const { hexToMinaBase58PrivateKey } = core;
  if (typeof hexToMinaBase58PrivateKey !== 'function') {
    throw new Error(
      'hexToMinaBase58PrivateKey not found on @toon-protocol/core — rebuild it: ' +
        'pnpm --filter @toon-protocol/core build'
    );
  }

  const mnemonic = readMnemonic();
  const deployerId = await fromMnemonicFull(mnemonic, {
    accountIndex: DEPLOYER_INDEX,
  });
  const zkAppId = await fromMnemonicFull(mnemonic, {
    accountIndex: ZKAPP_INDEX,
  });
  if (!deployerId.mina?.privateKey || !zkAppId.mina?.privateKey) {
    throw new Error(
      'Mina key derivation returned no private key — is mina-signer installed? ' +
        '(it is an optional dep; install it in the workspace)'
    );
  }
  const deployerEK = hexToMinaBase58PrivateKey(deployerId.mina.privateKey);
  const zkAppEK = hexToMinaBase58PrivateKey(zkAppId.mina.privateKey);

  console.log('=== Bare Mina zkApp deploy (MINA_SKIP_INIT=1) ===');
  console.log(`GraphQL          : ${graphqlUrl}`);
  console.log(`Deployer (idx ${DEPLOYER_INDEX})  : ${deployerId.mina.publicKey}`);
  console.log(`zkApp    (idx ${ZKAPP_INDEX})  : ${zkAppId.mina.publicKey}`);
  console.log(
    'Deploying bare (channelState=0) — the CLIENT opens the channel on-chain ' +
      'with the (client, apex) participants.\n'
  );

  // Delegate the actual deploy to scripts/deploy-mina-zkapp.ts (the single
  // source of truth for the o1js compile/deploy + idempotency). It reads
  // MINA_SKIP_INIT / MINA_ZKAPP_PRIVATE_KEY / MINA_DEPLOYER_PRIVATE_KEY /
  // MINA_GRAPHQL_URL and prints ONLY the zkApp address to STDOUT.
  const env = {
    ...process.env,
    MINA_SKIP_INIT: '1',
    MINA_GRAPHQL_URL: graphqlUrl,
    MINA_ZKAPP_PRIVATE_KEY: zkAppEK,
    MINA_DEPLOYER_PRIVATE_KEY: deployerEK,
  };
  const deployScript = join(REPO, 'scripts', 'deploy-mina-zkapp.ts');
  const address = await new Promise((resolve, reject) => {
    const child = spawn('npx', ['tsx', deployScript], {
      cwd: REPO,
      env,
      stdio: ['inherit', 'pipe', 'inherit'], // stdout captured; stderr → console
    });
    let out = '';
    child.stdout.on('data', (d) => {
      out += d.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`deploy-mina-zkapp.ts exited with code ${code}`));
        return;
      }
      const addr = out.trim().split('\n').filter(Boolean).pop() ?? '';
      if (!/^B62[1-9A-HJ-NP-Za-km-z]+$/.test(addr)) {
        reject(
          new Error(
            `deploy-mina-zkapp.ts did not print a Mina address (got: ${JSON.stringify(out)})`
          )
        );
        return;
      }
      resolve(addr);
    });
  });

  // Sanity: the printed address MUST be our deterministic zkApp address.
  if (address !== zkAppId.mina.publicKey) {
    throw new Error(
      `Deployed address ${address} != derived zkApp address ${zkAppId.mina.publicKey} ` +
        '(index/key mismatch)'
    );
  }

  // Record into e2e/testnets.json and drop the stale re-deploy placeholder.
  config.mina.zkAppAddress = address;
  delete config.mina.$comment;
  writeFileSync(TESTNETS, JSON.stringify(config, null, 2) + '\n');

  console.log('\n=== Mina bare deploy complete ===');
  console.log(`zkAppAddress: ${address}`);
  console.log(`Explorer: ${mina.explorer}/account/${address}`);
  console.log('Recorded in e2e/testnets.json (mina.zkAppAddress).');
  console.log(
    '\nNEXT: the connector can only settle once the CLIENT opens the channel ' +
      'on-chain (openMinaChannel writes Poseidon(client, apex, 0)). Verify by ' +
      'watching the Mina nonceField advance 0 → 1 on the first claimFromChannel ' +
      '(see packages/townhouse/RUNBOOK.md § "Mina reset gotcha").'
  );
}

await main();
