#!/usr/bin/env node
// ---------------------------------------------------------------------------
// deploy-e2e-testnet-evm — one-time EVM contract deploy for the public-testnet
// E2E mode. Deploys MockERC20 (USDC) + TokenNetworkRegistry and creates the
// TokenNetwork for the token, mirroring the connector's local
// DeployLocal.s.sol — but against a PUBLIC testnet (Base Sepolia) via viem,
// reading the connector's already-compiled Foundry artifacts (no forge needed).
//
// Deployer: the funded E2E_DEV_MNEMONIC account at the index below (default 2,
// the treasury — the only funded role today). Records the resulting
// registryAddress + tokenAddress into e2e/testnets.json.
//
// Usage (from repo root, SDK built):
//   pnpm --filter @toon-protocol/sdk build
//   node scripts/deploy-e2e-testnet-evm.mjs
//
// Idempotency: NOT idempotent — each run deploys fresh contracts. Re-run only
// to redeploy (e.g. after a chain reset). It overwrites the evm addresses in
// e2e/testnets.json.
// ---------------------------------------------------------------------------

import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join, dirname } from 'node:path';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEPLOYER_INDEX = Number(process.env.E2E_DEPLOYER_INDEX ?? '2');
const CONTRACTS_OUT = join(
  REPO,
  '..',
  'connector',
  'packages',
  'contracts',
  'out'
);
const TESTNETS = join(REPO, 'e2e', 'testnets.json');

// Resolve viem from the SDK package (it's a dep there; not at repo root).
const sdkRequire = createRequire(join(REPO, 'packages', 'sdk', 'package.json'));
const viem = await import(pathToFileURL(sdkRequire.resolve('viem')).href);
const viemAccounts = await import(
  pathToFileURL(sdkRequire.resolve('viem/accounts')).href
);
const {
  createWalletClient,
  createPublicClient,
  http,
  defineChain,
  formatEther,
  decodeEventLog,
} = viem;
const { privateKeyToAccount } = viemAccounts;

function readMnemonic() {
  const fromEnv = process.env.E2E_DEV_MNEMONIC?.trim();
  if (fromEnv) return fromEnv;
  const m = readFileSync(join(REPO, '.env.e2e.local'), 'utf8').match(
    /^\s*E2E_DEV_MNEMONIC\s*=\s*["']?([^"'\n]+)["']?\s*$/m
  );
  if (!m) throw new Error('E2E_DEV_MNEMONIC not set and not in .env.e2e.local');
  return m[1].trim();
}

function loadArtifact(name) {
  const a = JSON.parse(
    readFileSync(join(CONTRACTS_OUT, `${name}.sol`, `${name}.json`), 'utf8')
  );
  const bytecode = a.bytecode?.object ?? a.bytecode;
  if (!bytecode || bytecode.length < 4)
    throw new Error(`${name}: no deployable bytecode in artifact`);
  return { abi: a.abi, bytecode };
}

async function main() {
  const config = JSON.parse(readFileSync(TESTNETS, 'utf8'));
  const evm = config.evm;
  const chainId = Number(String(evm.chainId).split(':')[1]);
  const rpcUrl = process.env.BASE_SEPOLIA_RPC_URL || evm.rpcUrl;

  // Deployer key — derive via the SDK so it matches `e2e-wallet addresses`.
  const { fromMnemonicFull } = await import(
    pathToFileURL(join(REPO, 'packages', 'sdk', 'dist', 'index.js')).href
  );
  const id = await fromMnemonicFull(readMnemonic(), {
    accountIndex: DEPLOYER_INDEX,
  });
  const account = privateKeyToAccount(
    `0x${Buffer.from(id.secretKey).toString('hex')}`
  );

  const chain = defineChain({
    id: chainId,
    name: evm.name,
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  });
  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
  const walletClient = createWalletClient({
    account,
    chain,
    transport: http(rpcUrl),
  });

  const bal = await publicClient.getBalance({ address: account.address });
  console.log(`Deployer (idx ${DEPLOYER_INDEX}): ${account.address}`);
  console.log(
    `Balance: ${formatEther(bal)} ETH on ${evm.name} (chainId ${chainId})`
  );
  if (bal === 0n) throw new Error('Deployer has 0 ETH — fund it first.');

  const MockERC20 = loadArtifact('MockERC20');
  const TokenNetworkRegistry = loadArtifact('TokenNetworkRegistry');

  // 1. MockERC20("USD Coin","USDC",18) — matches DeployLocal.s.sol (18-decimal).
  console.log('\nDeploying MockERC20 (USD Coin / USDC / 18)…');
  let hash = await walletClient.deployContract({
    abi: MockERC20.abi,
    bytecode: MockERC20.bytecode,
    args: ['USD Coin', 'USDC', 18],
  });
  let rcpt = await publicClient.waitForTransactionReceipt({ hash });
  const tokenAddress = rcpt.contractAddress;
  console.log(`  USDC token: ${tokenAddress}  (tx ${hash})`);

  // 2. TokenNetworkRegistry()
  console.log('Deploying TokenNetworkRegistry…');
  hash = await walletClient.deployContract({
    abi: TokenNetworkRegistry.abi,
    bytecode: TokenNetworkRegistry.bytecode,
    args: [],
  });
  rcpt = await publicClient.waitForTransactionReceipt({ hash });
  const registryAddress = rcpt.contractAddress;
  console.log(`  Registry: ${registryAddress}  (tx ${hash})`);

  // 3. registry.createTokenNetwork(usdc). Use an explicit gas limit: it deploys
  //    a TokenNetwork via `new` (~2-3M gas) and auto-estimation can race the
  //    just-deployed registry's state propagation on public RPCs (a transient
  //    underestimate → revert). Decode TokenNetworkCreated for the address
  //    rather than reading the mapping immediately (read-after-write lag).
  console.log('Creating TokenNetwork for USDC via the registry…');
  hash = await walletClient.writeContract({
    address: registryAddress,
    abi: TokenNetworkRegistry.abi,
    functionName: 'createTokenNetwork',
    args: [tokenAddress],
    gas: 4_000_000n,
  });
  rcpt = await publicClient.waitForTransactionReceipt({ hash });
  if (rcpt.status !== 'success')
    throw new Error(`createTokenNetwork reverted (tx ${hash})`);
  let tokenNetworkAddress = null;
  for (const log of rcpt.logs) {
    try {
      const d = decodeEventLog({
        abi: TokenNetworkRegistry.abi,
        data: log.data,
        topics: log.topics,
      });
      if (d.eventName === 'TokenNetworkCreated')
        tokenNetworkAddress = d.args.tokenNetwork;
    } catch {
      /* not our event */
    }
  }
  console.log(`  TokenNetwork: ${tokenNetworkAddress}  (tx ${hash})`);

  // Record into e2e/testnets.json
  config.evm.registryAddress = registryAddress;
  config.evm.tokenAddress = tokenAddress;
  config.evm.tokenNetworkAddress = tokenNetworkAddress;
  writeFileSync(TESTNETS, JSON.stringify(config, null, 2) + '\n');

  console.log('\n=== Base Sepolia deploy complete ===');
  console.log(`registryAddress: ${registryAddress}`);
  console.log(`tokenAddress   : ${tokenAddress}`);
  console.log(`Explorer: ${evm.explorer}/address/${registryAddress}`);
  console.log('Recorded in e2e/testnets.json.');
}

await main();
