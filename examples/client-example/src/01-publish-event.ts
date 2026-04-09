/**
 * Example 01: Publish Event via ToonClient
 *
 * Demonstrates the complete standalone client lifecycle against running peer containers:
 *   1. Fund an EVM wallet on Anvil
 *   2. Create ToonClient pointing at peer1's BTP endpoint
 *   3. Bootstrap (discover peers, open payment channel on-chain)
 *   4. Sign a self-describing EIP-712 balance proof claim
 *   5. Publish a Nostr event with the claim via BTP
 *   6. Verify the event is stored on peer1's relay
 *   7. Graceful shutdown
 *
 * Key difference from SDK/Town examples: the client does NOT run its own connector.
 * It connects to external peer containers and must send self-describing claims with
 * every packet. The connector handles claim creation for SDK/Town nodes, but the
 * standalone client is responsible for its own claims.
 *
 * Prerequisites:
 *   - SDK E2E infrastructure running:
 *     ./scripts/sdk-e2e-infra.sh up
 *
 * Run: npm run publish-event
 */

import { ToonClient } from '@toon-protocol/client';
import { encodeEventToToon, decodeEventFromToon } from '@toon-protocol/relay';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import WebSocket from 'ws';
import {
  createPublicClient,
  createWalletClient,
  http,
  defineChain,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

// ---------------------------------------------------------------------------
// Infrastructure — SDK E2E peer containers
// ---------------------------------------------------------------------------

const ANVIL_RPC = 'http://localhost:18545';
const PEER1_BTP = 'ws://localhost:19000';
const PEER1_BLS = 'http://localhost:19100';
const PEER1_RELAY = 'ws://localhost:19700';
const PEER1_PUBKEY = 'd6bfe100d1600c0d8f769501676fc74c3809500bd131c8a549f88cf616c21f35';
const PEER1_ILP_ADDRESS = 'g.toon.peer1';

// ---------------------------------------------------------------------------
// Contracts (deterministic Anvil addresses)
// ---------------------------------------------------------------------------

const TOKEN_ADDRESS = '0x5FbDB2315678afecb367f032d93F642f64180aa3' as const; // Mock USDC (Anvil)
const TOKEN_NETWORK_ADDRESS = '0xCafac3dD18aC6c6e92c921884f9E4176737C052c' as const;

// Anvil Account #0 — deployer (holds all USDC tokens, used to fund our wallet)
const DEPLOYER_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as const;

// Anvil Account #9 — unused by any other example or test
const CLIENT_PRIVATE_KEY = '0x2a871d0798f97d79848a013d4936a73bf4cc922c825d33c1cf7073dff6d409c6' as const;
const CLIENT_EVM_ADDRESS = '0xa0Ee7A142d267C1f36714E4a8F75612F20a79720' as const;

const FUNDING_AMOUNT = 10n * 10n ** 18n; // 10 tokens (mock USDC on Anvil uses 18 decimals)

// ---------------------------------------------------------------------------
// Chain config
// ---------------------------------------------------------------------------

const CHAIN_ID = 31337;
const CHAIN_IDENTIFIER = 'evm:base:31337'; // Matches what peer1 advertises

// Multi-chain: To add Solana or Mina chain providers, configure:
//
// Solana:
//   supportedChains: ['evm:base:31337', 'solana:devnet'],
//   chainRpcUrls: { 'evm:base:31337': ANVIL_RPC, 'solana:devnet': 'http://localhost:19899' },
//
// Mina:
//   supportedChains: ['evm:base:31337', 'mina:devnet'],
//   chainRpcUrls: { 'evm:base:31337': ANVIL_RPC, 'mina:devnet': 'http://localhost:19085/graphql' },
//
// See 03-multi-chain-publish.ts for a complete multi-chain example.

const anvilChain = defineChain({
  id: CHAIN_ID,
  name: 'anvil',
  nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [ANVIL_RPC] } },
});

const ERC20_ABI = [
  {
    name: 'transfer',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function checkAnvil(): Promise<void> {
  const resp = await fetch(ANVIL_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_chainId', params: [], id: 1 }),
  });
  const json = await resp.json() as { result?: string };
  const chainId = parseInt(json.result || '0', 16);
  if (chainId !== CHAIN_ID) throw new Error(`Expected chain ${CHAIN_ID}, got ${chainId}`);
}

async function checkPeer1(): Promise<void> {
  const resp = await fetch(`${PEER1_BLS}/health`, { signal: AbortSignal.timeout(3000) });
  const health = await resp.json() as { status: string; bootstrapPhase: string };
  if (health.status !== 'healthy') throw new Error(`Peer1 unhealthy: ${health.status}`);
  console.log(`  Peer1: ${health.status} (phase: ${health.bootstrapPhase})`);
}

async function fundWallet(): Promise<void> {
  const client = createPublicClient({ chain: anvilChain, transport: http(ANVIL_RPC) });
  const balance = await client.readContract({
    address: TOKEN_ADDRESS,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [CLIENT_EVM_ADDRESS],
  });

  if (balance >= FUNDING_AMOUNT) {
    console.log(`  Already funded (${balance} USDC)`);
    return;
  }

  const deployerAccount = privateKeyToAccount(DEPLOYER_PRIVATE_KEY);
  const walletClient = createWalletClient({
    account: deployerAccount,
    chain: anvilChain,
    transport: http(ANVIL_RPC),
  });

  await walletClient.writeContract({
    address: TOKEN_ADDRESS,
    abi: ERC20_ABI,
    functionName: 'transfer',
    args: [CLIENT_EVM_ADDRESS, FUNDING_AMOUNT],
  });
  console.log(`  Funded with ${FUNDING_AMOUNT} USDC`);
}

/**
 * Query peer1's relay for an event by ID.
 * Relay returns TOON-encoded events — decode before comparing.
 */
function waitForEventOnRelay(
  relayUrl: string,
  eventId: string,
  timeoutMs = 10000,
): Promise<Record<string, unknown> | null> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(relayUrl);
    const subId = `verify-${Date.now()}`;
    const cleanup = () => {
      clearTimeout(timer);
      try { ws.close(); } catch { /* ignore */ }
    };

    const timer = setTimeout(() => { cleanup(); resolve(null); }, timeoutMs);

    ws.on('open', () => {
      ws.send(JSON.stringify(['REQ', subId, { ids: [eventId] }]));
    });

    ws.on('message', (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString());
        if (Array.isArray(msg)) {
          if (msg[0] === 'EVENT' && msg[1] === subId && msg[2]) {
            // Relay returns TOON-encoded event strings
            const toonBytes = new TextEncoder().encode(msg[2]);
            const event = decodeEventFromToon(toonBytes);
            cleanup();
            resolve(event as unknown as Record<string, unknown>);
          } else if (msg[0] === 'EOSE' && msg[1] === subId) {
            // End of stored events — keep waiting briefly for new events
          }
        }
      } catch { /* ignore parse errors */ }
    });

    ws.on('error', (err: Error) => { cleanup(); reject(err); });
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('=== TOON Client: Publish Event ===\n');

  // --- Phase 1: Preflight checks ---
  console.log('Phase 1: Checking infrastructure...');
  try {
    await checkAnvil();
    console.log(`  Anvil running (chain ID: ${CHAIN_ID})`);
    await checkPeer1();
  } catch (err) {
    console.error(`  Infrastructure not ready: ${err instanceof Error ? err.message : err}`);
    console.error('  Start it with: ./scripts/sdk-e2e-infra.sh up');
    process.exit(1);
  }
  console.log();

  // --- Phase 2: Fund wallet ---
  console.log('Phase 2: Funding client wallet (Anvil Account #9)...');
  await fundWallet();
  console.log();

  // --- Phase 3: Create ToonClient ---
  console.log('Phase 3: Creating ToonClient...');

  const secretKey = generateSecretKey();
  const pubkey = getPublicKey(secretKey);
  console.log(`  Nostr pubkey: ${pubkey.slice(0, 24)}...`);
  console.log(`  EVM address:  ${CLIENT_EVM_ADDRESS}`);

  const client = new ToonClient({
    // HTTP connector URL — required by validation but not used for transport
    // when btpUrl is provided. Point at peer1's BLS for a reachable endpoint.
    connectorUrl: PEER1_BLS,

    // BTP transport — this is the actual connection to peer1's connector
    btpUrl: PEER1_BTP,
    btpAuthToken: '', // No auth in dev mode
    btpPeerId: `client-${pubkey.slice(0, 8)}`,

    // Identity
    secretKey,
    ilpInfo: {
      pubkey,
      ilpAddress: `g.toon.client.${pubkey.slice(0, 8)}`,
      btpEndpoint: PEER1_BTP,
      assetCode: 'USD',
      assetScale: 6,
    },

    // TOON encoding (required — relay speaks TOON, not JSON)
    toonEncoder: encodeEventToToon,
    toonDecoder: decodeEventFromToon,

    // Network
    relayUrl: PEER1_RELAY,
    destinationAddress: PEER1_ILP_ADDRESS,
    knownPeers: [{
      pubkey: PEER1_PUBKEY,
      relayUrl: PEER1_RELAY,
      btpEndpoint: PEER1_BTP,
    }],

    // EVM / Payment Channels — client must manage its own claims
    evmPrivateKey: CLIENT_PRIVATE_KEY,
    supportedChains: [CHAIN_IDENTIFIER],
    chainRpcUrls: { [CHAIN_IDENTIFIER]: ANVIL_RPC },
    settlementAddresses: { [CHAIN_IDENTIFIER]: CLIENT_EVM_ADDRESS },
    preferredTokens: { [CHAIN_IDENTIFIER]: TOKEN_ADDRESS },
    tokenNetworks: { [CHAIN_IDENTIFIER]: TOKEN_NETWORK_ADDRESS },
  });

  console.log(`  Destination:  ${PEER1_ILP_ADDRESS}`);
  console.log(`  Transport:    BTP (${PEER1_BTP})\n`);

  // --- Phase 4: Bootstrap ---
  console.log('Phase 4: Starting client (bootstrap + payment channel)...');
  const startResult = await client.start();
  console.log(`  Mode: ${startResult.mode}`);
  console.log(`  Peers discovered: ${startResult.peersDiscovered}`);

  const channels = client.getTrackedChannels();
  console.log(`  Payment channels: ${channels.length}`);
  if (channels.length > 0) {
    console.log(`  Channel ID: ${channels[0]!.slice(0, 24)}...`);
  }
  console.log();

  // --- Phase 5: Sign claim and publish event ---
  console.log('Phase 5: Publishing event with self-describing claim...');

  const event = finalizeEvent({
    kind: 1,
    content: `Hello from ToonClient! Timestamp: ${new Date().toISOString()}`,
    tags: [['client', 'example-01']],
    created_at: Math.floor(Date.now() / 1000),
  }, secretKey);

  console.log(`  Event ID: ${event.id.slice(0, 24)}...`);
  console.log(`  Content:  "${event.content}"`);

  // Sign a balance proof — the client is responsible for creating self-describing
  // claims. SDK/Town nodes have their connector do this automatically.
  if (channels.length > 0) {
    const channelId = channels[0]!;
    const claim = await client.signBalanceProof(channelId, 1000n);
    console.log(`  Claim nonce: ${claim.nonce}`);
    console.log(`  Claim signer: ${claim.signerAddress}`);

    const result = await client.publishEvent(event, { claim });

    if (result.success) {
      console.log(`  Published!`);
    } else {
      console.log(`  Failed: ${result.error}`);
    }
  } else {
    // No channel — try without claim (may fail depending on peer config)
    console.log('  No payment channel opened — publishing without claim...');
    const result = await client.publishEvent(event);
    if (result.success) {
      console.log(`  Published!`);
    } else {
      console.log(`  Failed: ${result.error}`);
    }
  }
  console.log();

  // --- Phase 6: Verify event on relay ---
  console.log('Phase 6: Verifying event on relay...');
  await new Promise((r) => setTimeout(r, 1000));

  const storedEvent = await waitForEventOnRelay(PEER1_RELAY, event.id, 10000);
  if (storedEvent) {
    console.log(`  Event found on relay!`);
    console.log(`  ID:      ${(storedEvent['id'] as string).slice(0, 24)}...`);
    console.log(`  Content: "${storedEvent['content']}"`);
    console.log(`  Kind:    ${storedEvent['kind']}`);
  } else {
    console.log('  Event not found on relay (may still be propagating)');
  }
  console.log();

  // --- Phase 7: Cleanup ---
  console.log('Phase 7: Stopping client...');
  await client.stop();
  console.log('  Client stopped.');

  // --- Summary ---
  console.log('\n=== Summary ===');
  console.log(`  Nostr pubkey:    ${pubkey.slice(0, 24)}...`);
  console.log(`  EVM address:     ${CLIENT_EVM_ADDRESS}`);
  console.log(`  Event ID:        ${event.id.slice(0, 24)}...`);
  console.log(`  Channels:        ${channels.length}`);
  console.log(`  Relay verified:  ${storedEvent ? 'YES' : 'NO'}`);
  console.log('\nDone.');
  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
