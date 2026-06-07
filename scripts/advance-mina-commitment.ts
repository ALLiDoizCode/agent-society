#!/usr/bin/env tsx
/**
 * PART B — Advance an on-chain Mina payment-channel `balanceCommitment` to the
 * epoch a client claim commits to, so the connector's #98 commitment check
 * (`verifyBalanceProof`: `proofData.commitment === onChainState.balanceCommitment`)
 * PASSES and the Mina claim is accepted → stored → threshold → on-chain
 * CLAIM_FROM_CHANNEL.
 *
 * ## Why this is needed (the #98 alignment, Option 1)
 *
 * The connector's `MinaPaymentChannelSDK.verifyBalanceProof` (v3.9.6 dist)
 * compares the inbound claim's `commitment` against the CURRENT on-chain
 * `balanceCommitment`. A freshly `initializeChannel`-d zkApp pins
 * `balanceCommitment = Poseidon(0,0,0)` (PaymentChannel.ts L85), while a client
 * (and the connector's OWN per-packet-claim-service producer, dist
 * `per-packet-claim-service.js` L59-62/129) signs
 * `commitment = Poseidon(transferredAmount, 0, salt)`. So the FIRST non-zero
 * claim never matches the un-advanced on-chain init state.
 *
 * The connector's own producer + verifier are mutually inconsistent for the
 * first claim: the verifier requires the channel to ALREADY be at the claimed
 * epoch, but nothing advances it there. This script closes that gap on OUR side
 * by advancing the on-chain commitment to the target epoch via the zkApp's
 * `claimFromChannel` method (which itself writes `balanceCommitment =
 * Poseidon(balanceA, balanceB, salt)`), mirroring what the connector's own
 * settlement-executor would do once a channel is bootstrapped.
 *
 * ## What it does
 *
 * Deploys a payment-channel zkApp whose participant is a CONTROLLED key (so we
 * can sign the on-chain `claimFromChannel`, which binds sigs to
 * `channelHash = Poseidon(pA.x, pB.x, channelNonce)`), deposits `AMOUNT`, then
 * advances the on-chain `balanceCommitment` to `Poseidon(AMOUNT, 0, SALT)` with
 * nonce 1 — the exact value a client's first claim for `AMOUNT` commits to. It
 * prints the deployed zkApp address (stdout) and the resulting on-chain
 * commitment (stderr) so the value can be compared against a client claim.
 *
 * o1js DISCIPLINE: proof-generating (compile ~30-120s, ~2GB; deploy+init+deposit
 * +claim are 4 proofs). Run ONE at a time. 300s budget per the harness.
 *
 * Usage:
 *   tsx scripts/advance-mina-commitment.ts
 * Env:
 *   MINA_GRAPHQL_URL    lightnet GraphQL (default http://localhost:28085/graphql)
 *   MINA_ACCOUNTS_URL   accounts-manager (default http://localhost:28181)
 *   ADVANCE_AMOUNT      transferred amount (base units, default 1000000)
 *   ADVANCE_SALT        decimal salt; default deriveMinaSalt(zkApp, 1) is used if
 *                       MINA_ZKAPP_PRIVATE_KEY is set (deterministic address).
 *   MINA_ZKAPP_PRIVATE_KEY  optional EK… key for a deterministic zkApp address.
 */

import type * as O1js from 'o1js';
import type * as MinaZkApp from '@toon-protocol/mina-zkapp';
import { createHash } from 'node:crypto';

const GRAPHQL_URL =
  process.env.MINA_GRAPHQL_URL || 'http://localhost:28085/graphql';
const ACCOUNTS_URL = process.env.MINA_ACCOUNTS_URL || 'http://localhost:28181';
const ZKAPP_PRIVATE_KEY = process.env.MINA_ZKAPP_PRIVATE_KEY?.trim() || '';
const AMOUNT = BigInt(process.env.ADVANCE_AMOUNT || '1000000');
const NONCE = BigInt(process.env.ADVANCE_NONCE || '1');

/**
 * Client salt derivation — MUST match `MinaSigner.deriveMinaSalt`
 * (packages/client/src/signing/mina-signer.ts): first 240 bits of
 * sha256(`mina-pc-salt:${zkAppAddress}:${nonce}`), non-zero.
 */
function deriveMinaSalt(zkAppAddress: string, nonce: number): bigint {
  const digestHex = createHash('sha256')
    .update(`mina-pc-salt:${zkAppAddress}:${nonce}`)
    .digest('hex');
  const salt = BigInt('0x' + digestHex.slice(0, 60));
  return salt === 0n ? 1n : salt;
}

async function main() {
  const { createRequire } = await import('node:module');
  const { fileURLToPath } = await import('node:url');
  const path = await import('node:path');
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const zkAppDir = path.resolve(scriptDir, '..', 'packages', 'mina-zkapp');
  const require = createRequire(path.join(zkAppDir, 'package.json'));
  const o1js = require('o1js') as typeof O1js;
  const {
    Mina,
    PrivateKey,
    AccountUpdate,
    fetchAccount,
    Field,
    Poseidon,
    Signature,
  } = o1js;
  const { PaymentChannel } = require(
    path.join(zkAppDir, 'dist', 'index.js')
  ) as typeof MinaZkApp;

  const network = Mina.Network(GRAPHQL_URL);
  Mina.setActiveInstance(network);

  // zkApp key (deterministic if provided, else random).
  const zkAppKey = ZKAPP_PRIVATE_KEY
    ? PrivateKey.fromBase58(ZKAPP_PRIVATE_KEY)
    : PrivateKey.random();
  const zkAppPub = zkAppKey.toPublicKey();
  const zkAppAddress = zkAppPub.toBase58();
  console.error(`zkApp address: ${zkAppAddress}`);

  // Target salt: match the client's deterministic salt for this zkApp + nonce.
  const SALT = process.env.ADVANCE_SALT
    ? BigInt(process.env.ADVANCE_SALT)
    : deriveMinaSalt(zkAppAddress, Number(NONCE));
  const targetCommitment = Poseidon.hash([
    Field(AMOUNT),
    Field(0),
    Field(SALT),
  ]);
  console.error(
    `target: amount=${AMOUNT} salt=${SALT} nonce=${NONCE} commitment=${targetCommitment.toString()}`
  );

  // Acquire a funded deployer/participant account we CONTROL (so we can sign the
  // on-chain claimFromChannel, which binds sigs to channelHash = Poseidon(pA.x,
  // pB.x, channelNonce)). This account is participant A (and B — single-party
  // dev channel) so the harness holds the keys the on-chain method requires.
  const acquireRes = await fetch(
    `${ACCOUNTS_URL}/acquire-account?unlockAccount=true`,
    { method: 'GET' }
  );
  if (!acquireRes.ok) {
    throw new Error(
      `Failed to acquire Mina account: ${acquireRes.status} ${acquireRes.statusText}`
    );
  }
  const acct = (await acquireRes.json()) as { pk: string; sk: string };
  const partyKey = PrivateKey.fromBase58(acct.sk);
  const partyPub = partyKey.toPublicKey();
  console.error(`participant/deployer: ${partyPub.toBase58()}`);

  console.error('Compiling PaymentChannel (o1js — slow, ~30-120s)…');
  await PaymentChannel.compile();

  const FEE = 100_000_000; // 0.1 MINA
  const zkApp = new PaymentChannel(zkAppPub);
  const CHANNEL_NONCE = Field(0); // initializeChannel uses nonce Field(0)

  // Determine current on-chain state (idempotent across reruns).
  interface ChannelState {
    channelHash: string;
    balanceCommitment: string;
    nonce: bigint;
    state: bigint;
    depositTotal: bigint;
  }
  const readState = async (): Promise<ChannelState | null> => {
    const res = await fetchAccount({ publicKey: zkAppPub }).catch(() => ({
      account: undefined as unknown,
    }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const app = (res as any).account?.zkapp?.appState as
      | { toString(): string }[]
      | undefined;
    if (!app) return null;
    const at = (i: number): string => String(app[i] ?? '0');
    return {
      channelHash: at(0),
      balanceCommitment: at(1),
      nonce: BigInt(at(2)),
      state: BigInt(at(3)),
      depositTotal: BigInt(at(4)),
    };
  };
  const requireState = async (): Promise<ChannelState> => {
    const s = await readState();
    if (!s) throw new Error(`zkApp ${zkAppAddress} state unreadable on-chain`);
    return s;
  };

  const initialState = await readState();

  // 1) Deploy + initialize if the account does not exist yet.
  if (!initialState) {
    await fetchAccount({ publicKey: partyPub });
    console.error('Deploying zkApp…');
    const deployTx = await Mina.transaction(
      { sender: partyPub, fee: FEE },
      async () => {
        AccountUpdate.fundNewAccount(partyPub);
        await zkApp.deploy();
      }
    );
    await deployTx.prove();
    await deployTx
      .sign([partyKey, zkAppKey])
      .send()
      .then((t) => t.wait());

    console.error('initializeChannel (participant = controlled deployer)…');
    await fetchAccount({ publicKey: zkAppPub });
    await fetchAccount({ publicKey: partyPub });
    const initTx = await Mina.transaction(
      { sender: partyPub, fee: FEE },
      async () => {
        await zkApp.initializeChannel(
          partyPub,
          partyPub,
          CHANNEL_NONCE,
          Field(86400),
          Field(1)
        );
      }
    );
    await initTx.prove();
    await initTx
      .sign([partyKey])
      .send()
      .then((t) => t.wait());
  }
  let cur = await requireState();
  console.error(
    `current on-chain: commitment=${cur.balanceCommitment} nonce=${cur.nonce} state=${cur.state} depositTotal=${cur.depositTotal}`
  );

  if (cur.balanceCommitment === targetCommitment.toString()) {
    console.error('on-chain commitment ALREADY at target — no advance needed.');
    console.log(zkAppAddress);
    return;
  }

  // 2) Deposit so depositTotal == AMOUNT (conservation: balanceA+balanceB==deposit).
  if (cur.depositTotal !== AMOUNT) {
    const delta = AMOUNT - cur.depositTotal;
    if (delta <= 0n) {
      throw new Error(
        `depositTotal ${cur.depositTotal} already exceeds target AMOUNT ${AMOUNT}; cannot reduce. Use a fresh zkApp key.`
      );
    }
    console.error(`deposit ${delta} (to reach depositTotal=${AMOUNT})…`);
    await fetchAccount({ publicKey: zkAppPub });
    await fetchAccount({ publicKey: partyPub });
    const depTx = await Mina.transaction(
      { sender: partyPub, fee: FEE },
      async () => {
        await zkApp.deposit(Field(delta), partyPub);
      }
    );
    await depTx.prove();
    await depTx
      .sign([partyKey])
      .send()
      .then((t) => t.wait());
    cur = await requireState();
    console.error(`after deposit: depositTotal=${cur.depositTotal}`);
  }

  // 3) claimFromChannel — advances on-chain balanceCommitment to the target.
  //    Sign over the ON-CHAIN message [newBalanceCommitment, newNonce,
  //    channelHash] where channelHash = Poseidon(pA.x, pB.x, channelNonce).
  const channelHash = Poseidon.hash([partyPub.x, partyPub.x, CHANNEL_NONCE]);
  const newNonce = cur.nonce + (NONCE > cur.nonce ? NONCE - cur.nonce : 1n);
  const message = [targetCommitment, Field(newNonce), channelHash];
  const sig = Signature.create(partyKey, message);

  console.error(
    `claimFromChannel: advancing commitment → ${targetCommitment.toString()} (newNonce=${newNonce})…`
  );
  await fetchAccount({ publicKey: zkAppPub });
  await fetchAccount({ publicKey: partyPub });
  const claimTx = await Mina.transaction(
    { sender: partyPub, fee: FEE },
    async () => {
      await zkApp.claimFromChannel(
        Field(AMOUNT), // newBalanceA
        Field(0), // newBalanceB
        Field(SALT), // newSalt
        sig, // signatureA
        sig, // signatureB (single-party dev channel: pA == pB)
        partyPub, // participantA
        partyPub, // participantB
        CHANNEL_NONCE, // channelNonce (binds channelHash)
        targetCommitment, // newBalanceCommitment
        Field(newNonce) // newNonce
      );
    }
  );
  await claimTx.prove();
  const sent = await claimTx.sign([partyKey]).send();
  console.error(`claimFromChannel tx: ${sent.hash}`);
  await sent.wait();

  cur = await requireState();
  console.error(
    `AFTER advance: on-chain commitment=${cur.balanceCommitment} nonce=${cur.nonce}`
  );
  if (cur.balanceCommitment !== targetCommitment.toString()) {
    throw new Error(
      `advance FAILED: on-chain commitment ${cur.balanceCommitment} != target ${targetCommitment.toString()}`
    );
  }
  console.error(
    'PASS — on-chain balanceCommitment now equals the client claim commitment.'
  );
  console.log(zkAppAddress);
}

main().catch((err) => {
  console.error('advance-mina-commitment failed:', err);
  process.exit(1);
});
