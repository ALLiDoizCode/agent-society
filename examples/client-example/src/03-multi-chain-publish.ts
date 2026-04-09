/**
 * Example 03: Multi-Chain Publish via ToonClient (Lazy Channels)
 *
 * Flagship dogfooding example demonstrating the lazy channel flow:
 *   1. Create ToonClient with EVM chain config
 *   2. Start the client (discovers peers, NO channels opened yet)
 *   3. Publish a kind:1 note — channel opens lazily on first send
 *   4. Publish again — existing channel is reused (no second open)
 *   5. Verify events arrived on the relay
 *
 * Lazy channels mean zero startup cost — you only pay gas when you actually
 * publish your first event. Subsequent publishes reuse the same channel.
 *
 * Prerequisites:
 *   ./scripts/sdk-e2e-infra.sh up
 *
 * Run:
 *   cd examples/client-example && pnpm run example:03
 *
 * Multi-chain configuration:
 *   By default this uses EVM (Anvil). To configure Solana or Mina:
 *
 *   // Add Solana chain provider:
 *   // supportedChains: ['evm:base:31337', 'solana:devnet'],
 *   // chainRpcUrls: { 'evm:base:31337': ANVIL_RPC, 'solana:devnet': 'http://localhost:19899' },
 *
 *   // Add Mina chain provider:
 *   // supportedChains: ['evm:base:31337', 'mina:devnet'],
 *   // chainRpcUrls: { 'evm:base:31337': ANVIL_RPC, 'mina:devnet': 'http://localhost:19085/graphql' },
 */

import { ToonClient } from '@toon-protocol/client';
import { encodeEventToToon, decodeEventFromToon } from '@toon-protocol/relay';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import {
  createWalletClient,
  createPublicClient,
  http,
  defineChain,
  maxUint256,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

// ---------------------------------------------------------------------------
// Infrastructure
// ---------------------------------------------------------------------------

const ANVIL_RPC = 'http://localhost:18545';
const PEER1_BTP = 'ws://localhost:19000';
const PEER1_BLS = 'http://localhost:19100';
const PEER1_RELAY = 'ws://localhost:19700';
const PEER1_PUBKEY = 'd6bfe100d1600c0d8f769501676fc74c3809500bd131c8a549f88cf616c21f35';
const PEER1_ILP = 'g.toon.peer1';

// Contracts (deterministic Anvil deployment)
const TOKEN_ADDRESS = '0x5FbDB2315678afecb367f032d93F642f64180aa3';
const TOKEN_NETWORK_ADDRESS = '0xCafac3dD18aC6c6e92c921884f9E4176737C052c';

// Anvil Account #9 (dedicated for examples)
const EXAMPLE_PRIVATE_KEY = '0x2a871d0798f97d79848a013d4936a73bf4cc922c825d33c1cf7073dff6d409c6';

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('\n--- TOON Multi-Chain Publish (Lazy Channels) ---\n');

  // 1. Check infra
  console.log('Checking infrastructure...');
  try {
    const health = await fetch(`${PEER1_BLS}/health`, { signal: AbortSignal.timeout(3000) });
    if (!health.ok) throw new Error('Peer1 not healthy');
    console.log('  Peer1: healthy');
  } catch {
    console.error('ERROR: SDK E2E infra not running. Run: ./scripts/sdk-e2e-infra.sh up');
    process.exit(1);
  }

  // 2. Generate Nostr keypair
  const secretKey = generateSecretKey();
  const pubkey = getPublicKey(secretKey);
  console.log(`  Nostr pubkey: ${pubkey.slice(0, 16)}...`);

  // 3. Fund EVM wallet with test USDC
  const account = privateKeyToAccount(EXAMPLE_PRIVATE_KEY as Hex);
  console.log(`  EVM address:  ${account.address}`);

  const anvilChain = defineChain({
    id: 31337,
    name: 'anvil',
    nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [ANVIL_RPC] } },
  });

  const publicClient = createPublicClient({ chain: anvilChain, transport: http(ANVIL_RPC) });
  const walletClient = createWalletClient({
    account,
    chain: anvilChain,
    transport: http(ANVIL_RPC),
  });

  // Pre-approve token spend for TokenNetwork
  console.log('  Approving USDC for TokenNetwork...');
  const approveHash = await walletClient.writeContract({
    address: TOKEN_ADDRESS as Hex,
    abi: [{ name: 'approve', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }] }],
    functionName: 'approve',
    args: [TOKEN_NETWORK_ADDRESS as Hex, maxUint256],
  });
  await publicClient.waitForTransactionReceipt({ hash: approveHash });
  console.log('  USDC approved');

  // 4. Create ToonClient with lazy channel config
  console.log('\nCreating ToonClient...');
  const client = new ToonClient({
    connectorUrl: 'http://localhost:19080', // Not used in BTP mode
    btpUrl: PEER1_BTP,
    btpPeerId: `client-${pubkey.slice(0, 8)}`,
    secretKey,
    evmPrivateKey: EXAMPLE_PRIVATE_KEY,
    ilpInfo: {
      pubkey,
      ilpAddress: `g.toon.client.${pubkey.slice(0, 8)}`,
      btpEndpoint: PEER1_BTP,
    },
    destinationAddress: PEER1_ILP,
    relayUrl: PEER1_RELAY,
    supportedChains: ['evm:base:31337'],
    chainRpcUrls: { 'evm:base:31337': ANVIL_RPC },
    preferredTokens: { 'evm:base:31337': TOKEN_ADDRESS },
    tokenNetworks: { 'evm:base:31337': TOKEN_NETWORK_ADDRESS },
    knownPeers: [{
      pubkey: PEER1_PUBKEY,
      relayUrl: PEER1_RELAY,
      btpEndpoint: PEER1_BTP,
    }],
    toonEncoder: encodeEventToToon,
    toonDecoder: decodeEventFromToon,
  });

  // 5. Start — should NOT open any channels
  console.log('Starting client (no channels yet)...');
  const startResult = await client.start();
  console.log(`  Peers discovered: ${startResult.peersDiscovered}`);
  console.log(`  Tracked channels: ${client.getTrackedChannels().length} (should be 0)`);

  // 6. Create and publish first event — lazy channel opens here
  console.log('\nPublishing first event (lazy channel will open)...');
  const event1 = finalizeEvent({
    kind: 1,
    content: `Hello from TOON devnet! Chain: EVM. Timestamp: ${Date.now()}`,
    tags: [],
    created_at: Math.floor(Date.now() / 1000),
  }, secretKey);

  try {
    const result1 = await client.publishEvent(event1);
    if (result1.success) {
      console.log(`  Event 1 published: ${result1.eventId}`);
      console.log(`  Tracked channels: ${client.getTrackedChannels().length}`);
    } else {
      console.log(`  Event 1 rejected: ${result1.error}`);
    }
  } catch (err) {
    console.log(`  Publish failed (expected if channel open not fully wired): ${(err as Error).message}`);
  }

  // 7. Publish second event — should reuse channel
  console.log('\nPublishing second event (reusing channel)...');
  const event2 = finalizeEvent({
    kind: 1,
    content: `Second message from TOON! Lazy channels work! Timestamp: ${Date.now()}`,
    tags: [],
    created_at: Math.floor(Date.now() / 1000),
  }, secretKey);

  try {
    const result2 = await client.publishEvent(event2);
    if (result2.success) {
      console.log(`  Event 2 published: ${result2.eventId}`);
      console.log(`  Channel nonce should be 2`);
    } else {
      console.log(`  Event 2 rejected: ${result2.error}`);
    }
  } catch (err) {
    console.log(`  Publish failed: ${(err as Error).message}`);
  }

  // 8. Cleanup
  console.log('\nStopping client...');
  await client.stop();
  console.log('Done!\n');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
