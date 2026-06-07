#!/usr/bin/env tsx
/**
 * Fund a Mina address from the lightnet accounts-manager (Phase-2 Stage 3).
 *
 * Acquires a PRE-FUNDED account from the o1labs lightnet accounts-manager and
 * submits a native MINA payment transferring `MINA_FUND_AMOUNT` nanomina to the
 * target B62 address, then waits for inclusion. Prints the payment tx hash to
 * STDOUT (all diagnostics → STDERR, so the caller can capture the hash cleanly).
 *
 * Used by `scripts/townhouse-e2e-local-hs.sh` `fund_client_mina` to fund the
 * toon-client's derived Mina address — the client must pay its OWN on-chain
 * `initializeChannel` + `deposit` tx fees (~0.1 MINA each) plus the channel
 * deposit, but boots with 0 MINA (its Mina identity is mnemonic-derived, never
 * faucet-funded). Without this the client's `openMinaChannelOnChain` fails with
 * an insufficient-balance / fee-payer error and no on-chain channel is opened.
 *
 * Usage: tsx scripts/fund-mina-address.ts <targetB62Address>
 *
 * Environment:
 *   MINA_GRAPHQL_URL   - Mina GraphQL endpoint (default: http://localhost:19085/graphql)
 *   MINA_ACCOUNTS_URL  - Accounts manager endpoint (default: http://localhost:19181)
 *   MINA_FUND_AMOUNT   - nanomina to transfer (default: 5_000_000_000 = 5 MINA —
 *                        covers init fee + deposit fee + a 1_000_000-base-unit
 *                        channel deposit with headroom)
 *   MINA_FUND_FEE      - payment tx fee in nanomina (default: 100_000_000 = 0.1 MINA)
 *
 * o1js is loaded via a `createRequire` anchored at the mina-zkapp package (same
 * technique deploy-mina-zkapp.ts uses) because neither `o1js` nor the script's
 * directory is a root dependency.
 */

import type * as O1js from 'o1js';

const GRAPHQL_URL =
  process.env.MINA_GRAPHQL_URL || 'http://localhost:19085/graphql';
const ACCOUNTS_URL = process.env.MINA_ACCOUNTS_URL || 'http://localhost:19181';
const FUND_AMOUNT = BigInt(process.env.MINA_FUND_AMOUNT || '5000000000');
const FUND_FEE = BigInt(process.env.MINA_FUND_FEE || '100000000');

async function main() {
  const target = process.argv[2];
  if (!target || !/^B62[a-zA-Z0-9]{40,60}$/.test(target)) {
    console.error('usage: fund-mina-address.ts <targetB62Address>');
    process.exit(2);
  }

  const { createRequire } = await import('node:module');
  const { fileURLToPath } = await import('node:url');
  const path = await import('node:path');
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const zkAppDir = path.resolve(scriptDir, '..', 'packages', 'mina-zkapp');
  const require = createRequire(path.join(zkAppDir, 'package.json'));
  const o1js = require('o1js') as typeof O1js;
  const { Mina, PrivateKey, PublicKey, AccountUpdate, fetchAccount, UInt64 } =
    o1js;

  const network = Mina.Network(GRAPHQL_URL);
  Mina.setActiveInstance(network);

  // Acquire a pre-funded sender from the accounts-manager (GET, unlocked).
  const acquireRes = await fetch(
    `${ACCOUNTS_URL}/acquire-account?unlockAccount=true`,
    { method: 'GET' }
  );
  if (!acquireRes.ok) {
    throw new Error(
      `Failed to acquire Mina account: ${acquireRes.status} ${acquireRes.statusText}`
    );
  }
  const sender = (await acquireRes.json()) as { pk: string; sk: string };
  const senderKey = PrivateKey.fromBase58(sender.sk);
  const senderPub = senderKey.toPublicKey();
  const targetPub = PublicKey.fromBase58(target);
  console.error(`Funding ${target} with ${FUND_AMOUNT} nanomina`);
  console.error(`Sender (lightnet, pre-funded): ${senderPub.toBase58()}`);

  await fetchAccount({ publicKey: senderPub });

  // Detect whether the target account already exists on-chain. A brand-new
  // account needs the 1 MINA account-creation fee, paid by funding a new
  // account update; an existing account does not.
  const targetExisting = await fetchAccount({ publicKey: targetPub }).catch(
    () => ({ account: undefined })
  );
  const targetIsNew = !targetExisting.account;
  console.error(
    `Target account ${targetIsNew ? 'is NEW (account-creation fee applies)' : 'already exists'}`
  );

  const tx = await Mina.transaction(
    { sender: senderPub, fee: FUND_FEE },
    async () => {
      if (targetIsNew) {
        AccountUpdate.fundNewAccount(senderPub);
      }
      const senderUpdate = AccountUpdate.createSigned(senderPub);
      senderUpdate.send({ to: targetPub, amount: UInt64.from(FUND_AMOUNT) });
    }
  );
  // No zkApp proof — a plain payment is signature-only; prove() is a cheap no-op.
  await tx.prove();
  const pending = await tx.sign([senderKey]).send();
  console.error(`Payment tx sent: ${pending.hash}`);
  const included = await pending.wait();
  console.error(`Payment included. Status: ${included.status}`);

  console.log(pending.hash);
}

main().catch((err) => {
  console.error('Mina funding failed:', err);
  process.exit(1);
});
