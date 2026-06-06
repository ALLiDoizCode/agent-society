#!/usr/bin/env node
/**
 * PART A — Solana payment-channel CLOSE + SETTLE demonstration.
 *
 * Proves the apex (participant B / recipient) ATA is ACTUALLY CREDITED when a
 * channel that accumulated an on-chain `CLAIM_FROM_CHANNEL` is closed and
 * settled. The vault→recipient transfer happens at SETTLE_CHANNEL (0x04), which
 * is NOT in the per-publish path or the connector admin API — it is the channel-
 * close lifecycle of the on-chain Solana payment-channel program.
 *
 * Lifecycle (mirrors the connector's `SolanaPaymentChannelSDK`, extracted from
 * the v3.9.6 dist — `solana-payment-channel-sdk.js`):
 *
 *   1. INITIALIZE_CHANNEL (0x01)  — open channel (depositor=A, apex=B)
 *   2. DEPOSIT            (0x02)  — depositor funds the vault with USDC
 *   3. CLAIM_FROM_CHANNEL (0x06)  — apex redeems a depositor-signed balance
 *                                    proof; accumulates transferred_amount_A
 *                                    on-chain (vault unchanged)
 *   4. CLOSE_CHANNEL      (0x03)  — initiate close; records close_timestamp,
 *                                    starts the challenge window
 *   5. (wait the challenge window)
 *   6. SETTLE_CHANNEL     (0x04)  — vault → recipient (transferred_amount) +
 *                                    vault → depositor (remainder). THIS credits
 *                                    the apex recipient ATA.
 *
 * ── CHALLENGE WINDOW (honesty note) ──────────────────────────────────────────
 * Production channels open with challengeDuration=86400s (24h), so SETTLE on a
 * production channel cannot complete in-session, and `solana-test-validator` has
 * no clock-warp RPC (unlike Anvil). The SETTLE mechanics (vault→recipient
 * transfer) are byte-for-byte identical regardless of the challenge duration —
 * only the wait differs. So this demo opens a channel with a SHORT
 * challengeDuration (default 3s, override via CHALLENGE_SECS) and waits it out,
 * exercising the exact same SETTLE_CHANNEL instruction the connector's
 * `settleChannel` issues. Every tx signature + balance is real and on-chain.
 *
 * Keys are documented dev-only keys (faucet authority = the Mock USDC mint
 * authority; fresh random depositor/apex keypairs). NEVER use on real chains.
 *
 * Usage:
 *   node scripts/solana-close-settle-demo.mjs [--rpc URL] [--claim USDC] [--deposit USDC]
 *
 * Env:
 *   SOLANA_RPC_URL          default http://127.0.0.1:28899 (dev validator)
 *   SOLANA_PROGRAM_ID       default EdJxYPDxGvaJuu57DSUptf4soLv8enpdyQJJhHDLiydG
 *   SOLANA_USDC_MINT        default 6GbdrVghwNKTz9raga7y3Y4qqX5Zgg3AC4d48Kt7C59Q
 *   CHALLENGE_SECS          default 3
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

// `@noble/curves` is declared only in infra/solana/package.json (not hoisted to
// the workspace root under pnpm). Anchor module resolution there so this script
// — which lives in scripts/, not a package — resolves the same ed25519 build the
// spl-primitives module uses. Mirrors the createRequire anchor in
// scripts/deploy-mina-zkapp.ts.
const _solanaRequire = createRequire(
  join(
    dirname(fileURLToPath(import.meta.url)),
    '..',
    'infra',
    'solana',
    'package.json'
  )
);
const { ed25519 } = _solanaRequire('@noble/curves/ed25519.js');

import {
  makeRpc,
  getAccountInfo,
  requestAirdrop,
  waitForConfirmation,
  keypairFromJsonArray,
  deriveATA,
  findPDA,
  base58Decode,
  base58Encode,
  padTo32,
  writeU64LE,
  readU64LE,
  createAssociatedTokenAccount,
  mintTo,
  getSplTokenBalance,
  buildAndSendTransaction,
  SYSTEM_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  RENT_SYSVAR_ID,
} from '../infra/solana/spl-primitives.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Config ──────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
function argVal(flag, def) {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
}
const RPC_URL =
  argVal('--rpc', process.env.SOLANA_RPC_URL) || 'http://127.0.0.1:28899';
const PROGRAM_ID =
  process.env.SOLANA_PROGRAM_ID ||
  'EdJxYPDxGvaJuu57DSUptf4soLv8enpdyQJJhHDLiydG';
const USDC_MINT =
  process.env.SOLANA_USDC_MINT ||
  '6GbdrVghwNKTz9raga7y3Y4qqX5Zgg3AC4d48Kt7C59Q';
const CHALLENGE_SECS = Number(
  process.env.CHALLENGE_SECS || argVal('--challenge', '3')
);
const USDC_DECIMALS = 6;
const DEPOSIT_USDC = Number(argVal('--deposit', '2'));
const CLAIM_USDC = Number(argVal('--claim', '1'));
const DEPOSIT_BASE = BigInt(Math.round(DEPOSIT_USDC * 1e6));
const CLAIM_BASE = BigInt(Math.round(CLAIM_USDC * 1e6));

// Sysvars used by close/settle (match the connector SDK).
const CLOCK_SYSVAR = 'SysvarC1ock11111111111111111111111111111111';
const INSTRUCTIONS_SYSVAR = 'Sysvar1nstructions1111111111111111111111111';
const ED25519_PROGRAM = 'Ed25519SigVerify111111111111111111111111111';

const IX = {
  INITIALIZE_CHANNEL: new Uint8Array([0x01, 0, 0, 0, 0, 0, 0, 0]),
  DEPOSIT: new Uint8Array([0x02, 0, 0, 0, 0, 0, 0, 0]),
  CLOSE_CHANNEL: new Uint8Array([0x03, 0, 0, 0, 0, 0, 0, 0]),
  SETTLE_CHANNEL: new Uint8Array([0x04, 0, 0, 0, 0, 0, 0, 0]),
  CLAIM_FROM_CHANNEL: new Uint8Array([0x06, 0, 0, 0, 0, 0, 0, 0]),
};

function log(...a) {
  console.log('[sol-close-settle]', ...a);
}

function loadKeypair(filename) {
  const arr = JSON.parse(
    readFileSync(
      join(__dirname, '..', 'infra', 'solana', 'keys', filename),
      'utf8'
    )
  );
  return keypairFromJsonArray(arr);
}

/** Generate a fresh ed25519 keypair in the spl-primitives signer shape. */
function freshKeypair() {
  const privateKey = ed25519.utils.randomSecretKey();
  const publicKey = ed25519.getPublicKey(privateKey);
  return { privateKey, publicKey, pubkeyBase58: base58Encode(publicKey) };
}

// PDA derivation — sortParticipants matches the SDK byte-ordering.
function sortPubkeys(a, b) {
  const ab = padTo32(base58Decode(a));
  const bb = padTo32(base58Decode(b));
  for (let i = 0; i < 32; i++) {
    if (ab[i] < bb[i]) return [a, b];
    if (ab[i] > bb[i]) return [b, a];
  }
  return [a, b];
}

function deriveChannelPDA(participantA, participantB, mint) {
  const [min, max] = sortPubkeys(participantA, participantB);
  const seeds = [
    new TextEncoder().encode('channel'),
    padTo32(base58Decode(min)),
    padTo32(base58Decode(max)),
    padTo32(base58Decode(mint)),
  ];
  const { pda } = findPDA(seeds, base58Decode(PROGRAM_ID));
  return base58Encode(pda);
}

function deriveVaultPDA(channelPDA) {
  const seeds = [
    new TextEncoder().encode('vault'),
    padTo32(base58Decode(channelPDA)),
  ];
  const { pda } = findPDA(seeds, base58Decode(PROGRAM_ID));
  return base58Encode(pda);
}

function buildBalanceProofMessage(channelPDA, nonce, transferredAmount) {
  const m = new Uint8Array(48);
  m.set(padTo32(base58Decode(channelPDA)), 0);
  writeU64LE(m, 32, nonce);
  writeU64LE(m, 40, transferredAmount);
  return m;
}

// Ed25519 precompile instruction (verbatim from the connector SDK).
function buildEd25519PrecompileInstruction(signature, pubkey, message) {
  const HEADER_SIZE = 16;
  const total = HEADER_SIZE + 64 + 32 + message.length;
  const d = new Uint8Array(total);
  d[0] = 1;
  d[1] = 0;
  const sigOff = HEADER_SIZE;
  const pkOff = sigOff + 64;
  const msgOff = pkOff + 32;
  d[2] = sigOff & 0xff;
  d[3] = (sigOff >> 8) & 0xff;
  d[4] = 0xff;
  d[5] = 0xff;
  d[6] = pkOff & 0xff;
  d[7] = (pkOff >> 8) & 0xff;
  d[8] = 0xff;
  d[9] = 0xff;
  d[10] = msgOff & 0xff;
  d[11] = (msgOff >> 8) & 0xff;
  d[12] = message.length & 0xff;
  d[13] = (message.length >> 8) & 0xff;
  d[14] = 0xff;
  d[15] = 0xff;
  d.set(signature, sigOff);
  d.set(pubkey, pkOff);
  d.set(message, msgOff);
  return { programId: ED25519_PROGRAM, keys: [], data: d };
}

// Channel state field offsets (from the SDK's deserializeChannelState).
function parseChannelState(raw) {
  return {
    participantA: base58Encode(raw.slice(8, 40)),
    participantB: base58Encode(raw.slice(40, 72)),
    tokenMint: base58Encode(raw.slice(72, 104)),
    depositA: readU64LE(raw, 104),
    depositB: readU64LE(raw, 112),
    transferredAmountA: readU64LE(raw, 120),
    transferredAmountB: readU64LE(raw, 128),
    nonceA: readU64LE(raw, 136),
    nonceB: readU64LE(raw, 144),
    challengeDuration: readU64LE(raw, 152),
    state:
      ['opened', 'closed', 'settled'][raw[160] ?? 0] ?? `unknown(${raw[160]})`,
    closeTimestamp: readU64LE(raw, 161),
  };
}

async function getChannelState(rpc, channelPDA) {
  const info = await getAccountInfo(rpc, channelPDA);
  if (!info) return null;
  return parseChannelState(new Uint8Array(Buffer.from(info.data[0], 'base64')));
}

async function airdropAndConfirm(rpc, pubkey, lamports) {
  const sig = await requestAirdrop(rpc, pubkey, lamports);
  await waitForConfirmation(rpc, sig);
}

async function main() {
  const rpc = makeRpc(RPC_URL);
  log(`RPC=${RPC_URL} program=${PROGRAM_ID} mint=${USDC_MINT}`);
  log(
    `challengeDuration=${CHALLENGE_SECS}s deposit=${DEPOSIT_USDC} USDC claim=${CLAIM_USDC} USDC`
  );

  const mintAuthority = loadKeypair('faucet-authority.json'); // == USDC mint authority
  const depositor = freshKeypair(); // participant A
  const apex = freshKeypair(); // participant B (recipient — stands in for the apex Solana settlement signer)
  log(`depositor (A) = ${depositor.pubkeyBase58}`);
  log(`apex     (B) = ${apex.pubkeyBase58}  <-- recipient credited at settle`);

  // 0) Fund both with SOL for fees/rent.
  log('Airdropping SOL to depositor + apex…');
  await airdropAndConfirm(rpc, depositor.pubkeyBase58, 2_000_000_000);
  await airdropAndConfirm(rpc, apex.pubkeyBase58, 2_000_000_000);

  // 0b) Create USDC ATAs and fund depositor with USDC.
  const depositorAta = await createAssociatedTokenAccount(
    rpc,
    depositor,
    depositor.pubkeyBase58,
    USDC_MINT
  );
  const apexAta = await createAssociatedTokenAccount(
    rpc,
    apex,
    apex.pubkeyBase58,
    USDC_MINT
  );
  log(`depositor ATA = ${depositorAta}`);
  log(`apex      ATA = ${apexAta}`);
  // Mint 100 USDC to the depositor and 100 USDC to the apex (so the apex ATA
  // starts at a known non-zero balance, mirroring the PROVEN-already 100 USDC
  // starting balance of the real apex recipient ATA).
  await mintTo(
    rpc,
    mintAuthority,
    USDC_MINT,
    depositorAta,
    mintAuthority,
    100_000_000n
  );
  await mintTo(
    rpc,
    mintAuthority,
    USDC_MINT,
    apexAta,
    mintAuthority,
    100_000_000n
  );

  const apexBefore = await getSplTokenBalance(rpc, apexAta);
  const depositorBeforeAll = await getSplTokenBalance(rpc, depositorAta);
  log(
    `apex ATA balance BEFORE channel lifecycle  = ${apexBefore} (${Number(apexBefore) / 1e6} USDC)`
  );
  log(
    `depositor ATA balance BEFORE                = ${depositorBeforeAll} (${Number(depositorBeforeAll) / 1e6} USDC)`
  );

  // 1) INITIALIZE_CHANNEL (short challenge window).
  const channelPDA = deriveChannelPDA(
    depositor.pubkeyBase58,
    apex.pubkeyBase58,
    USDC_MINT
  );
  const vaultPDA = deriveVaultPDA(channelPDA);
  log(`channelPDA = ${channelPDA}`);
  log(`vaultPDA   = ${vaultPDA}`);

  const initData = new Uint8Array(16);
  initData.set(IX.INITIALIZE_CHANNEL, 0);
  writeU64LE(initData, 8, BigInt(CHALLENGE_SECS));
  const initSig = await buildAndSendTransaction(rpc, depositor, [
    {
      programId: PROGRAM_ID,
      keys: [
        { pubkey: depositor.pubkeyBase58, isSigner: true, isWritable: true },
        { pubkey: depositor.pubkeyBase58, isSigner: false, isWritable: false }, // A
        { pubkey: apex.pubkeyBase58, isSigner: false, isWritable: false }, // B
        { pubkey: USDC_MINT, isSigner: false, isWritable: false },
        { pubkey: channelPDA, isSigner: false, isWritable: true },
        { pubkey: vaultPDA, isSigner: false, isWritable: true },
        { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: RENT_SYSVAR_ID, isSigner: false, isWritable: false },
      ],
      data: initData,
    },
  ]);
  log(`INITIALIZE_CHANNEL tx = ${initSig}`);

  // 2) DEPOSIT into the vault.
  const depData = new Uint8Array(16);
  depData.set(IX.DEPOSIT, 0);
  writeU64LE(depData, 8, DEPOSIT_BASE);
  const depSig = await buildAndSendTransaction(rpc, depositor, [
    {
      programId: PROGRAM_ID,
      keys: [
        { pubkey: depositor.pubkeyBase58, isSigner: true, isWritable: false },
        { pubkey: depositorAta, isSigner: false, isWritable: true },
        { pubkey: vaultPDA, isSigner: false, isWritable: true },
        { pubkey: channelPDA, isSigner: false, isWritable: true },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      ],
      data: depData,
    },
  ]);
  log(`DEPOSIT tx = ${depSig} (vault funded with ${DEPOSIT_USDC} USDC)`);
  const vaultAfterDeposit = await getSplTokenBalance(rpc, vaultPDA);
  log(`vault balance after deposit = ${vaultAfterDeposit}`);

  // 3) CLAIM_FROM_CHANNEL — apex redeems a depositor-signed balance proof for
  //    CLAIM_BASE. Depositor (A) signs; nonce must be > current nonceA (=0).
  const nonce = 1n;
  const msg = buildBalanceProofMessage(channelPDA, nonce, CLAIM_BASE);
  const sig = ed25519.sign(msg, depositor.privateKey);
  const ed25519Ix = buildEd25519PrecompileInstruction(
    sig,
    padTo32(base58Decode(depositor.pubkeyBase58)),
    msg
  );
  const claimData = new Uint8Array(24);
  claimData.set(IX.CLAIM_FROM_CHANNEL, 0);
  writeU64LE(claimData, 8, nonce);
  writeU64LE(claimData, 16, CLAIM_BASE);
  const claimSig = await buildAndSendTransaction(rpc, apex, [
    ed25519Ix,
    {
      programId: PROGRAM_ID,
      keys: [
        { pubkey: apex.pubkeyBase58, isSigner: true, isWritable: false }, // fee_payer/claimer
        { pubkey: depositor.pubkeyBase58, isSigner: false, isWritable: false }, // signer (A)
        { pubkey: channelPDA, isSigner: false, isWritable: true },
        { pubkey: INSTRUCTIONS_SYSVAR, isSigner: false, isWritable: false },
      ],
      data: claimData,
    },
  ]);
  log(`CLAIM_FROM_CHANNEL tx = ${claimSig}`);
  const afterClaim = await getChannelState(rpc, channelPDA);
  // Note: the program records the credited delta in the slot of the participant
  // being PAID (B, the apex/recipient — the claimer), not the proof signer (A).
  log(
    `channel after claim: state=${afterClaim.state} depositA=${afterClaim.depositA} depositB=${afterClaim.depositB} ` +
      `transferredAmountA=${afterClaim.transferredAmountA} transferredAmountB=${afterClaim.transferredAmountB} ` +
      `nonceA=${afterClaim.nonceA} nonceB=${afterClaim.nonceB} (vault still=${await getSplTokenBalance(rpc, vaultPDA)})`
  );
  const credited =
    afterClaim.transferredAmountA === CLAIM_BASE
      ? 'A'
      : afterClaim.transferredAmountB === CLAIM_BASE
        ? 'B'
        : null;
  if (!credited) {
    throw new Error(
      `claim did not record CLAIM_BASE in either transferred slot (A=${afterClaim.transferredAmountA} B=${afterClaim.transferredAmountB})`
    );
  }
  log(
    `claim accumulated transferred amount in slot ${credited} (=${CLAIM_BASE})`
  );

  // 4) CLOSE_CHANNEL — initiate close (records close_timestamp, starts window).
  const closeSig = await buildAndSendTransaction(rpc, depositor, [
    {
      programId: PROGRAM_ID,
      keys: [
        { pubkey: depositor.pubkeyBase58, isSigner: true, isWritable: false },
        { pubkey: channelPDA, isSigner: false, isWritable: true },
        { pubkey: CLOCK_SYSVAR, isSigner: false, isWritable: false },
      ],
      data: IX.CLOSE_CHANNEL,
    },
  ]);
  const afterClose = await getChannelState(rpc, channelPDA);
  log(
    `CLOSE_CHANNEL tx = ${closeSig} (state=${afterClose.state}, closeTimestamp=${afterClose.closeTimestamp})`
  );

  // 5) Wait the challenge window (+ margin) so SETTLE passes ChannelChallengeNotExpired.
  const waitMs = (CHALLENGE_SECS + 3) * 1000;
  log(`Waiting challenge window (${waitMs}ms)…`);
  await new Promise((r) => setTimeout(r, waitMs));

  // 6) SETTLE_CHANNEL — vault → recipient (transferred) + vault → depositor (remainder).
  const apexPreSettle = await getSplTokenBalance(rpc, apexAta);
  const depositorPreSettle = await getSplTokenBalance(rpc, depositorAta);
  const vaultPreSettle = await getSplTokenBalance(rpc, vaultPDA);
  log(
    `--- PRE-SETTLE: apex ATA=${apexPreSettle} depositor ATA=${depositorPreSettle} vault=${vaultPreSettle} ---`
  );

  // settleChannel accounts (from SDK): caller, channel, vault, participantAToken,
  // participantBToken, rentRecipient, TOKEN_PROGRAM, CLOCK_SYSVAR.
  const settleSig = await buildAndSendTransaction(rpc, depositor, [
    {
      programId: PROGRAM_ID,
      keys: [
        { pubkey: depositor.pubkeyBase58, isSigner: true, isWritable: false }, // caller
        { pubkey: channelPDA, isSigner: false, isWritable: true },
        { pubkey: vaultPDA, isSigner: false, isWritable: true },
        { pubkey: depositorAta, isSigner: false, isWritable: true }, // participantAToken
        { pubkey: apexAta, isSigner: false, isWritable: true }, // participantBToken
        { pubkey: depositor.pubkeyBase58, isSigner: false, isWritable: true }, // rentRecipient
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: CLOCK_SYSVAR, isSigner: false, isWritable: false },
      ],
      data: IX.SETTLE_CHANNEL,
    },
  ]);

  const apexAfter = await getSplTokenBalance(rpc, apexAta);
  const depositorAfter = await getSplTokenBalance(rpc, depositorAta);
  const vaultAfter = await getSplTokenBalance(rpc, vaultPDA);
  const channelAfter = await getChannelState(rpc, channelPDA);

  log('============================================================');
  log('  SETTLE_CHANNEL RESULT — recipient credited?');
  log('============================================================');
  log(`SETTLE_CHANNEL tx signature = ${settleSig}`);
  log(
    `channel state after settle  = ${channelAfter ? channelAfter.state : '(account closed)'}`
  );
  log('');
  log(`apex (B) recipient ATA: ${apexAta}`);
  log(
    `  BEFORE settle = ${apexPreSettle} (${Number(apexPreSettle) / 1e6} USDC)`
  );
  log(`  AFTER  settle = ${apexAfter} (${Number(apexAfter) / 1e6} USDC)`);
  log(
    `  DELTA         = +${apexAfter - apexPreSettle} (+${Number(apexAfter - apexPreSettle) / 1e6} USDC)  [expected +${CLAIM_BASE}]`
  );
  log('');
  log(`depositor (A) ATA refund: ${depositorAta}`);
  log(`  BEFORE settle = ${depositorPreSettle}`);
  log(
    `  AFTER  settle = ${depositorAfter}  (DELTA +${depositorAfter - depositorPreSettle})  [expected refund +${DEPOSIT_BASE - CLAIM_BASE}]`
  );
  log('');
  log(`vault: ${vaultPreSettle} -> ${vaultAfter}`);
  log('============================================================');

  const ok =
    apexAfter - apexPreSettle === CLAIM_BASE &&
    depositorAfter - depositorPreSettle === DEPOSIT_BASE - CLAIM_BASE;
  if (!ok) {
    throw new Error('Settle did not credit the expected amounts');
  }
  log(
    'PASS — apex recipient ATA credited the claimed delta via SETTLE_CHANNEL.'
  );
}

main().catch((err) => {
  console.error('[sol-close-settle] FAILED:', err);
  process.exit(1);
});
