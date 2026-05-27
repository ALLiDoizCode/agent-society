import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import express from 'express';
import cors from 'cors';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { ethers } from 'ethers';

import { keypairFromJsonArray, deriveATA, getSplTokenBalance, makeRpc } from './spl-primitives.mjs';
import { solDrip } from './sol-drip.mjs';

// ---------------------------------------------------------------------------
// Schema validation (DN1, story 49.2 code review) — AC #1 requires runtime
// validation of /faucet/* request bodies against faucet.schema.json.
// ---------------------------------------------------------------------------
const __dirname = dirname(fileURLToPath(import.meta.url));
let validatePathRequest = null;
let validateUnifiedRequest = null;
try {
  // Try Docker image path first (contracts/ sits alongside src/ under /app),
  // then the monorepo sibling path for local development.
  const candidates = [
    resolve(__dirname, '../contracts/faucet.schema.json'),
    resolve(__dirname, '../../townhouse/contracts/faucet.schema.json'),
  ];
  const schemaPath = candidates.find((p) => { try { readFileSync(p); return true; } catch { return false; } });
  if (!schemaPath) throw new Error(`schema not found in: ${candidates.join(', ')}`);
  const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
  const ajv = new Ajv({ strict: false, allErrors: true });
  addFormats(ajv);
  ajv.addSchema(schema, 'faucet');
  validatePathRequest = ajv.getSchema('faucet#/definitions/FaucetPathRequest');
  validateUnifiedRequest = ajv.getSchema('faucet#/definitions/FaucetUnifiedRequest');
} catch (err) {
  console.error('⚠️  faucet.schema.json not found — request-body schema validation disabled:', err.message);
}

const app = express();
const PORT = process.env.PORT || 3500;

// ---------------------------------------------------------------------------
// EVM configuration (unchanged)
// ---------------------------------------------------------------------------
const RPC_URL = process.env.RPC_URL || 'http://anvil:8545';
const ETH_PRIVATE_KEY =
  process.env.ETH_PRIVATE_KEY ||
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'; // Anvil Account 1
const TOKEN_PRIVATE_KEY =
  process.env.TOKEN_PRIVATE_KEY ||
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'; // Anvil Account 0 (deployer)
const TOKEN_ADDRESS = process.env.TOKEN_ADDRESS;
const ETH_AMOUNT = process.env.ETH_AMOUNT || '100'; // 100 ETH
const TOKEN_AMOUNT = process.env.TOKEN_AMOUNT || '10000'; // 10,000 USDC
const RATE_LIMIT_HOURS = parseInt(process.env.RATE_LIMIT_HOURS || '1');

// Optional explorer URL bases — if set, the faucet inlines an explorerUrl in
// success responses (story 49.2 schema). Unset = explorerUrl omitted (still
// schema-valid; field is optional). The Akash dev lease URLs change per
// redeploy so the operator typically templates these at SDL render time.
const EVM_EXPLORER_URL_BASE = process.env.EVM_EXPLORER_URL_BASE || '';
const SOL_EXPLORER_URL_BASE = process.env.SOL_EXPLORER_URL_BASE || '';

// ---------------------------------------------------------------------------
// Solana configuration
// ---------------------------------------------------------------------------
// If SOLANA_RPC_URL is unset, the SOL endpoints return 503 ("not configured").
// USDC mint defaults to the Mock USDC pubkey baked into the bootstrap (see
// `infra/solana/bootstrap-usdc.mjs`); decimals are fixed at 6.
const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL || '';
const SOLANA_USDC_MINT =
  process.env.SOLANA_USDC_MINT ||
  '6GbdrVghwNKTz9raga7y3Y4qqX5Zgg3AC4d48Kt7C59Q';
const SOLANA_FAUCET_AUTHORITY_KEYPAIR_PATH =
  process.env.SOLANA_FAUCET_AUTHORITY_KEYPAIR_PATH ||
  '/etc/faucet/sol-authority.json';
const SOL_USDC_AMOUNT = parseInt(process.env.SOL_USDC_AMOUNT || '100');

// Recent-drips ring buffer (cap 100). Story 49.2 AC #4 — operator + dashboard
// poll GET /faucet/recent?limit=10 for an interleaved EVM+SOL feed.
const RECENT_DRIPS_MAX = 100;
const recentDrips = [];

// ERC20 ABI (minimal)
const ERC20_ABI = [
  'function transfer(address to, uint256 amount) returns (bool)',
  'function balanceOf(address account) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
];

// Legacy rate limit: address -> timestamp (shared across both chains;
// addresses are namespaced by chain prefix to avoid evm/solana cross-
// pollination). Applies to /api/* routes only — preserves the 1-hour cooldown
// behavior the old dashboard expects.
const legacyRateLimits = new Map();

// Story 49.2 AC #1 rate limits on the NEW /faucet/* routes:
//   • 1 req/sec per source address (token-bucket, in-memory)
//   • 5 req/min per source IP
// No daily cap (unlimited supply otherwise).
const ADDR_RATE_WINDOW_MS = 1000;
const IP_RATE_WINDOW_MS = 60_000;
const IP_RATE_MAX = 5;
const addrRateLimits = new Map(); // key=`${chain}:${address}` → last_ts_ms
const ipRateLimits = new Map(); // key=ip → number[] timestamps within window

// Prune stale rate-limit entries every 5 minutes to bound memory growth on
// long-running leases hit by many unique addresses (P12, code review).
setInterval(() => {
  const now = Date.now();
  for (const [k, ts] of addrRateLimits) {
    if (now - ts >= ADDR_RATE_WINDOW_MS) addrRateLimits.delete(k);
  }
  for (const [k, hits] of ipRateLimits) {
    if (hits.every((ts) => now - ts >= IP_RATE_WINDOW_MS)) ipRateLimits.delete(k);
  }
}, 5 * 60_000).unref();

// Middleware — explicit methods list so preflight reflects GET, POST, OPTIONS
// per AC #3, not just the mirrored request method.
app.use(cors({
  methods: ['GET', 'HEAD', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'content-type'],
}));
app.use(express.json());
app.use(express.static('public'));

// Setup EVM provider and wallets
const provider = new ethers.JsonRpcProvider(RPC_URL);
const ethWallet = new ethers.Wallet(ETH_PRIVATE_KEY, provider);
const tokenWallet = new ethers.Wallet(TOKEN_PRIVATE_KEY, provider);

// Token contract instance (will be set after deployment)
let tokenContract = null;
let tokenSymbol = 'USDC';
let tokenDecimals = 6;

// Solana faucet authority (loaded once at startup; null if unavailable).
let solanaAuthority = null;

// Initialize token contract
async function initTokenContract() {
  if (!TOKEN_ADDRESS) {
    console.log(
      '⚠️  TOKEN_ADDRESS not set. Waiting for contract deployment...'
    );
    return false;
  }

  try {
    tokenContract = new ethers.Contract(TOKEN_ADDRESS, ERC20_ABI, tokenWallet);
    tokenSymbol = await tokenContract.symbol();
    tokenDecimals = await tokenContract.decimals();
    console.log(
      `✅ Token contract initialized: ${tokenSymbol} at ${TOKEN_ADDRESS}`
    );
    return true;
  } catch (error) {
    console.error('❌ Failed to initialize token contract:', error.message);
    return false;
  }
}

// Load Solana faucet authority keypair from disk (JSON array format, same as
// solana-keygen). Returns null if the file is missing or malformed — the SOL
// airdrop still works without it; only the USDC drip is gated on this.
function loadSolanaAuthority() {
  if (!SOLANA_RPC_URL) return null;
  try {
    const arr = JSON.parse(
      readFileSync(SOLANA_FAUCET_AUTHORITY_KEYPAIR_PATH, 'utf8')
    );
    const kp = keypairFromJsonArray(arr);
    console.log(
      `✅ Solana faucet authority loaded: ${kp.pubkeyBase58} (from ${SOLANA_FAUCET_AUTHORITY_KEYPAIR_PATH})`
    );
    return kp;
  } catch (err) {
    console.error(
      `⚠️  Solana faucet authority unavailable (${SOLANA_FAUCET_AUTHORITY_KEYPAIR_PATH}): ${err.message}`
    );
    console.error('   USDC drip disabled; SOL airdrops will still work.');
    return null;
  }
}

// Legacy rate limit (per chain+address, 1-hour cooldown). Applies to /api/*.
function checkLegacyRateLimit(chain, address) {
  const key = `${chain}:${address.toLowerCase()}`;
  const now = Date.now();
  const lastRequest = legacyRateLimits.get(key);

  if (lastRequest) {
    const hoursSinceLastRequest = (now - lastRequest) / (1000 * 60 * 60);
    if (hoursSinceLastRequest < RATE_LIMIT_HOURS) {
      const waitMinutes = Math.ceil(
        RATE_LIMIT_HOURS * 60 - hoursSinceLastRequest * 60
      );
      return {
        allowed: false,
        waitMinutes,
      };
    }
  }

  return { allowed: true };
}

function updateLegacyRateLimit(chain, address) {
  legacyRateLimits.set(`${chain}:${address.toLowerCase()}`, Date.now());
}

// Story 49.2 rate limiter — separate from legacy, applied to /faucet/*.
function checkFaucetRateLimit(chain, address, ip) {
  const now = Date.now();

  // Per-address 1-req/sec. EVM addresses are case-insensitive (checksummed)
  // so normalise to lower for EVM only — Solana base58 is case-sensitive.
  const addrKey = `${chain}:${chain === 'evm' ? address.toLowerCase() : address}`;
  const lastAddrTs = addrRateLimits.get(addrKey);
  if (lastAddrTs && now - lastAddrTs < ADDR_RATE_WINDOW_MS) {
    const retryAfterMs = ADDR_RATE_WINDOW_MS - (now - lastAddrTs);
    return {
      allowed: false,
      scope: 'address',
      retryAfterSec: Math.max(1, Math.ceil(retryAfterMs / 1000)),
    };
  }

  // Per-IP 5/min sliding window.
  const ipHits = (ipRateLimits.get(ip) ?? []).filter(
    (ts) => now - ts < IP_RATE_WINDOW_MS
  );
  if (ipHits.length >= IP_RATE_MAX) {
    const oldest = ipHits[0];
    const retryAfterMs = IP_RATE_WINDOW_MS - (now - oldest);
    return {
      allowed: false,
      scope: 'ip',
      retryAfterSec: Math.max(1, Math.ceil(retryAfterMs / 1000)),
    };
  }

  return { allowed: true };
}

function recordFaucetHit(chain, address, ip) {
  const now = Date.now();
  addrRateLimits.set(`${chain}:${chain === 'evm' ? address.toLowerCase() : address}`, now);
  const hits = (ipRateLimits.get(ip) ?? []).filter(
    (ts) => now - ts < IP_RATE_WINDOW_MS
  );
  hits.push(now);
  ipRateLimits.set(ip, hits);
}

// Validate Ethereum address
function isValidEvmAddress(address) {
  try {
    return ethers.isAddress(address);
  } catch {
    return false;
  }
}

// Validate Solana base58 pubkey (length 32-44, no 0OIl).
const SOLANA_PUBKEY_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const EVM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
function isValidSolanaAddress(address) {
  return typeof address === 'string' && SOLANA_PUBKEY_RE.test(address);
}

// Display truncation for the recent-drips feed — first-6 + last-4 chars.
function truncateAddress(addr) {
  if (typeof addr !== 'string' || addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function pushRecentDrip({ chain, address, amount, txid }) {
  recentDrips.unshift({
    ts: new Date().toISOString(),
    address: truncateAddress(address),
    chain,
    amount,
    txid,
  });
  if (recentDrips.length > RECENT_DRIPS_MAX) {
    recentDrips.length = RECENT_DRIPS_MAX;
  }
}

function buildExplorerUrl(chain, tx) {
  if (chain === 'evm' && EVM_EXPLORER_URL_BASE) {
    return `${EVM_EXPLORER_URL_BASE.replace(/\/$/, '')}/tx/${tx}`;
  }
  if (chain === 'solana' && SOL_EXPLORER_URL_BASE) {
    return `${SOL_EXPLORER_URL_BASE.replace(/\/$/, '')}/tx/${tx}`;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Drip primitives — shared by legacy /api/* and new /faucet/* surfaces.
// ---------------------------------------------------------------------------

async function dripEvmCore(address, amountUsdc) {
  if (!tokenContract) {
    const initialized = await initTokenContract();
    if (!initialized) {
      const err = new Error(
        'Token contract not yet deployed; please wait for deployment to complete'
      );
      err.statusCode = 503;
      err.retryable = true;
      throw err;
    }
  }

  // Send ETH (fixed gas top-up — `amountUsdc` controls USDC only, native
  // top-up is constant per drip).
  const ethTx = await ethWallet.sendTransaction({
    to: address,
    value: ethers.parseEther(ETH_AMOUNT),
  });

  // Send tokens. Use caller-supplied amount when explicitly provided (including
  // zero); fall back to the env default. Falsy check would swallow amount=0.
  const tokenAmount = ethers.parseUnits(
    amountUsdc != null ? String(amountUsdc) : TOKEN_AMOUNT,
    tokenDecimals
  );
  const tokenTx = await tokenContract.transfer(address, tokenAmount);

  await ethTx.wait();
  await tokenTx.wait();

  let balanceAfter;
  try {
    const bal = await tokenContract.balanceOf(address);
    balanceAfter = ethers.formatUnits(bal, tokenDecimals);
  } catch {
    // Balance fetch is non-fatal — the tx already succeeded.
  }

  return {
    ethTxHash: ethTx.hash,
    tokenTxHash: tokenTx.hash,
    balanceAfter,
  };
}

async function dripSolCore(recipient, amountUsdc) {
  if (!SOLANA_RPC_URL) {
    const err = new Error(
      'SOLANA_RPC_URL is not set; the operator did not enable the Solana drip'
    );
    err.statusCode = 503;
    err.retryable = false;
    throw err;
  }

  const result = await solDrip({
    rpc: SOLANA_RPC_URL,
    recipient,
    usdcMint: SOLANA_USDC_MINT,
    faucetAuthorityKeypair: solanaAuthority,
    amount: amountUsdc ?? SOL_USDC_AMOUNT,
  });

  // Best-effort balance lookup (post-drip).
  let balanceAfter;
  if (solanaAuthority) {
    try {
      const splRpc = makeRpc(SOLANA_RPC_URL);
      const recipientAta = deriveATA(recipient, SOLANA_USDC_MINT);
      const raw = await getSplTokenBalance(splRpc, recipientAta);
      balanceAfter = (Number(raw) / 1_000_000).toString();
    } catch {
      // Non-fatal — drip already happened.
    }
  }

  return {
    airdropSig: result.airdropSig,
    usdcSig: result.usdcSig,
    balanceAfter,
  };
}

// ---------------------------------------------------------------------------
// Legacy /api/* surface — kept for backwards compat with the existing
// dashboards and shell scripts. Behavior preserved (1-hour cooldown).
// ---------------------------------------------------------------------------
async function handleEvmRequestLegacy(req, res) {
  try {
    const { address } = req.body;

    if (!address || !isValidEvmAddress(address)) {
      return res.status(400).json({ error: 'Invalid Ethereum address' });
    }

    if (!tokenContract) {
      const initialized = await initTokenContract();
      if (!initialized) {
        return res.status(503).json({
          error: 'Token contract not yet deployed',
          message: 'Please wait for contract deployment to complete',
        });
      }
    }

    const rateCheck = checkLegacyRateLimit('evm', address);
    if (!rateCheck.allowed) {
      return res.status(429).json({
        error: 'Rate limit exceeded',
        message: `Please wait ${rateCheck.waitMinutes} minutes before requesting again`,
        waitMinutes: rateCheck.waitMinutes,
      });
    }

    console.log(`💧 EVM faucet request for ${address}`);

    const ethTx = await ethWallet.sendTransaction({
      to: address,
      value: ethers.parseEther(ETH_AMOUNT),
    });
    console.log(`  📤 Sending ${ETH_AMOUNT} ETH: ${ethTx.hash}`);

    const tokenAmount = ethers.parseUnits(TOKEN_AMOUNT, tokenDecimals);
    const tokenTx = await tokenContract.transfer(address, tokenAmount);
    console.log(`  📤 Sending ${TOKEN_AMOUNT} ${tokenSymbol}: ${tokenTx.hash}`);

    await ethTx.wait();
    await tokenTx.wait();

    updateLegacyRateLimit('evm', address);

    console.log(`  ✅ EVM faucet request completed for ${address}`);

    res.json({
      success: true,
      transactions: {
        eth: { hash: ethTx.hash, amount: ETH_AMOUNT },
        token: {
          hash: tokenTx.hash,
          amount: TOKEN_AMOUNT,
          symbol: tokenSymbol,
        },
      },
    });
  } catch (error) {
    console.error('❌ EVM faucet request failed:', error);
    res
      .status(500)
      .json({ error: 'Faucet request failed', message: error.message });
  }
}

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    tokenAddress: TOKEN_ADDRESS,
    tokenReady: !!tokenContract,
    solanaConfigured: !!SOLANA_RPC_URL,
    solanaAuthorityReady: !!solanaAuthority,
    chainIds: {
      evm: parseInt(process.env.CHAIN_ID || '31337', 10),
      solana: process.env.SOLANA_CLUSTER || 'devnet',
    },
  });
});

app.get('/api/info', async (req, res) => {
  try {
    const ethBalance = await provider.getBalance(ethWallet.address);
    let tokenBalance = '0';

    if (tokenContract) {
      const balance = await tokenContract.balanceOf(tokenWallet.address);
      tokenBalance = ethers.formatUnits(balance, tokenDecimals);
    }

    res.json({
      ethAmount: ETH_AMOUNT,
      tokenAmount: TOKEN_AMOUNT,
      tokenSymbol,
      tokenAddress: TOKEN_ADDRESS,
      rateLimitHours: RATE_LIMIT_HOURS,
      faucetBalances: { eth: ethers.formatEther(ethBalance), token: tokenBalance },
      ready: !!tokenContract,
      solana: {
        rpcUrl: SOLANA_RPC_URL || null,
        usdcMint: SOLANA_USDC_MINT,
        faucetAuthority: solanaAuthority?.pubkeyBase58 ?? null,
        usdcAmount: SOL_USDC_AMOUNT,
        ready: !!SOLANA_RPC_URL,
      },
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to get faucet info',
      message: error.message,
    });
  }
});

app.post('/api/request', handleEvmRequestLegacy);
app.post('/api/evm/request', handleEvmRequestLegacy);

app.post('/api/sol/request', async (req, res) => {
  try {
    if (!SOLANA_RPC_URL) {
      return res.status(503).json({
        error: 'solana faucet not configured',
        message:
          'SOLANA_RPC_URL is not set; the operator did not enable the Solana drip.',
      });
    }

    const { recipient, amount } = req.body ?? {};

    if (!recipient || !isValidSolanaAddress(recipient)) {
      return res.status(400).json({
        error: 'Invalid Solana address',
        message: 'recipient must be a base58-encoded Solana pubkey',
      });
    }

    const usdcAmount =
      typeof amount === 'number' && amount > 0
        ? Math.floor(amount)
        : SOL_USDC_AMOUNT;

    const rateCheck = checkLegacyRateLimit('solana', recipient);
    if (!rateCheck.allowed) {
      return res.status(429).json({
        error: 'Rate limit exceeded',
        message: `Please wait ${rateCheck.waitMinutes} minutes before requesting again`,
        waitMinutes: rateCheck.waitMinutes,
      });
    }

    console.log(`💧 Solana faucet request for ${recipient} (${usdcAmount} USDC)`);

    const result = await solDrip({
      rpc: SOLANA_RPC_URL,
      recipient,
      usdcMint: SOLANA_USDC_MINT,
      faucetAuthorityKeypair: solanaAuthority,
      amount: usdcAmount,
    });

    updateLegacyRateLimit('solana', recipient);

    console.log(
      `  ✅ Solana faucet request completed for ${recipient} (airdrop=${result.airdropSig}${result.usdcSig ? ` usdc=${result.usdcSig}` : ' usdc=skipped'})`
    );

    res.json({
      success: true,
      airdropSig: result.airdropSig,
      usdcSig: result.usdcSig,
      recipient: result.recipient,
    });
  } catch (error) {
    console.error('❌ Solana faucet request failed:', error);
    if (error.code === 'MINT_NOT_FOUND') {
      return res.status(502).json({
        error: 'mint not found',
        message: error.message,
        airdropSig: error.airdropSig,
      });
    }
    res
      .status(500)
      .json({ error: 'Faucet request failed', message: error.message });
  }
});

// ---------------------------------------------------------------------------
// Story 49.2 — NEW /faucet/* surface
//
//   POST /faucet/evm           body: {address, amount?}
//   POST /faucet/sol           body: {address, amount?}
//   POST /faucet               body: {chain, recipient, amount?}
//   GET  /faucet/recent?limit=10
//
// Schema: packages/townhouse/contracts/faucet.schema.json (story 49.2 § DoD).
// Rate limit: 1 req/sec/address + 5/min/IP (story AC #1). Retry-After header
// is set on 429 responses so the UI can render a real countdown.
// ---------------------------------------------------------------------------

function clientIp(req) {
  return (
    req.headers['x-forwarded-for']?.toString().split(',')[0].trim() ||
    req.socket?.remoteAddress ||
    'unknown'
  );
}

async function handleFaucetUnified(chain, recipient, amount, req, res) {
  const ip = clientIp(req);

  // Schema validation (DN1, code review): validate the raw request body
  // against faucet.schema.json definitions before any drip logic. Gracefully
  // degrades to hand-rolled guards below when the schema file isn't present.
  const body = req.body ?? {};
  const validator = chain === 'evm' || chain === 'solana'
    ? (body.chain !== undefined ? validateUnifiedRequest : validatePathRequest)
    : null;
  if (validator && !validator(body)) {
    return res.status(400).json({
      error: 'request body does not match schema',
      details: validator.errors?.map((e) => `${e.instancePath} ${e.message}`.trim()),
    });
  }

  // Per-chain regex enforcement (matches schema + townhouse route).
  if (chain === 'evm' && !EVM_ADDRESS_RE.test(recipient)) {
    return res.status(400).json({
      error: 'recipient must be a 0x-prefixed 40-hex EVM address',
    });
  }
  if (chain === 'solana' && !SOLANA_PUBKEY_RE.test(recipient)) {
    return res.status(400).json({
      error: 'recipient must be a base58-encoded Solana pubkey',
    });
  }

  const rateCheck = checkFaucetRateLimit(chain, recipient, ip);
  if (!rateCheck.allowed) {
    res.setHeader('Retry-After', String(rateCheck.retryAfterSec));
    const waitMinutes = Math.max(1, Math.ceil(rateCheck.retryAfterSec / 60));
    return res.status(429).json({
      error: 'rate limit exceeded',
      waitMinutes,
    });
  }

  // Record the hit BEFORE the async drip, not after success — otherwise N
  // parallel requests all pass checkFaucetRateLimit synchronously (none
  // have recorded yet), bypassing the limit entirely. Hits count whether
  // the drip succeeds or fails, which is the correct DoS-resistant
  // behavior (a broken upstream chain must not allow rate-limit bypass).
  recordFaucetHit(chain, recipient, ip);

  try {
    if (chain === 'evm') {
      const { tokenTxHash, balanceAfter } = await dripEvmCore(recipient, amount);
      pushRecentDrip({
        chain,
        address: recipient,
        amount: amount ?? Number(TOKEN_AMOUNT),
        txid: tokenTxHash,
      });
      const response = {
        tx: tokenTxHash,
        chain,
        recipient,
      };
      if (balanceAfter !== undefined) response.balanceAfter = balanceAfter;
      const explorerUrl = buildExplorerUrl(chain, tokenTxHash);
      if (explorerUrl) response.explorerUrl = explorerUrl;
      return res.status(200).json(response);
    }

    // Solana path. Hit already recorded above (pre-drip).
    const { airdropSig, usdcSig, balanceAfter } = await dripSolCore(
      recipient,
      amount
    );
    const txid = usdcSig ?? airdropSig;
    pushRecentDrip({
      chain,
      address: recipient,
      amount: amount ?? SOL_USDC_AMOUNT,
      txid,
    });
    const response = {
      tx: txid,
      chain,
      recipient,
    };
    if (balanceAfter !== undefined) response.balanceAfter = balanceAfter;
    const explorerUrl = buildExplorerUrl(chain, txid);
    if (explorerUrl) response.explorerUrl = explorerUrl;
    return res.status(200).json(response);
  } catch (err) {
    const statusCode = err.statusCode ?? 502;
    console.error(`❌ /faucet drip failed [${chain}]:`, err);

    // Partial-success path: SOL airdrop succeeded but USDC failed
    // (mint missing). Surface the partial win.
    if (err.code === 'MINT_NOT_FOUND' && err.airdropSig) {
      return res.status(502).json({
        error: err.message,
        retryable: false,
        airdropSig: err.airdropSig,
      });
    }

    return res.status(statusCode).json({
      error: err.message ?? 'faucet drip failed',
      retryable: err.retryable !== false,
    });
  }
}

app.post('/faucet/evm', async (req, res) => {
  const { address, amount } = req.body ?? {};
  if (typeof address !== 'string') {
    return res.status(400).json({ error: 'address is required' });
  }
  return handleFaucetUnified(
    'evm',
    address,
    typeof amount === 'number' ? amount : undefined,
    req,
    res
  );
});

app.post('/faucet/sol', async (req, res) => {
  const { address, amount } = req.body ?? {};
  if (typeof address !== 'string') {
    return res.status(400).json({ error: 'address is required' });
  }
  return handleFaucetUnified(
    'solana',
    address,
    typeof amount === 'number' ? amount : undefined,
    req,
    res
  );
});

app.post('/faucet', async (req, res) => {
  const { chain, recipient, amount } = req.body ?? {};
  if (chain !== 'evm' && chain !== 'solana') {
    return res.status(400).json({ error: "chain must be 'evm' or 'solana'" });
  }
  if (typeof recipient !== 'string') {
    return res.status(400).json({ error: 'recipient is required' });
  }
  return handleFaucetUnified(
    chain,
    recipient,
    typeof amount === 'number' ? amount : undefined,
    req,
    res
  );
});

app.get('/faucet/recent', (req, res) => {
  const limitRaw = Number(req.query.limit ?? 10);
  const limit = Number.isFinite(limitRaw)
    ? Math.max(1, Math.min(RECENT_DRIPS_MAX, Math.floor(limitRaw)))
    : 10;
  res.status(200).json(recentDrips.slice(0, limit));
});

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------
app.listen(PORT, async () => {
  console.log('');
  console.log('═══════════════════════════════════════════════');
  console.log('   🚰 TOON Token Faucet (EVM + Solana)');
  console.log('═══════════════════════════════════════════════');
  console.log(`   Port:           ${PORT}`);
  console.log(`   EVM RPC:        ${RPC_URL}`);
  console.log(`   ETH per drip:   ${ETH_AMOUNT} ETH`);
  console.log(`   Token per drip: ${TOKEN_AMOUNT} ${tokenSymbol}`);
  console.log(`   Solana RPC:     ${SOLANA_RPC_URL || '(not configured)'}`);
  if (SOLANA_RPC_URL) {
    console.log(`   Solana mint:    ${SOLANA_USDC_MINT}`);
    console.log(`   USDC per drip:  ${SOL_USDC_AMOUNT} USDC + 1 SOL`);
  }
  console.log(`   Rate limit:     ${RATE_LIMIT_HOURS} hour(s) (legacy /api/*)`);
  console.log(`   Rate limit:     1/sec/address + 5/min/IP (/faucet/*)`);
  console.log('═══════════════════════════════════════════════');
  console.log('');

  await initTokenContract();
  solanaAuthority = loadSolanaAuthority();

  console.log('✅ Faucet is running!');
  console.log(`   UI: http://localhost:${PORT}`);
  console.log('');
});
