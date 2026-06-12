#!/usr/bin/env node
// ---------------------------------------------------------------------------
// fund-e2e-peers — distribute treasury (idx 2) → the public-mode E2E run
// accounts on the three public testnets.
//
// The public-testnet payment-channel contracts are deployed and pinned in
// e2e/testnets.json, but only the TREASURY role (BIP-32 account index 2) is
// faucet-funded on each chain. The run needs funded:
//
//   idx 0 = peer1 settlement (also EVM contract deployer)   — all chains
//   idx 1 = peer2 settlement                                — all chains
//   idx 3 = host-side publish/pay-to-write client           — EVM only
//   idx 4 = host-side settlement participant A              — EVM only
//   idx 5 = host-side settlement participant B              — EVM only
//
// idx 3/4/5 are the SDK e2e helper's EVM test actors (EVM_CLIENT_*/
// EVM_SETTLEMENT_* in docker-e2e-setup.ts, derived by e2e-derive-peer-config.mjs);
// they open/deposit/settle channels on Base Sepolia ONLY, so they need ETH+USDC
// but no Solana/Mina funds.
//
// This script has the funded treasury send, on each chain:
//   • Base Sepolia : ETH (gas) + MockUSDC transfer            → idx0/1/3/4/5
//   • Solana devnet: SOL + mock-USDC SPL transfer (creates ATAs) → idx0 / idx1
//   • Mina devnet  : MINA (covers the per-recipient account-creation fee)
//                    via scripts/fund-e2e-peers-mina.ts (npx tsx) → idx0 / idx1
//
// All three legs are IDEMPOTENT/re-runnable: amounts are TOP-UPs to a target
// floor, so a re-run after a devnet reset (which wipes balances) refunds, and a
// re-run on a still-funded peer is a near-no-op. Recipient ATAs / Mina accounts
// are created on first run only.
//
// Derivation is the SAME as scripts/e2e-wallet.mjs: `fromMnemonicFull(mnemonic,
// { accountIndex })` from the built SDK, so the addresses funded here match the
// keys the harness transacts with (SDK #177: every chain varies by accountIndex).
//
// ---------------------------------------------------------------------------
// Usage (from repo root, SDK built):
//   pnpm --filter @toon-protocol/sdk build
//   node scripts/fund-e2e-peers.mjs                 # all three chains
//   node scripts/fund-e2e-peers.mjs --chains evm,solana
//   node scripts/fund-e2e-peers.mjs --dry-run       # print the plan, send nothing
//
// Mnemonic source (first hit wins): $E2E_DEV_MNEMONIC, then E2E_DEV_MNEMONIC in
// ./.env.e2e.local (gitignored). Dry-run accepts any 12/24-word mnemonic
// (use a throwaway one to validate derivation + the transfer plan offline).
//
// Per-chain amount overrides (env, optional):
//   EVM_GAS_FLOOR_ETH      default 0.01   (target native floor per peer)
//   EVM_USDC_AMOUNT        default 50     (USDC, 18-decimal token)
//   SOL_GAS_FLOOR_SOL      default 0.05   (target native floor per peer)
//   SOL_USDC_AMOUNT        default 50     (mock-USDC, 6-decimal mint)
//   MINA_AMOUNT            default 5      (MINA per peer; covers 1 MINA account fee)
//
// SECURITY: reads ONLY the treasury seed (to sign treasury-funded transfers);
// never prints private keys. Use a TESTNET-ONLY wallet. See docs/e2e-testnets.md.
// ---------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const TESTNETS = join(REPO, 'e2e', 'testnets.json');
const SDK_DIST = join(REPO, 'packages', 'sdk', 'dist', 'index.js');

// Role indices (must match scripts/e2e-wallet.mjs).
const TREASURY_INDEX = Number(process.env.E2E_TREASURY_INDEX ?? '2');
const PEER_INDICES = [0, 1];
// Host-side EVM test actors used by the SDK e2e helper in public mode
// (packages/sdk/tests/e2e/helpers/docker-e2e-setup.ts → EVM_CLIENT_*/
// EVM_SETTLEMENT_* keys, derived by scripts/e2e-derive-peer-config.mjs):
//   idx3 = publish/pay-to-write client, idx4/idx5 = settlement participants A/B.
// They transact on EVM only (open/deposit/settle channels on Base Sepolia), so
// they need ETH gas + MockUSDC — NOT Solana/Mina funds.
// idx3 client, idx4/5 settlement A/B, idx6-11 per-suite host-side settlement
// signers (workflow/dvm-lifecycle/dvm-submission/swarm/pet-dvm/mill — each
// docker e2e suite opens+settles its own channel, so each needs its own funded
// EVM key; see scripts/e2e-derive-peer-config.mjs).
const EVM_ACTOR_INDICES = [3, 4, 5, 6, 7, 8, 9, 10, 11];
// Everyone who needs ETH + USDC on Base Sepolia.
const EVM_FUND_INDICES = [...PEER_INDICES, ...EVM_ACTOR_INDICES];

// Target native-gas floors + token amounts (small but enough for a two-party
// channel deposit + the on-chain open/deposit/settle gas).
const EVM_GAS_FLOOR_ETH = process.env.EVM_GAS_FLOOR_ETH ?? '0.01';
const EVM_USDC_AMOUNT = process.env.EVM_USDC_AMOUNT ?? '50';
const SOL_GAS_FLOOR_SOL = process.env.SOL_GAS_FLOOR_SOL ?? '0.05';
const SOL_USDC_AMOUNT = process.env.SOL_USDC_AMOUNT ?? '50';
const MINA_AMOUNT = process.env.MINA_AMOUNT ?? '5';

// --------------------------------------------------------------------------
// CLI args
// --------------------------------------------------------------------------
function parseArgs(argv) {
  const opts = { chains: ['evm', 'solana', 'mina'], dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run' || a === '-n') opts.dryRun = true;
    else if (a === '--chains') {
      const v = argv[++i];
      if (!v) die('--chains requires a value (e.g. evm,solana,mina)');
      opts.chains = v
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
    } else if (a.startsWith('--chains=')) {
      opts.chains = a
        .slice('--chains='.length)
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
    } else if (a === '-h' || a === '--help') {
      console.log(
        'Usage: node scripts/fund-e2e-peers.mjs [--chains evm,solana,mina] [--dry-run]'
      );
      process.exit(0);
    } else {
      die(`unknown argument: ${a}`);
    }
  }
  const known = new Set(['evm', 'solana', 'mina']);
  for (const c of opts.chains)
    if (!known.has(c)) die(`unknown chain "${c}" (expected evm|solana|mina)`);
  return opts;
}

function die(msg) {
  console.error(`[fund-e2e-peers] ERROR: ${msg}`);
  process.exit(1);
}

function readMnemonic() {
  const fromEnv = process.env.E2E_DEV_MNEMONIC?.trim();
  if (fromEnv) return fromEnv;
  try {
    const m = readFileSync(join(REPO, '.env.e2e.local'), 'utf8').match(
      /^\s*E2E_DEV_MNEMONIC\s*=\s*["']?([^"'\n]+)["']?\s*$/m
    );
    if (m) return m[1].trim();
  } catch {
    /* no .env.e2e.local */
  }
  die(
    'E2E_DEV_MNEMONIC not set and not in .env.e2e.local. ' +
      'Generate one with: node scripts/e2e-wallet.mjs generate'
  );
}

async function loadSdk() {
  try {
    return await import(pathToFileURL(SDK_DIST).href);
  } catch (err) {
    die(
      'Could not import the built SDK. Build it first:\n' +
        '  pnpm --filter @toon-protocol/sdk build\n' +
        `(looked for ${SDK_DIST}; original error: ${err?.message ?? err})`
    );
  }
}

// --------------------------------------------------------------------------
// EVM (Base Sepolia) — ETH gas top-up + MockUSDC transfer
// --------------------------------------------------------------------------
async function fundEvm({ evm, identities, dryRun }) {
  console.log(`\n=== EVM: ${evm.name} (${evm.chainId}) ===`);
  if (!evm.tokenAddress) die('evm.tokenAddress is null in e2e/testnets.json');

  const sdkRequire = createRequire(
    join(REPO, 'packages', 'sdk', 'package.json')
  );
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
    parseEther,
    parseUnits,
    formatUnits,
  } = viem;
  const { privateKeyToAccount } = viemAccounts;

  const chainId = Number(String(evm.chainId).split(':')[1]);
  const rpcUrl = process.env.BASE_SEPOLIA_RPC_URL || evm.rpcUrl;
  const chain = defineChain({
    id: chainId,
    name: evm.name,
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  });
  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });

  const treasury = identities[TREASURY_INDEX];
  const treasuryAccount = privateKeyToAccount(
    `0x${Buffer.from(treasury.secretKey).toString('hex')}`
  );
  const walletClient = createWalletClient({
    account: treasuryAccount,
    chain,
    transport: http(rpcUrl),
  });
  console.log(`Treasury (idx ${TREASURY_INDEX}): ${treasuryAccount.address}`);

  // ERC-20 minimal ABI: balanceOf + transfer + decimals.
  const erc20Abi = [
    {
      type: 'function',
      name: 'balanceOf',
      stateMutability: 'view',
      inputs: [{ name: 'a', type: 'address' }],
      outputs: [{ name: '', type: 'uint256' }],
    },
    {
      type: 'function',
      name: 'transfer',
      stateMutability: 'nonpayable',
      inputs: [
        { name: 'to', type: 'address' },
        { name: 'amount', type: 'uint256' },
      ],
      outputs: [{ name: '', type: 'bool' }],
    },
    {
      type: 'function',
      name: 'decimals',
      stateMutability: 'view',
      inputs: [],
      outputs: [{ name: '', type: 'uint8' }],
    },
  ];

  let tokenDecimals = 18;
  try {
    tokenDecimals = Number(
      await publicClient.readContract({
        address: evm.tokenAddress,
        abi: erc20Abi,
        functionName: 'decimals',
      })
    );
  } catch {
    console.log('  (could not read token decimals; assuming 18)');
  }

  const gasFloorWei = parseEther(EVM_GAS_FLOOR_ETH);
  const usdcAmount = parseUnits(EVM_USDC_AMOUNT, tokenDecimals);

  for (const idx of EVM_FUND_INDICES) {
    const peer = identities[idx];
    const role = PEER_INDICES.includes(idx) ? 'peer' : 'test-actor';
    const to = peer.evmAddress;
    console.log(`\n-- idx ${idx} (${role}) → ${to}`);

    const bal = await publicClient.getBalance({ address: to });
    const tokenBal = await publicClient.readContract({
      address: evm.tokenAddress,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [to],
    });
    console.log(
      `   current: ${formatEther(bal)} ETH, ${formatUnits(tokenBal, tokenDecimals)} USDC`
    );

    // Native gas top-up to the floor.
    const ethShort = bal < gasFloorWei ? gasFloorWei - bal : 0n;
    if (ethShort > 0n) {
      console.log(
        `   PLAN send ${formatEther(ethShort)} ETH (top-up to ${EVM_GAS_FLOOR_ETH})`
      );
      if (!dryRun) {
        const hash = await walletClient.sendTransaction({
          to,
          value: ethShort,
        });
        await publicClient.waitForTransactionReceipt({ hash });
        console.log(`   sent ETH tx ${hash}`);
      }
    } else {
      console.log(`   ETH floor already met (>= ${EVM_GAS_FLOOR_ETH}) — skip`);
    }

    // USDC: transfer the configured amount only if below it (idempotent floor).
    if (tokenBal < usdcAmount) {
      const send = usdcAmount - tokenBal;
      console.log(
        `   PLAN transfer ${formatUnits(send, tokenDecimals)} USDC (top-up to ${EVM_USDC_AMOUNT})`
      );
      if (!dryRun) {
        const hash = await walletClient.writeContract({
          address: evm.tokenAddress,
          abi: erc20Abi,
          functionName: 'transfer',
          args: [to, send],
          // Explicit gas: public RPCs sometimes underestimate transfer to a
          // fresh recipient (cold SSTORE) and the auto-estimate can revert.
          gas: 100_000n,
        });
        await publicClient.waitForTransactionReceipt({ hash });
        console.log(`   sent USDC tx ${hash}`);
      }
    } else {
      console.log(`   USDC floor already met (>= ${EVM_USDC_AMOUNT}) — skip`);
    }
  }
}

// --------------------------------------------------------------------------
// Solana devnet — SOL gas top-up + mock-USDC SPL transfer (creates ATAs)
// --------------------------------------------------------------------------
async function fundSolana({ solana, identities, dryRun }) {
  console.log(`\n=== Solana: ${solana.name} (${solana.chainId}) ===`);
  if (!solana.tokenMint) die('solana.tokenMint is null in e2e/testnets.json');

  const spl = await import(
    pathToFileURL(join(REPO, 'infra', 'solana', 'spl-primitives.mjs')).href
  );
  const {
    makeRpc,
    deriveATA,
    createAssociatedTokenAccount,
    transferChecked,
    getSplTokenBalance,
    base58Encode,
    buildAndSendTransaction,
    SYSTEM_PROGRAM_ID,
  } = spl;

  const rpcUrl = process.env.SOLANA_RPC_URL || solana.rpcUrl;
  const rpc = makeRpc(rpcUrl);
  const mint = solana.tokenMint;

  // The SDK exposes a 64-byte Ed25519 secretKey (priv||pub); build the keypair
  // shape spl-primitives expects ({ privateKey, publicKey, pubkeyBase58 }).
  function toKeypair(solIdentity) {
    const sk = solIdentity.secretKey;
    if (sk.length !== 64)
      die(`expected 64-byte Solana secretKey, got ${sk.length}`);
    const publicKey = sk.slice(32);
    return {
      privateKey: sk.slice(0, 32),
      publicKey,
      pubkeyBase58: base58Encode(publicKey),
    };
  }

  async function getLamports(pubkeyBase58) {
    const res = await rpc('getBalance', [pubkeyBase58]);
    return BigInt(res?.value ?? res ?? 0);
  }

  async function transferSol(payer, toBase58, lamports) {
    const data = new Uint8Array(12);
    // u32 LE instruction index 2 (Transfer)
    data[0] = 2;
    // u64 LE lamports
    let v = BigInt(lamports);
    for (let i = 0; i < 8; i++) {
      data[4 + i] = Number(v & 0xffn);
      v >>= 8n;
    }
    // SystemProgram::Transfer = instruction index 2 (u32 LE) + u64 LE lamports.
    return buildAndSendTransaction(rpc, payer, [
      {
        programId: SYSTEM_PROGRAM_ID,
        keys: [
          { pubkey: payer.pubkeyBase58, isSigner: true, isWritable: true },
          { pubkey: toBase58, isSigner: false, isWritable: true },
        ],
        data,
      },
    ]);
  }

  const treasury = toKeypair(identities[TREASURY_INDEX].solana);
  console.log(`Treasury (idx ${TREASURY_INDEX}): ${treasury.pubkeyBase58}`);

  const solFloorLamports = BigInt(Math.round(Number(SOL_GAS_FLOOR_SOL) * 1e9));
  const SOL_USDC_DECIMALS = 6;
  const usdcBaseUnits =
    BigInt(Math.floor(Number(SOL_USDC_AMOUNT))) *
    10n ** BigInt(SOL_USDC_DECIMALS);
  const treasuryAta = deriveATA(treasury.pubkeyBase58, mint);

  for (const idx of PEER_INDICES) {
    const peer = toKeypair(identities[idx].solana);
    const to = peer.pubkeyBase58;
    console.log(`\n-- idx ${idx} → ${to}`);

    const lamports = await getLamports(to);
    const peerAta = deriveATA(to, mint);
    const tokenBal = await getSplTokenBalance(rpc, peerAta);
    console.log(
      `   current: ${Number(lamports) / 1e9} SOL, ${Number(tokenBal) / 1e6} USDC`
    );

    // SOL top-up to the floor.
    const solShort =
      lamports < solFloorLamports ? solFloorLamports - lamports : 0n;
    if (solShort > 0n) {
      console.log(
        `   PLAN send ${Number(solShort) / 1e9} SOL (top-up to ${SOL_GAS_FLOOR_SOL})`
      );
      if (!dryRun) {
        const sig = await transferSol(treasury, to, solShort);
        console.log(`   sent SOL tx ${sig}`);
      }
    } else {
      console.log(`   SOL floor already met (>= ${SOL_GAS_FLOOR_SOL}) — skip`);
    }

    // USDC: ensure recipient ATA, then top-up to the configured amount.
    if (tokenBal < usdcBaseUnits) {
      const send = usdcBaseUnits - tokenBal;
      console.log(
        `   PLAN ensure ATA ${peerAta} + transfer ${Number(send) / 1e6} USDC ` +
          `(top-up to ${SOL_USDC_AMOUNT})`
      );
      if (!dryRun) {
        await createAssociatedTokenAccount(rpc, treasury, to, mint);
        const sig = await transferChecked(
          rpc,
          treasury,
          treasuryAta,
          mint,
          peerAta,
          treasury,
          send,
          SOL_USDC_DECIMALS
        );
        console.log(`   sent USDC tx ${sig}`);
      }
    } else {
      console.log(`   USDC floor already met (>= ${SOL_USDC_AMOUNT}) — skip`);
    }
  }
}

// --------------------------------------------------------------------------
// Mina devnet — delegate to the tsx helper (o1js payment, account-creation fee)
// --------------------------------------------------------------------------
async function fundMina({ mina, identities, dryRun }) {
  console.log(`\n=== Mina: ${mina.name} (${mina.chainId}) ===`);

  const treasuryMina = identities[TREASURY_INDEX].mina;
  if (!treasuryMina?.privateKey) {
    die(
      'Treasury Mina key unavailable (mina-signer not installed in the SDK ' +
        'workspace). Install it, then re-run.'
    );
  }

  const recipients = PEER_INDICES.map((idx) => {
    const m = identities[idx].mina;
    if (!m?.publicKey) die(`idx ${idx} Mina address unavailable`);
    return { idx, address: m.publicKey };
  });

  console.log(`Treasury (idx ${TREASURY_INDEX}): ${treasuryMina.publicKey}`);
  for (const r of recipients) console.log(`-- idx ${r.idx} → ${r.address}`);
  console.log(
    `   PLAN send ${MINA_AMOUNT} MINA to each (1 MINA account-creation fee ` +
      `applies to a brand-new account)`
  );

  // The Mina leg needs o1js (real-devnet payment signing/inclusion) which is
  // simplest from a tsx helper. Pass the treasury's hex private key + recipients
  // + amount on the env; the helper never logs the key. Dry-run prints the plan
  // (above) and does NOT invoke the helper / broadcast.
  if (dryRun) {
    console.log('   (dry-run: not invoking scripts/fund-e2e-peers-mina.ts)');
    return;
  }

  const helper = join(REPO, 'scripts', 'fund-e2e-peers-mina.ts');
  const res = spawnSync(
    'npx',
    ['tsx', helper, ...recipients.map((r) => r.address)],
    {
      cwd: REPO,
      stdio: ['inherit', 'inherit', 'inherit'],
      env: {
        ...process.env,
        MINA_GRAPHQL_URL: process.env.MINA_GRAPHQL_URL || mina.graphqlUrl,
        MINA_FUND_AMOUNT_MINA: MINA_AMOUNT,
        // Hex Pallas private key — consumed by the helper, never printed.
        MINA_TREASURY_PRIVATE_KEY_HEX: treasuryMina.privateKey,
      },
    }
  );
  if (res.status !== 0)
    die(`Mina funding helper exited ${res.status ?? 'null'}`);
}

// --------------------------------------------------------------------------
async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const config = JSON.parse(readFileSync(TESTNETS, 'utf8'));
  const mnemonic = readMnemonic();
  const { fromMnemonicFull } = await loadSdk();

  console.log(
    `[fund-e2e-peers] chains=${opts.chains.join(',')} dryRun=${opts.dryRun}`
  );
  console.log(
    `[fund-e2e-peers] funding peers idx ${PEER_INDICES.join('/')} (all chains) ` +
      `+ EVM test-actors idx ${EVM_ACTOR_INDICES.join('/')} (EVM only) ` +
      `from treasury idx ${TREASURY_INDEX}`
  );

  // Derive every index we fund (peers + EVM test-actors + treasury) the SAME
  // way scripts/e2e-wallet.mjs / e2e-derive-peer-config.mjs do.
  const identities = {};
  const allIndices = [...new Set([...EVM_FUND_INDICES, TREASURY_INDEX])];
  for (const idx of allIndices) {
    identities[idx] = await fromMnemonicFull(mnemonic, { accountIndex: idx });
  }

  if (opts.chains.includes('evm'))
    await fundEvm({ evm: config.evm, identities, dryRun: opts.dryRun });
  if (opts.chains.includes('solana'))
    await fundSolana({
      solana: config.solana,
      identities,
      dryRun: opts.dryRun,
    });
  if (opts.chains.includes('mina'))
    await fundMina({ mina: config.mina, identities, dryRun: opts.dryRun });

  console.log(
    `\n[fund-e2e-peers] ${opts.dryRun ? 'DRY-RUN complete (nothing broadcast)' : 'done'}.`
  );
}

await main();
