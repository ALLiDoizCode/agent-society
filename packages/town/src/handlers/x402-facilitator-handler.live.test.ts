/**
 * Live integration test for x402 facilitator endpoints.
 *
 * Round-trips POST /verify → POST /settle through the real handler against
 * a running Anvil and a deployed mock USDC, using a real EIP-3009 signature.
 * This pins the spec envelope (base64 decode, sig split, field shapes) and
 * the on-chain settlement path against future drift — coverage that the
 * mock-based unit tests in `x402-facilitator-handler.test.ts` can't give.
 *
 * SKIPPED unless these env vars are all set:
 *   X402_ANVIL_RPC_URL    — e.g., http://localhost:8545
 *   X402_USDC_ADDRESS     — deployed mock USDC contract address
 *   X402_FACILITATOR_KEY  — facilitator private key (receives USDC, pays gas)
 *   X402_PAYER_KEY        — payer private key (must hold USDC + ETH)
 *
 * Run locally:
 *   anvil --host 0.0.0.0 --port 8545 &
 *   ./scripts/deploy-mock-usdc.sh    # prints USDC address
 *   export X402_ANVIL_RPC_URL=http://localhost:8545
 *   export X402_USDC_ADDRESS=<address from script>
 *   # Anvil default funded accounts:
 *   export X402_FACILITATOR_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
 *   export X402_PAYER_KEY=0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d
 *   pnpm --filter @toon-protocol/town vitest run src/handlers/x402-facilitator-handler.live.test.ts
 *
 * The mock USDC's EIP-712 domain is { name: "USD Coin", version: "2",
 * chainId: 31337, verifyingContract: <usdcAddress> } — see
 * scripts/deploy-mock-usdc.sh.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { Hono } from 'hono';
import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  type Hex,
  type WalletClient,
  type PublicClient,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { foundry } from 'viem/chains';
import type { ChainPreset } from '@toon-protocol/core';
import { createX402FacilitatorHandler } from './x402-facilitator-handler.js';
import type {
  X402SignedPaymentPayload,
  X402FacilitatorRequest,
} from './x402-types.js';

const RPC = process.env['X402_ANVIL_RPC_URL'];
const USDC = process.env['X402_USDC_ADDRESS'] as Hex | undefined;
const FAC_KEY = process.env['X402_FACILITATOR_KEY'] as Hex | undefined;
const PAY_KEY = process.env['X402_PAYER_KEY'] as Hex | undefined;
const SHOULD_RUN = Boolean(RPC && USDC && FAC_KEY && PAY_KEY);

describe.skipIf(!SHOULD_RUN)('x402 facilitator — live Anvil round-trip', () => {
  let publicClient: PublicClient;
  let walletClient: WalletClient;
  let payerAccount: ReturnType<typeof privateKeyToAccount>;
  let facilitatorAccount: ReturnType<typeof privateKeyToAccount>;
  let chainConfig: ChainPreset;

  beforeAll(async () => {
    payerAccount = privateKeyToAccount(PAY_KEY!);
    facilitatorAccount = privateKeyToAccount(FAC_KEY!);

    publicClient = createPublicClient({
      chain: foundry,
      transport: http(RPC),
    }) as PublicClient;

    walletClient = createWalletClient({
      account: facilitatorAccount,
      chain: foundry,
      transport: http(RPC),
    });

    chainConfig = {
      name: 'anvil',
      chainId: 31337,
      rpcUrl: RPC!,
      usdcAddress: USDC!,
      tokenNetworkAddress: '',
      registryAddress: '',
    };

    // If the payer has zero USDC, fund them from the deployer (which is
    // facilitatorAccount under the default deploy-mock-usdc.sh setup).
    const balance = await publicClient.readContract({
      address: USDC!,
      abi: parseAbi(['function balanceOf(address) view returns (uint256)']),
      functionName: 'balanceOf',
      args: [payerAccount.address],
    });
    if (balance === 0n) {
      const hash = await walletClient.writeContract({
        address: USDC!,
        abi: parseAbi(['function transfer(address,uint256) returns (bool)']),
        functionName: 'transfer',
        args: [payerAccount.address, 100_000_000n], // 100 USDC
        chain: foundry,
        account: facilitatorAccount,
      });
      await publicClient.waitForTransactionReceipt({ hash });
    }
  }, 30_000);

  it('signs EIP-3009 and round-trips /verify -> /settle on a real chain', async () => {
    const value = 1_000_000n; // 1 USDC
    const validAfter = 0n;
    const validBefore = BigInt(Math.floor(Date.now() / 1000) + 3600);
    const nonce = `0x${'a1'.repeat(32)}` as Hex;

    // Sign EIP-3009 typed data with the payer key. The mock USDC uses
    // domain { name: "USD Coin", version: "2", chainId, USDC contract }.
    const signature = await privateKeyToAccount(PAY_KEY!).signTypedData({
      domain: {
        name: 'USD Coin',
        version: '2',
        chainId: 31337,
        verifyingContract: USDC!,
      },
      types: {
        TransferWithAuthorization: [
          { name: 'from', type: 'address' },
          { name: 'to', type: 'address' },
          { name: 'value', type: 'uint256' },
          { name: 'validAfter', type: 'uint256' },
          { name: 'validBefore', type: 'uint256' },
          { name: 'nonce', type: 'bytes32' },
        ],
      },
      primaryType: 'TransferWithAuthorization',
      message: {
        from: payerAccount.address,
        to: facilitatorAccount.address,
        value,
        validAfter,
        validBefore,
        nonce,
      },
    });

    const signedPayload: X402SignedPaymentPayload = {
      x402Version: 1,
      scheme: 'exact',
      network: 'anvil',
      payload: {
        signature,
        authorization: {
          from: payerAccount.address,
          to: facilitatorAccount.address,
          value: value.toString(),
          validAfter: validAfter.toString(),
          validBefore: validBefore.toString(),
          nonce,
        },
      },
    };
    const paymentPayload = Buffer.from(JSON.stringify(signedPayload)).toString(
      'base64'
    );

    const request: X402FacilitatorRequest = {
      x402Version: 1,
      paymentPayload,
      paymentRequirements: {
        scheme: 'exact',
        network: 'anvil',
        maxAmountRequired: value.toString(),
        resource: 'https://example.com/test-resource',
        payTo: facilitatorAccount.address,
        asset: USDC!,
      },
    };

    const handler = createX402FacilitatorHandler({
      x402Enabled: true,
      chainConfig,
      facilitatorAddress: facilitatorAccount.address,
      publicClient,
      walletClient,
    });

    const app = new Hono();
    app.post('/verify', (c) => handler.handleVerify(c));
    app.post('/settle', (c) => handler.handleSettle(c));

    // /verify against the real chain (signature, balance, nonce-freshness)
    const verifyRes = await app.fetch(
      new Request('http://localhost/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      })
    );
    const verifyBody = (await verifyRes.json()) as {
      isValid: boolean;
      payer: string | null;
      invalidReason: string | null;
    };
    expect(verifyRes.status).toBe(200);
    expect(verifyBody.invalidReason).toBeNull();
    expect(verifyBody.isValid).toBe(true);
    expect(verifyBody.payer?.toLowerCase()).toBe(
      payerAccount.address.toLowerCase()
    );

    // /settle submits the actual transferWithAuthorization on-chain
    const settleRes = await app.fetch(
      new Request('http://localhost/settle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      })
    );
    const settleBody = (await settleRes.json()) as {
      success: boolean;
      txHash: string | null;
      networkId: string | null;
      errorReason: string | null;
    };
    expect(settleRes.status).toBe(200);
    expect(settleBody.errorReason).toBeNull();
    expect(settleBody.success).toBe(true);
    expect(settleBody.txHash).toMatch(/^0x[0-9a-fA-F]{64}$/);
    expect(settleBody.networkId).toBe('anvil');

    // The on-chain tx actually moved USDC to the facilitator.
    const receipt = await publicClient.waitForTransactionReceipt({
      hash: settleBody.txHash as Hex,
    });
    expect(receipt.status).toBe('success');
  }, 60_000);
});
