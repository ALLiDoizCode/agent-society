#!/usr/bin/env tsx
/**
 * fund-e2e-peers-mina — Mina leg of scripts/fund-e2e-peers.mjs.
 *
 * Sends native MINA from the funded E2E TREASURY (BIP-32 idx 2) to each peer
 * recipient (idx 0 / idx 1) on the PUBLIC Mina devnet, paying the 1 MINA
 * account-creation fee for any recipient that does not yet exist on-chain.
 *
 * Unlike scripts/fund-mina-address.ts (which acquires a pre-funded sender from a
 * LIGHTNET accounts-manager), this funds against the REAL devnet from the
 * treasury's own mnemonic-derived Mina key — there is no accounts-manager on a
 * public testnet, the treasury IS the faucet-funded payer.
 *
 * Invoked by fund-e2e-peers.mjs (never directly, normally):
 *   MINA_TREASURY_PRIVATE_KEY_HEX=<hex> \
 *   MINA_GRAPHQL_URL=<devnet> \
 *   MINA_FUND_AMOUNT_MINA=5 \
 *     npx tsx scripts/fund-e2e-peers-mina.ts <B62 recipient...>
 *
 * Idempotency: top-up to a target floor — a recipient already at/above
 * MINA_FUND_AMOUNT_MINA is skipped; below it, the shortfall is sent (plus the
 * account-creation fee on first funding). Re-runnable after a devnet reset.
 *
 * o1js is loaded via a createRequire anchored at the mina-zkapp package (same
 * technique deploy-mina-zkapp.ts / fund-mina-address.ts use); the hex→base58
 * (`EK…`) key conversion uses @toon-protocol/core's hexToMinaBase58PrivateKey,
 * dynamic-imported from its built dist (core is ESM-only, see the note inline).
 * All diagnostics → STDERR; the tx hashes → STDOUT. The private key is read
 * from the env and NEVER printed.
 */

import type * as O1js from 'o1js';

const GRAPHQL_URL =
  process.env.MINA_GRAPHQL_URL ||
  'https://api.minascan.io/node/devnet/v1/graphql';
// Target per-recipient floor (whole MINA) and the payment-tx fee (nanomina).
const FUND_AMOUNT_NANO = BigInt(
  Math.round(Number(process.env.MINA_FUND_AMOUNT_MINA || '5') * 1e9)
);
const FUND_FEE_NANO = BigInt(process.env.MINA_FUND_FEE || '100000000'); // 0.1 MINA
const TREASURY_HEX = (process.env.MINA_TREASURY_PRIVATE_KEY_HEX || '').trim();

function err(msg: string) {
  console.error(`[fund-e2e-peers-mina] ${msg}`);
}

async function main() {
  const recipients = process.argv.slice(2);
  if (recipients.length === 0) {
    err('usage: fund-e2e-peers-mina.ts <B62 recipient...>');
    process.exit(2);
  }
  for (const r of recipients) {
    if (!/^B62[a-zA-Z0-9]{40,60}$/.test(r)) {
      err(`not a B62 address: ${r}`);
      process.exit(2);
    }
  }
  if (!/^[0-9a-fA-F]+$/.test(TREASURY_HEX)) {
    err('MINA_TREASURY_PRIVATE_KEY_HEX missing or not hex');
    process.exit(2);
  }

  const { createRequire } = await import('node:module');
  const { fileURLToPath } = await import('node:url');
  const path = await import('node:path');
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const repo = path.resolve(scriptDir, '..');

  // o1js — anchored at the mina-zkapp package.
  const zkAppDir = path.join(repo, 'packages', 'mina-zkapp');
  const o1jsRequire = createRequire(path.join(zkAppDir, 'package.json'));
  const o1js = o1jsRequire('o1js') as typeof O1js;
  const { Mina, PrivateKey, PublicKey, AccountUpdate, fetchAccount, UInt64 } =
    o1js;

  // hex → Mina base58 (`EK…`). @toon-protocol/core is ESM-only (its package
  // `exports` map defines no `require` condition), so both `require(...)` and
  // `require.resolve(...)` fail with ERR_PACKAGE_PATH_NOT_EXPORTED. Dynamic-
  // `import` the built ESM entry directly (the canonical, stable dist path) —
  // requires the core package to be built (`pnpm --filter @toon-protocol/core
  // build`).
  const { pathToFileURL } = await import('node:url');
  const coreEntry = path.join(repo, 'packages', 'core', 'dist', 'index.js');
  const core = (await import(pathToFileURL(coreEntry).href).catch(() => {
    throw new Error(
      `Could not load @toon-protocol/core from ${coreEntry}. ` +
        'Build it first: pnpm --filter @toon-protocol/core build'
    );
  })) as { hexToMinaBase58PrivateKey: (hex: string) => string };
  const { hexToMinaBase58PrivateKey } = core;

  const network = Mina.Network(GRAPHQL_URL);
  Mina.setActiveInstance(network);

  const senderKey = PrivateKey.fromBase58(
    hexToMinaBase58PrivateKey(TREASURY_HEX)
  );
  const senderPub = senderKey.toPublicKey();
  err(`Treasury sender: ${senderPub.toBase58()}`);
  err(`GraphQL: ${GRAPHQL_URL}`);

  await fetchAccount({ publicKey: senderPub });

  const hashes: string[] = [];
  for (const target of recipients) {
    const targetPub = PublicKey.fromBase58(target);
    const existing = await fetchAccount({ publicKey: targetPub }).catch(() => ({
      account: undefined as unknown,
    }));
    const acct = (
      existing as { account?: { balance?: { toString(): string } } }
    ).account;
    const isNew = !acct;
    const balanceNano = acct?.balance ? BigInt(acct.balance.toString()) : 0n;

    if (!isNew && balanceNano >= FUND_AMOUNT_NANO) {
      err(
        `${target}: balance ${Number(balanceNano) / 1e9} MINA >= floor ` +
          `${Number(FUND_AMOUNT_NANO) / 1e9} — skip`
      );
      continue;
    }
    const sendNano = isNew ? FUND_AMOUNT_NANO : FUND_AMOUNT_NANO - balanceNano;
    err(
      `${target}: ${isNew ? 'NEW (account-creation fee applies)' : `top-up ${Number(sendNano) / 1e9} MINA`}`
    );

    const tx = await Mina.transaction(
      { sender: senderPub, fee: FUND_FEE_NANO },
      async () => {
        if (isNew) AccountUpdate.fundNewAccount(senderPub);
        const su = AccountUpdate.createSigned(senderPub);
        su.send({ to: targetPub, amount: UInt64.from(sendNano) });
      }
    );
    await tx.prove();
    const pending = await tx.sign([senderKey]).send();
    err(`  payment tx sent: ${pending.hash}`);
    const included = await pending.wait();
    err(`  included. status: ${included.status}`);
    hashes.push(pending.hash);
  }

  // Tx hashes (one per line) to STDOUT for the caller.
  for (const h of hashes) console.log(h);
}

main().catch((e) => {
  err(`failed: ${e?.message ?? e}`);
  if (e?.stack) console.error(e.stack);
  process.exit(1);
});
