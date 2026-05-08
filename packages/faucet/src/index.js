import { readFileSync } from 'node:fs';

import express from 'express';
import cors from 'cors';
import { ethers } from 'ethers';

import { keypairFromJsonArray } from './spl-primitives.mjs';
import { solDrip } from './sol-drip.mjs';

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

// ERC20 ABI (minimal)
const ERC20_ABI = [
  'function transfer(address to, uint256 amount) returns (bool)',
  'function balanceOf(address account) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
];

// Rate limiting: address -> timestamp (shared across both chains; addresses
// are namespaced by chain prefix to avoid evm/solana cross-pollination).
const rateLimits = new Map();

// Middleware
app.use(cors());
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

// Check rate limit (chain-namespaced)
function checkRateLimit(chain, address) {
  const key = `${chain}:${address.toLowerCase()}`;
  const now = Date.now();
  const lastRequest = rateLimits.get(key);

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

// Update rate limit
function updateRateLimit(chain, address) {
  rateLimits.set(`${chain}:${address.toLowerCase()}`, Date.now());
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
function isValidSolanaAddress(address) {
  return typeof address === 'string' && SOLANA_PUBKEY_RE.test(address);
}

// ---------------------------------------------------------------------------
// EVM drip handler (extracted so /api/request and /api/evm/request share it)
// ---------------------------------------------------------------------------
async function handleEvmRequest(req, res) {
  try {
    const { address } = req.body;

    if (!address || !isValidEvmAddress(address)) {
      return res.status(400).json({
        error: 'Invalid Ethereum address',
      });
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

    const rateCheck = checkRateLimit('evm', address);
    if (!rateCheck.allowed) {
      return res.status(429).json({
        error: 'Rate limit exceeded',
        message: `Please wait ${rateCheck.waitMinutes} minutes before requesting again`,
        waitMinutes: rateCheck.waitMinutes,
      });
    }

    console.log(`💧 EVM faucet request for ${address}`);

    // Send ETH
    const ethTx = await ethWallet.sendTransaction({
      to: address,
      value: ethers.parseEther(ETH_AMOUNT),
    });
    console.log(`  📤 Sending ${ETH_AMOUNT} ETH: ${ethTx.hash}`);

    // Send tokens
    const tokenAmount = ethers.parseUnits(TOKEN_AMOUNT, tokenDecimals);
    const tokenTx = await tokenContract.transfer(address, tokenAmount);
    console.log(`  📤 Sending ${TOKEN_AMOUNT} ${tokenSymbol}: ${tokenTx.hash}`);

    // Wait for confirmations
    await ethTx.wait();
    await tokenTx.wait();

    updateRateLimit('evm', address);

    console.log(`  ✅ EVM faucet request completed for ${address}`);

    res.json({
      success: true,
      transactions: {
        eth: {
          hash: ethTx.hash,
          amount: ETH_AMOUNT,
        },
        token: {
          hash: tokenTx.hash,
          amount: TOKEN_AMOUNT,
          symbol: tokenSymbol,
        },
      },
    });
  } catch (error) {
    console.error('❌ EVM faucet request failed:', error);
    res.status(500).json({
      error: 'Faucet request failed',
      message: error.message,
    });
  }
}

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    tokenAddress: TOKEN_ADDRESS,
    tokenReady: !!tokenContract,
    solanaConfigured: !!SOLANA_RPC_URL,
    solanaAuthorityReady: !!solanaAuthority,
  });
});

// ---------------------------------------------------------------------------
// Get faucet info (EVM + Solana)
// ---------------------------------------------------------------------------
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
      faucetBalances: {
        eth: ethers.formatEther(ethBalance),
        token: tokenBalance,
      },
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

// ---------------------------------------------------------------------------
// EVM drip endpoints
//   POST /api/request      — legacy EVM endpoint (kept for backwards compat)
//   POST /api/evm/request  — explicit EVM alias
// ---------------------------------------------------------------------------
app.post('/api/request', handleEvmRequest);
app.post('/api/evm/request', handleEvmRequest);

// ---------------------------------------------------------------------------
// Solana drip endpoint
// ---------------------------------------------------------------------------
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
      typeof amount === 'number' && amount > 0 ? Math.floor(amount) : SOL_USDC_AMOUNT;

    const rateCheck = checkRateLimit('solana', recipient);
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

    updateRateLimit('solana', recipient);

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
    // MINT_NOT_FOUND is a soft-fail: SOL airdrop did succeed, only USDC was
    // skipped. Surface the airdrop sig so the operator gets the partial win.
    if (error.code === 'MINT_NOT_FOUND') {
      return res.status(502).json({
        error: 'mint not found',
        message: error.message,
        airdropSig: error.airdropSig,
      });
    }
    res.status(500).json({
      error: 'Faucet request failed',
      message: error.message,
    });
  }
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
  console.log(`   Rate limit:     ${RATE_LIMIT_HOURS} hour(s)`);
  console.log('═══════════════════════════════════════════════');
  console.log('');

  // Try to initialize EVM token contract.
  await initTokenContract();

  // Load Solana faucet authority (best-effort).
  solanaAuthority = loadSolanaAuthority();

  console.log('✅ Faucet is running!');
  console.log(`   UI: http://localhost:${PORT}`);
  console.log('');
});
