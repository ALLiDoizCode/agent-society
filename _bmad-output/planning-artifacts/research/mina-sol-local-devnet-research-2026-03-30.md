# Mina & Solana Local Devnet Research for Payment Channel Settlement

**Date:** 2026-03-30
**Purpose:** Evaluate local devnet/test validator options for TOON Protocol payment channel settlement E2E testing
**Context:** Settlement system needs to deploy smart contracts (zkApps on Mina, programs on Solana) and run E2E tests locally, integrating with the existing `docker-compose-sdk-e2e.yml` infrastructure pattern (Anvil for EVM).

---

## Table of Contents

1. [Mina Protocol Local Devnet Options](#1-mina-protocol-local-devnet-options)
2. [Solana Local Devnet Options](#2-solana-local-devnet-options)
3. [Comparison Tables](#3-comparison-tables)
4. [Recommendations](#4-recommendations)
5. [Docker Integration Strategy](#5-docker-integration-strategy)
6. [Contract/Program Deployment Steps](#6-contractprogram-deployment-steps)
7. [Wallet Funding Approach](#7-wallet-funding-approach)
8. [Gotchas and Known Issues](#8-gotchas-and-known-issues)

---

## 1. Mina Protocol Local Devnet Options

### 1.1 Mina.LocalBlockchain() — o1js In-Memory Mock

**What it is:** An in-process mock Mina ledger provided by o1js. No Docker, no daemon, no network -- pure TypeScript/JS running in your test process.

**How it works:**

```typescript
const Local = await Mina.LocalBlockchain({ proofsEnabled: false });
Mina.setActiveInstance(Local);
const feePayer = Local.testAccounts[0].key;
```

**Capabilities:**
- 10 pre-funded test accounts available immediately
- zkApp deployment via `Mina.transaction()` + `zkApp.deploy()`
- `proofsEnabled: false` skips ZK proof generation (fast CI mode)
- `proofsEnabled: true` generates and verifies real proofs (slow, 30-120s per proof)
- `setProofsEnabled(x)` for dynamic toggling
- Jest integration out of the box (zkapp-cli scaffolds Jest tests)

**Strengths:**
- Zero infrastructure -- runs in-process, instant startup
- Perfect for unit and integration tests of zkApp logic
- No Docker, no ports, no external processes
- Fastest possible feedback loop with `proofsEnabled: false`
- Deterministic execution -- no consensus, no block timing variance

**Weaknesses:**
- Not a real blockchain -- no consensus, no block production, no networking
- No GraphQL API, no archive node, no event fetching via `Mina.fetchEvents()`
- Cannot test deployment workflows or transaction lifecycle
- Does not exercise the Mina daemon or wire protocol
- Mock ledger may diverge from real network behavior on edge cases

**Resource requirements:** ~200-500 MB RAM (Node.js process), negligible CPU without proofs
**Setup complexity:** Trivial (just `import { Mina } from 'o1js'`)
**Community adoption:** Very high -- this is the standard unit test approach for all zkApps

---

### 1.2 Lightnet (mina-local-network Docker) — Official Local Network

**What it is:** A single Docker container running a real Mina daemon (and optionally archive node + PostgreSQL) with a pre-funded genesis ledger. Official tooling from o1Labs.

**Docker image:** `o1labs/mina-local-network`
**Repository:** [o1-labs/mina-lightnet-docker](https://github.com/o1-labs/mina-lightnet-docker) (last updated Feb 2026)

**Startup:**

```bash
# Via zkapp-cli (recommended)
zk lightnet start

# Via Docker directly
docker run --rm -it \
  --env NETWORK_TYPE="single-node" \
  --env PROOF_LEVEL="none" \
  -p 3085:3085 -p 5432:5432 -p 8080:8080 -p 8181:8181 -p 8282:8282 \
  o1labs/mina-local-network:compatible-latest-lightnet
```

**Environment Variables:**

| Variable | Default | Purpose |
|---|---|---|
| `NETWORK_TYPE` | `single-node` | `single-node` or `multi-node` |
| `PROOF_LEVEL` | `full` | `full` or `none` (use `none` for speed) |
| `LOG_LEVEL` | `Trace` | `Trace`, `Debug`, `Info`, `Warn`, `Error` |
| `RUN_ARCHIVE_NODE` | `true` | Enable archive node + PostgreSQL |
| `SLOT_TIME` | `20000` | Block slot duration in milliseconds |

**Ports (single-node):**

| Port | Service |
|---|---|
| 3085 | Mina Daemon GraphQL |
| 5432 | PostgreSQL (archive) |
| 8080 | NGINX reverse proxy (recommended endpoint) |
| 8181 | Mina Accounts Manager |
| 8282 | Archive-Node-API |

**Key specs:**
- **Genesis ledger:** 1,000+ pre-funded accounts, 1,550 MINA each
- **Block time:** ~20-40 seconds
- **Transaction finality (k):** 30 blocks
- **Startup time:** ~1-2 minutes (single-node)
- **RAM (single-node, PROOF_LEVEL=none):** ~850-970 MB
- **RAM (multi-node):** ~5.5-6+ GB
- **Architecture:** amd64 and arm64 supported

**Account Manager API (port 8181):**

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/acquire-account` | Get a pre-funded keypair |
| PUT | `/release-account` | Return keypair to pool |
| GET | `/list-acquired-accounts` | List acquired accounts |

**o1js connection:**
```typescript
const network = Mina.Network('http://127.0.0.1:8080/graphql');
Mina.setActiveInstance(network);
```

**Strengths:**
- Real Mina daemon -- tests actual deployment, consensus, and transaction lifecycle
- Pre-funded accounts with convenient REST API for account management
- Configurable block time and proof level
- Archive node available for event fetching
- Docker-native, CI/CD friendly (GitHub Actions service container support)
- Actively maintained, tested as part of Mesa upgrade pipeline

**Weaknesses:**
- ~1 GB RAM minimum (heavier than Anvil's ~50 MB)
- 20-40 second block times make E2E tests slow (vs. instant Anvil blocks)
- Image is large (~2-3 GB compressed)
- No `PROOF_LEVEL=none` equivalent for faster-than-real block production
- Single-node mode doesn't test network partition or multi-node consensus

**Community adoption:** High -- official recommended approach for integration testing before devnet

---

### 1.3 Mina Devnet — Remote Public Testnet

**What it is:** Public test network operated by the Mina Foundation. Real nodes, real consensus, real block times (~3 min).

**Status (March 2026):** Active, currently running pre-Mesa software. Mesa devnet upgrade scheduled after Trailblazers program completes.

**Strengths:**
- Most realistic testing environment
- Free tMINA from faucet
- Tests real network conditions

**Weaknesses:**
- **Not local** -- requires internet, subject to network issues
- ~3 minute block times make E2E iteration extremely slow
- Cannot reset state between test runs
- Shared environment -- other users' activity affects state
- Not suitable for CI/CD pipelines

**Community adoption:** Moderate -- used for final pre-mainnet validation, not for development iteration

---

### 1.4 Mina Sandbox (RUN_DEMO=true) — Legacy

**What it is:** Built-in demo mode in the standard Mina daemon Docker container, activated via `RUN_DEMO=true` environment variable.

**Status:** Effectively superseded by Lightnet. The Lightnet Docker images are purpose-built for development testing and provide a much better experience. The sandbox approach is undocumented in current Mina docs and appears unmaintained.

**Recommendation:** Do not use. Use Lightnet instead.

---

### 1.5 zkApp Testing Patterns — How Teams Actually Test

Based on community patterns and official examples (e.g., Mastermind zkApp series):

1. **Unit tests:** `Mina.LocalBlockchain({ proofsEnabled: false })` -- fast, in-process, covers zkApp logic
2. **Integration tests:** `Mina.LocalBlockchain({ proofsEnabled: true })` -- verifies proof generation works (slow, ~30-120s per proof)
3. **E2E tests:** Lightnet Docker -- tests deployment, transactions, event fetching against real daemon
4. **Pre-launch validation:** Devnet -- final check before mainnet

The standard flow is: LocalBlockchain (fast iteration) -> Lightnet (integration) -> Devnet (validation).

---

## 2. Solana Local Devnet Options

### 2.1 solana-test-validator — Official Local Validator

**What it is:** A full-featured, single-node Solana cluster that runs locally. Ships with the Solana CLI. The reference tool for local Solana development.

**Startup:**
```bash
solana-test-validator
# With programs pre-loaded:
solana-test-validator --bpf-program <PROGRAM_ID> <PROGRAM.so> --reset
# Clone accounts from mainnet:
solana-test-validator --clone <ACCOUNT> --url mainnet-beta
```

**Ports:**

| Port | Service |
|---|---|
| 8899 | JSON-RPC |
| 8900 | WebSocket (PubSub) |
| 9900 | Faucet |
| 1024 | Gossip |

**Key specs:**
- **Slot time:** ~400ms (default)
- **Startup time:** 2-5 seconds
- **RAM:** ~500 MB - 1 GB
- **Airdrop:** `solana airdrop 100` (unlimited SOL locally)
- **Program deployment:** `solana program deploy <PROGRAM.so>` or `--bpf-program` at genesis
- **Account cloning:** `--clone <PUBKEY> --url <CLUSTER>` copies live state locally
- **Reset:** `--reset` flag clears ledger on startup

**Docker availability:**
- Official image: `solanalabs/solana` (1M+ pulls on Docker Hub)
- Community image: `tchambard/solana-test-validator` with docker-compose support
- Health check: `curl -f http://localhost:8899/health`

**Strengths:**
- Official, battle-tested, ships with Solana CLI
- Full RPC API -- identical to devnet/mainnet
- Account cloning from live clusters
- Program deployment at genesis via `--bpf-program`
- SPL token creation via `spl-token create-token`
- Fast slot time (~400ms)
- Docker images available
- Huge community adoption

**Weaknesses:**
- External process -- slower test startup than in-process alternatives
- ~500 MB - 1 GB RAM
- Occasional deadlock issues reported (GitHub issue #30557)
- Not as fast as in-process alternatives for pure unit testing
- Logs can be noisy

**Community adoption:** Very high -- the standard local development tool for Solana

---

### 2.2 LiteSVM — In-Process Solana VM (Recommended for Fast Tests)

**What it is:** A fast, lightweight, in-process Solana VM for testing. Successor to solana-bankrun. Runs the SBF runtime directly in your test process -- no external validator needed.

**Repository:** [LiteSVM/litesvm](https://github.com/LiteSVM/litesvm) -- 585 stars, latest release v0.11.0 (March 2026)
**npm package:** `litesvm` (TypeScript/JS bindings)

**Installation (TypeScript):**
```bash
pnpm add -D @solana/kit @solana/kit-client-litesvm @solana-program/system
```

**Usage (TypeScript):**
```typescript
import { createClient } from '@solana/kit-client-litesvm';
import { generateKeyPairSigner, lamports } from '@solana/kit';

const client = await createClient(); // auto-funded payer
client.svm.airdrop(client.payer.address, lamports(2_000_000_000n));

// Deploy program, send transactions, check state...
```

**Usage (Rust):**
```rust
use litesvm::LiteSvm;
let mut svm = LiteSvm::new();
svm.airdrop(&payer.pubkey(), 10_000_000_000).unwrap();
```

**Key specs:**
- **Startup:** Instant (in-process)
- **Languages:** Rust (primary), TypeScript/JS, Python
- **Performance:** Claims 25x faster than traditional Anchor TypeScript tests
- **RAM:** Minimal (~100-200 MB, in-process)
- **SPL token support:** Via `litesvm-token` crate (Rust) or program plugin (TS)
- **Time travel:** Can warp slots/time forward and backward
- **Account manipulation:** Direct `set_account()` / `setAccount()` for arbitrary state

**Anchor integration:**
```typescript
// LiteSVM is now the recommended test runner for Anchor
import { fromWorkspace } from '@solana/kit-client-litesvm';
const client = await fromWorkspace('./').withSplPrograms().withBuiltins().withSysvars();
```

**Strengths:**
- Fastest option -- no external process, no network overhead
- Active development (v0.11.0, March 2026)
- First-class TypeScript support via `@solana/kit-client-litesvm`
- Time travel and direct state manipulation
- Anchor integration
- Replaces deprecated bankrun
- Deterministic execution

**Weaknesses:**
- Not a full validator -- no RPC API, no WebSocket subscriptions
- Cannot test RPC-dependent code paths
- Relatively new TypeScript bindings (API still evolving)
- No Docker (runs in-process by design)
- Cannot clone accounts from live clusters (must set up manually)

**Community adoption:** Growing rapidly -- official Anchor recommendation, replacing bankrun

---

### 2.3 Bankrun (solana-bankrun) — DEPRECATED

**What it is:** A lightweight BanksServer/BanksClient test framework for Node.js. Built on top of `solana-program-test`.

**Status:** **Deprecated as of 2025.** Users should migrate to LiteSVM.

**npm package:** `solana-bankrun`
**Repository:** [kevinheavey/solana-bankrun](https://github.com/kevinheavey/solana-bankrun)

**Why it was deprecated:**
- Inherited complexity from `solana-program-test`
- LiteSVM provides a cleaner, faster alternative
- Concurrent test issues (required `--runInBand` in Jest)

**Recommendation:** Do not use for new projects. Migrate to LiteSVM.

---

### 2.4 solana-program-test — Rust In-Process BPF Testing

**What it is:** The official Rust crate for in-process BPF program testing. Provides a `BanksClient` connected to a `ProgramTest` environment.

**Usage:**
```rust
use solana_program_test::*;
let mut test = ProgramTest::new("my_program", program_id, processor!(entry));
let (mut banks_client, payer, recent_blockhash) = test.start().await;
```

**Key specs:**
- Rust-only (no TypeScript/JS bindings)
- Runs BPF programs in-process
- Foundation for bankrun and LiteSVM

**Strengths:**
- Official Solana SDK crate
- Full BPF runtime
- Well-documented

**Weaknesses:**
- Rust-only -- no TypeScript/JS support
- Slower compilation than LiteSVM
- More verbose API
- Being superseded by LiteSVM for most use cases

**Community adoption:** High in Rust ecosystem, but declining as LiteSVM gains traction

---

### 2.5 Amman — Metaplex Validator Wrapper

**What it is:** A `solana-test-validator` wrapper from Metaplex that adds convenience features (address labels, transaction logs, account snapshots).

**Repository:** [metaplex-foundation/amman](https://github.com/metaplex-foundation/amman)
**Status:** Low activity. The parent `js-next` repo was archived March 2025. Amman standalone repo still exists but updates are sparse.

**Strengths:**
- Nice developer UX (labels, explorer)
- Account snapshot/restore

**Weaknesses:**
- Maintenance concerns (Metaplex focus shifted to Umi/Kinobi)
- Wraps solana-test-validator (same resource requirements)
- Niche adoption -- most teams use solana-test-validator directly

**Recommendation:** Do not adopt for new projects. Use solana-test-validator directly or LiteSVM.

---

### 2.6 Surfpool — New Solana Foundation Tool

**What it is:** A drop-in replacement for `solana-test-validator` from the Solana Foundation that automatically clones mainnet programs/accounts on demand.

**Repository:** [solana-foundation/surfpool](https://github.com/solana-foundation/surfpool)
**Status:** Active development, joined Solana Foundation in 2025.

**Startup:**
```bash
surfpool start
# Surfpool Studio UI at http://127.0.0.1:18488
```

**Key features:**
- Automatic mainnet account/program cloning (just-in-time)
- Infrastructure as Code for reproducible deployments
- Built-in web UI (Surfpool Studio)
- MCP integration for AI tooling

**Strengths:**
- Zero-config mainnet forking
- Solana Foundation backed
- Modern DX

**Weaknesses:**
- Newer tool, smaller community than solana-test-validator
- Docker support unclear
- Still wraps a local validator (similar resource requirements)

**Community adoption:** Growing, especially for Anchor projects. Worth monitoring.

---

### 2.7 Anchor localnet — Framework Integration

**What it is:** Not a separate tool -- Anchor's CLI wraps `solana-test-validator` with convenience commands.

**Commands:**
```bash
anchor test           # Start validator, deploy, run tests, stop
anchor localnet       # Start validator + deploy, keep running
anchor localnet --skip-build  # Reuse existing build
```

**Configuration (Anchor.toml):**
```toml
[programs.localnet]
my_program = "PROGRAM_ID"
```

**How it works:** Anchor starts `solana-test-validator` with `--bpf-program` flags for all workspace programs, runs tests, then tears down the validator.

**Strengths:**
- Seamless for Anchor projects
- Automatic program deployment
- Configurable via Anchor.toml

**Weaknesses:**
- Anchor-specific (requires Anchor framework)
- Same resource requirements as solana-test-validator

**Relevance:** If TOON uses Anchor for Solana programs, this is the natural integration. If using raw Solana SDK or Pinocchio, use solana-test-validator directly.

---

## 3. Comparison Tables

### 3.1 Mina Options

| Criteria | LocalBlockchain | Lightnet (Docker) | Devnet (Remote) | Sandbox (Legacy) |
|---|---|---|---|---|
| **Setup complexity** | Trivial | Moderate | Moderate | N/A (deprecated) |
| **Docker compatible** | N/A (in-process) | Yes (purpose-built) | N/A (remote) | N/A |
| **zkApp deployment** | Yes | Yes | Yes | N/A |
| **Wallet funding** | 10 pre-funded | 1000+ pre-funded | Faucet | N/A |
| **Block time** | Instant | 20-40s | ~3 min | N/A |
| **Finality** | Instant | 30 blocks (~10-20 min) | 30 blocks (~90 min) | N/A |
| **RAM** | ~200-500 MB | ~850-970 MB | N/A (remote) | N/A |
| **Proof generation** | Optional | Optional | Always | N/A |
| **Real daemon** | No | Yes | Yes | Partial |
| **Archive node** | No | Optional | Yes | No |
| **GraphQL API** | No | Yes | Yes | No |
| **Stability** | Excellent | Good | Good | Unmaintained |
| **CI/CD suitability** | Excellent | Good | Poor | N/A |
| **Community adoption** | Very high | High | Moderate | None |

### 3.2 Solana Options

| Criteria | solana-test-validator | LiteSVM | Bankrun | solana-program-test | Amman | Surfpool |
|---|---|---|---|---|---|---|
| **Setup complexity** | Low | Low | Low | Moderate | Moderate | Low |
| **Docker compatible** | Yes | N/A (in-process) | N/A | N/A | Yes | Unclear |
| **Program deployment** | Yes | Yes | Yes | Yes | Yes | Yes |
| **SPL token support** | Full | Yes | Yes | Yes | Yes | Yes |
| **Wallet funding** | Airdrop (unlimited) | Airdrop API | Auto-funded | Auto-funded | Airdrop | UI faucet |
| **Slot time** | ~400ms | Instant | Instant | Instant | ~400ms | ~400ms |
| **RAM** | ~500 MB - 1 GB | ~100-200 MB | ~200-400 MB | ~200-400 MB | ~500 MB - 1 GB | ~500 MB - 1 GB |
| **RPC API** | Full | No | No | No | Full | Full |
| **TypeScript support** | Via RPC client | Yes (`@solana/kit`) | Yes | No (Rust only) | Yes | Yes |
| **Account cloning** | Yes (from clusters) | Manual only | Manual only | Manual only | Yes | Auto (mainnet) |
| **Time travel** | Limited | Yes | Yes | Yes | No | No |
| **Maintenance** | Active | Active (v0.11.0) | **Deprecated** | Active | Low | Active |
| **Community adoption** | Very high | Growing fast | Declining | Moderate | Low | Growing |

---

## 4. Recommendations

### 4.1 Mina: Two-Tier Strategy

**For unit/integration tests (fast, CI-friendly):**
- **Use `Mina.LocalBlockchain({ proofsEnabled: false })`**
- Instant, zero infrastructure, deterministic
- Test zkApp contract logic, state transitions, proof circuit correctness
- Run in standard `pnpm test` alongside existing Vitest suite

**For E2E tests (Docker, real daemon):**
- **Use Lightnet (`o1labs/mina-local-network:compatible-latest-lightnet`)**
- Real Mina daemon, real GraphQL API, real transaction lifecycle
- Integrates into `docker-compose-sdk-e2e.yml` alongside Anvil
- Use `PROOF_LEVEL=none` for speed, `SLOT_TIME=20000` (minimum)

**Justification:**
- LocalBlockchain is the community standard for fast tests
- Lightnet is the only viable Docker option for E2E -- actively maintained, well-documented, Mesa-tested
- Devnet is too slow and unreliable for CI/CD
- Sandbox/RUN_DEMO is dead

### 4.2 Solana: Two-Tier Strategy

**For unit/integration tests (fast, CI-friendly):**
- **Use LiteSVM (`@solana/kit-client-litesvm`)**
- In-process, 25x faster than validator-based tests
- TypeScript-native, Anchor-compatible
- Run in standard `pnpm test` alongside existing Vitest suite

**For E2E tests (Docker, full RPC):**
- **Use `solana-test-validator` via Docker**
- Full RPC API, identical to devnet/mainnet
- Docker images available (`solanalabs/solana`)
- Integrates into `docker-compose-sdk-e2e.yml` alongside Anvil
- Health check: `curl -f http://localhost:8899/health`

**Justification:**
- LiteSVM is the modern standard (replaces deprecated bankrun), actively developed, Anchor-endorsed
- solana-test-validator is battle-tested and provides the full RPC API needed for E2E
- Bankrun is deprecated
- Amman is low-maintenance
- Surfpool is promising but too new for critical infrastructure

---

## 5. Docker Integration Strategy

### 5.1 Proposed docker-compose-sdk-e2e.yml Additions

```yaml
services:
  # Existing Anvil service unchanged...
  anvil:
    # ...

  # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  # Mina Lightnet — Local Mina network for zkApp settlement
  # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  mina:
    image: o1labs/mina-local-network:compatible-latest-lightnet
    container_name: sdk-e2e-mina
    environment:
      NETWORK_TYPE: single-node
      PROOF_LEVEL: none
      LOG_LEVEL: Info
      RUN_ARCHIVE_NODE: "false"    # Disable to save RAM (~200 MB)
      SLOT_TIME: "20000"           # 20s blocks (minimum)
    ports:
      - "19085:3085"    # Mina Daemon GraphQL
      - "19080:8080"    # NGINX reverse proxy
      - "19181:8181"    # Accounts Manager
    healthcheck:
      test: >
        curl -sf -X POST http://localhost:8080/graphql
        -H 'Content-Type: application/json'
        -d '{"query":"{ syncStatus }"}'
        | grep -q 'SYNCED'
      interval: 10s
      timeout: 5s
      retries: 30
      start_period: 120s  # Lightnet needs ~1-2 min to sync
    networks:
      - toon-sdk-e2e

  # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  # Solana Test Validator — Local Solana cluster for program settlement
  # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  solana:
    image: solanalabs/solana:v2.2.14
    container_name: sdk-e2e-solana
    entrypoint: []
    command:
      - sh
      - -c
      - |
        solana-test-validator \
          --reset \
          --rpc-port 8899 \
          --bind-address 0.0.0.0 \
          --faucet-port 9900 \
          --slots-per-epoch 150 \
          --log
    ports:
      - "19899:8899"    # JSON-RPC
      - "19900:8900"    # WebSocket
      - "19901:9900"    # Faucet
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8899/health"]
      interval: 5s
      timeout: 3s
      retries: 10
      start_period: 10s
    networks:
      - toon-sdk-e2e
```

### 5.2 Port Allocation (Extending Existing Scheme)

| Service | Host Port | Container Port | Purpose |
|---|---|---|---|
| Anvil | 18545 | 8545 | EVM JSON-RPC (existing) |
| Mina GraphQL | 19085 | 3085 | Mina daemon GraphQL |
| Mina Proxy | 19080 | 8080 | NGINX reverse proxy |
| Mina Accounts | 19181 | 8181 | Account manager API |
| Solana RPC | 19899 | 8899 | JSON-RPC |
| Solana WS | 19900 | 8900 | WebSocket PubSub |
| Solana Faucet | 19901 | 9900 | SOL airdrop |

### 5.3 Resource Budget

| Service | RAM (est.) | CPU (est.) | Startup |
|---|---|---|---|
| Anvil | ~50 MB | Minimal | ~2s |
| Mina Lightnet | ~850 MB | 1 core | ~90s |
| Solana Validator | ~500 MB | 1 core | ~5s |
| **Total** | **~1.4 GB** | **2+ cores** | **~90s** (Mina dominates) |

Note: Mina Lightnet is the bottleneck for both RAM and startup time. With archive node disabled (`RUN_ARCHIVE_NODE=false`), RAM drops by ~200 MB.

---

## 6. Contract/Program Deployment Steps

### 6.1 Mina zkApp Deployment (to Lightnet)

```typescript
import { Mina, PrivateKey, AccountUpdate } from 'o1js';
import { SettlementContract } from './settlement-contract.js';

// Connect to Lightnet
const network = Mina.Network('http://localhost:19080/graphql');
Mina.setActiveInstance(network);

// Acquire a pre-funded account from Lightnet
const response = await fetch('http://localhost:19181/acquire-account');
const { pk, sk } = await response.json();
const deployerKey = PrivateKey.fromBase58(sk);

// Deploy zkApp
const zkAppKey = PrivateKey.random();
const zkApp = new SettlementContract(zkAppKey.toPublicKey());

const txn = await Mina.transaction(deployerKey.toPublicKey(), async () => {
  AccountUpdate.fundNewAccount(deployerKey.toPublicKey());
  await zkApp.deploy();
});
await txn.prove();
await txn.sign([deployerKey, zkAppKey]).send();
```

### 6.2 Mina zkApp Testing (LocalBlockchain, fast)

```typescript
import { Mina, PrivateKey, AccountUpdate } from 'o1js';
import { SettlementContract } from './settlement-contract.js';

const Local = await Mina.LocalBlockchain({ proofsEnabled: false });
Mina.setActiveInstance(Local);

const deployer = Local.testAccounts[0];
const zkAppKey = PrivateKey.random();
const zkApp = new SettlementContract(zkAppKey.toPublicKey());

const txn = await Mina.transaction(deployer, async () => {
  AccountUpdate.fundNewAccount(deployer);
  await zkApp.deploy();
});
await txn.sign([deployer.key, zkAppKey]).send();
```

### 6.3 Solana Program Deployment (to test-validator)

```bash
# Option A: Deploy at genesis (in docker-compose command)
solana-test-validator \
  --bpf-program <PROGRAM_ID> /programs/settlement.so \
  --reset

# Option B: Deploy after startup
solana config set --url http://localhost:19899
solana program deploy target/deploy/settlement.so

# Option C: From TypeScript tests
import { Connection, Keypair } from '@solana/web3.js';
const connection = new Connection('http://localhost:19899');
// ... deploy via BPF loader
```

### 6.4 Solana Program Testing (LiteSVM, fast)

```typescript
import { createClient } from '@solana/kit-client-litesvm';
import { lamports } from '@solana/kit';

const client = await createClient();
// Load program binary
const programBytes = fs.readFileSync('./target/deploy/settlement.so');
client.svm.addProgram(programId, programBytes);

// Fund accounts and test
client.svm.airdrop(client.payer.address, lamports(10_000_000_000n));
// ... send transactions, verify state
```

---

## 7. Wallet Funding Approach

### 7.1 Mina Wallet Funding

**LocalBlockchain:**
- 10 pre-funded test accounts available at `Local.testAccounts[0..9]`
- Each has sufficient MINA for dozens of transactions

**Lightnet:**
- 1,000+ pre-funded accounts (1,550 MINA each) via Accounts Manager API
- `GET http://localhost:19181/acquire-account` returns `{ pk, sk }` keypair
- `PUT http://localhost:19181/release-account` returns keypair to pool
- No faucet needed -- genesis ledger provides ample funds

### 7.2 Solana Wallet Funding

**solana-test-validator:**
```bash
solana airdrop 100 <PUBKEY> --url http://localhost:19899
# Unlimited SOL available locally
```

**LiteSVM:**
```typescript
client.svm.airdrop(publicKey, lamports(10_000_000_000n)); // 10 SOL
// Or set account directly:
client.svm.setAccount(publicKey, {
  lamports: 100_000_000_000n, // 100 SOL
  data: Buffer.alloc(0),
  owner: SystemProgram.programId,
  executable: false,
});
```

**SPL Token Creation (solana-test-validator):**
```bash
spl-token create-token                    # Create mint
spl-token create-account <MINT>           # Create token account
spl-token mint <MINT> 1000000 <ACCOUNT>   # Mint tokens
```

---

## 8. Gotchas and Known Issues

### 8.1 Mina Gotchas

1. **Lightnet startup is slow (~90s).** The `start_period` in healthcheck must be generous. Tests should wait for `syncStatus: SYNCED` before proceeding.

2. **Block time is 20-40 seconds minimum.** Unlike Anvil (instant) or Solana (~400ms), Mina transactions take real time to confirm. E2E tests will be inherently slower.

3. **Finality requires 30 blocks.** On Lightnet with 20s slots, that's ~10-20 minutes. For E2E tests, use transaction inclusion (1 block) rather than waiting for finality.

4. **PROOF_LEVEL=none is essential for CI.** With `full` proofs, each transaction takes 30-120 seconds to prove. Always use `none` in CI/E2E.

5. **Lightnet Docker image is large (~2-3 GB).** First pull is slow. Use `--pull=missing` (not `always`) in CI to cache.

6. **arm64 support exists** but may have different performance characteristics. Test on CI target architecture.

7. **Avoid the actions/reducer API** -- it carries a "not safe to use in production" warning and has a 32-pending-action hard limit (from prior o1js research).

8. **On-chain state limited to 8 Fields** (256 bytes) pre-Mesa, 32 Fields post-Mesa. Design settlement contracts accordingly.

9. **Off-chain Merkle storage is developer responsibility.** IndexedMerkleMap stores only the root on-chain.

### 8.2 Solana Gotchas

1. **solana-test-validator occasional deadlocks.** Known issue (GitHub #30557). Mitigate with `--reset` flag and health checks.

2. **LiteSVM TypeScript API is evolving.** The `@solana/kit-client-litesvm` package may have breaking changes. Pin versions.

3. **LiteSVM has no RPC API.** If your code uses `Connection` from `@solana/web3.js` to talk to a validator, those code paths cannot be tested with LiteSVM. Use solana-test-validator for RPC-dependent E2E tests.

4. **Bankrun is deprecated.** Do not use `solana-bankrun` for new projects. Migrate to LiteSVM.

5. **Docker solana-test-validator needs `--bind-address 0.0.0.0`.** By default it binds to localhost, which is unreachable from outside the container.

6. **SPL token programs are not loaded by default** in solana-test-validator. Use `--clone` to copy them from a cluster, or use Surfpool which auto-clones.

7. **LiteSVM concurrent tests are safe** (unlike bankrun which required `--runInBand`).

8. **Solana program compilation requires Rust toolchain + `cargo build-sbf`.** The Solana CLI must be installed with the BPF SDK. LiteSVM requires Solana CLI >= 1.18.8 for building test programs.

9. **solanalabs/solana Docker image versions** -- verify the tag matches the Solana CLI version you're developing against. Use a specific version tag (e.g., `v2.2.14`), not `latest`.

### 8.3 Cross-Chain E2E Considerations

1. **Startup ordering matters.** Mina takes ~90s, Solana ~5s, Anvil ~2s. Use `depends_on` with healthchecks or start Mina first.

2. **Total RAM budget ~1.4 GB** for all three chains (Anvil + Mina + Solana). Ensure CI runners have sufficient memory. GitHub Actions runners have 7 GB RAM -- sufficient.

3. **Test parallelism.** Mina's slow block times make serial E2E tests very slow. Consider testing Mina settlement and Solana settlement in parallel.

4. **Contract addresses are NOT deterministic on Mina** (unlike Anvil). zkApp addresses depend on the randomly generated zkApp private key. Either generate deterministic keys in tests or discover addresses dynamically.

5. **Solana program IDs CAN be deterministic** by specifying the keypair: `solana program deploy --program-id ./keypair.json`.

---

## Sources

### Mina Protocol
- [Mina Documentation: Testing zkApps Locally](https://docs.minaprotocol.com/zkapps/writing-a-zkapp/introduction-to-zkapps/testing-zkapps-locally)
- [Mina Documentation: Testing zkApps with Lightnet](https://docs.minaprotocol.com/zkapps/writing-a-zkapp/introduction-to-zkapps/testing-zkapps-lightnet)
- [Mina Documentation: LocalBlockchain API](https://docs.minaprotocol.com/zkapps/o1js-reference/namespaces/Mina/functions/LocalBlockchain)
- [o1labs/mina-local-network Docker Hub](https://hub.docker.com/r/o1labs/mina-local-network)
- [o1-labs/mina-lightnet-docker GitHub](https://github.com/o1-labs/mina-lightnet-docker)
- [Road to Mesa: Status Update (Feb 2026)](https://minaprotocol.com/blog/road-to-mesa-feb-2026)
- [Mesa Upgrade Testing Plan](https://minaprotocol.com/blog/mesa-upgrade-testing-plan)
- [Mesa Testnet Live](https://minaprotocol.com/blog/mesa-testnet-live)
- [zkapp-cli GitHub](https://github.com/o1-labs/zkapp-cli)

### Solana
- [Solana Test Validator Guide](https://solana.com/developers/guides/getstarted/solana-test-validator)
- [LiteSVM GitHub](https://github.com/LiteSVM/litesvm)
- [LiteSVM Documentation](https://www.litesvm.com/docs/getting-started)
- [LiteSVM npm package](https://www.npmjs.com/package/litesvm)
- [QuickNode: How to Test with LiteSVM](https://www.quicknode.com/guides/solana-development/tooling/litesvm)
- [Bankrun (deprecated)](https://kevinheavey.github.io/solana-bankrun/)
- [Anchor LiteSVM Integration](https://www.anchor-lang.com/docs/testing/litesvm)
- [Anchor Local Development](https://www.anchor-lang.com/docs/quickstart/local)
- [Amman GitHub](https://github.com/metaplex-foundation/amman)
- [Surfpool GitHub](https://github.com/solana-foundation/surfpool)
- [Surfpool Introduction (Helius)](https://www.helius.dev/blog/surfpool)
- [solanalabs/solana Docker Hub](https://hub.docker.com/r/solanalabs/solana)
- [solana-test-validator-docker GitHub](https://github.com/tchambard/solana-test-validator-docker)
- [Testing with Jest and Bankrun](https://solana.com/developers/guides/advanced/testing-with-jest-and-bankrun)
