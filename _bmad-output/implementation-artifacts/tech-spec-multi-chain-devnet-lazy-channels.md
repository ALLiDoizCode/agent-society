---
title: 'Multi-Chain Devnet & Lazy Payment Channels'
slug: 'multi-chain-devnet-lazy-channels'
created: '2026-03-31'
status: 'ready-for-dev'
stepsCompleted: [1, 2, 3, 4]
tech_stack: ['typescript', 'vitest', 'docker-compose', 'foundry', 'solana-test-validator', 'mina-lightnet', 'o1js', 'viem', '@noble/curves', 'nostr-tools']
files_to_modify: ['contracts/evm/', 'contracts/solana/', 'packages/mina-zkapp/', 'docker-compose-sdk-e2e.yml', 'package.json', 'pnpm-workspace.yaml', 'packages/client/src/channel/ChannelManager.ts', 'packages/client/src/channel/OnChainChannelClient.ts', 'packages/client/src/ToonClient.ts', 'packages/client/src/modes/http.ts', 'packages/client/src/signing/', 'packages/core/src/bootstrap/BootstrapService.ts', 'packages/core/src/bootstrap/types.ts', 'packages/core/src/bootstrap/discovery-tracker.ts', 'docker/src/entrypoint-sdk.ts', 'scripts/sdk-e2e-infra.sh', 'packages/sdk/tests/e2e/helpers/docker-e2e-setup.ts', 'packages/client/tests/e2e/', 'examples/client-example/src/']
code_patterns: ['chainProviders[] conditional build in entrypoint-sdk.ts', 'BootstrapService.bootstrapWithPeer() eager open at line 408', 'ChannelManager EIP-712 only signing', 'OnChainChannelClient viem-only EVM', 'per-file Anvil account allocation for nonce isolation', 'ConnectorChannelClient interface for channel ops', 'negotiateSettlementChain() for peer chain matching']
test_patterns: ['vitest with 120s timeout for E2E', 'per-file account allocation (#3-#9)', 'checkAllServicesReady() parallel health checks', 'waitForEventOnRelay() WebSocket polling', 'mock WebSocket + admin/runtime clients for unit tests']
---

# Tech-Spec: Multi-Chain Devnet & Lazy Payment Channels

**Created:** 2026-03-31

## Overview

### Problem Statement

Team members cannot easily dogfood TOON protocol. The SDK E2E infrastructure requires cloning an external `../connector` repo for smart contracts (EVM Foundry contracts, Solana programs, Mina zkApp). The ToonClient eagerly opens payment channels during bootstrap (slow startup, wasteful for exploratory use). Only EVM settlement is wired end-to-end in the client path. There is no simple "clone -> run -> publish" developer experience for multi-chain settlement.

### Solution

Vendor all chain contracts into this repo so a single `git clone` provides everything. Implement lazy payment channel creation in ToonClient — channels open on first packet send, not during bootstrap. Configure docker-compose peers to support all three chains (EVM + Solana + Mina) simultaneously. Add client-level E2E tests validating publish-through-lazy-channel for each chain. Create and update examples as the primary dogfooding entry point.

### Scope

**In Scope:**
- Vendor EVM contracts, Solana compiled program, Mina zkApp package into `contracts/` directory
- Update `docker-compose-sdk-e2e.yml` volume mounts to reference vendored contracts (no `../connector`)
- Remove `link:../connector/packages/mina-zkapp` from root `package.json`
- Implement lazy `ensureChannel(peerId, chainType)` in client ChannelManager
- Remove eager channel open from BootstrapService (keep peer discovery + BTP registration)
- Add multi-chain env vars (Solana RPC, Mina GraphQL, supported chains) to peer1/peer2 in docker-compose
- Client E2E tests: EVM, Solana, Mina, and mixed-chain scenarios
- New example: `03-multi-chain-publish.ts` (flagship dogfooding script)
- New example: `04-subscribe-events.ts` (read-side subscription)
- Update `01-publish-event.ts` with multi-chain config documentation
- Update `examples/client-example/README.md` with dogfooding guide
- Enhanced bootstrap banner in `sdk-e2e-infra.sh` with endpoints and getting-started instructions

**Out of Scope:**
- Chain Bridge DVM implementation (Epic 14)
- Production chain deployment (Arbitrum One, Solana mainnet, Mina mainnet)
- CLI/REPL tooling for interactive dogfooding
- Data persistence across container restarts
- New Docker containers or services (reuses existing infra)
- Embedded connector mode for ToonClient

## Context for Development

### Codebase Patterns

- ToonClient is HTTP-mode only — talks to connector via HTTP, not embedded
- Multi-chain config types already exist in `packages/core/src/chain/chain-config.ts`: `ChainType`, `SolanaChainPreset`, `MinaChainPreset`, builder functions
- `ToonClientConfig` already has `supportedChains`, `chainRpcUrls`, `settlementAddresses` fields
- Settlement SDKs exist in connector v2.2.0: `SolanaPaymentChannelProvider`, `MinaPaymentChannelProvider`
- E2E tests use per-file Anvil accounts (#3-#9) to avoid nonce collisions
- Docker peers use `entrypoint-sdk.ts` which reads `SUPPORTED_CHAINS`, `SOLANA_RPC_URL`, `MINA_GRAPHQL_URL`
- BootstrapService currently: discover peers -> register BTP -> open channels eagerly
- ChannelManager tracks nonces + signs balance proofs, supports optional persistence via ChannelStore

#### Eager Channel Opening (exact code path)
1. `ToonClient.start()` (line 135) → `initializeHttpMode()` → creates `BootstrapService`
2. `BootstrapService.bootstrap()` (line 249) → loops `bootstrapWithPeer()` for each known peer
3. `bootstrapWithPeer()` (line 341) → queries kind:10032 → registers BTP → **opens channel at line 408**
4. Channel opening condition: `channelClient` + `settlementInfo.supportedChains` + `peerInfo.supportedChains` + `peerInfo.settlementAddresses`
5. Uses `negotiateSettlementChain()` to match local vs peer chains
6. Same pattern exists in `DiscoveryTracker.peerWith()` (line 272) for dynamically discovered peers

#### Publish Flow (exact code path)
1. `ToonClient.publishEvent()` (line 223) → encode TOON → calculate amount → **requires pre-signed claim**
2. Claim must be provided in `options.claim` — throws `MISSING_CLAIM` if absent
3. Claim built via `EvmSigner.buildClaimMessage(proof, pubkey)` → creates `EVMClaimMessage`
4. Sent via `BtpRuntimeClient.sendIlpPacketWithClaim()` → BTP protocol data includes claim
5. BTP wraps claim in `{ protocolName: 'payment-channel-claim', data: JSON.stringify(claim) }`

#### Docker Multi-Chain Gaps
- Peer1/Peer2 have `SOLANA_RPC_URL` and `MINA_GRAPHQL_URL` set BUT missing `SOLANA_PROGRAM_ID` and `MINA_ZKAPP_ADDRESS` — these are required by `buildChainProviders()` in entrypoint-sdk.ts to activate the providers
- `SUPPORTED_CHAINS` only lists `evm:base:31337` — needs `solana:devnet,mina:devnet` appended
- Missing per-chain settlement addresses: `SETTLEMENT_ADDRESS_SOLANA_DEVNET`, `SETTLEMENT_ADDRESS_MINA_DEVNET`
- Missing per-chain preferred tokens: `PREFERRED_TOKEN_SOLANA_DEVNET`, `PREFERRED_TOKEN_MINA_DEVNET`

#### Contract External References (exact locations)
- `docker-compose-sdk-e2e.yml` line 74: `../connector/packages/contracts:/contracts` (EVM Foundry)
- `docker-compose-sdk-e2e.yml` line 103: `../connector/packages/solana-program/target/deploy:/programs:ro` (Solana .so)
- `package.json` line 43: `"@toon-protocol/mina-zkapp": "link:../connector/packages/mina-zkapp"` (Mina o1js)

#### Client Signing Architecture (EVM-only currently)
- `EvmSigner` (evm-signer.ts) — only signing implementation, uses EIP-712 typed data
- `ChannelManager` stores `chainId: number` and `tokenNetworkAddress: string` per channel — EVM-specific
- `OnChainChannelClient` uses viem only — `createWalletClient()`, `createPublicClient()`, `writeContract()`
- No `ChainSigner` abstraction exists — needs creation for Solana (Ed25519) and Mina (Poseidon)

### Files to Reference

| File | Purpose |
| ---- | ------- |
| `packages/client/src/ToonClient.ts` | Main client class, publishEvent flow, lazy channel orchestration point |
| `packages/client/src/config.ts` | ToonClientConfig validation + defaults |
| `packages/client/src/types.ts` | Full config interface (supportedChains, chainRpcUrls, etc.) |
| `packages/client/src/channel/ChannelManager.ts` | Nonce tracking + claim signing — needs ensureChannel() |
| `packages/client/src/channel/OnChainChannelClient.ts` | On-chain channel operations — EVM only, needs multi-chain |
| `packages/client/src/modes/http.ts` | HTTP mode initialization — wires BootstrapService + channel clients |
| `packages/client/src/adapters/HttpConnectorAdmin.ts` | Connector admin API (peer/channel mgmt) |
| `packages/client/src/adapters/BtpRuntimeClient.ts` | BTP transport — sendIlpPacketWithClaim() |
| `packages/client/src/signing/evm-signer.ts` | EIP-712 balance proof signing — reference for new signers |
| `packages/core/src/chain/chain-config.ts` | Multi-chain presets, resolve functions, builder functions |
| `packages/core/src/bootstrap/BootstrapService.ts` | Eager channel open at line 408 — needs lazy refactor |
| `packages/core/src/bootstrap/types.ts` | BootstrapResult, BootstrapEvent — needs new fields |
| `packages/core/src/bootstrap/discovery-tracker.ts` | Dynamic peer discovery — peerWith() has same eager pattern |
| `docker-compose-sdk-e2e.yml` | Docker Compose — external refs on lines 74, 103 |
| `docker/src/entrypoint-sdk.ts` | buildChainProviders() — conditionally activates chains |
| `scripts/sdk-e2e-infra.sh` | Infra orchestration — needs Solana program ID capture + Mina zkApp deploy |
| `infra/solana/entrypoint.sh` | Solana program deployment from /programs mount |
| `packages/sdk/tests/e2e/helpers/docker-e2e-setup.ts` | E2E test constants, helpers, ABIs |
| `packages/sdk/tests/e2e/docker-solana-settlement-e2e.test.ts` | Reference: Solana settlement test pattern |
| `packages/sdk/tests/e2e/docker-mina-settlement-e2e.test.ts` | Reference: Mina settlement test pattern |
| `examples/client-example/src/01-publish-event.ts` | Existing client publish example (EVM) |
| `examples/client-example/src/02-payment-channel.ts` | Existing payment channel example |
| `examples/client-example/README.md` | Client example documentation |

### Technical Decisions

- **Contract vendoring**: Copy files with source commit hash in `contracts/README.md` (not git subtree or npm package — contracts are stable at connector v2.2.0)
- **Mina zkApp**: Goes into `packages/mina-zkapp/` as workspace package (has its own o1js build step)
- **Chain selection**: Per-peer, not per-event. Client matches its configured chainProviders against peer's kind:10032 advertised chains via `negotiateSettlementChain()`
- **Lazy channel pattern**: `ensureChannel()` is idempotent — returns existing channel or opens new one. Called in publishEvent send path before claim signing.
- **Multi-chain peers**: Both peer1 and peer2 support all three chains simultaneously (mirrors production intent)
- **Lazy hook insertion point**: Modify `BootstrapService.bootstrapWithPeer()` to store negotiation metadata (chain, address, token) WITHOUT calling `openChannel()`. New `ensureChannel()` on ToonClient calls `openChannel()` on first use.
- **ChainSigner abstraction**: New interface wrapping EvmSigner (EIP-712), SolanaSigner (Ed25519), MinaSigner (Poseidon). ChannelManager routes to correct signer based on channel's chain type.
- **Solana program deployment**: `infra/solana/entrypoint.sh` deploys .so files from `/programs` mount. Program ID is deterministic from keypair — capture and inject as `SOLANA_PROGRAM_ID` env var.
- **Mina zkApp deployment**: Must be scripted in `sdk-e2e-infra.sh` — acquire account from accounts manager, deploy zkApp, capture address as `MINA_ZKAPP_ADDRESS` env var.
- **ClaimMessage generalization**: Current `EVMClaimMessage` becomes one variant of a union `ClaimMessage` type. Each chain produces its own claim format (`EVMClaimMessage`, `SolanaClaimMessage`, `MinaClaimMessage`). The BTP protocol data `protocolName: 'payment-channel-claim'` stays the same; the receiver dispatches by `blockchain` field in the claim.

## Implementation Plan

### Tasks

#### Phase 1: Vendor Contracts (no code changes, infra only)

- [ ] **Task 1: Vendor EVM Foundry contracts**
  - File: Create `contracts/evm/` directory
  - Action: Copy the ENTIRE `../connector/packages/contracts/` directory into `contracts/evm/` (script/, src/, lib/, foundry.toml, remappings.txt). Do NOT selectively copy — DeployLocal.s.sol has transitive Solidity imports into src/ and lib/ that are hard to enumerate. Copying everything is safe and ensures compilation works.
  - Action: Create `contracts/README.md` with source repo URL, commit hash, and date
  - Action: Verify compilation: `cd contracts/evm && forge build` should succeed
  - Notes: The `src/` directory contains the TokenNetwork, TokenNetworkRegistry, and MockUSDC contracts that DeployLocal.s.sol deploys. All are needed.

- [ ] **Task 2: Vendor Solana compiled program**
  - File: Create `contracts/solana/` directory
  - Action: Copy `../connector/packages/solana-program/target/deploy/*.so` into `contracts/solana/`
  - Action: Copy the program keypair file (if present) for deterministic program ID
  - Notes: These are pre-compiled BPF programs. The .so files are ~200KB each. Include any IDL files if present.

- [ ] **Task 3: Vendor Mina zkApp as workspace package**
  - File: Create `packages/mina-zkapp/` directory
  - Action: Copy `../connector/packages/mina-zkapp/` into `packages/mina-zkapp/`
  - File: `pnpm-workspace.yaml`
  - Action: Verify `packages/*` glob already covers `packages/mina-zkapp/` (it does)
  - File: `package.json` (root)
  - Action: Remove line 43 override `"@toon-protocol/mina-zkapp": "link:../connector/packages/mina-zkapp"` — replace with `"@toon-protocol/mina-zkapp": "workspace:*"` if needed, or remove entirely if workspace resolution handles it
  - Notes: Run `pnpm install` to verify workspace linking. The mina-zkapp package has o1js as a dependency.

- [ ] **Task 4: Update docker-compose volume mounts**
  - File: `docker-compose-sdk-e2e.yml`
  - Action (line 74): Change `../connector/packages/contracts:/contracts` → `./contracts/evm:/contracts`
  - Action (line 103): Change `../connector/packages/solana-program/target/deploy:/programs:ro` → `./contracts/solana:/programs:ro`
  - Notes: Test with `docker compose -f docker-compose-sdk-e2e.yml config` to validate paths resolve.

#### Phase 2: Multi-Chain Docker Peer Config

- [ ] **Task 5: Script Solana program ID capture**
  - File: `scripts/sdk-e2e-infra.sh`
  - Action: After Solana health check passes, query the deployed program ID using `solana program show --programs --url http://localhost:19899` and extract the program ID
  - Action: Export as `SOLANA_PROGRAM_ID` environment variable for peer containers
  - Notes: The program ID is deterministic from the keypair used during deployment. If a keypair file exists in `contracts/solana/`, include it in the entrypoint. Alternative: hardcode the program ID in docker-compose after one-time discovery.

- [ ] **Task 6: Script Mina zkApp deployment**
  - File: `scripts/sdk-e2e-infra.sh`
  - Action: After Mina lightnet health check and sync, add a deployment step:
    1. Acquire a funded account from Mina accounts manager (`POST http://localhost:19181/acquire-account`)
    2. Deploy the zkApp contract using `packages/mina-zkapp/` build output
    3. Capture the deployed zkApp public key
    4. Export as `MINA_ZKAPP_ADDRESS` environment variable
  - Notes: May need a small Node.js deployment script (e.g., `scripts/deploy-mina-zkapp.ts`) that uses o1js to deploy. The lightnet accounts manager provides pre-funded accounts with test MINA.

- [ ] **Task 7: Add multi-chain env vars to peer1 and peer2**
  - File: `docker-compose-sdk-e2e.yml`
  - **IMPORTANT — Staged startup (fixes F7 chicken-and-egg):** Docker Compose resolves `${VAR}` at `up` time, BEFORE the infra script captures Solana program ID / Mina zkApp address. Solution: `sdk-e2e-infra.sh` must use **staged docker compose**:
    1. `docker compose up -d anvil solana-validator mina-lightnet` — start chain services only
    2. Wait for health checks, capture `SOLANA_PROGRAM_ID` and `MINA_ZKAPP_ADDRESS`
    3. Export captured values as shell env vars
    4. `docker compose up -d peer1 peer2` — start peers (they now resolve `${VAR}` from exported env)
  - Action: For both peer1 and peer2, add:
    ```yaml
    SOLANA_PROGRAM_ID: '${SOLANA_PROGRAM_ID}'
    SOLANA_KEY_ID: 'solana-settlement'
    MINA_ZKAPP_ADDRESS: '${MINA_ZKAPP_ADDRESS}'
    MINA_KEY_ID: 'mina-settlement'
    ```
  - Action: Update `SUPPORTED_CHAINS` — **peer1 and peer2 get DIFFERENT preferred chains** for mixed-chain E2E testing (fixes F10):
    ```yaml
    # Peer1: all chains, prefers EVM
    SUPPORTED_CHAINS: 'evm:base:31337,solana:devnet,mina:devnet'
    # Peer2: all chains, prefers Solana (different order = different preference)
    SUPPORTED_CHAINS: 'solana:devnet,evm:base:31337,mina:devnet'
    ```
  - Action: Add per-chain settlement addresses and preferred tokens for both peers:
    ```yaml
    SETTLEMENT_ADDRESS_SOLANA_DEVNET: '${PEER_SOLANA_TOKEN_ACCOUNT}'
    SETTLEMENT_ADDRESS_MINA_DEVNET: '${PEER_MINA_ACCOUNT}'
    PREFERRED_TOKEN_SOLANA_DEVNET: '${SOLANA_TOKEN_MINT}'
    PREFERRED_TOKEN_MINA_DEVNET: 'MINA'
    TOKEN_NETWORK_SOLANA_DEVNET: '${SOLANA_PROGRAM_ID}'
    TOKEN_NETWORK_MINA_DEVNET: '${MINA_ZKAPP_ADDRESS}'
    ```
  - Notes: `entrypoint-sdk.ts` `buildChainProviders()` checks `solanaProgramId` and `minaZkAppAddress` as activation gates. The staged startup ensures these are available when peers start. `negotiateSettlementChain()` uses array order as preference — Peer1 prefers EVM, Peer2 prefers Solana, enabling the mixed-chain E2E test (Task 21).

- [ ] **Task 8: Update sdk-e2e-infra.sh bootstrap banner**
  - File: `scripts/sdk-e2e-infra.sh`
  - Action: After all health checks pass, print enhanced banner:
    ```
    🟢 TOON Devnet Ready (EVM + Solana + Mina)
       EVM (Anvil):       http://localhost:18545
       Solana:            http://localhost:19899
       Mina GraphQL:      http://localhost:19085
       Mina Accounts:     http://localhost:19181
       Peer1 Relay:       ws://localhost:19700
       Peer1 BLS:         http://localhost:19100
       Peer2 Relay:       ws://localhost:19710
       Peer2 BLS:         http://localhost:19110
       
       Dogfood: cd examples/client-example && pnpm run example:03
    ```
  - Notes: Banner should also print Solana program ID and Mina zkApp address for debugging.

#### Phase 3: ChainSigner Abstraction & Lazy Channels

- [ ] **Task 9: Create ChainSigner interface**
  - File: Create `packages/client/src/signing/types.ts`
  - Action: Define chain-agnostic signing interface:
    ```typescript
    // Chain-specific metadata (discriminated union, not Record<string, unknown>)
    export type ChainMetadata =
      | { chainType: 'evm'; chainId: number; tokenNetworkAddress: string; tokenAddress?: string }
      | { chainType: 'solana'; programId: string; tokenMint?: string }
      | { chainType: 'mina'; zkAppAddress: string; tokenId?: string };
    
    export interface ChainSigner {
      readonly chainType: 'evm' | 'solana' | 'mina';
      readonly signerIdentifier: string;  // EVM address, Solana pubkey, Mina pubkey
      signBalanceProof(params: {
        channelId: string;
        nonce: number;
        transferredAmount: bigint;
        lockedAmount: bigint;
        locksRoot: string;
        metadata: ChainMetadata;  // Typed per-chain, not Record<string, unknown>
      }): Promise<SignedBalanceProof>;
      buildClaimMessage(proof: SignedBalanceProof, senderId: string): ClaimMessage;
    }
    
    export type ClaimMessage = EVMClaimMessage | SolanaClaimMessage | MinaClaimMessage;
    
    export interface SolanaClaimMessage {
      version: string;
      blockchain: 'solana';
      messageId: string;
      timestamp: string;
      senderId: string;
      channelId: string;
      nonce: number;
      transferredAmount: string;
      signature: string;  // Ed25519 signature
      signerAddress: string;  // Solana pubkey (base58)
      programId: string;
    }
    
    export interface MinaClaimMessage {
      version: string;
      blockchain: 'mina';
      messageId: string;
      timestamp: string;
      senderId: string;
      channelId: string;
      nonce: number;
      transferredAmount: string;
      commitment: string;  // Poseidon commitment
      signerAddress: string;  // Mina pubkey (B62q...)
      zkAppAddress: string;
    }
    ```
  - Notes: `EVMClaimMessage` already exists in `evm-signer.ts`. Keep it there; import the type.

- [ ] **Task 10: Wrap EvmSigner to implement ChainSigner**
  - File: `packages/client/src/signing/evm-signer.ts`
  - Action: Make `EvmSigner` implement `ChainSigner` interface. Add `chainType: 'evm'` getter. Rename existing `buildClaimMessage()` to match interface if needed.
  - Notes: This should be a non-breaking change — existing callers can still use EvmSigner directly.

- [ ] **Task 11: Create SolanaSigner implementing ChainSigner**
  - File: Create `packages/client/src/signing/solana-signer.ts`
  - Action: Implement `ChainSigner` for Solana using Ed25519 signing from `@noble/curves/ed25519`
  - Action: `signBalanceProof()` → sign channel state with Ed25519 private key
  - Action: `buildClaimMessage()` → produce `SolanaClaimMessage` with base58 pubkey and program ID
  - Notes: Reference `docker-solana-settlement-e2e.test.ts` for the exact signing pattern. Solana balance proofs use raw Ed25519, not EIP-712.

- [ ] **Task 12: Create MinaSigner implementing ChainSigner**
  - File: Create `packages/client/src/signing/mina-signer.ts`
  - Action: Implement `ChainSigner` for Mina using Poseidon commitment from o1js
  - Action: `signBalanceProof()` → generate Poseidon commitment over channel state fields
  - Action: `buildClaimMessage()` → produce `MinaClaimMessage` with B62 pubkey and zkApp address
  - Notes: Reference `docker-mina-settlement-e2e.test.ts` for the exact signing pattern. Import from `@toon-protocol/mina-zkapp` or o1js directly.

- [ ] **Task 12b: Extend OnChainChannelClient for Solana and Mina channel opening**
  - File: `packages/client/src/channel/OnChainChannelClient.ts`
  - Action: Currently EVM-only (uses viem). Extend to support Solana and Mina channel opening by dispatching on the `chain` parameter prefix:
    - `evm:*` → existing viem logic (no changes)
    - `solana:*` → Solana PDA channel creation via `@solana/web3.js` or raw JSON-RPC:
      1. Derive PDA from program ID + participant pubkeys
      2. Build `openChannel` instruction
      3. Sign and send transaction
      4. Return channelId (PDA address)
    - `mina:*` → Mina zkApp state transition via o1js:
      1. Load zkApp contract
      2. Call `openChannel` method with participant public keys
      3. Sign and prove transaction (proof-level=none on devnet)
      4. Return channelId (derived from participants)
  - Action: Add `SolanaChannelOpener` class (internal, used by OnChainChannelClient):
    - Constructor takes: `rpcUrl: string`, `keypair: Uint8Array`, `programId: string`
    - `openChannel(peerAddress, deposit, timeout)` → PDA creation + deposit
    - `getChannelState(channelId)` → read PDA account data
    - Reference: `docker-solana-settlement-e2e.test.ts` for exact PDA derivation and instruction format
  - Action: Add `MinaChannelOpener` class (internal, used by OnChainChannelClient):
    - Constructor takes: `graphqlUrl: string`, `privateKey: string`, `zkAppAddress: string`
    - `openChannel(peerAddress, deposit, timeout)` → zkApp method call
    - `getChannelState(channelId)` → read zkApp on-chain state
    - Reference: `docker-mina-settlement-e2e.test.ts` for exact zkApp interaction pattern
    - **IMPORTANT**: Import o1js dynamically (`await import('o1js')`) to avoid pulling 50MB into the client bundle for non-Mina users (fixes F15 bundle size concern)
  - Action: Update `openChannel()` dispatch logic:
    ```typescript
    async openChannel(params: OpenChannelParams): Promise<OpenChannelResult> {
      const chainPrefix = params.chain.split(':')[0]; // 'evm', 'solana', 'mina'
      switch (chainPrefix) {
        case 'evm': return this.openEvmChannel(params);    // existing logic
        case 'solana': return this.solanaOpener!.openChannel(params);
        case 'mina': return this.minaOpener!.openChannel(params);
        default: throw new Error(`Unsupported chain: ${params.chain}`);
      }
    }
    ```
  - Action: Update constructor to accept optional `solanaConfig` and `minaConfig` for initializing the chain-specific openers
  - File: `packages/client/src/modes/http.ts`
  - Action: Wire Solana/Mina config into OnChainChannelClient construction when `chainRpcUrls` includes Solana/Mina entries
  - Notes: This is the critical missing piece identified by adversarial review (F3/F6). Signing (Tasks 9-12) and opening (this task) are separate concerns — both are needed for end-to-end lazy channels on non-EVM chains.

- [ ] **Task 13: Extend ChannelManager for multi-chain**
  - File: `packages/client/src/channel/ChannelManager.ts`
  - Action: Replace single `evmSigner: EvmSigner` with `chainSigners: Map<string, ChainSigner>`
  - Action: Add `registerChainSigner(chainType: string, signer: ChainSigner): void`
  - Action: Extend `ChannelTracking` interface to include `chainType: string` alongside existing `chainId` / `tokenNetworkAddress`
  - Action: In `signBalanceProof()`, look up the correct signer from `chainSigners` based on the channel's `chainType`
  - Action: Add `ensureChannel(peerId: string, peerNegotiation: PeerNegotiation): Promise<string>` method. **Note:** ChannelManager currently has no `config` property — `initialDeposit` and `settlementTimeout` must be passed in via the `PeerNegotiation` parameter or set as constructor options:
    ```typescript
    interface ChannelManagerConfig {
      initialDeposit?: string;       // default: '100000'
      settlementTimeout?: number;    // default: 86400
    }
    
    interface PeerNegotiation {
      chain: string;                 // e.g., 'evm:base:31337'
      chainType: string;             // 'evm' | 'solana' | 'mina'
      chainId: number | string;
      settlementAddress: string;
      tokenAddress?: string;
      tokenNetwork?: string;
      initialDeposit?: string;       // override per-peer if needed
      settlementTimeout?: number;    // override per-peer if needed
    }
    
    // Constructor changes: ChannelManager(signers?, store?, config?)
    async ensureChannel(peerId: string, negotiation: PeerNegotiation): Promise<string> {
      // Guard against concurrent opens for same peer (F8 fix)
      if (this.pendingOpens.has(peerId)) {
        return this.pendingOpens.get(peerId)!;
      }
      
      const existing = this.getChannelForPeer(peerId);
      if (existing) return existing;
      
      if (!this.channelClient) {
        throw new Error('No channel client configured — cannot open payment channel');
      }
      
      // Deduplicate concurrent opens
      const openPromise = (async () => {
        try {
          const result = await this.channelClient.openChannel({
            peerId,
            chain: negotiation.chain,
            token: negotiation.tokenAddress,
            tokenNetwork: negotiation.tokenNetwork,
            peerAddress: negotiation.settlementAddress,
            initialDeposit: negotiation.initialDeposit ?? this.defaultInitialDeposit ?? '100000',
            settlementTimeout: negotiation.settlementTimeout ?? this.defaultSettlementTimeout ?? 86400,
          });
          
          this.trackChannel(result.channelId, {
            chainType: negotiation.chainType,
            chainId: typeof negotiation.chainId === 'number' ? negotiation.chainId : 0,
            tokenNetworkAddress: negotiation.tokenNetwork ?? '',
          });
          this.peerChannels.set(peerId, result.channelId);
          return result.channelId;
        } finally {
          this.pendingOpens.delete(peerId);
        }
      })();
      
      this.pendingOpens.set(peerId, openPromise);
      return openPromise;
    }
    ```
  - Action: Add `peerChannels: Map<string, string>` for peer-to-channel mapping
  - Action: Add `pendingOpens: Map<string, Promise<string>>` for concurrent open deduplication (fixes F8 race condition)
  - Action: Add `setChannelClient(client: ConnectorChannelClient): void` method
  - Action: Update constructor to accept optional `ChannelManagerConfig` as third parameter with `initialDeposit` and `settlementTimeout` defaults
  - Notes: Backwards compatible — if only EvmSigner registered, behavior is identical to current. The `pendingOpens` map ensures concurrent `publishEvent()` calls for the same peer don't trigger duplicate channel opens.

- [ ] **Task 14: Remove eager channel open from BootstrapService**
  - File: `packages/core/src/bootstrap/BootstrapService.ts`
  - Action: In `bootstrapWithPeer()` (line 381-416), replace the `openChannel()` call with storing negotiation metadata on the `BootstrapResult`. The `negotiatedChain` and `settlementAddress` fields already exist on `BootstrapResult` (lines 49-52 of types.ts) — reuse them:
    ```typescript
    // BEFORE: await this.channelClient.openChannel({...})
    // AFTER: Store metadata for lazy opening (negotiatedChain + settlementAddress already exist)
    result.negotiatedChain = negotiatedChain;
    result.settlementAddress = peerAddress;
    result.tokenAddress = tokenAddress;    // NEW field
    result.tokenNetwork = tokenNetwork;    // NEW field
    ```
  - File: `packages/core/src/bootstrap/types.ts`
  - Action: Add ONLY the genuinely new fields to `BootstrapResult` (`negotiatedChain` and `settlementAddress` already exist — do NOT duplicate them):
    ```typescript
    // ADD these new fields alongside existing negotiatedChain/settlementAddress:
    tokenAddress?: string;
    tokenNetwork?: string;
    ```
  - Notes: Do NOT remove the `channelClient` property or `negotiateSettlementChain()` logic — the negotiation still runs during bootstrap to validate compatibility. Only the `openChannel()` call is deferred.

- [ ] **Task 15: Apply same lazy pattern to DiscoveryTracker**
  - File: `packages/core/src/bootstrap/discovery-tracker.ts`
  - Action: In the `peerWith()` function (around line 272), apply the same transformation: store negotiation metadata instead of calling `openChannel()`. **IMPORTANT: DiscoveryTracker is a factory function (`createDiscoveryTracker`) returning closures, NOT a class.** The `channelClient` is closure-scoped, not `this.channelClient`. Modify the closure to store negotiation metadata in the returned tracker's state object instead of calling the closure-scoped `channelClient.openChannel()`.
  - Action: Emit a `discovery:channel-pending` event with peer ID and negotiation metadata via the tracker's event emitter
  - Action: Expose the stored negotiation metadata via a new `getPeerNegotiation(peerId): PeerNegotiation | undefined` method on the returned tracker object
  - Notes: The DiscoveryTracker handles dynamically discovered peers (via kind:10032). Same lazy pattern applies. ToonClient must listen for `discovery:channel-pending` events to update its `peerNegotiations` map.

- [ ] **Task 16: Wire lazy channels into ToonClient.publishEvent()**
  - File: `packages/client/src/ToonClient.ts`
  - Action: Modify `publishEvent()` to support TWO modes — explicit claim (existing) and auto-claim (new lazy):
    ```typescript
    async publishEvent(
      event: NostrEvent,
      options?: { destination?: string; claim?: SignedBalanceProof }
    ): Promise<PublishEventResult> {
      // ... encode, calculate amount, resolve destination ...
      
      let claimMessage: ClaimMessage;
      if (options?.claim) {
        // EXISTING PATH: Caller provides pre-signed claim (backwards compatible)
        claimMessage = EvmSigner.buildClaimMessage(options.claim, this.getPublicKey());
      } else if (this.channelManager) {
        // NEW PATH: Auto-open channel + auto-sign claim
        const peerId = this.resolvePeerId(destination);
        const negotiation = this.peerNegotiations.get(peerId);
        if (!negotiation) {
          throw new ToonClientError('No negotiation metadata for peer — was bootstrap completed?', 'PEER_NOT_NEGOTIATED');
        }
        const channelId = await this.channelManager.ensureChannel(peerId, negotiation);
        const proof = await this.channelManager.signBalanceProof(channelId, BigInt(amount));
        const signer = this.channelManager.getSignerForChannel(channelId);
        claimMessage = signer.buildClaimMessage(proof, this.getPublicKey());
      } else {
        throw new ToonClientError('No claim provided and no channel manager configured', 'MISSING_CLAIM');
      }
      
      // Send via BTP with claim ...
    }
    ```
  - Action: **Keep** the `MISSING_CLAIM` error for the case where neither explicit claim NOR channel manager is available. Do NOT remove the existing public `signBalanceProof()` and `getTrackedChannels()` methods — they remain for callers who manage claims manually.
  - Action: Store `peerNegotiations: Map<string, PeerNegotiation>` populated from bootstrap results
  - Action: Add `resolvePeerId(destination: string): string` helper that maps ILP destination address to peer ID
  - File: `packages/client/src/modes/http.ts`
  - Action: Wire `ChannelManager.setChannelClient(onChainChannelClient)` during initialization
  - Action: Pass `bootstrapResults` back to ToonClient for negotiation metadata storage
  - Notes: This preserves backwards compatibility — existing code that passes `options.claim` still works unchanged. New code can omit the claim and let the client handle everything. The `MISSING_CLAIM` error is kept as a fallback for misconfigured clients.

#### Phase 4: E2E Tests

- [ ] **Task 17: Add multi-chain constants to E2E helpers**
  - File: `packages/sdk/tests/e2e/helpers/docker-e2e-setup.ts`
  - Action: Add Solana and Mina constants:
    ```typescript
    export const SOLANA_RPC = 'http://localhost:19899';
    export const SOLANA_WS = 'ws://localhost:19900';
    export const SOLANA_PROGRAM_ID = process.env.SOLANA_PROGRAM_ID || '';
    export const MINA_GRAPHQL = 'http://localhost:19085/graphql';
    export const MINA_ACCOUNTS_MANAGER = 'http://localhost:19181';
    export const MINA_ZKAPP_ADDRESS = process.env.MINA_ZKAPP_ADDRESS || '';
    ```
  - Action: Add helper `acquireMinaAccount()` that calls the accounts manager API
  - Action: Add helper `waitForSolanaHealth()` and `waitForMinaHealth()`

- [ ] **Task 18: Create client E2E test — EVM lazy channel**
  - File: Create `packages/client/tests/e2e/docker-client-evm-e2e.test.ts`
  - Action: Test the lazy channel flow for EVM:
    1. Create ToonClient with EVM chain config (Account #3, Peer1 as connector)
    2. Call `client.start()` — assert NO channels opened
    3. Call `client.publishEvent(kind1Note)` — assert channel opens lazily, event sent
    4. Call `client.publishEvent(kind1Note2)` — assert SAME channel reused (no second open)
    5. Verify event arrived on Peer1's relay via `waitForEventOnRelay()`
    6. Verify on-chain channel state via `getChannelState()`
  - Notes: Use Anvil Account #3. Test timeout: 120s. Use `checkAllServicesReady()` in beforeAll.

- [ ] **Task 19: Create client E2E test — Solana lazy channel**
  - File: Create `packages/client/tests/e2e/docker-client-solana-e2e.test.ts`
  - Action: Same flow as Task 18 but with Solana chain config:
    1. Create ToonClient with Solana chain provider (new Ed25519 keypair)
    2. `client.start()` → no channels
    3. `client.publishEvent()` → lazy Solana channel open + Ed25519 signed claim
    4. Verify event on relay
    5. Verify on-chain Solana program state (PDA channel account)
  - Notes: Use dedicated Solana keypair. May need SOL airdrop for gas. Test timeout: 120s.

- [ ] **Task 20: Create client E2E test — Mina lazy channel**
  - File: Create `packages/client/tests/e2e/docker-client-mina-e2e.test.ts`
  - Action: Same flow as Task 18 but with Mina chain config:
    1. Acquire funded Mina account from accounts manager
    2. Create ToonClient with Mina chain provider
    3. `client.start()` → no channels
    4. `client.publishEvent()` → lazy Mina channel open + Poseidon commitment claim
    5. Verify event on relay
    6. Verify on-chain Mina zkApp state
  - Notes: Mina proof generation is SLOW — use 180s timeout. Acquire/release accounts via accounts manager API to avoid test interference.

- [ ] **Task 21: Create client E2E test — mixed chain**
  - File: Create `packages/client/tests/e2e/docker-client-multi-chain-e2e.test.ts`
  - Action: Test client selecting correct chain per peer:
    1. Configure client with all three chain providers
    2. Publish to Peer1 (advertises EVM preference) → EVM channel
    3. Publish to Peer2 (advertises Solana preference) → Solana channel
    4. Verify two different channels opened on two different chains
    5. Verify both events arrived on respective relays
  - Notes: This test validates `negotiateSettlementChain()` end-to-end. Requires peer1 and peer2 to advertise different preferred chains (may need docker-compose config tweak for this test).

- [ ] **Task 22: Add client E2E npm scripts**
  - File: `packages/client/package.json`
  - Action: Add scripts:
    ```json
    "test:e2e": "vitest run --config vitest.e2e.config.ts",
    "test:e2e:client": "vitest run --config vitest.e2e.config.ts tests/e2e/docker-client-*.test.ts",
    "test:e2e:client:evm": "vitest run --config vitest.e2e.config.ts tests/e2e/docker-client-evm-e2e.test.ts",
    "test:e2e:client:solana": "vitest run --config vitest.e2e.config.ts tests/e2e/docker-client-solana-e2e.test.ts",
    "test:e2e:client:mina": "vitest run --config vitest.e2e.config.ts tests/e2e/docker-client-mina-e2e.test.ts"
    ```
  - File: Create `packages/client/vitest.e2e.config.ts`
  - Action: Configure vitest for E2E (120s timeout, node environment, path aliases)
  - Notes: Mirror the pattern from `packages/sdk/vitest.e2e.config.ts`.

#### Phase 5: Examples & Documentation

- [ ] **Task 23: Create `03-multi-chain-publish.ts` example**
  - File: Create `examples/client-example/src/03-multi-chain-publish.ts`
  - Action: Flagship dogfooding example that:
    1. Creates a ToonClient with all three chain providers (EVM, Solana, Mina)
    2. Calls `client.start()` — discovers peers, no channels yet
    3. Creates a kind:1 note with content "Hello from TOON devnet! Chain: EVM"
    4. Calls `client.publishEvent(note)` — lazy channel opens, event published
    5. Prints: channel ID, chain used, event ID, relay URL
    6. Optionally repeats for Solana and Mina peers
    7. Cleans up
  - Notes: This is the primary "run this to dogfood" script. Use deterministic Anvil Account #9 (same as existing 01-publish-event). Include clear console output with emojis for DevX.

- [ ] **Task 24: Create `04-subscribe-events.ts` example**
  - File: Create `examples/client-example/src/04-subscribe-events.ts`
  - Action: Read-side subscription example:
    1. Connect to Peer1's relay (`ws://localhost:19700`)
    2. Subscribe to kind:1 events with NIP-01 filter
    3. Print arriving events with metadata (pubkey, created_at, content)
    4. Run until interrupted (Ctrl+C)
  - Notes: Free to read — no payment needed for subscriptions. Use raw WebSocket or `nostr-tools` relay client.

- [ ] **Task 25: Update `01-publish-event.ts` with multi-chain comments**
  - File: `examples/client-example/src/01-publish-event.ts`
  - Action: Add comments showing how to configure Solana and Mina chain providers:
    ```typescript
    // Multi-chain: Add Solana provider
    // supportedChains: ['evm:base:31337', 'solana:devnet'],
    // chainRpcUrls: { 'evm:base:31337': ANVIL_RPC, 'solana:devnet': 'http://localhost:19899' },
    ```
  - Notes: Don't change the default behavior — just add commented-out examples.

- [ ] **Task 26: Update client-example README**
  - File: `examples/client-example/README.md`
  - Action: Add dogfooding guide section:
    - Prerequisites: `git clone`, `pnpm install && pnpm build`, `./scripts/sdk-e2e-infra.sh up`
    - Quick start: `cd examples/client-example && pnpm run example:03`
    - Example descriptions for all 4 examples
    - Port reference table
    - Multi-chain configuration guide
    - Troubleshooting (common issues with infra startup)
  - Action: Add npm scripts for new examples:
    ```json
    "example:03": "tsx src/03-multi-chain-publish.ts",
    "example:04": "tsx src/04-subscribe-events.ts"
    ```

### Acceptance Criteria

#### Contract Vendoring
- [ ] AC 1: Given a fresh clone of the repo (no `../connector` sibling), when running `./scripts/sdk-e2e-infra.sh up`, then all three chain services (Anvil, Solana, Mina) start successfully and deploy their respective contracts without errors.
- [ ] AC 2: Given the repo, when running `grep -r '../connector' .` (excluding .git), then zero results are returned — no external connector references remain.

#### Multi-Chain Peers
- [ ] AC 3: Given both peers are running with multi-chain config, when querying Peer1's kind:10032 event, then `supportedChains` includes `evm:base:31337`, `solana:devnet`, and `mina:devnet` with corresponding `settlementAddresses`.
- [ ] AC 4: Given both peers are running, when querying each peer's kind:10032 event from their relay, then `supportedChains` arrays contain entries for all three chain types (`evm:base:31337`, `solana:devnet`, `mina:devnet`) and corresponding `settlementAddresses` are non-empty for each chain.

#### Lazy Payment Channels
- [ ] AC 5: Given a ToonClient configured with EVM chain provider, when calling `client.start()`, then zero payment channels are opened (no on-chain transactions).
- [ ] AC 6: Given a started ToonClient with no open channels, when calling `client.publishEvent(note)` for the first time, then a payment channel is opened lazily on the negotiated chain, the event is published successfully, and the event is readable on the peer's relay.
- [ ] AC 7: Given a ToonClient with an already-open channel to Peer1, when calling `client.publishEvent(note2)` to the same peer, then the existing channel is reused (no second `openChannel` call), and the cumulative balance proof nonce increments by 1.
- [ ] AC 8: Given a ToonClient configured with Solana chain provider, when calling `client.publishEvent(note)`, then a Solana payment channel is opened (PDA account created), an Ed25519-signed balance proof is sent, and the event arrives on the relay.
- [ ] AC 9: Given a ToonClient configured with Mina chain provider, when calling `client.publishEvent(note)`, then a Mina payment channel is opened (zkApp state updated), a Poseidon commitment claim is sent, and the event arrives on the relay.
- [ ] AC 10: Given a ToonClient configured with all three chain providers and two peers with different chain preferences, when publishing to each peer, then the client selects the correct chain per peer based on `negotiateSettlementChain()`.

#### Error Handling
- [ ] AC 11: Given a ToonClient with no chain providers configured, when calling `client.publishEvent(note)`, then a clear error is thrown: `'No channel client configured — cannot open payment channel'`.
- [ ] AC 12: Given a ToonClient where `openChannel()` fails (e.g., insufficient funds), when calling `client.publishEvent(note)`, then the error propagates with a descriptive message including the chain type and peer ID.

#### Examples
- [ ] AC 13: Given a running devnet (`./scripts/sdk-e2e-infra.sh up`), when running `cd examples/client-example && pnpm run example:03`, then a kind:1 note is published through a lazily-opened channel and the script prints the channel ID, chain used, and event ID.
- [ ] AC 14: Given events have been published, when running `pnpm run example:04` in a separate terminal, then published events are displayed in real-time.

## Additional Context

### Dependencies

- `@toon-protocol/connector@2.2.0` — ConnectorNode, SolanaPaymentChannelProvider, MinaPaymentChannelProvider
- `@toon-protocol/mina-zkapp` — Mina zkApp contract (vendored as workspace package)
- `@noble/curves` — Ed25519 signing for Solana claims (already a transitive dep)
- `o1js` — Poseidon hashing for Mina claims (via mina-zkapp package)
- `viem` — EVM signing and on-chain queries (already a dependency)
- Docker images: `ghcr.io/foundry-rs/foundry:latest`, `ghcr.io/beeman/solana-test-validator:latest`, `o1labs/mina-local-network:compatible-latest-lightnet`
- External `../connector` repo — one-time source for contract vendoring only

### Testing Strategy

**Unit Tests:**
- `ChannelManager.ensureChannel()` — mock `channelClient.openChannel()`, verify idempotent behavior
- `ChannelManager.ensureChannel()` concurrent — call twice simultaneously for same peer, verify only one `openChannel()` call (deduplication via `pendingOpens`)
- `ChannelManager.ensureChannel()` failure — mock `openChannel()` rejection, verify error propagates and `pendingOpens` is cleaned up (retry works)
- `SolanaSigner.signBalanceProof()` — verify Ed25519 signature matches expected format
- `MinaSigner.signBalanceProof()` — verify Poseidon commitment matches expected format
- `ChannelManager` multi-signer routing — register EVM + Solana signers, verify correct dispatch
- `ToonClient.publishEvent()` auto-claim path — mock ChannelManager + BtpRuntimeClient, verify: ensureChannel called → signBalanceProof called → buildClaimMessage called → sendIlpPacketWithClaim called with correct claim
- `ToonClient.publishEvent()` explicit claim path — verify when `options.claim` is provided, ensureChannel is NOT called (backwards compatible)
- `ToonClient.publishEvent()` no channel manager — verify `MISSING_CLAIM` error when neither claim nor channelManager configured
- `ToonClient.publishEvent()` channel open failure — mock ensureChannel rejection, verify error message includes chain type and peer ID
- `OnChainChannelClient` chain dispatch — mock Solana/Mina openers, verify correct opener called based on `chain` prefix

**E2E Tests (require Docker infra):**
- `docker-client-evm-e2e.test.ts` — EVM lazy channel + publish (baseline)
- `docker-client-solana-e2e.test.ts` — Solana lazy channel + publish
- `docker-client-mina-e2e.test.ts` — Mina lazy channel + publish (180s timeout)
- `docker-client-multi-chain-e2e.test.ts` — Mixed chain selection per peer

**Integration Verification:**
- Run `./scripts/sdk-e2e-infra.sh up` — verify all three chains healthy
- Run `pnpm test:e2e:client` — verify all client E2E tests pass
- Run existing `pnpm test:e2e:docker` — verify no regression in SDK-level tests
- Run `cd examples/client-example && pnpm run example:03` — verify dogfooding flow works

### Notes

**High-Risk Items:**
- **Mina zkApp deployment automation** (Task 6): The o1js deployment step is complex and may need a dedicated script. If it blocks, consider hardcoding the zkApp address after one-time manual deployment.
- **Solana program ID capture** (Task 5): The deployed program ID depends on the keypair. If the .so is built without a deterministic keypair, the ID changes each deployment. Mitigation: include the keypair file in `contracts/solana/`.
- **Mina E2E timeout** (Task 20): Even with `proof-level=none`, Mina operations are slow. May need test-specific timeout configuration.

**Error Recovery for Lazy Channel Opens:**
- If `ensureChannel()` calls `openChannel()` and the on-chain tx succeeds but the subsequent `signBalanceProof()` or BTP send fails: the opened channel IS tracked in ChannelManager (the `finally` block in `ensureChannel` cleans up `pendingOpens` but keeps the tracked channel). On retry, `ensureChannel()` sees the existing channel and reuses it — no duplicate open.
- If `openChannel()` itself fails (insufficient funds, tx reverted): the `pendingOpens` promise rejects and is cleaned up in `finally`. The `peerChannels` map is NOT updated. On retry, `ensureChannel()` will attempt `openChannel()` again using the same negotiation metadata — the metadata persists in `peerNegotiations`.
- If `openChannel()` succeeds on-chain but the client crashes before tracking: on restart, the channel exists on-chain but is unknown to the client. The client will attempt a new `openChannel()` — this is acceptable for devnet (gas is free on Anvil, no real funds on test chains). Production would need channel recovery, which is out of scope.

**Known Limitations:**
- Lazy channels add latency to the first `publishEvent()` call (~2-5s for EVM, ~10s for Solana, ~30-60s for Mina). Subsequent calls are fast.
- Multi-chain peers require all three chain services running. If one chain service fails, that chain's settlement is unavailable but others still work.
- The Mina lightnet uses 4GB RAM. Teams with limited Docker resources may want to disable it.

**Future Considerations (out of scope):**
- Channel pre-warming: warm up channels for known peers in the background after start()
- Chain fallback: if preferred chain fails, try next-best chain
- Persistent devnet: volume mounts for SQLite and chain state across restarts
- Devnet CLI: `pnpm devnet:up`, `pnpm devnet:fund <address>`, `pnpm devnet:status`
