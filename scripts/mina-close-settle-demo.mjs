#!/usr/bin/env node
/**
 * Mina payment-channel CLOSE + SETTLE demonstration (Story 34.4).
 *
 * The Mina mirror of `scripts/solana-close-settle-demo.mjs`. Proves the apex
 * (participant B / recipient) account is ACTUALLY CREDITED native MINA when a
 * channel that accumulated an on-chain `claimFromChannel` is closed and settled.
 *
 * Lifecycle (mirrors the connector's `MinaPaymentChannelSDK`, extracted from the
 * 3.9.13 dist — `mina-payment-channel-sdk.js`, whose methods are thin
 * pass-throughs to the zkApp's `@method`s):
 *
 *   1. deploy + initializeChannel      — open channel (participantA=A, B=apex)
 *   2. deposit(amount, depositor)       — depositor ESCROWS native MINA on the
 *                                          zkApp account (the Mina analog of the
 *                                          Solana vault PDA). NEW in Story 34.4:
 *                                          deposit now actually custodies funds.
 *   3. claimFromChannel                 — advance commitment/nonce for a
 *                                          depositor-signed balance proof (the
 *                                          per-publish accrual; escrow unchanged)
 *   4. initiateClose                    — initiate close; records closedAtSlot,
 *                                          starts the challenge window
 *   5. (wait the challenge window)
 *   6. settle                           — drains the zkApp escrow: balanceB →
 *                                          participantB (apex/recipient credit) +
 *                                          balanceA → participantA (depositor
 *                                          refund). THIS credits the apex.
 *
 * ── CHALLENGE WINDOW (honesty note) ──────────────────────────────────────────
 * The on-chain `settle()` requires `currentSlot >= closedAtSlot + settlementTimeout`.
 * Production channels use settlementTimeout=86400 slots; the SETTLE mechanics
 * (escrow→recipient) are identical regardless of the window length — only the
 * wait differs. So this demo opens the channel with a SHORT settlementTimeout
 * (default 2 slots, override via MINA_CHALLENGE_SLOTS) and polls the lightnet
 * until the deadline slot is reached, exercising the exact same `settle` proof.
 * Lightnet slotDuration is ~20s, so a 2-slot window settles in ~40-80s. Every tx
 * hash + balance is real and on-chain.
 *
 * ── VK / CONNECTOR caveat (honesty note) ─────────────────────────────────────
 * This demo deploys + drives THIS repo's (Story-34.4 modified) PaymentChannel
 * zkApp, which has a DIFFERENT verification key than the one connector 3.9.13
 * bundles. The per-publish connector path (its claimFromChannel) targets the
 * connector-bundled VK, so the recipient-credit at settle proven here cannot yet
 * be driven THROUGH the connector — it requires shipping this zkApp into a
 * connector release. This script demonstrates the recipient credit at the zkApp
 * layer end-to-end on a real lightnet.
 *
 * Usage:
 *   node scripts/mina-close-settle-demo.mjs
 *
 * Env:
 *   MINA_GRAPHQL_URL        default http://localhost:28085/graphql
 *   MINA_ACCOUNTS_URL       default http://localhost:28181
 *   MINA_DEPOSIT_MINA       default 5     (MINA deposited / escrowed)
 *   MINA_CLAIM_MINA         default 3     (MINA owed to the apex recipient B)
 *   MINA_CHALLENGE_SLOTS    default 2     (settlementTimeout, in global slots)
 */

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const GRAPHQL_URL =
  process.env.MINA_GRAPHQL_URL || 'http://localhost:28085/graphql';
const ACCOUNTS_URL = process.env.MINA_ACCOUNTS_URL || 'http://localhost:28181';
const DEPOSIT_MINA = Number(process.env.MINA_DEPOSIT_MINA || '5');
const CLAIM_MINA = Number(process.env.MINA_CLAIM_MINA || '3');
const CHALLENGE_SLOTS = BigInt(process.env.MINA_CHALLENGE_SLOTS || '2');
const DEPOSIT_NANO = BigInt(Math.round(DEPOSIT_MINA * 1e9));
const CLAIM_NANO = BigInt(Math.round(CLAIM_MINA * 1e9));
const REFUND_NANO = DEPOSIT_NANO - CLAIM_NANO;
const TX_FEE = 100_000_000; // 0.1 MINA

function log(...a) {
  console.error('[mina-close-settle]', ...a);
}

async function gql(query) {
  const res = await fetch(GRAPHQL_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data;
}

async function currentGlobalSlot() {
  const d = await gql(
    '{ bestChain(maxLength:1){ protocolState{ consensusState{ slotSinceGenesis } } } }'
  );
  return BigInt(d.bestChain[0].protocolState.consensusState.slotSinceGenesis);
}

async function acquireAccount() {
  const res = await fetch(
    `${ACCOUNTS_URL}/acquire-account?unlockAccount=true`,
    {
      method: 'GET',
    }
  );
  if (!res.ok)
    throw new Error(`acquire-account failed: ${res.status} ${res.statusText}`);
  return res.json(); // { pk, sk }
}

async function main() {
  // Reuse the deploy-mina-zkapp.ts createRequire anchor so o1js + the zkApp load
  // through the SAME (CJS) o1js instance (see deploy-mina-zkapp.ts for the full
  // rationale on the ESM/CJS dual-instance gotcha under o1js 2.14).
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const zkAppDir = resolve(scriptDir, '..', 'packages', 'mina-zkapp');
  const require = createRequire(join(zkAppDir, 'package.json'));
  const o1js = require('o1js');
  const {
    Mina,
    PrivateKey,
    Field,
    Poseidon,
    Signature,
    AccountUpdate,
    fetchAccount,
  } = o1js;
  const { PaymentChannel } = require(join(zkAppDir, 'dist', 'index.js'));

  Mina.setActiveInstance(Mina.Network(GRAPHQL_URL));

  log(`GraphQL=${GRAPHQL_URL} accounts=${ACCOUNTS_URL}`);
  log(
    `deposit=${DEPOSIT_MINA} MINA claim(B)=${CLAIM_MINA} MINA refund(A)=${
      Number(REFUND_NANO) / 1e9
    } MINA challengeSlots=${CHALLENGE_SLOTS}`
  );

  // Acquire 3 funded lightnet accounts.
  const deployerAcct = await acquireAccount();
  const aAcct = await acquireAccount(); // participant A (depositor / client)
  const bAcct = await acquireAccount(); // participant B (apex / recipient)
  const deployerKey = PrivateKey.fromBase58(deployerAcct.sk);
  const deployerPub = deployerKey.toPublicKey();
  const aKey = PrivateKey.fromBase58(aAcct.sk);
  const aPub = aKey.toPublicKey();
  const bKey = PrivateKey.fromBase58(bAcct.sk);
  const bPub = bKey.toPublicKey();
  log(`deployer = ${deployerPub.toBase58()}`);
  log(`A (depositor) = ${aPub.toBase58()}`);
  log(`B (apex/recipient) = ${bPub.toBase58()}  <-- credited at settle`);

  log('Compiling PaymentChannel zkApp (o1js — slow)…');
  await PaymentChannel.compile();

  const zkAppKey = PrivateKey.random();
  const zkAppAddress = zkAppKey.toPublicKey();
  const zkApp = new PaymentChannel(zkAppAddress);
  log(`zkApp address = ${zkAppAddress.toBase58()}`);

  const channelNonce = Field(0);
  const settlementTimeout = Field(CHALLENGE_SLOTS);
  const tokenId = Field(1);

  // 1) Deploy.
  await fetchAccount({ publicKey: deployerPub });
  log('Deploying zkApp…');
  let tx = await Mina.transaction(
    { sender: deployerPub, fee: TX_FEE },
    async () => {
      AccountUpdate.fundNewAccount(deployerPub);
      await zkApp.deploy();
    }
  );
  await tx.prove();
  let pending = await tx.sign([deployerKey, zkAppKey]).send();
  log(`deploy tx = ${pending.hash}`);
  await pending.wait();

  // 1b) initializeChannel(A, B).
  await fetchAccount({ publicKey: zkAppAddress });
  await fetchAccount({ publicKey: deployerPub });
  log('initializeChannel(A, B)…');
  tx = await Mina.transaction(
    { sender: deployerPub, fee: TX_FEE },
    async () => {
      await zkApp.initializeChannel(
        aPub,
        bPub,
        channelNonce,
        settlementTimeout,
        tokenId
      );
    }
  );
  await tx.prove();
  pending = await tx.sign([deployerKey]).send();
  log(`init tx = ${pending.hash}`);
  await pending.wait();

  // 2) deposit — A escrows DEPOSIT_NANO on the zkApp account.
  await fetchAccount({ publicKey: zkAppAddress });
  await fetchAccount({ publicKey: aPub });
  const zkAppBalBeforeDeposit = (
    await fetchAccount({ publicKey: zkAppAddress })
  ).account.balance.toBigInt();
  log(
    `zkApp escrow balance BEFORE deposit = ${zkAppBalBeforeDeposit} nanomina`
  );
  log(`deposit ${DEPOSIT_MINA} MINA (A escrows on the zkApp)…`);
  tx = await Mina.transaction({ sender: aPub, fee: TX_FEE }, async () => {
    await zkApp.deposit(Field(DEPOSIT_NANO), aPub);
  });
  await tx.prove();
  pending = await tx.sign([aKey]).send();
  log(`deposit tx = ${pending.hash}`);
  await pending.wait();
  const zkAppBalAfterDeposit = (
    await fetchAccount({ publicKey: zkAppAddress })
  ).account.balance.toBigInt();
  log(
    `zkApp escrow balance AFTER deposit  = ${zkAppBalAfterDeposit} nanomina ` +
      `(delta +${zkAppBalAfterDeposit - zkAppBalBeforeDeposit})`
  );

  // 3) claimFromChannel — depositor-signed balance proof: A keeps REFUND, B owed CLAIM.
  const balA = Field(REFUND_NANO);
  const balB = Field(CLAIM_NANO);
  const salt = Field(424242);
  const newNonce = Field(1);
  const channelHash = Poseidon.hash([aPub.x, bPub.x, channelNonce]);
  const newCommitment = Poseidon.hash([balA, balB, salt]);
  const claimMsg = [newCommitment, newNonce, channelHash];
  const sigA = Signature.create(aKey, claimMsg);
  const sigB = Signature.create(bKey, claimMsg);
  await fetchAccount({ publicKey: zkAppAddress });
  await fetchAccount({ publicKey: deployerPub });
  log('claimFromChannel (advance commitment/nonce)…');
  tx = await Mina.transaction(
    { sender: deployerPub, fee: TX_FEE },
    async () => {
      await zkApp.claimFromChannel(
        balA,
        balB,
        salt,
        sigA,
        sigB,
        aPub,
        bPub,
        channelNonce,
        newCommitment,
        newNonce
      );
    }
  );
  await tx.prove();
  pending = await tx.sign([deployerKey]).send();
  log(`claim tx = ${pending.hash}`);
  await pending.wait();

  // 4) initiateClose with the latest balances.
  const closeNonce = Field(2);
  const closeMsg = [balA, balB, salt, closeNonce];
  const closeSigA = Signature.create(aKey, closeMsg);
  const closeSigB = Signature.create(bKey, closeMsg);
  await fetchAccount({ publicKey: zkAppAddress });
  await fetchAccount({ publicKey: deployerPub });
  const slotAtClose = await currentGlobalSlot();
  log(`initiateClose (current global slot ~${slotAtClose})…`);
  tx = await Mina.transaction(
    { sender: deployerPub, fee: TX_FEE },
    async () => {
      await zkApp.initiateClose(
        balA,
        balB,
        salt,
        closeNonce,
        closeSigA,
        closeSigB
      );
    }
  );
  await tx.prove();
  pending = await tx.sign([deployerKey]).send();
  log(`close tx = ${pending.hash}`);
  await pending.wait();
  await fetchAccount({ publicKey: zkAppAddress });
  const closedAtSlot = (await fetchAccount({ publicKey: zkAppAddress })).account
    .zkapp.appState[5];
  log(`closedAtSlot (appState[5]) = ${closedAtSlot.toString()}`);

  // 5) Wait the challenge window: poll until currentSlot >= closedAtSlot + timeout.
  const deadline = BigInt(closedAtSlot.toString()) + CHALLENGE_SLOTS;
  log(`Waiting for global slot >= ${deadline} (challenge window)…`);
  const start = Date.now();
  let slot = await currentGlobalSlot();
  while (slot < deadline) {
    if (Date.now() - start > 12 * 60 * 1000)
      throw new Error('challenge-window wait exceeded 12 min');
    await new Promise((r) => setTimeout(r, 5000));
    slot = await currentGlobalSlot();
    log(`  …current slot = ${slot} (need >= ${deadline})`);
  }

  // 6) settle — drains escrow: balanceB → B (recipient credit), balanceA → A.
  await fetchAccount({ publicKey: bPub });
  await fetchAccount({ publicKey: aPub });
  await fetchAccount({ publicKey: zkAppAddress });
  await fetchAccount({ publicKey: deployerPub });
  const bBefore = (
    await fetchAccount({ publicKey: bPub })
  ).account.balance.toBigInt();
  const aBefore = (
    await fetchAccount({ publicKey: aPub })
  ).account.balance.toBigInt();
  const escrowBefore = (
    await fetchAccount({ publicKey: zkAppAddress })
  ).account.balance.toBigInt();
  log(
    `--- PRE-SETTLE: B=${bBefore} A=${aBefore} escrow=${escrowBefore} (nanomina) ---`
  );

  tx = await Mina.transaction(
    { sender: deployerPub, fee: TX_FEE },
    async () => {
      await zkApp.settle(balA, balB, salt, aPub, bPub, channelNonce);
    }
  );
  await tx.prove();
  pending = await tx.sign([deployerKey]).send();
  const settleHash = pending.hash;
  log(`settle tx = ${settleHash}`);
  await pending.wait();

  await fetchAccount({ publicKey: bPub });
  await fetchAccount({ publicKey: aPub });
  await fetchAccount({ publicKey: zkAppAddress });
  const bAfter = (
    await fetchAccount({ publicKey: bPub })
  ).account.balance.toBigInt();
  const aAfter = (
    await fetchAccount({ publicKey: aPub })
  ).account.balance.toBigInt();
  const escrowAfter = (
    await fetchAccount({ publicKey: zkAppAddress })
  ).account.balance.toBigInt();
  const channelState = (await fetchAccount({ publicKey: zkAppAddress })).account
    .zkapp.appState[3];

  log('============================================================');
  log('  settle RESULT — apex recipient credited?');
  log('============================================================');
  log(`settle tx hash = ${settleHash}`);
  log(
    `channelState (appState[3]) after settle = ${channelState.toString()} (3 = SETTLED)`
  );
  log('');
  log(`B (apex / recipient) ${bPub.toBase58()}`);
  log(`  BEFORE settle = ${bBefore} (${Number(bBefore) / 1e9} MINA)`);
  log(`  AFTER  settle = ${bAfter} (${Number(bAfter) / 1e9} MINA)`);
  log(`  DELTA         = +${bAfter - bBefore}  [expected +${CLAIM_NANO}]`);
  log('');
  log(`A (depositor refund) ${aPub.toBase58()}`);
  log(`  BEFORE settle = ${aBefore}`);
  log(
    `  AFTER  settle = ${aAfter}  (DELTA +${aAfter - aBefore})  [expected refund +${REFUND_NANO}]`
  );
  log('');
  log(
    `zkApp escrow: ${escrowBefore} -> ${escrowAfter}  (drained ${escrowBefore - escrowAfter})`
  );
  log('============================================================');

  const ok =
    bAfter - bBefore === CLAIM_NANO &&
    aAfter - aBefore === REFUND_NANO &&
    channelState.toString() === '3';
  if (!ok) {
    throw new Error(
      `settle did not credit the expected amounts / state ` +
        `(B delta=${bAfter - bBefore} expected ${CLAIM_NANO}; ` +
        `A delta=${aAfter - aBefore} expected ${REFUND_NANO}; ` +
        `channelState=${channelState.toString()})`
    );
  }
  log(
    'PASS — apex (B) recipient credited the claimed delta via zkApp settle().'
  );
  console.log(settleHash); // stdout: the settle tx hash for capture
}

main().catch((err) => {
  console.error('[mina-close-settle] FAILED:', err);
  process.exit(1);
});
