/**
 * SPL token primitives for Solana — pure ESM, no transpilation, minimal deps
 * (`@noble/curves` for ed25519, `node:crypto` for sha256).
 *
 * SOURCE: copied verbatim from `infra/solana/spl-primitives.mjs` so the faucet
 * container is self-contained (no cross-tree imports at build time). Keep the
 * two files in sync — the faucet route in
 * `packages/townhouse/src/api/routes/faucet.ts` imports the original via a
 * relative path; this copy serves the standalone faucet container only.
 *
 * Covers exactly what the dev faucet + Mock USDC bootstrap need:
 *   - base58 encode/decode
 *   - PDA derivation (off-curve check via Edwards-curve point math)
 *   - Associated Token Account (ATA) derivation
 *   - Legacy transaction builder (account ordering + sign + send + confirm)
 *   - SPL token instructions: createMint, createATA, mintTo, transferChecked
 *
 * The instruction layouts and account orders mirror
 * `packages/sdk/tests/e2e/docker-solana-settlement-e2e.test.ts`. Keep them in
 * sync if the test code drifts; both end up exercising the same on-chain
 * SPL Token Program.
 */

import * as crypto from 'node:crypto';
import { ed25519 } from '@noble/curves/ed25519.js';

export const SYSTEM_PROGRAM_ID = '11111111111111111111111111111111';
export const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const ASSOCIATED_TOKEN_PROGRAM_ID =
  'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
export const RENT_SYSVAR_ID = 'SysvarRent111111111111111111111111111111111';

// ---------------------------------------------------------------------------
// Base58
// ---------------------------------------------------------------------------

const BASE58_ALPHABET =
  '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export function base58Encode(bytes) {
  let zeros = 0;
  for (let i = 0; i < bytes.length && bytes[i] === 0; i++) zeros++;
  let value = 0n;
  for (const byte of bytes) value = value * 256n + BigInt(byte);
  let result = '';
  while (value > 0n) {
    result = BASE58_ALPHABET[Number(value % 58n)] + result;
    value = value / 58n;
  }
  for (let i = 0; i < zeros; i++) result = '1' + result;
  return result || '1';
}

export function base58Decode(str) {
  let zeros = 0;
  for (let i = 0; i < str.length && str[i] === '1'; i++) zeros++;
  let value = 0n;
  for (const ch of str) {
    const idx = BASE58_ALPHABET.indexOf(ch);
    if (idx === -1) throw new Error(`Invalid base58 character: ${ch}`);
    value = value * 58n + BigInt(idx);
  }
  const hex = value === 0n ? '' : value.toString(16);
  const hexPadded = hex.length % 2 ? '0' + hex : hex;
  const rawBytes = [];
  for (let i = 0; i < hexPadded.length; i += 2) {
    rawBytes.push(parseInt(hexPadded.slice(i, i + 2), 16));
  }
  const result = new Uint8Array(zeros + rawBytes.length);
  result.set(rawBytes, zeros);
  return result;
}

// ---------------------------------------------------------------------------
// LE writers / readers
// ---------------------------------------------------------------------------

export function writeU32LE(buf, offset, value) {
  buf[offset] = value & 0xff;
  buf[offset + 1] = (value >> 8) & 0xff;
  buf[offset + 2] = (value >> 16) & 0xff;
  buf[offset + 3] = (value >> 24) & 0xff;
}

export function writeU64LE(buf, offset, value) {
  for (let i = 0; i < 8; i++) {
    buf[offset + i] = Number((value >> BigInt(i * 8)) & 0xffn);
  }
}

export function readU64LE(buf, offset) {
  let result = 0n;
  for (let i = 0; i < 8; i++) {
    result |= BigInt(buf[offset + i] ?? 0) << BigInt(i * 8);
  }
  return result;
}

export function padTo32(bytes) {
  if (bytes.length === 32) return bytes;
  if (bytes.length > 32) return bytes.slice(bytes.length - 32);
  const padded = new Uint8Array(32);
  padded.set(bytes, 32 - bytes.length);
  return padded;
}

// ---------------------------------------------------------------------------
// Off-curve check (for PDA derivation) — ed25519 curve y → x² test
// ---------------------------------------------------------------------------

function modPow(base, exp, mod) {
  let result = 1n;
  base = ((base % mod) + mod) % mod;
  while (exp > 0n) {
    if (exp & 1n) result = (result * base) % mod;
    exp >>= 1n;
    base = (base * base) % mod;
  }
  return result;
}

function modInverse(a, m) {
  return modPow(((a % m) + m) % m, m - 2n, m);
}

function isOnCurve(bytes) {
  const P = (1n << 255n) - 19n;
  const yBytes = new Uint8Array(32);
  yBytes.set(bytes);
  yBytes[31] = (yBytes[31] ?? 0) & 0x7f;
  let y = 0n;
  for (let i = 0; i < 32; i++) y |= BigInt(yBytes[i] ?? 0) << BigInt(i * 8);
  if (y >= P) return true;
  const y2 = (y * y) % P;
  const D = (P - ((121665n * modInverse(121666n, P)) % P) + P) % P;
  const numerator = (y2 - 1n + P) % P;
  const denominator = (D * y2 + 1n) % P;
  const denominatorInv = modInverse(denominator, P);
  const x2 = (numerator * denominatorInv) % P;
  if (x2 === 0n) return true;
  return modPow(x2, (P - 1n) / 2n, P) === 1n;
}

// ---------------------------------------------------------------------------
// PDA + ATA
// ---------------------------------------------------------------------------

export function findPDA(seeds, programId) {
  const PDA_MARKER = new TextEncoder().encode('ProgramDerivedAddress');
  for (let bump = 255; bump >= 0; bump--) {
    const allSeeds = [...seeds, new Uint8Array([bump])];
    let totalLen = 0;
    for (const s of allSeeds) totalLen += s.length;
    totalLen += programId.length + PDA_MARKER.length;
    const hashInput = new Uint8Array(totalLen);
    let offset = 0;
    for (const s of allSeeds) {
      hashInput.set(s, offset);
      offset += s.length;
    }
    hashInput.set(programId, offset);
    offset += programId.length;
    hashInput.set(PDA_MARKER, offset);
    const hash = new Uint8Array(crypto.createHash('sha256').update(hashInput).digest());
    if (!isOnCurve(hash)) return { pda: hash, bump };
  }
  throw new Error('Could not find a viable PDA bump seed');
}

export function deriveATA(walletBase58, mintBase58) {
  const wallet = padTo32(base58Decode(walletBase58));
  const mint = padTo32(base58Decode(mintBase58));
  const tokenProgram = base58Decode(TOKEN_PROGRAM_ID);
  const atProgram = base58Decode(ASSOCIATED_TOKEN_PROGRAM_ID);
  const { pda } = findPDA([wallet, tokenProgram, mint], atProgram);
  return base58Encode(pda);
}

// ---------------------------------------------------------------------------
// JSON-RPC + transaction send
// ---------------------------------------------------------------------------

export function makeRpc(rpcUrl) {
  let id = 1;
  return async function rpc(method, params = []) {
    const res = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method, params, id: id++ }),
      signal: AbortSignal.timeout(30000),
    });
    const json = await res.json();
    if (json.error) {
      throw new Error(
        `Solana RPC ${method} failed: ${json.error.message} (code ${json.error.code})`
      );
    }
    return json.result;
  };
}

export async function getLatestBlockhash(rpc) {
  const r = await rpc('getLatestBlockhash', [{ commitment: 'confirmed' }]);
  return r.value.blockhash;
}

export async function getAccountInfo(rpc, pubkey) {
  const r = await rpc('getAccountInfo', [
    pubkey,
    { encoding: 'base64', commitment: 'confirmed' },
  ]);
  return r.value;
}

export async function getMinimumBalanceForRentExemption(rpc, dataLen) {
  return await rpc('getMinimumBalanceForRentExemption', [dataLen]);
}

export async function requestAirdrop(rpc, pubkey, lamports) {
  return await rpc('requestAirdrop', [pubkey, lamports]);
}

export async function waitForConfirmation(rpc, signature, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const r = await rpc('getSignatureStatuses', [[signature]]);
    const status = r.value[0];
    if (
      status?.confirmationStatus === 'confirmed' ||
      status?.confirmationStatus === 'finalized'
    ) {
      if (status.err) {
        throw new Error(
          `Tx ${signature} failed: ${JSON.stringify(status.err)}`
        );
      }
      return;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Tx ${signature} not confirmed within ${timeoutMs}ms`);
}

// ---------------------------------------------------------------------------
// Transaction builder (legacy message format)
// ---------------------------------------------------------------------------

function compactU16Size(value) {
  if (value > 0xffff) {
    throw new RangeError(`compact-u16 value ${value} exceeds u16 max`);
  }
  return value < 0x80 ? 1 : value < 0x4000 ? 2 : 3;
}

function writeCompactU16(buf, offset, value) {
  if (value < 0x80) {
    buf[offset++] = value;
  } else if (value < 0x4000) {
    buf[offset++] = (value & 0x7f) | 0x80;
    buf[offset++] = value >> 7;
  } else {
    buf[offset++] = (value & 0x7f) | 0x80;
    buf[offset++] = ((value >> 7) & 0x7f) | 0x80;
    buf[offset++] = value >> 14;
  }
  return offset;
}

/**
 * Build, sign, send, and confirm a legacy Solana transaction.
 *
 * @param {ReturnType<typeof makeRpc>} rpc
 * @param {{publicKey: Uint8Array, privateKey: Uint8Array}} feePayer
 * @param {Array<{programId: string, keys: Array<{pubkey: string, isSigner: boolean, isWritable: boolean}>, data: Uint8Array}>} instructions
 * @param {Array<{publicKey: Uint8Array, privateKey: Uint8Array}>} additionalSigners
 * @returns {Promise<string>} tx signature (base58)
 */
export async function buildAndSendTransaction(
  rpc,
  feePayer,
  instructions,
  additionalSigners = []
) {
  const blockhash = await getLatestBlockhash(rpc);
  const feePayerPubkey = base58Encode(feePayer.publicKey);

  // Collect unique accounts; fee payer is always first.
  const accountMap = new Map();
  accountMap.set(feePayerPubkey, {
    pubkey: feePayerPubkey,
    isSigner: true,
    isWritable: true,
  });
  for (const ix of instructions) {
    for (const key of ix.keys) {
      const existing = accountMap.get(key.pubkey);
      if (existing) {
        existing.isSigner = existing.isSigner || key.isSigner;
        existing.isWritable = existing.isWritable || key.isWritable;
      } else {
        accountMap.set(key.pubkey, { ...key });
      }
    }
    if (!accountMap.has(ix.programId)) {
      accountMap.set(ix.programId, {
        pubkey: ix.programId,
        isSigner: false,
        isWritable: false,
      });
    }
  }

  const accounts = [...accountMap.values()].sort((a, b) => {
    if (a.pubkey === feePayerPubkey) return -1;
    if (b.pubkey === feePayerPubkey) return 1;
    const aScore = (a.isSigner ? 2 : 0) + (a.isWritable ? 1 : 0);
    const bScore = (b.isSigner ? 2 : 0) + (b.isWritable ? 1 : 0);
    return bScore - aScore;
  });

  const numSigners = accounts.filter((a) => a.isSigner).length;
  const numReadonlySigners = accounts.filter(
    (a) => a.isSigner && !a.isWritable
  ).length;
  const numReadonlyNonSigners = accounts.filter(
    (a) => !a.isSigner && !a.isWritable
  ).length;

  const accountIndexMap = new Map();
  accounts.forEach((a, i) => accountIndexMap.set(a.pubkey, i));

  const compiled = instructions.map((ix) => ({
    programIdIndex: accountIndexMap.get(ix.programId),
    accountIndices: ix.keys.map((k) => accountIndexMap.get(k.pubkey)),
    data: ix.data,
  }));

  let instructionSize = compactU16Size(compiled.length);
  for (const ix of compiled) {
    instructionSize += 1;
    instructionSize +=
      compactU16Size(ix.accountIndices.length) + ix.accountIndices.length;
    instructionSize += compactU16Size(ix.data.length) + ix.data.length;
  }

  const messageSize =
    3 +
    compactU16Size(accounts.length) +
    32 * accounts.length +
    32 +
    instructionSize;
  const message = new Uint8Array(messageSize);
  let offset = 0;

  message[offset++] = numSigners;
  message[offset++] = numReadonlySigners;
  message[offset++] = numReadonlyNonSigners;

  offset = writeCompactU16(message, offset, accounts.length);
  for (const acct of accounts) {
    message.set(padTo32(base58Decode(acct.pubkey)), offset);
    offset += 32;
  }

  message.set(padTo32(base58Decode(blockhash)), offset);
  offset += 32;

  offset = writeCompactU16(message, offset, compiled.length);
  for (const ix of compiled) {
    message[offset++] = ix.programIdIndex;
    offset = writeCompactU16(message, offset, ix.accountIndices.length);
    for (const idx of ix.accountIndices) message[offset++] = idx;
    offset = writeCompactU16(message, offset, ix.data.length);
    message.set(ix.data, offset);
    offset += ix.data.length;
  }

  const finalMessage = message.slice(0, offset);

  const allSigners = [feePayer, ...additionalSigners];
  const signerPubkeys = accounts.filter((a) => a.isSigner).map((a) => a.pubkey);

  const signatures = [];
  for (const signerPubkey of signerPubkeys) {
    const signer = allSigners.find(
      (s) => base58Encode(s.publicKey) === signerPubkey
    );
    if (!signer) throw new Error(`Missing signer for ${signerPubkey}`);
    signatures.push(ed25519.sign(finalMessage, signer.privateKey));
  }

  const txSize =
    compactU16Size(signatures.length) +
    signatures.length * 64 +
    finalMessage.length;
  const tx = new Uint8Array(txSize);
  let txOffset = 0;
  txOffset = writeCompactU16(tx, txOffset, signatures.length);
  for (const sig of signatures) {
    tx.set(sig, txOffset);
    txOffset += 64;
  }
  tx.set(finalMessage, txOffset);

  const txBase64 = Buffer.from(tx).toString('base64');
  const txSig = await rpc('sendTransaction', [
    txBase64,
    {
      encoding: 'base64',
      skipPreflight: false,
      preflightCommitment: 'confirmed',
    },
  ]);
  await waitForConfirmation(rpc, txSig);
  return txSig;
}

// ---------------------------------------------------------------------------
// SPL instructions
// ---------------------------------------------------------------------------

/**
 * Load a Solana keypair from a 64-byte JSON array file
 * (format: `[u8; 64]`, private || public — same as solana-keygen).
 */
export function keypairFromJsonArray(arr) {
  const bytes = new Uint8Array(arr);
  if (bytes.length !== 64) {
    throw new Error(`Expected 64-byte keypair, got ${bytes.length}`);
  }
  return {
    privateKey: bytes.slice(0, 32),
    publicKey: bytes.slice(32),
    pubkeyBase58: base58Encode(bytes.slice(32)),
  };
}

/** Create a fresh SPL mint owned by `mintAuthority`. */
export async function createMint(rpc, payer, mintKeypair, mintAuthority, decimals) {
  const rentExempt = await getMinimumBalanceForRentExemption(rpc, 82);

  const createIxData = new Uint8Array(4 + 8 + 8 + 32);
  writeU32LE(createIxData, 0, 0); // SystemProgram::CreateAccount
  writeU64LE(createIxData, 4, BigInt(rentExempt));
  writeU64LE(createIxData, 12, 82n);
  createIxData.set(base58Decode(TOKEN_PROGRAM_ID), 20);

  const initMintData = new Uint8Array(67);
  initMintData[0] = 0; // InitializeMint
  initMintData[1] = decimals;
  initMintData.set(padTo32(base58Decode(mintAuthority)), 2);
  initMintData[34] = 0; // No freeze authority

  return await buildAndSendTransaction(
    rpc,
    payer,
    [
      {
        programId: SYSTEM_PROGRAM_ID,
        keys: [
          { pubkey: payer.pubkeyBase58, isSigner: true, isWritable: true },
          { pubkey: mintKeypair.pubkeyBase58, isSigner: true, isWritable: true },
        ],
        data: createIxData,
      },
      {
        programId: TOKEN_PROGRAM_ID,
        keys: [
          { pubkey: mintKeypair.pubkeyBase58, isSigner: false, isWritable: true },
          { pubkey: RENT_SYSVAR_ID, isSigner: false, isWritable: false },
        ],
        data: initMintData,
      },
    ],
    [mintKeypair]
  );
}

/** Create the Associated Token Account (ATA) for `wallet` + `mint`. Idempotent. */
export async function createAssociatedTokenAccount(rpc, payer, wallet, mint) {
  const ata = deriveATA(wallet, mint);
  const info = await getAccountInfo(rpc, ata);
  if (info) return ata;

  await buildAndSendTransaction(rpc, payer, [
    {
      programId: ASSOCIATED_TOKEN_PROGRAM_ID,
      keys: [
        { pubkey: payer.pubkeyBase58, isSigner: true, isWritable: true },
        { pubkey: ata, isSigner: false, isWritable: true },
        { pubkey: wallet, isSigner: false, isWritable: false },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      ],
      data: new Uint8Array(0),
    },
  ]);

  return ata;
}

/** SPL Token MintTo (instruction 7). */
export async function mintTo(rpc, payer, mint, destination, mintAuthority, amount) {
  const data = new Uint8Array(9);
  data[0] = 7;
  writeU64LE(data, 1, amount);

  const signers =
    mintAuthority.pubkeyBase58 === payer.pubkeyBase58 ? [] : [mintAuthority];

  return await buildAndSendTransaction(
    rpc,
    payer,
    [
      {
        programId: TOKEN_PROGRAM_ID,
        keys: [
          { pubkey: mint, isSigner: false, isWritable: true },
          { pubkey: destination, isSigner: false, isWritable: true },
          {
            pubkey: mintAuthority.pubkeyBase58,
            isSigner: true,
            isWritable: false,
          },
        ],
        data,
      },
    ],
    signers
  );
}

/**
 * SPL Token TransferChecked (instruction 12) — safer than legacy Transfer
 * because it validates the mint+decimals on-chain.
 */
export async function transferChecked(
  rpc,
  payer,
  source,
  mint,
  destination,
  authority,
  amount,
  decimals
) {
  const data = new Uint8Array(10);
  data[0] = 12;
  writeU64LE(data, 1, amount);
  data[9] = decimals;

  const signers =
    authority.pubkeyBase58 === payer.pubkeyBase58 ? [] : [authority];

  return await buildAndSendTransaction(
    rpc,
    payer,
    [
      {
        programId: TOKEN_PROGRAM_ID,
        keys: [
          { pubkey: source, isSigner: false, isWritable: true },
          { pubkey: mint, isSigner: false, isWritable: false },
          { pubkey: destination, isSigner: false, isWritable: true },
          { pubkey: authority.pubkeyBase58, isSigner: true, isWritable: false },
        ],
        data,
      },
    ],
    signers
  );
}

/** SPL token account balance (raw u64). Returns 0n if account is missing. */
export async function getSplTokenBalance(rpc, tokenAccount) {
  const info = await getAccountInfo(rpc, tokenAccount);
  if (!info) return 0n;
  const raw = Buffer.from(info.data[0], 'base64');
  if (raw.length < 72) return 0n;
  return readU64LE(new Uint8Array(raw), 64);
}
