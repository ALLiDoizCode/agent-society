/**
 * Solana drip helper — ports the Solana branch of
 * `packages/townhouse/src/api/routes/faucet.ts` into a single function the
 * standalone faucet server can call.
 *
 * Behaviour mirrors the route:
 *   1. requestAirdrop — top up native SOL (test-validator dev RPC, no key
 *      required). On a real testnet/mainnet RPC the airdrop call still works
 *      (rate-limited) — there's no auth involved.
 *   2. SPL TransferChecked — Mock USDC drip from the faucet treasury, signed
 *      by the bootstrap-baked authority keypair. Recipient ATA is created
 *      on-the-fly if missing.
 *   3. If the mint doesn't exist on the target RPC, the SOL drip still
 *      succeeds and we return without a `usdcSig` (so a real-RPC misconfig
 *      doesn't crash — the operator just gets SOL).
 *
 * Amounts: `amount` is interpreted as whole USDC (decimals=6). The native
 * SOL top-up is fixed at 1 SOL — the dashboard's "amount" input always means
 * USDC, same as the route.
 */

import {
  createAssociatedTokenAccount,
  deriveATA,
  getAccountInfo,
  makeRpc,
  requestAirdrop as splRequestAirdrop,
  transferChecked,
  waitForConfirmation,
} from './spl-primitives.mjs';

const SOLANA_USDC_DECIMALS = 6;
const NATIVE_SOL_LAMPORTS = 1_000_000_000; // 1 SOL

/**
 * Drip SOL + (optionally) Mock USDC to a recipient.
 *
 * @param {object} args
 * @param {string} args.rpc — Solana JSON-RPC URL
 * @param {string} args.recipient — base58 pubkey
 * @param {string} args.usdcMint — Mock USDC mint pubkey (base58)
 * @param {{publicKey: Uint8Array, privateKey: Uint8Array, pubkeyBase58: string} | null} args.faucetAuthorityKeypair
 *   Loaded faucet authority keypair (signs the SPL transfer + pays the ATA
 *   creation rent). If `null`, the USDC drip is skipped — SOL still goes out.
 * @param {number} args.amount — whole USDC to send (>= 0; floored)
 * @returns {Promise<{ airdropSig: string, usdcSig?: string, recipient: string }>}
 */
export async function solDrip({
  rpc,
  recipient,
  usdcMint,
  faucetAuthorityKeypair,
  amount,
}) {
  const splRpc = makeRpc(rpc);

  // 1. Native SOL airdrop (no key needed).
  const airdropSig = await splRequestAirdrop(
    splRpc,
    recipient,
    NATIVE_SOL_LAMPORTS
  );

  // Best-effort wait — a slow validator shouldn't block the SPL transfer
  // outright if the airdrop has already been seen. The transfer below will
  // fail loudly if the recipient still has 0 SOL when its ATA is created.
  await waitForConfirmation(splRpc, airdropSig).catch(() => {});

  // 2. USDC drip (skipped if no authority keypair available).
  if (!faucetAuthorityKeypair) {
    return { airdropSig, recipient };
  }

  // If the mint doesn't exist on this RPC (e.g., real testnet/mainnet, or a
  // pre-bootstrap lease), surface a clear error instead of crashing in the
  // ATA creation path. SOL drip still succeeded.
  const mintInfo = await getAccountInfo(splRpc, usdcMint);
  if (!mintInfo) {
    const err = new Error(
      `mint not found on RPC: ${usdcMint} (SOL airdrop succeeded: ${airdropSig})`
    );
    err.code = 'MINT_NOT_FOUND';
    err.airdropSig = airdropSig;
    throw err;
  }

  // Ensure recipient has an ATA (idempotent).
  const recipientAta = await createAssociatedTokenAccount(
    splRpc,
    faucetAuthorityKeypair,
    recipient,
    usdcMint
  );

  // Treasury ATA is owned by the faucet authority (created at bootstrap).
  const treasuryAta = deriveATA(
    faucetAuthorityKeypair.pubkeyBase58,
    usdcMint
  );

  // Whole USDC → base units (decimals=6).
  const baseUnits =
    BigInt(Math.floor(Math.max(amount, 0))) * 1_000_000n;

  const usdcSig = await transferChecked(
    splRpc,
    faucetAuthorityKeypair,
    treasuryAta,
    usdcMint,
    recipientAta,
    faucetAuthorityKeypair,
    baseUnits,
    SOLANA_USDC_DECIMALS
  );

  return { airdropSig, usdcSig, recipient };
}
