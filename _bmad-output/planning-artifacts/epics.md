---
stepsCompleted: [1, 2, 3, 4]
inputDocuments:
  - docs/prd/2-requirements.md
  - docs/architecture/toon-service-protocol.md
  - docs/architecture/5-components.md
  - docs/architecture/7-core-workflows.md
  - docs/architecture/12-coding-standards.md
  - docs/architecture/13-test-strategy-and-standards.md
  - docs/ILP-GATED-RELAY.md
  - packages/core/src/compose.ts
---

# TOON SDK - Epic Breakdown

## Overview

This document provides the epic and story breakdown for `@toon-protocol/sdk`, decomposing the requirements from the PRD, Architecture, and the TOON Service Protocol spec into implementable stories. The SDK is a TOON-native, ILP-gated service node framework with unified secp256k1 identity (Nostr + EVM). Developers build ILP-gated services by registering kind-based handlers that receive raw TOON for direct LLM consumption, with optional structured decode for code-based handlers.

> **Scope Note:** This document supersedes `docs/prd/` (v3.0, 2026-02-17) as the requirements baseline for the SDK phase. The old PRD's FR1-FR66 covered a broader scope (17 epics including agent runtime, Gas Town integration, NIP adoption roadmap) that no longer reflects the current project direction. The Requirements Inventory below defines the authoritative FR set for implementation.

## Requirements Inventory

### Functional Requirements

**TOON Codec Prerequisite (derived from Architecture Decision 1)**

- FR-SDK-0: The TOON encoder, decoder, and shallow parser SHALL be available in `@toon-protocol/core` to avoid circular dependencies and enable SDK, BLS, and relay packages to share a single codec location

**SDK Core (derived from TOON Service Protocol + existing FR27-FR30)**

- FR-SDK-1: The SDK SHALL provide a `createNode()` function that composes an embedded `ConnectorNode` with a handler registry, bootstrap service, and relay monitor into a single lifecycle-managed object
- FR-SDK-2: The SDK SHALL provide a handler registry with `.on(kind, handler)` and `.onDefault(handler)` methods for routing events by kind to developer-provided handler functions
- FR-SDK-3: The SDK SHALL provide TOON-native data handling: shallow TOON parse for routing metadata (kind, pubkey), raw TOON passthrough to handlers for direct LLM consumption, and optional lazy decode to structured objects for code-based handlers
- FR-SDK-4: The SDK SHALL verify Nostr event signatures (Schnorr) by default before invoking developer handlers, rejecting forged events with ILP error codes; verification is skippable in dev mode
- FR-SDK-5: The SDK SHALL provide configurable pricing validation (per-byte and per-kind) with self-write bypass for the node's own pubkey
- FR-SDK-6: The SDK SHALL bridge the handler registry to the connector's `PaymentHandler` interface, using `isTransit` to distinguish fire-and-forget (intermediate hop) from await (final hop) semantics
- FR-SDK-7: The SDK SHALL provide a `HandlerContext` object to handlers with `toon` (raw TOON string), `kind`, `pubkey`, `amount`, `destination`, `decode()` (lazy), `accept(data?)` and `reject(code, message)` methods
- FR-SDK-8: The SDK SHALL expose the embedded connector's direct method API for peer management (`registerPeer`, `removePeer`), packet sending (`sendPacket`), and channel operations (`openChannel`, `getChannelState`)
- FR-SDK-9: The SDK SHALL integrate with `BootstrapService` and `RelayMonitor` from `@toon-protocol/core` for peer discovery and network join
- FR-SDK-10: The SDK SHALL manage complete node lifecycle via `start()` and `stop()` methods (connector start, bootstrap, relay monitor start; graceful shutdown)
- FR-SDK-11: The SDK SHALL use `@toon-protocol/connector` in embedded mode (`deploymentMode: 'embedded'`) with `setPacketHandler()` for in-process packet delivery
- FR-SDK-12: The SDK SHALL support a dev mode that skips signature verification, bypasses pricing, and logs all incoming packets for local development
- FR-SDK-13: The SDK SHALL be published as `@toon-protocol/sdk` on npm with public access
- FR-SDK-NEW-1: The SDK SHALL provide unified identity from BIP-39 seed phrases: `generateMnemonic()`, `fromMnemonic(words, options?)`, and `fromSecretKey(key)` deriving both Nostr pubkey (x-only Schnorr) and EVM address (Keccak-256) from a single secp256k1 key via NIP-06 derivation path `m/44'/1237'/0'/0/{accountIndex}`

**Validation & Proof (derived from existing codebase)**

- FR-SDK-14: The current relay BLS logic in `docker/src/entrypoint.ts` SHALL be reimplementable using the SDK's handler registry, proving SDK completeness
- FR-SDK-15: All existing E2E tests SHALL pass when running against a relay built with the SDK

**Cleanup (derived from TOON Service Protocol)**

- FR-SDK-16: The `packages/git-proxy/` package SHALL be removed as it is superseded by the TOON Service Protocol pattern

**Relay Node Publishing (derived from Epic 2)**

- FR-RELAY-1: The SDK-based relay SHALL be published as `@toon-protocol/town` on npm with a `startTown(config)` function, CLI entrypoint, and Docker image

**Production Protocol Economics (derived from Party Mode Decisions 2026-03-05/06)**

- FR-PROD-1: The protocol SHALL use USDC as the sole user-facing payment token, replacing the AGENT development token. Payment channels, pricing, and all user flows SHALL be USDC-denominated
- FR-PROD-2: The protocol SHALL support multi-environment chain configuration: Anvil (local dev with mock USDC), Arbitrum Sepolia (staging with testnet USDC), and Arbitrum One (production with real USDC)
- FR-PROD-3: TOON nodes SHALL expose a `/publish` HTTP endpoint that accepts x402 payments (HTTP 402 negotiation with EIP-3009 gasless USDC authorization), constructs ILP PREPARE packets with TOON data payloads, and routes them through the ILP network to destination relays
- FR-PROD-4: Peer discovery SHALL use a seed relay list model (kind:10036 events on public Nostr relays) instead of requiring a genesis node. Any relay in the seed list can bootstrap a new peer into the network
- FR-PROD-5: TOON nodes SHALL publish kind:10035 (x402 Service Discovery) events advertising payment endpoint, pricing, and supported chains in a machine-readable format
- FR-PROD-6: The `/health` endpoint SHALL return enriched JSON including peer count, channel count, pricing information, and service capabilities for both human and agent consumption
- FR-PROD-7: The SPSP handshake (kind:23194/23195) SHALL be removed from the protocol. The peer discovery handshake phase SHALL be eliminated, with chain selection running locally against kind:10032 data and channels opened unilaterally
- FR-PROD-8: The Town node SHALL expose a relay subscription API allowing developers to subscribe to other Nostr relays for any event kind, enabling extensible peer discovery, seed relay lists, and custom event subscriptions

**Marlin TEE Deployment (derived from Party Mode Decisions 2026-03-05/06)**

- FR-TEE-1: The TOON Docker image SHALL be packaged for deployment on Marlin Oyster CVM with attestation server configuration and proxy endpoint mapping
- FR-TEE-2: TOON nodes running in Oyster CVM SHALL publish kind:10033 (TEE Attestation) events containing PCR values, enclave image hash, and attestation documents
- FR-TEE-3: The BootstrapService SHALL verify kind:10033 attestation events when discovering peers, preferring TEE-attested relays and validating PCR measurements against known-good image hashes
- FR-TEE-4: Enclave-resident nodes SHALL derive persistent Nostr identity keys from Nautilus KMS seeds, binding relay identity to TEE code integrity
- FR-TEE-5: Docker builds SHALL use Nix for reproducible builds producing deterministic PCR values across build environments
- FR-TEE-6: kind:10036 (Seed Relay List) bootstrap SHALL verify TEE attestation (kind:10033) as the trust anchor before trusting a seed relay's peer list

**DVM Compute Marketplace (derived from Party Mode 2020117 Analysis 2026-03-10)**

- FR-DVM-1: The protocol SHALL define DVM (Data Vending Machine) event kinds using NIP-90 compatible Nostr event kinds: Kind 5xxx for job requests, Kind 6xxx for job results, and Kind 7000 for job feedback, with full TOON encoding/decoding support
- FR-DVM-2: Initiated agents (those with open ILP payment channels) SHALL publish DVM job requests and results via ILP PREPARE packets as the preferred path, with x402 /publish (FR-PROD-3) available as a fallback for non-initiated agents
- FR-DVM-3: DVM compute settlement (customer paying provider for work performed) SHALL be routed through the ILP network using the provider's ILP address from their kind:10035 event, settling through existing EVM payment channels
- FR-DVM-4: kind:10035 Service Discovery events SHALL include a structured skill descriptor schema declaring supported DVM kinds, capabilities, input parameters, pricing, and feature lists to enable programmatic agent-to-agent service discovery

**Advanced DVM Coordination + TEE Integration (derived from Party Mode 2020117 Analysis 2026-03-10)**

- FR-DVM-5: The protocol SHALL support workflow chains — multi-step DVM pipelines where each step's Kind 6xxx result output automatically becomes the next step's Kind 5xxx request input
- FR-DVM-6: The protocol SHALL support agent swarms — competitive DVM job execution where multiple providers submit results and the customer selects the best submission for payment
- FR-DVM-7: DVM job results (Kind 6xxx) from TEE-attested nodes SHALL include a reference to the node's kind:10033 attestation event, providing cryptographic proof that the computation ran in a verified enclave
- FR-DVM-8: The protocol SHALL define a reputation scoring system combining ILP channel volume, Web of Trust declarations (Kind 30382), job completion statistics, and job reviews (Kind 31117) into a composite score visible in kind:10035 service discovery events

**ILP Address Hierarchy & Protocol Economics (derived from Party Mode 2026-03-20)**

- FR-ADDR-1: ILP addresses SHALL be deterministically derived from the peering topology using `${parentPrefix}.${childPubkey.slice(0, 8)}`, with the root prefix (`g.toon`) as a deployment constant
- FR-ADDR-2: The BTP handshake SHALL communicate the upstream peer's prefix so the connecting node can compute its own address deterministically
- FR-ADDR-3: Multi-peered nodes SHALL hold multiple ILP addresses (one per upstream peering) and advertise all addresses in kind:10032 events
- FR-ADDR-4: Each node SHALL advertise a `feePerByte` field in kind:10032 peer info events to enable route-aware fee calculation
- FR-ADDR-5: The SDK SHALL compute total cost internally as `destinationWriteFee + Σ(hop[i].feePerByte × packetBytes)`, making fee calculation invisible to `publishEvent()` callers
- FR-ADDR-6: A new Nostr event kind SHALL enable peers to claim human-readable vanity prefixes (e.g., `useast`, `btc`) from their upstream peer by paying for the prefix, creating an ILP address marketplace

**Network Primitives — Compute Provider Protocol (derived from Party Mode Network Primitives Strategy 2026-03-22, reframed 2026-03-23)**

- FR-COMPUTE-1: The protocol SHALL define kind:5250 (Compute DVM Request) and kind:6250 (Compute DVM Result) event kinds following the NIP-90 DVM pattern, with TOON encoding/decoding support
- FR-COMPUTE-2: The compute primitive SHALL use a two-phase model: Phase 1 synchronous submit (kind:5250 ILP PREPARE returns jobId in FULFILL within ILP timeout), Phase 2 asynchronous result (poll via kind:5251 or provider publishes kind:6250 to relay)
- FR-COMPUTE-3: ~~The compute handler SHALL use a backend-agnostic `ComputeAdapter` interface~~ REMOVED — provider implementations are out of scope; providers own their backend integration
- FR-COMPUTE-4: The protocol spec SHALL document that compute DVM providers set pricing via `kindPricing[5250]` covering backend cost + convenience fee margin
- FR-COMPUTE-5: The protocol spec SHALL define self-describing receipt tags: `['backend', type]`, `['job-id', id]`, `['gateway', url]`, `['compute-ms', duration]`, `['attestation', proof]` (if TEE)
- FR-COMPUTE-6: ~~A `JobTracker` state manager SHALL handle Phase 2 async state~~ DEFERRED — may be added to consumer SDK if DX demands it
- FR-COMPUTE-7: (NEW) TOON SHALL ship a provider test harness that validates third-party provider compliance against the protocol spec
- FR-COMPUTE-8: (NEW) TOON SHALL ship provider handoff documents for HyperBEAM, Oyster CVM, and Akash ecosystems

**Network Primitives — Chain Bridge Provider Protocol (derived from Party Mode Network Primitives Strategy 2026-03-22, reframed 2026-03-23)**

- FR-BRIDGE-1: The protocol SHALL define kind:5260 (Chain Bridge DVM Request) and kind:6260 (Chain Bridge DVM Result) event kinds following the NIP-90 DVM pattern
- FR-BRIDGE-2: Tier 1 (trustless broadcast) SHALL be the initial protocol: agent signs transaction locally, provider submits to target chain(s) and pays gas, provider can only submit or not submit — zero custody risk
- FR-BRIDGE-3: Multi-chain broadcast SHALL be supported in a single ILP packet via `['param', 'chains', 'ethereum,arbitrum,base,ao']` tag, with per-chain tx hash results in the receipt
- FR-BRIDGE-4: Chain bridge results SHALL use self-describing receipts with per-chain tags: `['chain', chainName, txHash, status]`
- FR-BRIDGE-5: Chain bridge providers SHALL advertise supported chains in their kind:10035 SkillDescriptor with per-chain pricing covering gas cost + convenience fee
- FR-BRIDGE-6: AO/HyperBEAM SHALL be treated as a blockchain target (kind:5260), NOT a compute backend (kind:5250). Providers broadcast signed AO messages via HyperBEAM's HTTP API
- FR-BRIDGE-7: (NEW) TOON SHALL ship provider handoff documents for Ethereum/EVM, Solana, and AO/HyperBEAM chain bridge operators

**Loony — Autonomous Agent Application (derived from Party Mode 2026-03-23)**

- FR-LOONY-1: Loony SHALL be an example application (`packages/loony`) that demonstrates all six layers of the TOON Agent Architecture: identity, payment, discovery, primitives, composition, and agent lifecycle
- FR-LOONY-2: Loony SHALL consume LLM inference from kind:5250 compute providers discovered via marketplace (decoupled inference — no embedded LLM)
- FR-LOONY-3: Loony SHALL register as a DVM provider for composite services (workflows composed from discovered primitives), earning revenue to sustain operations
- FR-LOONY-4: Loony SHALL discover new services at runtime via kind:10035 SkillDescriptors and integrate them without code changes (emergent capability extension)
- FR-LOONY-5: Loony SHALL exercise all four network primitives: messaging (kind:1), blob storage (kind:5094), compute (kind:5250), chain bridge (kind:5260)

**NIP-34 Git Forge — The Rig (derived from TOON Service Protocol + NIP-34)**

- FR-NIP34-1: The Rig SHALL be an SDK-based service node that receives NIP-34 git events (kinds 30617, 1617, 1618, 1619, 1621, 1622, 1630-1633) via ILP packets and executes git operations via TypeScript-native git HTTP backend
- FR-NIP34-2: The Rig SHALL use Nostr pubkeys as native identity for all git operations — no separate user database, no identity mapping layer; pubkeys ARE the usernames
- FR-NIP34-3: The Rig SHALL serve a read-only web UI (TypeScript port of Forgejo's code browsing/diff templates converted from Go HTML to EJS/Eta) with issues/PRs/comments sourced from Nostr events on the relay
- FR-NIP34-4: The Rig SHALL process NIP-34 status events (kinds 1630-1633) for PR lifecycle management with pubkey-based permission checks
- FR-NIP34-5: The Rig SHALL be a single-process TypeScript service deployable via `npx @toon-protocol/rig` with no Go, no Docker, and no external database dependencies
- FR-NIP34-6: The Rig SHALL be published as `@toon-protocol/rig` on npm with a `startRig(config)` function, CLI entrypoint, and Docker image

### NonFunctional Requirements

- NFR-SDK-1: The SDK SHALL be written in TypeScript with strict mode enabled, following existing coding standards (ESLint 9.x flat config, Prettier 3.x)
- NFR-SDK-2: The SDK SHALL support Node.js 24.x via ESM
- NFR-SDK-3: The SDK SHALL achieve >80% line coverage for public APIs
- NFR-SDK-4: Developer integration time for creating a basic custom service SHALL be under 30 minutes (10 lines of code for a minimal node)
- NFR-SDK-5: The SDK SHALL use structural typing for the `ConnectorNode` interface to keep `@toon-protocol/connector` as an optional peer dependency
- NFR-SDK-6: Unit tests SHALL use mocked connectors with no live relay or blockchain dependencies
- NFR-SDK-7: The SDK package size SHALL be minimal, depending only on `@toon-protocol/core` (includes TOON codec per FR-SDK-0), `nostr-tools`, `@scure/bip39`, `@scure/bip32`

### Additional Requirements

**From Architecture - Coding Standards:**

- Use PascalCase for classes, camelCase for functions, UPPER_SNAKE_CASE for constants
- Export all public APIs from package `index.ts`
- Use `nostr-tools` types (don't redefine Nostr event types)
- Pass TOON encoder/decoder as config callbacks (DI pattern)
- Never use `any` - use `unknown` and type guards

**From Architecture - Test Strategy:**

- Vitest as test framework
- Co-located `*.test.ts` files next to source
- Factory functions for test fixtures
- AAA pattern (Arrange, Act, Assert)

**From Architecture - TOON Service Protocol:**

- Service contract is `POST /handle-packet` with `HandlePacketRequest`/`HandlePacketResponse`
- These types already exist in `packages/core/src/compose.ts`
- Connector v2.0.0 removed fulfillment/condition from application API — handlers return `{ accept: boolean }`, no SHA-256 needed
- `isTransit` flag on `PaymentRequest` signals fire-and-forget vs await semantics
- Nostr pubkeys are universal identity (no service-specific auth)
- TOON is the AI-native wire format — handlers receive raw TOON for direct LLM consumption

**From Connector Package (@toon-protocol/connector@1.4.0):**

- `ConnectorNode` class with `setPacketHandler(handler: PaymentHandler)` for simplified handling
- `PaymentRequest` includes `isTransit`, `paymentId`, `destination`, `amount`, `data`
- `PaymentResponse` returns `{ accept: boolean, data?, rejectReason? }`
- Direct methods: `registerPeer()`, `removePeer()`, `openChannel()`, `getChannelState()`, `sendPacket()`
- `deploymentMode: 'embedded'` config option
- `ConnectorConfig` with `peers`, `routes`, `btpServerPort`, `settlementInfra` options

**From Identity Design (session-derived):**

- Both Nostr (BIP-340 Schnorr) and EVM (ECDSA) use secp256k1 — same private key works for both
- BIP-39 mnemonic → BIP-32 HD derivation → NIP-06 path `m/44'/1237'/0'/0/{index}`
- One keypair = Nostr pubkey + EVM address (deterministically linked)
- Agent portability: 12-word seed phrase recovers entire identity across both layers
- Multi-agent fleet: different account indices derive distinct agents from one seed

### FR Coverage Map

FR-SDK-0: Epic 1, Story 1.0 - TOON codec extraction to @toon-protocol/core
FR-SDK-1: Epic 1, Story 1.7 - createNode() composition function
FR-SDK-2: Epic 1, Story 1.2 - Handler registry (.on/.onDefault)
FR-SDK-3: Epic 1, Story 1.3 - TOON-native HandlerContext with passthrough + lazy decode
FR-SDK-4: Epic 1, Story 1.4 - Schnorr signature verification pipeline
FR-SDK-5: Epic 1, Story 1.5 - Pricing validation with self-write bypass
FR-SDK-6: Epic 1, Story 1.6 - PaymentHandler bridge with isTransit semantics
FR-SDK-7: Epic 1, Story 1.3 - HandlerContext accept()/reject() helpers
FR-SDK-8: Epic 1, Story 1.8 - Connector direct methods API
FR-SDK-9: Epic 1, Story 1.9 - BootstrapService + RelayMonitor integration
FR-SDK-10: Epic 1, Story 1.7 - Node lifecycle (start/stop)
FR-SDK-11: Epic 1, Story 1.7 - Embedded connector mode
FR-SDK-12: Epic 1, Story 1.10 - Dev mode
FR-SDK-13: Epic 1, Story 1.11 - npm publish as @toon-protocol/sdk
FR-SDK-NEW-1: Epic 1, Story 1.1 - Unified identity from seed phrase
FR-SDK-14: Epic 2, Story 2.1 - Relay reimplementation using SDK
FR-SDK-15: Epic 2, Story 2.3 - E2E test validation
FR-SDK-16: Epic 2, Story 2.4 - Remove packages/git-proxy
FR-RELAY-1: Epic 2, Story 2.5 - Publish @toon-protocol/town package
FR-PROD-1: Epic 3, Story 3.1 - USDC token migration
FR-PROD-2: Epic 3, Story 3.2 - Multi-environment chain configuration
FR-PROD-3: Epic 3, Story 3.3 - x402 /publish endpoint
FR-PROD-4: Epic 3, Story 3.4 - Seed relay discovery
FR-PROD-5: Epic 3, Story 3.5 - kind:10035 service discovery events
FR-PROD-6: Epic 3, Story 3.6 - Enriched /health endpoint
FR-PROD-7: Epic 2, Story 2.7 - SPSP removal and peer discovery cleanup
FR-PROD-8: Epic 2, Story 2.8 - Relay subscription API on TownInstance
FR-TEE-1: Epic 4, Story 4.1 - Oyster CVM packaging
FR-TEE-2: Epic 4, Story 4.2 - Attestation server and kind:10033 events
FR-TEE-3: Epic 4, Story 4.3 - Attestation-aware peering
FR-TEE-4: Epic 4, Story 4.4 - Nautilus KMS identity
FR-TEE-5: Epic 4, Story 4.5 - Nix reproducible builds
FR-TEE-6: Epic 4, Story 4.6 - Attestation-first seed relay bootstrap
FR-DVM-1: Epic 5, Story 5.1 - DVM event kind definitions (NIP-90 compatible, TOON-encoded)
FR-DVM-2: Epic 5, Story 5.2 - ILP-native job submission for initiated agents
FR-DVM-3: Epic 5, Story 5.3 - Job result delivery + ILP-routed compute settlement
FR-DVM-4: Epic 5, Story 5.4 - Skill descriptors in kind:10035 service discovery events
FR-DVM-5: Epic 6, Story 6.1 - Workflow chains (multi-step pipelines)
FR-DVM-6: Epic 6, Story 6.2 - Agent swarms (competitive bidding)
FR-DVM-7: Epic 6, Story 6.3 - TEE-attested DVM results
FR-DVM-8: Epic 6, Story 6.4 - Reputation scoring system
FR-ADDR-1: Epic 7, Story 7.1 - Deterministic address derivation from pubkey + parent prefix
FR-ADDR-2: Epic 7, Story 7.2 - BTP address assignment handshake
FR-ADDR-3: Epic 7, Story 7.3 - Multi-address support for multi-peered nodes
FR-ADDR-4: Epic 7, Story 7.4 - Fee-per-byte advertisement in kind:10032
FR-ADDR-5: Epic 7, Story 7.5 - SDK route-aware fee calculation (invisible to users)
FR-ADDR-6: Epic 7, Story 7.6 - Prefix claim kind and vanity prefix marketplace
FR-NIP34-1: Epic 8, Stories 8.1-8.4 - Git HTTP backend and NIP-34 handlers (split across repo, patch, issue/comment, HTTP backend)
FR-NIP34-2: Epic 8, Story 8.5 - Nostr pubkey-native git identity
FR-NIP34-3: Epic 8, Stories 8.7-8.10 - Read-only code browsing web UI (split across layout+repo list, tree+blob, commits+diff, blame)
FR-NIP34-4: Epic 8, Story 8.6 - PR lifecycle via NIP-34 status events
FR-NIP34-5: Epic 8, Story 8.11 - Issues/PRs from Nostr events on relay
FR-NIP34-6: Epic 8, Story 8.12 - Publish @toon-protocol/rig package
FR-BRIDGE-1: Epic 13 - Chain Bridge DVM event kind protocol spec (kind:5260/6260)
FR-BRIDGE-2: Epic 13 - Tier 1 trustless broadcast protocol spec
FR-BRIDGE-3: Epic 13 - Multi-chain broadcast packet format spec
FR-BRIDGE-4: Epic 13 - Self-describing per-chain receipt spec
FR-BRIDGE-5: Epic 13 - Chain-specific pricing in SkillDescriptor spec
FR-BRIDGE-6: Epic 13 - AO/HyperBEAM as chain target (not compute backend)
FR-BRIDGE-7: Epic 13 - Provider handoff docs (Ethereum/EVM, Solana, AO)
FR-COMPUTE-1: Epic 14 - Compute DVM event kind protocol spec (kind:5250/6250)
FR-COMPUTE-2: Epic 14 - Two-phase compute model protocol spec (submit + async result)
FR-COMPUTE-3: REMOVED - ComputeAdapter interface (provider implementations out of scope)
FR-COMPUTE-4: Epic 14 - Convenience fee pricing documentation in protocol spec
FR-COMPUTE-5: Epic 14 - Self-describing compute receipt spec
FR-COMPUTE-6: DEFERRED - JobTracker async state management (may be added to consumer SDK if DX demands)
FR-COMPUTE-7: Epic 14 - Provider test harness for compliance validation
FR-COMPUTE-8: Epic 14 - Provider handoff docs (HyperBEAM, Oyster CVM, Akash)
FR-LOONY-1: Epic 15 - Autonomous agent demonstrating all six architecture layers
FR-LOONY-2: Epic 15 - Decoupled LLM inference via marketplace discovery
FR-LOONY-3: Epic 15 - Revenue generation as composite service DVM provider
FR-LOONY-4: Epic 15 - Emergent capability extension via runtime SkillDescriptor discovery
FR-LOONY-5: Epic 15 - Exercise all four network primitives end-to-end

## Epic List

### Epic 1: ILP-Gated Service Node SDK

A developer can create a working ILP-gated service node from a 12-word seed phrase in ~10 lines of code. The SDK provides unified secp256k1 identity (Nostr + EVM), TOON-native kind-based event handling with raw TOON passthrough for LLM consumption and lazy decode for code handlers, configurable pricing validation, embedded connector lifecycle management, network discovery, and dev mode. Includes the TOON codec extraction prerequisite. Published as `@toon-protocol/sdk`.
**FRs covered:** FR-SDK-0, FR-SDK-1, FR-SDK-2, FR-SDK-3, FR-SDK-4, FR-SDK-5, FR-SDK-6, FR-SDK-7, FR-SDK-8, FR-SDK-9, FR-SDK-10, FR-SDK-11, FR-SDK-12, FR-SDK-13, FR-SDK-NEW-1

### Epic 2: Nostr Relay Reference Implementation, Protocol Stabilization & SDK Validation

The existing relay BLS is rebuilt using the SDK's handler registry, proving SDK completeness. Adds Nostr-specific handlers (event storage) as documented examples of code-based handlers that decode TOON to structured NostrEvent objects. Published as `@toon-protocol/town` so anyone can `npm install` and run their own relay to join the network. All existing E2E tests pass. Old experimental `packages/git-proxy/` removed. Additionally, the SPSP handshake is removed from the protocol and the peer discovery flow is simplified (discover → register → announce), ensuring the SDK ships with a clean, stable protocol surface. A relay subscription API on TownInstance replaces bespoke internal components like `RelayMonitor`.
**FRs covered:** FR-SDK-14, FR-SDK-15, FR-SDK-16, FR-RELAY-1, FR-PROD-7, FR-PROD-8
**Stories:** 8 (2.1-2.8)
**Scope change (2026-03-07):** Stories 3.7 (SPSP Removal) and 3.8 (Relay Subscription API) moved from Epic 3 into Epic 2. These stories modify the SDK's public surface (removing SPSP handler, simplifying bootstrap, replacing RelayMonitor) and should land before the SDK is considered stable. The dependency of Story 3.7 on Story 3.1 (USDC) was a sequencing artifact, not a technical dependency — SPSP removal is token-agnostic.

### Epic 3: Production Protocol Economics

Production-ready protocol economics — USDC payments, x402 HTTP payment on-ramp, multi-environment chain configuration, and decentralized peer discovery. Replaces the AGENT development token with USDC, adds Arbitrum One as production chain, enables x402 as an HTTP-native payment rail alongside ILP, and replaces the genesis hub-and-spoke topology with a seed relay list model. After this epic, TOON nodes can be deployed on any infrastructure with real USDC on Arbitrum, and the protocol works end-to-end without TEE.
**FRs covered:** FR-PROD-1, FR-PROD-2, FR-PROD-3, FR-PROD-4, FR-PROD-5, FR-PROD-6
**Stories:** 6
**Decision source:** [Party Mode Decision Log](research/marlin-party-mode-decisions-2026-03-05.md) — Decisions 1, 2, 6, 7, 8, 12, 13
**Scope change (2026-03-07):** Stories 3.7 and 3.8 moved to Epic 2 (see Epic 2 scope change note)

### Epic 4: Marlin TEE Deployment

From repository to one-command *service* deployment on Marlin Oyster — starting with the relay as reference implementation. Packages the TOON Docker image for Oyster CVM, adds TEE attestation (kind:10033), implements attestation-aware peering, integrates Nautilus KMS for persistent enclave-bound identity, and establishes Nix reproducible builds for deterministic PCR values. Phases 2 (attestation-aware peering) and 3 (x402 bridge was moved to Epic 3) are developed in parallel but ship as a combined external release.
**FRs covered:** FR-TEE-1, FR-TEE-2, FR-TEE-3, FR-TEE-4, FR-TEE-5, FR-TEE-6
**Stories:** TBD (to be decomposed when epic starts)
**Decision source:** [Party Mode Decision Log](research/marlin-party-mode-decisions-2026-03-05.md) — Decisions 3, 4, 5, 9, 10, 11
**Research source:** [Marlin Integration Technical Research](research/technical-marlin-integration-research-2026-03-05.md)

### Epic 5: DVM Compute Marketplace

NIP-90 compatible DVM (Data Vending Machine) compute marketplace on the TOON network. Agents post job requests (Kind 5xxx) and receive results (Kind 6xxx) through the existing ILP payment infrastructure. Initiated agents use ILP PREPARE packets as the preferred write path; non-initiated agents use x402 as an HTTP on-ramp. Compute settlement (paying the provider for work performed) routes through the ILP network, settling through EVM payment channels. Skill descriptors in kind:10035 events enable programmatic agent-to-agent service discovery. The DVM layer creates a two-tier access model: ILP-native for committed network participants, x402 for newcomers — with the marketplace providing the economic incentive to graduate from tier 2 to tier 1.
**FRs covered:** FR-DVM-1, FR-DVM-2, FR-DVM-3, FR-DVM-4
**Stories:** 4
**Decision source:** [Party Mode 2020117 Analysis](research/party-mode-2020117-analysis-2026-03-10.md)
**Inspiration:** [2020117](https://github.com/qingfeng/2020117) — Nostr-native agent network with NIP-90 DVM marketplace (Lightning payments, Cloudflare Workers)

### Epic 6: Advanced DVM Coordination + TEE Integration

Advanced DVM coordination patterns and TEE trust integration. Workflow chains enable multi-step compute pipelines where each step's output feeds into the next step's input automatically. Agent swarms enable competitive job execution where multiple providers bid and the best result wins. TEE-attested DVM results provide cryptographic proof that computation ran in a verified enclave. A reputation scoring system combines ILP channel volume, Web of Trust declarations, job completion stats, and reviews into a composite score for programmatic trust decisions.
**FRs covered:** FR-DVM-5, FR-DVM-6, FR-DVM-7, FR-DVM-8
**Stories:** 4
**Dependencies:** Epic 4 (TEE attestation for Story 6.3), Epic 5 (base DVM for all stories)
**Decision source:** [Party Mode 2020117 Analysis](research/party-mode-2020117-analysis-2026-03-10.md)

### Epic 7: ILP Address Hierarchy & Protocol Economics

Hierarchical ILP addressing with deterministic address derivation, multi-hop fee calculation, and a prefix marketplace. Replaces the current flat, publisher-assigned ILP addressing (`g.toon.genesis`, `g.toon.peer1`) with a hierarchical model where addresses are derived from the peering topology: each upstream peer assigns child addresses as `${parentPrefix}.${childPubkey.slice(0, 8)}`. The root prefix (`g.toon`) is a deployment constant owned by the genesis node. Multi-peered nodes receive multiple addresses (one per upstream peering). Fee calculation becomes invisible to SDK users — each node advertises `feePerByte` in kind:10032 events, and the SDK sums intermediary fees along the route path internally. A new Nostr kind enables peers to claim human-readable vanity prefixes (e.g., `g.toon.useast`, `g.toon.btc`) from their upstream by paying for the prefix, creating an ILP address marketplace.

**Key Design Decisions (Party Mode 2026-03-20):**
- Identity ≠ Address ≠ Route — Nostr pubkey is identity, ILP address is reachability (ephemeral, per-peering), routes are dynamic advertisements
- Addresses are deterministic: `${parentPrefix}.${peerPubkey.slice(0, 8)}` — zero configuration, cryptographically collision-resistant
- Root prefix (`g.toon`) is a protocol constant, not assigned — the genesis node IS `g.toon`
- Fee calculation is SDK-internal: `totalAmount = destinationWriteFee + Σ(hop[i].feePerByte × packetBytes)`
- Vanity prefix claims via new Nostr kind — peers pay upstream for human-readable prefixes, creating a domain-registrar business model

**Stories:** 6
**Decision source:** Party Mode 2026-03-20 — ILP Address Generation & Fee Calculation

### Epic 8: The Rig — Fully Decentralized ILP-Gated Git

Fully decentralized git: repos exist on the protocol, not on any server. Git objects on Arweave, NIP-34 events on relays, NIP-34 Git Agent Skill teaches agents the protocol, Forge-UI static frontend on Arweave for humans. No server, no SDK library, no local git cache. Agents use skill + `@toon-protocol/client`.
**FRs covered:** FR-NIP34-1, FR-NIP34-2, FR-NIP34-3, FR-NIP34-4, FR-NIP34-5, FR-NIP34-6, FR-ARWEAVE-1
**Stories:** 13 (8.0: Arweave DVM + 8.1-8.6: NIP-34 Git Agent Skill + 8.7-8.11: Forge-UI + 8.12: Publish)
**Decision source:** Party Mode 2026-03-22 — Arweave DVM + Agent Skills
**Validates:** Epics 1 (SDK), 2 (relay), 3 (USDC/x402), 4 (TEE), 5 (DVM), 6 (Advanced DVM), 7 (ILP Addressing)

### Epic 13: Chain Bridge Primitive — Provider Protocol & DX (kind:5260)

Define the chain bridge provider protocol, refine the consumer DX, and ship provider handoff documents. **Provider implementations are out of scope** — per-chain bridge operators build their own providers. Same model as Epic 14: TOON defines the marketplace, providers integrate.

**Scope — What TOON ships:**
1. **Provider Protocol Specification** — Definitive doc for "how to build a TOON chain bridge provider": kind:5260 request format, kind:6260 result format, Tier 1 trustless broadcast semantics, multi-chain packet format, per-chain receipt tags, chain-specific pricing.
2. **Provider Test Harness** — Extend the Epic 14 test harness for kind:5260: validates tx broadcast handling, per-chain receipt format, multi-chain packet parsing, SkillDescriptor chain-specific pricing.
3. **Consumer SDK Refinements** — Ensure consumer DX for chain bridge: tx submission, receipt verification, multi-chain result parsing, chain discovery by SkillDescriptor features.
4. **Provider Handoff Documents** — One per target blockchain:
   - `provider-handoff-ethereum.md` — EVM tx broadcast, gas estimation, receipt format
   - `provider-handoff-solana.md` — Solana tx broadcast, slot receipts
   - `provider-handoff-ao.md` — AO message broadcast via HyperBEAM node, p4 fee model, slot receipt
5. **DVM Event Kind Definitions** — Finalize kind:5260/6260 schemas.

**Scope — What TOON does NOT ship:**
- No per-chain provider implementations — bridge operators own their chain integrations
- No EVM node operation, no Solana validator, no AO/HyperBEAM node operation

**FRs covered:** FR-BRIDGE-1, FR-BRIDGE-2, FR-BRIDGE-3, FR-BRIDGE-4, FR-BRIDGE-5, FR-BRIDGE-6 (reframed as protocol spec, not implementation), FR-BRIDGE-7
**Stories (8 stories):**

**Phase 1: Protocol Foundation (12.1–12.3)**
- **12.1 Chain Bridge Event Kind Definitions** — Define kind:5260 (Chain Tx Broadcast Request) and kind:6260 (Chain Tx Broadcast Result) event schemas in `@toon-protocol/core`. Builder/parser functions following the exact pattern of `arweave-storage.ts` (kind:5094) and compute event kinds (kind:5250). Tags: `['param', 'chains', 'ethereum,arbitrum,base,ao']` (comma-separated target chains), `['param', 'tx', base64(signedTx)]` (fully-signed transaction payload), `['param', 'chain-id', chainId]` (primary chain identifier), `['bid', amount, 'usdc']`. Parser validates kind range 5260, extracts chain targets and tx payload. Test helpers and roundtrip tests. Export constants: `CHAIN_BRIDGE_REQUEST_KIND = 5260`, `CHAIN_BRIDGE_RESULT_KIND = 6260`.
- **12.2 Tier 1 Trustless Broadcast Protocol** — Define Tier 1 broadcast semantics as a protocol specification document. Tier 1: provider receives a fully-signed transaction and broadcasts it to the target chain(s). Provider cannot steal funds — only submit or not submit. Define error taxonomy: `tx-rejected` (chain rejected tx), `tx-already-submitted` (idempotency — return existing receipt), `gas-estimation-failed` (EVM-specific), `chain-unavailable` (RPC down), `invalid-tx-format` (malformed payload). Define idempotency requirements: same tx hash → return cached receipt, no double-broadcast. Define timeout semantics: provider must respond within ILP packet timeout with at least `status: 'pending'` if chain confirmation is slow. Future tiers explicitly deferred with rationale: Tier 2 (construct + broadcast) requires provider to hold user keys temporarily, Tier 3 (custodial execute with TEE) requires TEE key management — both have significant security implications documented but not implemented.
- **12.3 Self-Describing Per-Chain Receipts** — Define the multi-chain receipt tag format for kind:6260 results, following D8-PM-002 (same pattern as blob storage and compute receipts). Per-chain receipt tag groups: `['chain', chainName]` (chain identifier), `['tx-hash', hash]` (chain-native tx hash), `['block', blockNum]` (block/slot number), `['status', 'confirmed' | 'pending' | 'failed']` (per-chain status), `['gas-used', gasUsed]` (EVM-specific), `['slot', slot]` (Solana/AO-specific), `['fee-paid', amount]` (actual chain fee paid by provider). Multi-chain response: multiple chain-prefixed tag groups in one kind:6260 event, ordered by chain name. Receipt parser: `parseChainBridgeReceipt(data: string): ChainBridgeReceipt | null`. `ChainBridgeReceipt` type: `{ chains: Record<string, ChainReceipt> }` where `ChainReceipt` has chain-specific fields. Validation: receipt is chain-agnostic at the protocol level — consumers parse per-chain details only if needed. Unit tests for receipt roundtrip, missing tags, unknown chain names (forward-compatible), partial success (some chains confirmed, some failed).

**Phase 2: Consumer DX (12.4–12.5)**
- **12.4 Consumer SDK Tx Submission** — Add chain bridge consumer helpers to `@toon-protocol/sdk`. `submitChainBroadcast(client, { chains, signedTx, providerPubkey?, amount }): Promise<{ jobId: string, perChainStatus: Record<string, string> }>` — wraps kind:5260 event building + `publishEvent()` with amount override. For multi-chain requests, single ILP payment covers all chains (provider prices accordingly). `pollBroadcastResult(client, jobId, { timeoutMs?, intervalMs? }): Promise<ChainBridgeReceipt>` — polls for kind:6260 result filtered by jobId. `parseBroadcastResult(event): ChainBridgeReceipt | null` — convenience parser. Example code in JSDoc showing full lifecycle: discover bridge provider via kind:10035 with chain filter → submit signed tx targeting multiple chains → poll for per-chain receipts → verify each chain's confirmation status.
- **12.5 Chain Bridge SkillDescriptor** — Define SkillDescriptor requirements for chain bridge providers. `kinds: [5260]`, pricing must be chain-specific to reflect different gas costs: `{ '5260:ethereum': '<price>', '5260:arbitrum': '<price>', '5260:ao': '<price>' }`. `features` array must include supported chains: `['bridge', 'ethereum', 'arbitrum', 'base']` or `['bridge', 'ao', 'solana']`. `inputSchema` must describe: supported chains, max tx size, supported tx formats per chain, confirmation guarantees. `buildChainBridgeSkillDescriptor()` helper that validates all required chain bridge fields including per-chain pricing. Discovery helper: `discoverChainBridgeProviders(client, { chains?, maxPrice?, features? }): Promise<SkillDescriptor[]>` — queries kind:10035 events, filters by supported chains and pricing. Unit tests for descriptor building, discovery filtering by chain, multi-chain pricing validation.

**Phase 3: Validation & Handoff (12.6–12.8)**
- **12.6 Provider Test Harness Extension** — Extend Epic 10's `@toon-protocol/provider-test` for kind:5260 validation. CLI: `npx @toon-protocol/provider-test --kind 5260 --endpoint <ilp-address> --relay <relay-url>`. Test suite validates: (1) kind:5260 tx broadcast accepted with valid payment, (2) kind:6260 result has self-describing per-chain receipt tags, (3) SkillDescriptor published to relay with correct chain bridge fields and per-chain pricing, (4) multi-chain packet handling (multiple chains in one request), (5) pricing validation rejects underpayment, (6) error handling for rejected/invalid transactions, (7) idempotency — same tx resubmitted returns cached receipt. Reference mock provider (dev-only, NOT production): simple Node.js service that accepts kind:5260, simulates broadcast to mock chain RPC, returns synthetic receipts. For test harness validation only.
- **12.7 Provider Handoff Documents** — Write three provider handoff documents (markdown, in `docs/provider-handoffs/`): (1) `provider-handoff-ethereum.md` — EVM tx broadcast provider covering Ethereum, Arbitrum, Base, and other EVM chains. RPC integration (`eth_sendRawTransaction`), gas estimation (`eth_estimateGas`), receipt polling (`eth_getTransactionReceipt`), multi-chain EVM support (same code, different RPC endpoints), receipt format mapping to kind:6260 tags, chain-specific pricing based on gas costs, example SkillDescriptor with multi-chain EVM features. (2) `provider-handoff-solana.md` — Solana tx broadcast provider. `sendTransaction` RPC, slot-based receipts, priority fee handling (`computeUnitPrice`), receipt format mapping (`slot` tag instead of `block`), Solana-specific error codes, example SkillDescriptor. (3) `provider-handoff-ao.md` — AO message broadcast via HyperBEAM node. AO message format (not EVM tx), p4 fee model (provider pays AO compute fee, passes through as convenience fee), HyperBEAM HTTP API for message submission, slot receipt from AO scheduler, example SkillDescriptor with `ao` feature. Explicitly clarifies: AO is a blockchain target for chain bridge, NOT a compute backend — compute on AO is handled by HyperBEAM compute providers via kind:5250.
- **12.8 Publish Chain Bridge Primitive** — Publish updated packages: `@toon-protocol/core` (kind:5260/6260 builders/parsers, chain bridge receipt types), `@toon-protocol/sdk` (consumer helpers, SkillDescriptor chain bridge extensions), `@toon-protocol/provider-test` (chain bridge test suite). Version bump following semver (minor version for new feature). Update `_bmad-output/project-context.md` with Epic 13 completion status, chain bridge primitive architecture section, and provider handoff doc locations. Verify all exports, run full test suite, validate E2E with reference mock provider.

**Dependencies:** Epic 8 (self-describing receipt pattern), Epic 5 (DVM event kinds), Epic 3 (multi-chain config), Epic 14 (shared test harness infrastructure)
**Decision source:** Party Mode 2026-03-22 — Network Primitives Strategy (D8-PM-003, D8-PM-006, D8-PM-008); Party Mode 2026-03-23 — Provider Protocol Model

**Key Design Decisions:**
- Tier 1 only for initial implementation: trustless broadcast. Provider cannot steal funds — only submit or not submit.
- Multi-chain in one packet: `['param', 'chains', 'ethereum,arbitrum,base,ao']`. Receipt has per-chain tags.
- AO is a blockchain target, not a compute backend. Provider has AO wallet/HyperBEAM node, pays p4 fee, returns slot receipt.
- Future tiers deferred: Tier 2 (construct + broadcast), Tier 3 (custodial execute with TEE) have significant security implications.
- Chain-specific pricing in SkillDescriptor (different gas costs per chain).
- **Provider implementations are out of scope** — same model as compute primitive.

### Epic 14: Compute Primitive — Provider Protocol & DX (kind:5250)

Define the compute provider protocol, refine the consumer DX, and ship provider handoff documents. **Provider implementations are out of scope** — third-party teams (HyperBEAM, Oyster CVM, Akash) build their own providers using TOON's protocol spec and test harness. TOON ships the marketplace definition; providers integrate.

**Scope — What TOON ships:**
1. **Provider Protocol Specification** — Definitive doc for "how to build a TOON compute provider": kind:5250 request format, kind:6250 result format, kind:7000 feedback, SkillDescriptor requirements for compute, self-describing receipt tags, two-phase async pattern (D8-PM-005), pricing model, registration flow.
2. **Provider Test Harness** — Validation tool for provider teams: `npx @toon-protocol/provider-test --kind 5250 --endpoint <url>`. Validates job handling, receipt format, SkillDescriptor correctness, two-phase async pattern.
3. **Consumer SDK Refinements** — Ensure `@toon-protocol/client` and `@toon-protocol/sdk` have excellent DX for consuming compute: job submission, result polling/subscription, receipt verification, provider discovery by features.
4. **Provider Handoff Documents** — One per target ecosystem:
   - `provider-handoff-hyperbeam.md` — `~toon-client@1.0` Erlang device architecture, R&D phases, HyperBEAM-specific integration (based on `toon-hyperbeam-integration-strategy.md`)
   - `provider-handoff-oyster-cvm.md` — Docker-based compute provider, TEE attestation integration, Nitro enclave patterns
   - `provider-handoff-akash.md` — GPU compute provider, SDL templates, Akash marketplace integration
5. **DVM Event Kind Refinements** — Finalize kind:5250/6250/5251 schemas, validate against blob storage (kind:5094) patterns, ensure consistency across all DVM kinds.

**Scope — What TOON does NOT ship:**
- No `ComputeAdapter` interface or backend implementations — providers own their backend integration
- No Oyster CVM provider code, no Akash provider code, no HyperBEAM `~toon-client@1.0` device
- No Docker-based reference provider (providers build to spec, validated by test harness)

**FRs covered:** FR-COMPUTE-1, FR-COMPUTE-2, FR-COMPUTE-4, FR-COMPUTE-5 (reframed as protocol spec, not implementation)
**FRs removed from scope:** FR-COMPUTE-3 (ComputeAdapter interface — providers own their backend), FR-COMPUTE-6 (JobTracker — consumer-side async state, may be added if DX demands it)
**Stories (8 stories):**

**Phase 1: Protocol Foundation (10.1-10.3)**
- **10.1 Compute Event Kind Definitions** — Define kind:5250 (Compute Job Request) and kind:6250 (Compute Job Result) event schemas in `@toon-protocol/core`. Builder/parser functions following the exact pattern of `arweave-storage.ts` (kind:5094). Tags: `['i', wasmRef, 'arweave']` (WASM module ref from blob storage), `['param', 'entrypoint', fn]`, `['param', 'input', base64(args)]`, `['param', 'maxComputeMs', ms]`, `['bid', amount, 'usdc']`, `['output', mimeType]`. Parser validates kind range 5250, extracts all params. Test helpers and roundtrip tests. Export constants: `COMPUTE_JOB_REQUEST_KIND = 5250`, `COMPUTE_JOB_RESULT_KIND = 6250`.
- **10.2 Two-Phase Async Result Protocol** — Define kind:5251 (Compute Job Status Query) event schema. Phase 1: synchronous submit via kind:5250 ILP PREPARE returns `{ jobId, status: 'submitted' }` in FULFILL data. Phase 2: client polls via kind:5251 with `['e', jobId]` tag, or subscribes to kind:6250 events with `['e', jobId]` filter. Define `ComputeJobStatus` type: `'submitted' | 'running' | 'completed' | 'failed' | 'timeout'`. Builder/parser for kind:5251 status query and status response. Constants: `COMPUTE_STATUS_QUERY_KIND = 5251`.
- **10.3 Self-Describing Compute Receipts** — Define the self-describing receipt tag format for kind:6250 results, following D8-PM-002 (same pattern as blob storage receipts). Receipt tags: `['compute-type', 'oyster' | 'akash' | 'docker' | ...]`, `['job-id', backendJobId]`, `['compute-ms', actualMs]`, `['result-ref', url]` (if result too large for inline), `['gateway', baseUrl]`, `['attestation', enclaveHash]` (optional, TEE only), `['status', 'completed' | 'failed']`. Receipt parser: `parseComputeReceipt(data: string): ComputeReceipt | null`. Validation: receipt is backend-agnostic — consumers never need to know which backend ran the job. Unit tests for receipt roundtrip, missing tags, unknown compute-type (forward-compatible).

**Phase 2: Consumer DX (10.4-10.5)**
- **10.4 Consumer SDK Job Submission** — Add compute consumer helpers to `@toon-protocol/sdk`. `submitComputeJob(client, { wasmRef, entrypoint, input, maxComputeMs, providerPubkey?, amount }): Promise<{ jobId: string }>` — wraps kind:5250 event building + `publishEvent()` with amount override. `pollComputeResult(client, jobId, { timeoutMs?, intervalMs? }): Promise<ComputeReceipt>` — polls via kind:5251 until status is terminal. `subscribeComputeResult(client, jobId, callback): Subscription` — subscribes to kind:6250 events filtered by jobId. `parseComputeResult(event): ComputeReceipt | null` — convenience parser. Example code in JSDoc showing full lifecycle: discover provider via kind:10035 → submit job → poll/subscribe → read result.
- **10.5 Compute Provider SkillDescriptor** — Define SkillDescriptor requirements for compute providers. `kinds: [5250]`, `pricing: { '5250': '<price-per-compute-unit>' }`, `features` array must include compute-specific capabilities: `['compute', 'wasm', 'tee']` or `['compute', 'docker', 'gpu']`. `inputSchema` must describe accepted WASM module formats, max input size, max compute time, supported architectures. Add `buildComputeSkillDescriptor()` helper that validates all required compute fields. Add discovery helper: `discoverComputeProviders(client, { features?, maxPrice?, teeRequired? }): Promise<SkillDescriptor[]>` — queries kind:10035 events, filters by compute capabilities. Unit tests for descriptor building, discovery filtering, edge cases (no providers, all filtered out).

**Phase 3: Validation & Handoff (10.6-10.8)**
- **10.6 Provider Test Harness** — Create `@toon-protocol/provider-test` package (or add to existing test infrastructure). CLI: `npx @toon-protocol/provider-test --kind 5250 --endpoint <ilp-address> --relay <relay-url>`. Test suite validates: (1) kind:5250 job submission accepted with valid payment, (2) kind:5251 status query returns valid status, (3) kind:6250 result has self-describing receipt tags, (4) SkillDescriptor published to relay with correct compute fields, (5) pricing validation rejects underpayment, (6) timeout handling (maxComputeMs exceeded → error feedback), (7) invalid WASM ref → graceful error. Reference Docker provider (dev-only, NOT production): simple Node.js container that accepts kind:5250, runs WASM via `@aspect-build/rules_js` or similar, returns result. This is for test harness validation only — not a production provider.
- **10.7 Provider Handoff Documents** — Write three provider handoff documents (markdown, in `docs/provider-handoffs/`): (1) `provider-handoff-oyster-cvm.md` — Docker-based compute provider running in Marlin Oyster CVM TEE. Covers: Dockerfile pattern, attestation integration (kind:10033 tags in receipt), Nitro enclave constraints (tmpfs, memory limits), esbuild bundling guidance, USDC payment flow on Arbitrum, example SkillDescriptor with `tee` feature. References TOON's own Oyster deployment experience. (2) `provider-handoff-akash.md` — GPU compute provider on Akash Network. Covers: SDL template for TOON compute provider, reverse auction deployment, AKT/USDC payment, `@akashnetwork/chain-sdk` integration, GPU-specific SkillDescriptor with `gpu` feature, cost optimization via spot bidding. References technical research (`technical-crypto-container-deployment-research-2026-03-24.md`). (3) `provider-handoff-hyperbeam.md` — `~toon-client@1.0` Erlang device on HyperBEAM/AO. Covers: device architecture, AO message format, p4 fee model, HyperBEAM HTTP API integration, WASM execution via AO compute units. References `toon-hyperbeam-integration-strategy.md`. Note: AO is a Chain Bridge target (kind:5260 in Epic 13), NOT a compute backend — this handoff covers only the HyperBEAM native compute device pattern.
- **10.8 Publish Compute Primitive** — Publish updated packages: `@toon-protocol/core` (kind:5250/6250/5251 builders/parsers), `@toon-protocol/sdk` (consumer helpers, SkillDescriptor compute extensions), `@toon-protocol/provider-test` (test harness CLI). Version bump following semver (minor version for new feature). Update `_bmad-output/project-context.md` with Epic 10 completion status, compute primitive architecture section, and provider handoff doc locations. Verify all exports, run full test suite, validate E2E with reference Docker provider.

**Dependencies:** Epic 8 (blob storage primitive pattern, self-describing receipts), Epic 5 (DVM event kinds), Epic 6 (TEE-attested results, reputation)
**Decision source:** Party Mode 2026-03-22 — Network Primitives Strategy (D8-PM-003, D8-PM-004, D8-PM-005); Party Mode 2026-03-23 — Provider Protocol Model

**Key Design Decisions:**
- Two-phase model: Phase 1 submit (synchronous, fits ILP timeout) returns jobId. Phase 2 result (async poll via kind:5251 or provider publishes kind:6250).
- Convenience fee pricing: providers are resellers, `kindPricing` covers backend + margin, no metering infrastructure.
- Self-describing receipts: `backend`, `job-id`, `gateway`, `compute-ms`, `attestation` tags.
- AO/HyperBEAM is NOT a compute backend — it is a blockchain (see Epic 13).
- **Provider implementations are out of scope** — TOON defines the protocol, providers integrate. Handoff docs are the key deliverable for third-party adoption.
- **Provider test harness is the force multiplier** — Validates provider compliance without requiring TOON team involvement.
- **Decoupled inference model** — LLM providers (Oyster CVM running Llama, Akash running Mixtral, HyperBEAM running WASM models) are just kind:5250 DVM providers. Agent reasoning is a service consumed via the marketplace, not embedded.

### Epic 15: Loony — Autonomous Agent Application

Loony is an example application that proves TOON Protocol can support a self-bootstrapping, self-sustaining, self-extending autonomous agent. Like Forge proves decentralized git, Loony proves the autonomous agent lifecycle. Loony exercises all four network primitives (messaging, storage, compute, chain bridge) plus composition (workflows, marketplace discovery, provider selection).

**Relationship to Protocol:**
- Loony is an APPLICATION, not a protocol feature — same relationship as Forge (`packages/rig`) to blob storage
- Loony is a CONSUMER of DVM services, not a provider — it discovers providers via kind:10035 and pays for services via ILP
- Loony validates the protocol by being the first entity on the network that isn't a node operator or human — it's an autonomous participant

**Agent Lifecycle (what Loony demonstrates):**
1. **Bootstrap** — Generate identity from seed phrase, fund wallet, connect to TOON relay, discover peers and services
2. **Perceive** — Subscribe to relay events (free reads), build map of available services from kind:10035 SkillDescriptors
3. **Reason** — Consume LLM inference from a kind:5250 compute provider (decoupled — Loony picks the best inference provider from the marketplace based on pricing/reputation/features)
4. **Act** — Publish events (messaging), store data on Arweave (kind:5094), dispatch compute jobs (kind:5250), broadcast transactions (kind:5260), compose multi-step workflows (kind:10040)
5. **Earn** — Register as a DVM provider (publish kind:10035 SkillDescriptor) for services Loony can offer (e.g., composed workflows, curated analysis, brokered compute). Accept jobs from other agents, earn convenience fees.
6. **Extend** — Discover new services at runtime that didn't exist when Loony was deployed. Read SkillDescriptors (TOON format, LLM-readable), understand new service APIs, compose novel workflows from discovered primitives, publish compositions as new SkillDescriptors for others to use.

**What Loony is NOT:**
- Not a general-purpose AI agent framework (use LangGraph, CrewAI, etc. for that)
- Not a chatbot or assistant
- Not coupled to any specific LLM (switches providers at runtime via marketplace)
- Not a protocol extension — uses only existing event kinds and primitives

**Stories (8 stories):**

**Phase 1: Identity & Bootstrap (14.1–14.2)**
- **14.1 Loony Package Scaffold & Identity Bootstrap** — Create `packages/loony` package. Loony imports `@toon-protocol/sdk` (leaf node, same relationship as Forge/`packages/rig` to blob storage — never imports core/bls directly). Generate identity from seed phrase via SDK's existing secp256k1 identity system, fund wallet from faucet in dev mode, connect to TOON relay, authenticate via BTP. Entry point: `createLoonyAgent(config: LoonyConfig): Promise<LoonyAgent>`. `LoonyConfig`: seed phrase (or mnemonic), relay URLs, chain config, initial funding amount, budget limits. `LoonyAgent` interface: `start()`, `stop()`, `getIdentity()`, `getBalance()`. Package scaffolding: `package.json` with `@toon-protocol/sdk` dependency, tsconfig extending root, vitest config, basic README. Acceptance: Loony can connect to genesis node, has valid Nostr+EVM identity, can send and receive events on the relay, wallet is funded in dev mode.
- **14.2 Service Discovery & Perception Layer** — Subscribe to kind:10035 (SkillDescriptor) events on relay via SDK subscription API. Build and maintain an in-memory `ServiceRegistry`: maps provider pubkeys to their capabilities, pricing, features, and last-seen timestamp. `ServiceRegistry` API: `discoverProviders(kind: number, features?: string[]): SkillDescriptor[]` — query the registry filtered by DVM kind and optional feature requirements. `getProvider(pubkey: string): SkillDescriptor | null`. `getBestProvider(kind: number, features?: string[], rankBy?: 'price' | 'reputation'): SkillDescriptor | null` — returns highest-ranked provider matching criteria. Auto-refresh: new kind:10035 events update the registry in real-time via relay subscription. Stale provider pruning: providers not seen for configurable TTL are deprioritized (not removed). Acceptance: Loony discovers all four primitive provider types (messaging via relay, blob storage kind:5094, compute kind:5250, chain bridge kind:5260) from relay events and can query them by kind and features.

**Phase 2: Reasoning & Action (14.3–14.5)**
- **14.3 Decoupled LLM Inference via Compute Marketplace** — Loony consumes LLM inference from a kind:5250 compute provider discovered via `ServiceRegistry` (14.2). NO embedded LLM — inference is a service consumed from the marketplace. Provider selection logic: filter by `features: ['compute', 'inference']`, rank by pricing (lowest cost) and optionally reputation (kind:7000 feedback event scores). `ReasoningEngine` class: `reason(prompt: string, context?: string): Promise<string>` — builds kind:5250 job request with inference parameters, submits via SDK's `submitComputeJob()`, polls for result, extracts response text. `selectInferenceProvider(): SkillDescriptor` — queries ServiceRegistry for best inference provider. Provider failover: if primary provider fails or times out, automatically try next-best provider from registry. Structured output support: `reasonStructured<T>(prompt: string, schema: T): Promise<T>` — requests JSON-formatted response matching schema. Acceptance: Loony sends a natural language prompt to a compute provider discovered from the marketplace and receives an LLM-generated response. Uses reference Docker provider from Epic 10 test harness in dev/test.
- **14.4 Multi-Primitive Action Layer** — Loony can exercise all four network primitives through a unified action dispatcher. Actions: (1) **Messaging** — publish Nostr events via `publishEvent()` (pay-to-write via ILP), (2) **Blob Storage** — store data on Arweave via kind:5094 using SDK's blob storage helpers, (3) **Compute** — dispatch jobs via kind:5250 using SDK's compute helpers, (4) **Chain Bridge** — broadcast transactions via kind:5260 using SDK's chain bridge helpers. `ActionDispatcher` class: `act(action: LoonyAction): Promise<LoonyResult>` — routes to the appropriate primitive based on action type. `LoonyAction` discriminated union: `{ type: 'message', content } | { type: 'store', data, contentType } | { type: 'compute', wasmRef, input } | { type: 'bridge', chains, signedTx }`. `LoonyResult`: includes primitive-specific receipt, cost incurred, and provider used. Cost tracking: every action records its ILP cost for economics (14.8). Acceptance: Loony performs at least one operation on each of the four primitives and receives valid receipts for each.
- **14.5 OODA Decision Loop** — Implement the Observe-Orient-Decide-Act autonomous loop that drives Loony's behavior. `OODALoop` class with configurable cycle: (1) **Observe** — read new relay events since last cycle (free reads), check ServiceRegistry for new/changed providers, check wallet balance. (2) **Orient** — feed observations to ReasoningEngine (14.3) with system prompt describing Loony's goals, current state, available actions, and budget constraints. LLM interprets observations and suggests priorities. (3) **Decide** — ReasoningEngine outputs a structured action plan: list of `LoonyAction` items with rationale and expected cost. Budget governor validates total cost against available balance. (4) **Act** — execute approved actions via ActionDispatcher (14.4), record results. Loop configuration: `{ intervalMs, maxActionsPerCycle, budgetPerCycle, goals[] }`. Goals are natural language strings that shape the LLM's orientation (e.g., "discover profitable service compositions", "maintain positive balance", "extend capabilities"). Graceful degradation: if no inference provider available, Loony enters passive observation mode (observe only, no reason/decide/act). Acceptance: Loony autonomously observes relay activity, reasons about observations via LLM, and takes at least one reasoned action per cycle without human intervention.

**Phase 3: Economics & Extension (14.6–14.8)**
- **14.6 DVM Provider Registration & Earning** — Loony registers as a DVM provider by publishing kind:10035 SkillDescriptor(s) for composite services it can offer. Composite service pattern: Loony orchestrates multiple primitive calls into a single workflow and charges a convenience fee margin. Example composite: "verified-deploy" = lint code (kind:5250 compute) + run tests (kind:5250 compute) + store artifact (kind:5094 blob) — Loony prices the bundle higher than the sum of sub-job costs. `CompositeServiceManager` class: `registerService(descriptor: SkillDescriptor, handler: CompositeHandler)` — publishes SkillDescriptor to relay and registers local handler. `CompositeHandler`: receives incoming kind:5250 job, orchestrates sub-jobs to real primitive providers via ActionDispatcher (14.4), aggregates results, returns composed result. Revenue tracking: each completed job records `{ earned, spent_on_sub_jobs, margin }`. Loony's SDK node handles incoming ILP payments for its registered services (same pattern as any TOON DVM provider). Acceptance: Loony publishes a SkillDescriptor for a composite service, receives a job request from another client (or test harness), orchestrates the workflow across multiple providers, returns the composed result, and earns net positive margin.
- **14.7 Runtime Capability Extension** — Loony discovers new kind:10035 SkillDescriptors at runtime that didn't exist when Loony was deployed. `CapabilityExtender` class: monitors ServiceRegistry (14.2) for new SkillDescriptors, feeds new descriptors to ReasoningEngine (14.3) with prompt: "A new service is available on the network. Here is its SkillDescriptor (TOON format). What can this service do? How could it be composed with existing services to create value?" LLM reads the descriptor (TOON format is LLM-readable by design), understands the new service API, and suggests compositions. `proposeComposition(newService: SkillDescriptor, existingServices: SkillDescriptor[]): Promise<CompositionProposal[]>` — LLM generates proposed workflows combining new and existing services. If a composition is deemed profitable (estimated margin > 0), Loony auto-registers it as a new composite service via CompositeServiceManager (14.6) and publishes a new SkillDescriptor. The marketplace IS the extension mechanism — no code changes needed to integrate new capabilities. Acceptance: A new SkillDescriptor is published to the relay after Loony starts; Loony discovers it, uses LLM reasoning to understand it, proposes a novel composition incorporating the new service, registers the composition as a new service, and can execute it when requested.
- **14.8 Self-Sustaining Economics & E2E Validation** — End-to-end validation that Loony operates as a self-sustaining autonomous agent. `LoonyEconomics` tracker: `{ totalEarned, totalSpent, currentBalance, profitableServices: { name, totalRevenue, totalCost, margin }[], unprofitableServices: { name, reason }[] }`. Budget governor integration with OODA loop: Loony won't take actions that would reduce balance below configurable reserve threshold. Economic reporting: Loony periodically publishes its economics summary as a Nostr event (transparent operation). Self-pruning: if a composite service is consistently unprofitable (margin < 0 over N executions), Loony de-registers it and stops offering it. Full E2E integration test scenario: (1) Loony bootstraps from seed phrase on test network, (2) discovers primitive providers (blob, compute, chain bridge), (3) reasons about service opportunities via LLM, (4) registers as composite service provider, (5) receives and fulfills job requests, (6) discovers a new service published mid-test, (7) extends capabilities by composing with new service, (8) maintains positive or stable balance over N OODA cycles. Performance assertions: balance trending positive, at least one composite service registered, at least one capability extension performed. Acceptance: Loony runs autonomously for N cycles demonstrating the complete agent lifecycle (bootstrap → perceive → reason → act → earn → extend) with positive or stable economics.

**Dependencies:** Epic 8 (blob storage primitive), Epic 9 (agent skills for protocol understanding), Epic 14 (compute provider protocol — at least one third-party provider must exist), Epic 13 (chain bridge provider protocol — at least one third-party provider must exist)
**Decision source:** Party Mode 2026-03-23 — Architecture + Loony + Provider Model; Party Mode 2026-03-24 — Story Decomposition

**Key Design Decisions:**
- `packages/loony` is the package — a TOON SDK consumer application, not a library
- Loony imports `@toon-protocol/sdk` (or `@toon-protocol/client`) — never core/bls directly (leaf node, same as Forge)
- LLM inference is decoupled — Loony discovers compute providers via kind:10035, picks based on pricing/reputation, consumes via kind:5250. No embedded LLM.
- Earning model — Loony acts as a DVM provider for composite services (workflows it has composed from discovered primitives). Revenue sustains its operation.
- Emergent capability extension — Loony discovers new kind:10035 SkillDescriptors at runtime, reads them (LLM-readable TOON format), and integrates new capabilities without code changes. The marketplace IS the extension mechanism.
- Self-sustaining economics — Loony earns by providing services and spends by consuming them. If it discovers a profitable composition (e.g., "verified code deploy" = lint + test + deploy), it publishes that as a new service and earns margin on each execution.

---

## Epic 1: ILP-Gated Service Node SDK

A developer can create a working ILP-gated service node from a 12-word seed phrase in ~10 lines of code. The SDK provides unified secp256k1 identity (Nostr + EVM), TOON-native kind-based event handling with raw TOON passthrough for LLM consumption and lazy decode for code handlers, configurable pricing validation, embedded connector lifecycle management, network discovery, and dev mode.

### Story 1.0: Extract TOON Codec to @toon-protocol/core

As a **SDK developer**,
I want the TOON encoder, decoder, and shallow parser to live in `@toon-protocol/core`,
So that the SDK can access TOON functionality without depending on `@toon-protocol/bls` or `@toon-protocol/relay`, avoiding circular dependencies.

**Dependencies:** None (prerequisite for all other Epic 1 stories)

**Acceptance Criteria:**

**Given** the TOON encoder and decoder currently in `@toon-protocol/bls`
**When** I move them to `packages/core/src/toon/`
**Then** `packages/core/src/toon/encoder.ts` contains the Nostr event → TOON bytes encoder
**And** `packages/core/src/toon/decoder.ts` contains the TOON bytes → Nostr event decoder
**And** `packages/core/src/toon/index.ts` re-exports encoder, decoder, and shallow-parse

**Given** the need for routing metadata extraction without full decode
**When** I create `packages/core/src/toon/shallow-parse.ts`
**Then** it exports a `shallowParseToon(data: Uint8Array): ToonRoutingMeta` function
**And** `ToonRoutingMeta` contains `{ kind: number, pubkey: string, id: string, sig: string, rawBytes: Uint8Array }`
**And** the shallow parser extracts only these fields without performing a full TOON decode

**Given** `@toon-protocol/bls` currently imports TOON codec locally
**When** I update its imports to use `@toon-protocol/core`
**Then** all existing BLS tests pass with the updated import paths
**And** the BLS package no longer contains its own copy of the codec

**Given** `@toon-protocol/relay` may reference the TOON codec
**When** I update any relay imports to use `@toon-protocol/core`
**Then** all existing relay tests pass with the updated import paths

**Given** all import paths are updated
**When** I run the full test suite (`pnpm -r test`)
**Then** all existing tests pass with zero regressions

---

### Story 1.1: Unified Identity from Seed Phrase

As a **service developer**,
I want to generate or restore my node's complete identity from a 12-word seed phrase,
So that I have one keypair for Nostr event signing and EVM settlement with deterministic recovery.

**Dependencies:** None

**Acceptance Criteria:**

**Given** no existing identity
**When** I call `generateMnemonic()`
**Then** a valid 12-word BIP-39 mnemonic is returned
**And** calling `fromMnemonic(words)` returns `{ secretKey, pubkey, evmAddress }`

**Given** an existing 12 or 24-word mnemonic
**When** I call `fromMnemonic(words)`
**Then** the returned `secretKey` is the BIP-32 derived key at NIP-06 path `m/44'/1237'/0'/0/0`
**And** the returned `pubkey` is the x-only Schnorr public key (32 bytes hex)
**And** the returned `evmAddress` is the Keccak-256 derived `0x` address from the same key

**Given** an existing 32-byte secret key
**When** I call `fromSecretKey(key)`
**Then** the returned `pubkey` and `evmAddress` are correctly derived from that key

**Given** an `accountIndex` parameter
**When** I call `fromMnemonic(words, { accountIndex: 3 })`
**Then** the derivation path is `m/44'/1237'/0'/0/3`
**And** a distinct keypair is returned for each index

### Story 1.2: Handler Registry with Kind-Based Routing

As a **service developer**,
I want to register event handlers by Nostr event kind using `.on(kind, handler)` and `.onDefault(handler)`,
So that incoming ILP packets are routed to my domain logic based on event type.

**Dependencies:** None

**Acceptance Criteria:**

**Given** a handler registry
**When** I call `.on(30617, myRepoHandler)`
**Then** incoming events with `kind: 30617` are dispatched to `myRepoHandler`

**Given** multiple kind registrations
**When** events of different kinds arrive
**Then** each event is dispatched to its registered handler only

**Given** a registered default handler via `.onDefault(handler)`
**When** an event arrives with a kind that has no specific handler
**Then** the default handler is invoked

**Given** no default handler and no matching kind handler
**When** an event arrives
**Then** the SDK automatically rejects with ILP error code `F00` (bad request)

**Given** a kind with an already registered handler
**When** I call `.on(kind, newHandler)` again
**Then** the previous handler is replaced

**Test Approach:** Unit tests covering kind match dispatch, default fallback invocation, F00 rejection when no handler matches, and handler replacement on duplicate `.on()` calls. Use mocked handlers to verify dispatch correctness.

### Story 1.3: HandlerContext with TOON Passthrough and Lazy Decode

As a **service developer**,
I want my handler to receive a `HandlerContext` with raw TOON data for direct LLM consumption and optional structured decode,
So that LLM-based handlers avoid decode overhead and code-based handlers can access typed objects.

**Dependencies:** Story 1.0 (uses ToonRoutingMeta for shallow parse metadata)

**Acceptance Criteria:**

**Given** an incoming ILP packet with base64-encoded TOON data
**When** my handler is invoked
**Then** `ctx.toon` contains the raw TOON string (no decode performed)
**And** `ctx.kind` contains the event kind (extracted via shallow TOON parse)
**And** `ctx.pubkey` contains the sender's public key (extracted via shallow TOON parse)
**And** `ctx.amount` contains the ILP payment amount as bigint
**And** `ctx.destination` contains the ILP destination address

**Given** a handler that needs structured data
**When** I call `ctx.decode()`
**Then** the full TOON to NostrEvent decode is performed and the typed object is returned
**And** subsequent calls to `ctx.decode()` return the cached result (no re-decode)

**Given** a handler that accepts the event
**When** I call `ctx.accept(data?)`
**Then** a correctly formatted `HandlePacketAcceptResponse` is produced with optional response data

**Given** a handler that rejects the event
**When** I call `ctx.reject(code, message)`
**Then** a correctly formatted `HandlePacketRejectResponse` is produced with the ILP error code

**Test Approach:** Unit tests covering raw TOON passthrough (no decode on access), lazy decode with caching (second call returns same object), accept/reject response format correctness. Verify shallow parse extracts kind/pubkey without full decode.

### Story 1.4: Schnorr Signature Verification Pipeline

As a **service developer**,
I want all incoming events to have their Schnorr signatures verified before my handler is invoked,
So that I can trust event authorship without implementing verification myself.

**Dependencies:** Story 1.0 (uses ToonRoutingMeta for id, pubkey, sig, rawBytes)

**Acceptance Criteria:**

**Given** an incoming ILP packet with a valid TOON-encoded Nostr event
**When** the Schnorr signature on the event is valid
**Then** the event is dispatched to the appropriate handler

**Given** an incoming ILP packet with an invalid signature
**When** signature verification fails
**Then** the SDK rejects with ILP error code `F06` (unexpected payment)
**And** the handler is never invoked

**Given** the SDK is configured with `devMode: true`
**When** an event with an invalid or missing signature arrives
**Then** signature verification is skipped
**And** the event is dispatched to the handler normally
**And** a debug log is emitted noting the skipped verification

**Given** the shallow TOON parse extracts `id`, `pubkey`, and `sig`
**When** verification runs
**Then** only these fields plus the serialized event bytes are needed (no full content decode required)

**Test Approach:** Unit tests covering valid signature passthrough, invalid signature → F06 rejection (handler never invoked), and devMode skip (invalid sig accepted with debug log). Use real Schnorr test vectors from nostr-tools.

### Story 1.5: Pricing Validation with Self-Write Bypass

As a **service developer**,
I want the SDK to validate ILP payment amounts against configurable pricing before my handler is invoked,
So that underpaid events are automatically rejected and my own node's events are free.

**Dependencies:** Story 1.0 (uses TOON byte length for per-byte pricing)

**Acceptance Criteria:**

**Given** a configured `basePricePerByte` (default: `10n`)
**When** an event arrives with `amount < toonBytes.length * basePricePerByte`
**Then** the SDK rejects with ILP error code `F04` (insufficient amount)
**And** the rejection metadata includes `required` and `received` amounts

**Given** a `kindPricing` map with overrides (e.g., `{ 23194: 0n }`)
**When** an event of that kind arrives
**Then** the kind-specific price is used instead of per-byte calculation

**Given** an event where `ctx.pubkey` matches the node's own pubkey
**When** pricing validation runs
**Then** the event bypasses pricing (self-write is free)
**And** the handler is invoked normally

**Given** no pricing configuration
**When** `createNode()` is called
**Then** the default `basePricePerByte: 10n` is applied

**Test Approach:** Unit — per-byte calc, per-kind override, self-write bypass, F04 rejection.

### Story 1.6: PaymentHandler Bridge with Transit Semantics

As a **service developer**,
I want the SDK to bridge my handler registry to the connector's `PaymentHandler` interface,
So that the embedded connector delivers ILP packets to my handlers with correct fire-and-forget vs await behavior.

**Dependencies:** Story 1.2 (handler registry for dispatch)

**Acceptance Criteria:**

**Given** the connector receives an ILP packet where `isTransit` is `true` (intermediate hop)
**When** the packet is delivered to the SDK's PaymentHandler bridge
**Then** the handler is invoked fire-and-forget (non-blocking)
**And** the connector continues forwarding immediately without waiting for handler response

**Given** the connector receives an ILP packet where `isTransit` is `false` (final hop)
**When** the packet is delivered to the SDK's PaymentHandler bridge
**Then** the handler is invoked and the response is awaited
**And** the handler's `accept()`/`reject()` result flows back as the ILP fulfill/reject

**Given** a handler throws an unhandled exception
**When** the PaymentHandler bridge catches it
**Then** an ILP `T00` (internal error) reject response is returned
**And** the error is logged

**Test Approach:** Unit — isTransit fire-and-forget, !isTransit await, exception → T00.

### Story 1.7: createNode() Composition with Embedded Connector Lifecycle

As a **service developer**,
I want to call `createNode(config)` and get a fully wired node with `start()` and `stop()` lifecycle methods,
So that I don't manually wire connector, handlers, verification, pricing, and bootstrap together.

**Dependencies:** Stories 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.8, 1.9 (composition of all pipeline stages)

**Acceptance Criteria:**

**Given** a valid `NodeConfig` with `secretKey`, `connector`, and at least one handler
**When** I call `createNode(config)`
**Then** a `ServiceNode` is returned with the handler registry wired to the connector's PacketHandler via the PaymentHandler bridge
**And** the verification and pricing pipelines are inserted before handler dispatch
**And** `node.pubkey` returns the Nostr x-only public key
**And** `node.evmAddress` returns the derived EVM address

**Given** a created node
**When** I call `node.start()`
**Then** the connector's `setPacketHandler()` is called with the SDK's bridge
**And** bootstrap runs (peer discovery, registration, handshakes)
**And** the relay monitor starts watching for new peers
**And** a `StartResult` is returned with `{ peerCount, channelCount, bootstrapResults }`

**Given** a started node
**When** I call `node.stop()`
**Then** the relay monitor subscription is unsubscribed
**And** lifecycle state is cleaned up
**And** calling `stop()` again is a no-op

**Given** `node.start()` is called twice without stopping
**When** the second `start()` executes
**Then** it throws a `NodeError` with message indicating already started

**Test Approach:** Integration — full pipeline: TOON → parse → verify → price → dispatch → accept/reject.

### Story 1.8: Connector Direct Methods API

As a **service developer**,
I want to access the embedded connector's peer management and channel operations through the node,
So that I can programmatically manage peers and payment channels for advanced use cases.

**Dependencies:** None

**Acceptance Criteria:**

**Given** a created node with a connector that supports channel operations
**When** I access `node.connector`
**Then** I can call `registerPeer()`, `removePeer()`, `sendPacket()`
**And** I can call `openChannel()`, `getChannelState()` for payment channel management

**Given** a connector without channel support (older version)
**When** I access `node.channelClient`
**Then** it returns `null`

**Given** a registered peer
**When** I call `node.connector.sendPacket({ destination, amount, data })`
**Then** the ILP packet is sent through the connector to the specified destination

### Story 1.9: Network Discovery and Bootstrap Integration

As a **service developer**,
I want my node to automatically discover peers, join the network, and monitor for new peers,
So that my service participates in the TOON mesh without manual peer configuration.

**Dependencies:** None (uses existing @toon-protocol/core BootstrapService and RelayMonitor)

**Acceptance Criteria:**

**Given** a node config with `knownPeers` and/or `ardriveEnabled: true`
**When** `node.start()` is called
**Then** `BootstrapService` runs layered discovery (genesis peers, ArDrive, env var peers)
**And** discovered peers are registered with the connector

**Given** a started node
**When** a new kind:10032 (ILP Peer Info) event appears on the monitored relay
**Then** the `RelayMonitor` detects it and initiates peering with the new peer

**Given** a node config with settlement configuration
**When** bootstrap registers peers
**Then** payment channels are opened unilaterally using settlement info from the peer's kind:10032 event
**And** `StartResult.channelCount` reflects opened channels

**Given** a started node
**When** I call `node.peerWith(pubkey)`
**Then** the node initiates peering with the specified pubkey (register + channel opening using kind:10032 info)

**Given** bootstrap or relay monitor events
**When** I call `node.on('bootstrap', listener)` before `start()`
**Then** I receive lifecycle events (phase changes, peer registered, channel opened, etc.)

> _Note: SPSP handshake (kind:23194/23195) was originally part of this flow but is removed in Story 2.7. Settlement negotiation runs locally using kind:10032 data; BTP claims are self-describing with on-chain verification._

### Story 1.10: Dev Mode

As a **service developer**,
I want a dev mode that skips signature verification, relaxes pricing, and logs all packets,
So that I can iterate locally without running a full network or blockchain.

**Dependencies:** Stories 1.4, 1.5 (verification and pricing pipelines to bypass)

**Acceptance Criteria:**

**Given** `createNode({ devMode: true, ... })`
**When** an event arrives with an invalid or missing signature
**Then** verification is skipped and the handler is invoked

**Given** dev mode is enabled
**When** any event arrives
**Then** the full packet details are logged (kind, pubkey, amount, destination, TOON preview)

**Given** dev mode is enabled
**When** pricing validation runs
**Then** all amounts are accepted (pricing bypass)

**Given** dev mode is NOT enabled (production)
**When** an event fails verification or pricing
**Then** it is rejected normally with no bypass

### Story 1.11: Package Setup and npm Publish

As a **service developer**,
I want to `npm install @toon-protocol/sdk` and import a clean public API,
So that I can start building immediately with TypeScript types and documentation.

**Dependencies:** Stories 1.0-1.10 (all SDK code must be complete before publish)

**Acceptance Criteria:**

**Given** the `@toon-protocol/sdk` package
**When** I inspect `package.json`
**Then** it has `"type": "module"`, TypeScript strict mode, ESLint 9.x flat config, Prettier 3.x
**And** peer dependency on `@toon-protocol/connector` (optional)
**And** dependencies on `@toon-protocol/core`, `@toon-protocol/relay` (for TOON codec), `nostr-tools`, `@scure/bip39`, `@scure/bip32`

**Given** the package entry point `index.ts`
**When** I import from `@toon-protocol/sdk`
**Then** all public APIs are exported: `createNode`, `fromMnemonic`, `fromSecretKey`, `generateMnemonic`, `HandlerContext`, `NodeConfig`, `ServiceNode`, type definitions

**Given** the package is built
**When** published to npm with `--access public`
**Then** it is available as `@toon-protocol/sdk` with correct ESM exports and TypeScript declarations

---

## Epic 2: Nostr Relay Reference Implementation, Protocol Stabilization & SDK Validation

The existing relay BLS is rebuilt using the SDK's handler registry, proving SDK completeness. Adds Nostr-specific handlers (event storage) as documented examples of code-based handlers that decode TOON to structured NostrEvent objects. Serves as the reference implementation for other developers building their own services. All existing E2E tests pass. Published as `@toon-protocol/town` so anyone can `npm install` and run their own relay to join the network. Old experimental `packages/git-proxy/` removed. The SPSP handshake is removed from the protocol and peer discovery is simplified, ensuring the SDK ships clean. A relay subscription API on TownInstance provides a general-purpose mechanism for subscribing to remote relays.

### Story 2.1: Relay Event Storage Handler

As a **relay operator**,
I want the relay BLS reimplemented as an SDK handler that stores Nostr events,
So that the existing relay functionality works on the SDK and serves as a reference for code-based handlers.

**Dependencies:** Epic 1 (SDK must be complete)

**Acceptance Criteria:**

**Given** a `createNode()` instance with a handler registered for general event kinds
**When** a paid ILP packet arrives with a TOON-encoded Nostr event
**Then** the handler calls `ctx.decode()` to get the structured NostrEvent
**And** stores the event in the EventStore (SQLite)
**And** calls `ctx.accept()` with event metadata

**Given** the handler receives an event
**When** `ctx.decode()` returns a valid NostrEvent
**Then** the event is stored with its original TOON encoding (TOON-native storage)

**Given** the relay node is configured with the node's own pubkey
**When** an event from the node's own pubkey arrives
**Then** pricing is bypassed by the SDK (self-write) and the event is stored

### Story 2.2: SPSP Handshake Handler _(DEPRECATED — removed in Story 2.7)_

> **Deprecation Notice:** This story was implemented as part of Epic 2 but the SPSP handshake (kind:23194/23195) is removed from the protocol in Story 2.7. The handshake is unnecessary because: (1) kind:10032 already publishes all settlement info publicly, (2) no STREAM protocol is used (TOON-over-ILP directly), (3) BTP claims can be made self-describing with chainId/tokenNetworkAddress/tokenAddress, and (4) connectors can verify payment channels on-chain dynamically. The `createSpspHandshakeHandler()` in `@toon-protocol/town` and all SPSP code in `@toon-protocol/core` are removed in Story 2.7.

As a **relay operator**,
I want SPSP request handling (kind:23194) reimplemented as an SDK handler,
So that settlement negotiation and peer registration work through the SDK's kind-based routing.

**Dependencies:** Epic 1 (SDK must be complete)

**Acceptance Criteria:**

**Given** a handler registered for kind `23194` (SPSP Request)
**When** an SPSP request arrives as a paid ILP packet
**Then** the handler calls `ctx.decode()` to get the Nostr event
**And** parses the NIP-44 encrypted SPSP request
**And** generates fresh SPSP parameters (destination account, shared secret)
**And** negotiates settlement chains if both parties have settlement config
**And** opens payment channels via the connector's channel client when chains intersect
**And** builds an NIP-44 encrypted SPSP response event
**And** calls `ctx.accept()` with the TOON-encoded response as fulfillment data

**Given** settlement negotiation fails
**When** the SPSP handler catches the error
**Then** it gracefully degrades to a basic SPSP response (no settlement fields)
**And** logs a warning

**Given** a successful SPSP handshake
**When** the handler has the peer's ILP address and BTP endpoint
**Then** the peer is registered with the connector via `node.connector.registerPeer()`

### Story 2.3: E2E Test Validation

As a **SDK developer**,
I want all existing E2E tests to pass when running against the SDK-based relay,
So that the SDK is proven to be a complete replacement for the manual wiring.

**Dependencies:** Stories 2.1, 2.2 (relay handlers must be implemented)

**Acceptance Criteria:**

**Given** the SDK-based relay is deployed as the genesis node
**When** the existing E2E test suite runs (`pnpm test:e2e`)
**Then** all tests pass including bootstrap, payment channel creation, and event publishing

**Given** the SDK-based relay entrypoint
**When** compared to the original `docker/src/entrypoint.ts`
**Then** the handler registrations are significantly shorter than the original ~300 lines in `entrypoint.ts`

> _Note: Target is <100 lines of handler logic, reflecting the SDK's abstraction value._

**Given** the test `genesis-bootstrap-with-channels.test.ts`
**When** it runs against the SDK-based relay
**Then** bootstrap with payment channel creation succeeds
**And** signed balance proofs are generated
**And** event publishing with ILP payment works
**And** on-chain channel state is validated

### Story 2.4: Remove packages/git-proxy and Document Reference Implementation

As a **SDK developer**,
I want the obsolete `packages/git-proxy/` removed and the SDK-based relay documented as the reference implementation,
So that the codebase is clean and developers have a clear example to follow.

**Dependencies:** None (independent cleanup, can be done in parallel)

**Acceptance Criteria:**

**Given** `packages/git-proxy/` exists in the monorepo
**When** this story is completed
**Then** the package is removed from the filesystem and `pnpm-workspace.yaml`
**And** no other package depends on it

**Given** the SDK-based relay entrypoint
**When** a developer reads the example
**Then** it demonstrates: seed phrase identity, kind-based handler registration, `ctx.decode()` for code handlers, settlement configuration, and lifecycle management
**And** inline comments explain each SDK pattern

**Given** the example code
**When** reviewed against the SDK's public API
**Then** every major SDK feature is exercised (identity, handlers, pricing, bootstrap, channels, dev mode)

### Story 2.5: Publish @toon-protocol/town Package

As a **network operator**,
I want to `npm install @toon-protocol/town` and deploy a relay with minimal configuration,
So that I can join the TOON network by running a single command with my seed phrase.

**Dependencies:** Stories 2.1, 2.3 (relay handler and E2E validation must pass)

**Acceptance Criteria:**

**Given** the `@toon-protocol/town` package
**When** I inspect `package.json`
**Then** it depends on `@toon-protocol/sdk`, `@toon-protocol/relay` (for EventStore + TOON codec), and `@toon-protocol/core`
**And** it has `"type": "module"` with TypeScript strict mode

**Given** the package entry point
**When** I import from `@toon-protocol/town`
**Then** it exports a `startTown(config)` function and a `TownConfig` type
**And** config accepts: `mnemonic` (or `secretKey`), `relayPort`, `blsPort`, `knownPeers`, `settlementConfig`, and optional overrides

**Given** a minimal configuration with just a mnemonic
**When** I call `startTown({ mnemonic: '...' })`
**Then** a relay node starts with sensible defaults (ports 7100/3100, default pricing, ArDrive discovery enabled)
**And** bootstrap runs, peers are discovered, and the relay is accepting events

**Given** the package includes a CLI entrypoint
**When** I run `npx @toon-protocol/town --mnemonic "..."` (or `--secret-key`)
**Then** a relay node starts with environment variable and CLI flag configuration
**And** Docker image is also published for container deployments

**Given** the package is built
**When** published to npm with `--access public`
**Then** it is available as `@toon-protocol/town` with correct ESM exports and TypeScript declarations

### Story 2.7: SPSP Removal and Peer Discovery Cleanup

> **Moved from Epic 3 (was Story 3.7) on 2026-03-07.** The SPSP removal modifies the SDK's public surface and bootstrap flow — it belongs in Epic 2 to ensure the SDK ships with a clean, stable protocol. The original dependency on Story 3.1 (USDC) was a sequencing artifact; SPSP removal is token-agnostic.

As a **protocol developer**,
I want the SPSP handshake removed from the protocol and the peer discovery flow simplified,
So that peers can transact immediately after discovery without a negotiation round-trip.

**Dependencies:** Stories 2.1, 2.3 (relay handlers and E2E validation must pass first). Connector must support self-describing BTP claims (see below).

**Background:**

The SPSP handshake (kind:23194/23195) exists to negotiate settlement details between peers before they can exchange ILP packets. However, every piece of information SPSP negotiates is already published in kind:10032 (ILP Peer Info):

- `destinationAccount` (ILP address) → kind:10032 `ilpAddress`
- `sharedSecret` → Not needed (no STREAM protocol; TOON-over-ILP directly)
- `negotiatedChain` → Deterministic from kind:10032 `supportedChains` intersection
- `settlementAddress` → kind:10032 `settlementAddresses`
- `tokenAddress` → kind:10032 `preferredTokens`
- `tokenNetworkAddress` → kind:10032 `tokenNetworks`
- `channelId` → Opened unilaterally by sender

Since TOON uses TOON-over-ILP (not STREAM), there is no shared secret to negotiate. The sender reads the peer's kind:10032 from the relay, selects the best matching chain locally, and opens a channel unilaterally. The connector handles BTP claim signing and verification independently (see connector handoff doc).

**Acceptance Criteria:**

**Given** the peer discovery flow currently with phases: discovering → registering → handshaking → announcing
**When** this story is completed
**Then** the handshaking phase is removed
**And** phases are: discovering → registering → announcing
**And** channel opening happens during the registration phase using kind:10032 settlement data
**And** chain selection runs locally against the peer's kind:10032 `supportedChains` (set intersection + token preference)

**Given** `addPeerToConnector()` in `BootstrapService` currently passes only `id`, `url`, and `routes` to the connector
**When** this story is completed
**Then** `addPeerToConnector()` populates the `settlement` field in `ConnectorAdminClient.addPeer()` with the chain-selected data from the peer's kind:10032: `chainId`, `tokenNetworkAddress`, `tokenAddress`, `evmAddress` (peer's settlement address), and `channelId` (from unilateral channel opening)
**And** this settlement info enables the connector to build self-describing BTP claims with `chainId`, `tokenNetworkAddress`, and `tokenAddress` fields

**Given** `node.peerWith(pubkey)` currently performs connector registration + SPSP handshake
**When** this story is completed
**Then** `peerWith()` performs: read peer's kind:10032 from relay → select chain locally → register with connector (including settlement info) → open channel unilaterally → done
**And** no kind:23194/23195 events are created or processed

**Given** the SPSP code in `@toon-protocol/core` and `@toon-protocol/town`
**When** this story is completed
**Then** `NostrSpspServer`, `NostrSpspClient`, SPSP event builders/parsers are removed from `@toon-protocol/core`
**And** `createSpspHandshakeHandler()` is removed from `@toon-protocol/town`
**And** Event kinds 23194 and 23195 are no longer used by the protocol
**And** The SDK stub `spsp-handshake-handler.ts` is removed from `@toon-protocol/sdk`
**And** `SPSP_REQUEST_KIND` and `SPSP_RESPONSE_KIND` constants are removed

**Given** the `RelayMonitor` component in `@toon-protocol/core`
**When** this story is completed
**Then** `RelayMonitor` is evaluated for removal or simplification, since the Town node's own relay subscriptions can serve the same purpose (see Story 2.8)

**Given** all existing E2E tests
**When** run against the updated peer discovery flow
**Then** all tests pass with the simplified flow (no SPSP handshake)
**And** payment channel creation works via unilateral opening

**Connector dependency:** The `@toon-protocol/connector` must support self-describing BTP claims (extended `EVMClaimMessage` with `chainId`, `tokenNetworkAddress`, `tokenAddress`) and dynamic on-chain channel verification. See handoff doc: `docs/handoffs/connector-self-describing-claims.md`

**Test Approach:** Integration tests for simplified peer discovery flow without SPSP, unilateral channel opening using kind:10032 data, and E2E validation of the complete discover → register → announce → transact flow.

### Story 2.8: Relay Subscription API on TownInstance

> **Moved from Epic 3 (was Story 3.8) on 2026-03-07.** This provides the general-purpose relay subscription API that replaces bespoke `RelayMonitor`, fitting naturally with Epic 2's protocol stabilization scope.

As a **service developer**,
I want the Town node to expose methods for subscribing to other Nostr relays,
So that I can discover peers, seed relays, and custom event kinds through a programmable API rather than relying on hardcoded internal components.

**Dependencies:** None (can be developed in parallel with other Epic 2 stories)

**Background:**

The Town node is a Nostr relay that can serve events and accept subscriptions. However, `TownInstance` currently exposes no methods for subscribing to *other* relays. Peer discovery (kind:10032), seed relay lists (kind:10036, Story 3.4), and future use cases (kind:10033 TEE attestation, custom service kinds) all require subscribing to remote relays. Rather than building separate internal components for each subscription type (e.g., `RelayMonitor`, `SeedRelayDiscovery`), the Town should expose a general-purpose relay subscription API that any of these features can use.

**Acceptance Criteria:**

**Given** a running `TownInstance`
**When** I call `town.subscribe(relayUrl, filters)`
**Then** the Town opens a WebSocket connection to the specified relay
**And** subscribes with the provided Nostr filters (kinds, authors, etc.)
**And** received events are stored in the Town's own EventStore
**And** a `Subscription` handle is returned for lifecycle management

**Given** an active subscription
**When** I call `subscription.close()`
**Then** the WebSocket subscription is cleanly closed
**And** no further events are received from that relay

**Given** a subscription to a relay that disconnects
**When** the WebSocket connection drops
**Then** the Town automatically reconnects with exponential backoff
**And** resumes the subscription from the last seen event timestamp

**Given** the Town is stopped via `town.stop()`
**When** there are active outbound subscriptions
**Then** all subscriptions are cleanly closed during shutdown

**Given** Story 3.4 (Seed Relay Discovery)
**When** implemented using this subscription API
**Then** seed relay discovery is simply `town.subscribe(publicRelayUrl, [{ kinds: [10036] }])`
**And** no separate `SeedRelayDiscovery` component is needed

**Given** peer discovery for kind:10032
**When** implemented using this subscription API
**Then** peer discovery is simply `town.subscribe(peerRelayUrl, [{ kinds: [10032] }])`
**And** the existing `RelayMonitor` can be replaced or simplified

**Test Approach:** Unit tests for subscription lifecycle (open, receive events, close, reconnect). Integration test subscribing to a local relay and verifying events arrive in the EventStore.

---

## Epic 3: Production Protocol Economics

Production-ready protocol economics — USDC payments, x402 HTTP payment on-ramp, multi-environment chain configuration, and decentralized peer discovery. After this epic, TOON nodes can be deployed on any infrastructure with real USDC on Arbitrum One, and the protocol works end-to-end without TEE.

**Decision source:** [Party Mode Decision Log](research/marlin-party-mode-decisions-2026-03-05.md)

**Key architectural decisions:**
- USDC replaces AGENT token for all user-facing payments (Decision 1)
- x402 `/publish` endpoint on the TOON node (not a separate gateway) constructs the same ILP PREPARE packets the network already routes (Decision 8)
- The BLS handles only `/handle-packet` — all public-facing endpoints belong to the node (Decision 13)
- Seed relay list replaces genesis hub-and-spoke topology (Decision 7)
- Arbitrum One is the production chain; Anvil for dev, Sepolia for staging (Decision 6)
- SPSP removal and bootstrap simplification moved to Epic 2 (Decision 12, revised — see Epic 2 scope change note)

### Story 3.1: USDC Token Migration

As a **relay operator**,
I want payment channels and pricing denominated in USDC instead of the AGENT development token,
So that the protocol uses a real, widely-held stablecoin for all user-facing payments.

**Dependencies:** Epic 2 (relay reference implementation must be complete)

**Acceptance Criteria:**

**Given** the existing TokenNetwork contracts deployed on Anvil with AGENT token
**When** this story is completed
**Then** a mock USDC ERC-20 contract is deployed on Anvil at a deterministic address for local development
**And** the TokenNetwork is configured to use the mock USDC token
**And** all payment channel operations use USDC denomination

**Given** the SDK's pricing validator with `basePricePerByte`
**When** pricing is calculated for an event
**Then** the amount is denominated in USDC (micro-units)
**And** the pricing model remains `basePricePerByte * toonData.length`

**Given** the existing faucet service
**When** this story is completed
**Then** the faucet distributes mock USDC (on Anvil) instead of AGENT tokens
**And** the faucet service is understood to be dev-only (not needed in production)

**Given** the SDK and client packages
**When** they reference token contracts
**Then** all references to "AGENT" token are replaced with "USDC" in config, types, and documentation
**And** all existing tests pass with USDC denomination

### Story 3.2: Multi-Environment Chain Configuration

As a **relay operator**,
I want to configure my node for different deployment environments (dev, staging, production),
So that I can develop locally on Anvil, test on Arbitrum Sepolia, and deploy to Arbitrum One.

**Dependencies:** Story 3.1 (USDC migration must be complete)

**Acceptance Criteria:**

**Given** the node configuration
**When** I specify `chain: 'anvil'` (or no chain config)
**Then** the node connects to the local Anvil instance at `http://localhost:8545`
**And** uses the deterministic mock USDC contract address

**Given** the node configuration
**When** I specify `chain: 'arbitrum-sepolia'`
**Then** the node connects to Arbitrum Sepolia RPC
**And** uses the testnet USDC contract address

**Given** the node configuration
**When** I specify `chain: 'arbitrum-one'`
**Then** the node connects to Arbitrum One RPC
**And** uses the production USDC contract address (`0xaf88d065e77c8cC2239327C5EDb3A432268e5831`)

**Given** environment variables
**When** `TOON_CHAIN` is set
**Then** it overrides the config file chain selection
**And** `TOON_RPC_URL` allows custom RPC endpoint override

### Story 3.3: x402 /publish Endpoint

As an **HTTP client or AI agent**,
I want to publish Nostr events to any relay in the network via a simple HTTP endpoint with USDC payment,
So that I can interact with TOON without understanding ILP or running an ILP client.

**Dependencies:** Story 3.1 (USDC denomination), Story 3.2 (Arbitrum chain config for on-chain settlement)

**Acceptance Criteria:**

**Given** a TOON node with x402 enabled (`TOON_X402_ENABLED=true`)
**When** an HTTP client sends `GET /publish` with a Nostr event payload
**Then** the node returns HTTP 402 with pricing information (amount in USDC, facilitator address, payment network)

**Given** the 402 response
**When** the client signs an EIP-3009 gasless USDC authorization and retries with `X-PAYMENT` header
**Then** the node verifies the EIP-3009 signature
**And** settles the USDC transfer on Arbitrum
**And** constructs an ILP PREPARE packet with the TOON-encoded event as data
**And** routes the PREPARE through the connector to the destination relay

**Given** the destination relay's BLS receives the ILP PREPARE
**When** `/handle-packet` processes it
**Then** the packet is indistinguishable from one sent via the ILP rail
**And** the event is stored and a FULFILL is returned

**Given** the FULFILL propagates back
**When** the node receives it
**Then** the node returns HTTP 200 with the event ID and settlement transaction hash

**Given** the destination relay is multiple hops away
**When** the node needs to price the request
**Then** the node reads the destination's kind:10032 event from the relay for ILP address and pricing info
**And** adds a routing buffer (configurable, default 5-10%) for multi-hop overhead
**And** returns the all-in USDC price in the 402 response

**Given** x402 is disabled (default)
**When** an HTTP client sends `GET /publish`
**Then** the endpoint returns 404

### Story 3.4: Seed Relay Discovery

As a **new relay operator**,
I want to bootstrap my node by connecting to any relay in a seed list rather than depending on a specific genesis node,
So that the network has no single point of failure for peer discovery.

**Dependencies:** Epic 2 (node must be functional)

**Acceptance Criteria:**

**Given** a kind:10036 (Seed Relay List) event published to a public Nostr relay
**When** a new TOON node starts with `discovery: 'seed-list'` config
**Then** the node reads kind:10036 events from configured public Nostr relays
**And** connects to seed relays from the list
**And** subscribes to kind:10032 events to discover the full network

**Given** the seed list contains multiple relay URLs
**When** the first seed relay is unreachable
**Then** the node tries the next relay in the list
**And** continues until a connection is established or the list is exhausted

**Given** a node that is already part of the network
**When** configured to publish its seed list
**Then** it publishes a kind:10036 event to configured public Nostr relays
**And** the event contains the node's WebSocket URL and basic metadata

**Given** backward compatibility requirements
**When** `discovery: 'genesis'` is configured (or default for dev mode)
**Then** the existing genesis-based bootstrap flow is used unchanged
**And** the seed list discovery is opt-in for production deployments

### Story 3.5: kind:10035 Service Discovery Events

As a **network participant or AI agent**,
I want to discover what services a TOON node offers and at what price,
So that I can programmatically find and consume services without documentation.

**Dependencies:** Story 3.1 (USDC pricing)

**Acceptance Criteria:**

**Given** a TOON node that starts successfully
**When** bootstrap completes
**Then** the node publishes a kind:10035 (Service Discovery) event to the relay network

**Given** the kind:10035 event
**When** parsed by any client
**Then** it contains: service type (e.g., "relay", "rig"), x402 endpoint URL (if enabled), ILP address, pricing model (`basePricePerByte`, currency), supported event kinds, and node capabilities

**Given** a node with x402 disabled
**When** it publishes kind:10035
**Then** the x402 endpoint field is omitted
**And** the event advertises ILP-only access

**Given** a node's pricing or capabilities change
**When** the change is detected
**Then** a new kind:10035 event is published (replaceable event, NIP-33 pattern)

### Story 3.6: Enriched /health Endpoint

As a **network operator or AI agent**,
I want the health endpoint to return comprehensive node status including pricing and capabilities,
So that I can monitor nodes and make programmatic peering decisions.

**Dependencies:** Story 3.1 (USDC pricing), Story 3.5 (service discovery data)

**Acceptance Criteria:**

**Given** a running TOON node
**When** I request `GET /health`
**Then** the response includes:
```json
{
  "phase": "running",
  "peerCount": 5,
  "channelCount": 3,
  "pricing": { "basePricePerByte": 10, "currency": "USDC" },
  "x402": { "enabled": true, "endpoint": "/publish" },
  "capabilities": ["relay", "x402"],
  "chain": "arbitrum-one",
  "version": "1.0.0"
}
```

**Given** a node running inside an Oyster CVM (future, Epic 4)
**When** I request `GET /health`
**Then** the response additionally includes TEE attestation fields (designed to be extensible)

---

## Epic 4: Marlin TEE Deployment

From repository to one-command *service* deployment on Marlin Oyster — starting with the relay as reference implementation. Stories will be decomposed in detail when this epic starts using the BMAD epic-start workflow.

**Decision source:** [Party Mode Decision Log](research/marlin-party-mode-decisions-2026-03-05.md)
**Research source:** [Marlin Integration Technical Research](research/technical-marlin-integration-research-2026-03-05.md)

**Key architectural decisions:**
- Dedicated epic, not a phase within another epic (Decision 4)
- Epic thesis: "From repository to one-command *service* deployment on Marlin Oyster — starting with the relay as reference implementation" (Decision 10)
- Phases 2 (attestation-aware peering) and 3 (combined release) develop in parallel, ship together (Decision 5)
- Autonomous agent readiness as architectural invariant — deterministic bootstrap, programmatic deployment, self-describing economics (Decision 11)
- Emergent compute vision — TOON provides substrate, peers deploy arbitrary TEE-attested services (Decision 9)
- Event kinds 10032-10099 reserved for service advertisement (Decision 9)

**High-level scope (to be decomposed into stories at epic start):**

### Story 4.1: Oyster CVM Packaging (FR-TEE-1)
Package existing TOON Docker image for Oyster CVM deployment. Add attestation server configuration, proxy endpoint mapping. Verify deployment on Oyster testnet.

### Story 4.2: TEE Attestation Events (FR-TEE-2)
Publish kind:10033 events containing PCR values, enclave image hash, and attestation documents. Define event format and publish on node startup and periodic refresh.

### Story 4.3: Attestation-Aware Peering (FR-TEE-3)
Extend BootstrapService to parse and verify kind:10033 attestation events. Peers prefer TEE-attested relays. PCR measurement verification against known-good values.

### Story 4.4: Nautilus KMS Identity (FR-TEE-4)
Integrate Nautilus KMS for persistent enclave-bound Nostr keypairs. Relay identity derived from KMS seeds inside TEE — identity bound to code integrity.

### Story 4.5: Nix Reproducible Builds (FR-TEE-5)
Establish Nix-based Docker builds producing deterministic PCR values. CI pipeline verifies PCR reproducibility across build environments.

### Story 4.6: Attestation-First Seed Relay Bootstrap (FR-TEE-6)
Integrate kind:10033 verification into the seed relay discovery flow (from Epic 3 Story 3.4). Attestation is the bootstrap trust anchor.

---

## Epic 5: DVM Compute Marketplace

NIP-90 compatible DVM (Data Vending Machine) compute marketplace on the TOON network. Agents post job requests (Kind 5xxx) and receive results (Kind 6xxx) through the existing ILP payment infrastructure. The DVM layer provides a structured job lifecycle protocol — request, feedback, result, settlement — on top of TOON's pay-to-write relay and ILP routing mesh.

**Decision source:** [Party Mode 2020117 Analysis](research/party-mode-2020117-analysis-2026-03-10.md)
**Inspiration:** [2020117](https://github.com/qingfeng/2020117) — Nostr-native agent network with NIP-90 DVM marketplace

**Key architectural decisions:**
- NIP-90 event kinds (5xxx/6xxx/7000) for interoperability with the broader Nostr DVM ecosystem (2020117, DVMDash, etc.)
- Two-tier access: ILP PREPARE packets for initiated agents (preferred), x402 /publish for non-initiated agents (fallback)
- Compute settlement routes through ILP, not direct EVM transfer — every DVM job strengthens the payment channel network (flywheel)
- Skill descriptors embedded in kind:10035 service discovery events (not a separate event kind)
- Relay write fees (per-byte) are separate from compute fees (per-job) — both settle through ILP channels
- Standard Nostr JSON in DVM events (TOON encoding is the relay's internal format; DVM protocol uses JSON for cross-network compatibility)

**Two-tier access model:**
```
Tier 1: Initiated Agents (ILP-native) — preferred path
  Agent → ILP PREPARE packet (TOON-encoded Kind 5xxx) → Relay stores → Provider reads free
  Lower cost, no HTTP overhead, native ILP routing

Tier 2: Non-Initiated Agents (x402 on-ramp) — fallback path
  Agent → POST /publish → HTTP 402 → EIP-3009 USDC auth → Relay stores
  Higher friction, but no payment channel required
```

**DVM job lifecycle on TOON:**
```
1. Customer → ILP PREPARE [Kind 5xxx job request]  → Relay (paid to write)
2. Provider ← reads Kind 5xxx (free to read)
3. Provider → ILP PREPARE [Kind 7000 feedback]     → Relay (paid to write)
4. Provider → ILP PREPARE [Kind 6xxx result]        → Relay (paid to write)
5. Customer ← reads Kind 6xxx (free to read)
6. Customer → ILP payment to Provider               → Compute settlement (routed through ILP mesh)
```

### Story 5.1: DVM Event Kind Definitions

As a **protocol developer**,
I want NIP-90 compatible DVM event kinds defined for the TOON protocol with full TOON encoding support,
So that agents can post structured job requests, receive feedback, and collect results using the standard DVM protocol.

**Dependencies:** Epic 2 (relay must support event storage and subscriptions)

**Acceptance Criteria:**

**Given** the NIP-90 DVM protocol specification
**When** this story is completed
**Then** Kind 5xxx (Job Request) events are defined with required tags: `i` (input + type), `bid` (amount in USDC micro-units), `output` (expected output type), and optional tags: `p` (target specific provider), `param` (key-value parameters), `relays` (preferred relay URLs)
**And** Kind 6xxx (Job Result) events are defined with required tags: `e` (request event ID), `p` (customer pubkey), `amount` (compute cost in USDC micro-units), and content containing the result data
**And** Kind 7000 (Job Feedback) events are defined with required tags: `e` (request event ID), `p` (customer pubkey), `status` (processing/error/success/partial), and optional content with status details

**Given** the TOON TOON format
**When** DVM events are published via ILP PREPARE packets
**Then** TOON encoder/decoder handles Kind 5xxx, 6xxx, and 7000 events correctly
**And** the TOON shallow parser extracts kind, pubkey, and event ID without full decode for routing decisions

**Given** a set of initially supported DVM job kinds
**When** the protocol launches
**Then** Kind 5100 (Text Generation) is supported as the reference DVM kind
**And** additional kinds (5200 image generation, 5300 text-to-speech, 5302 translation) are defined but provider support is optional
**And** the kind:10035 skill descriptor advertises which specific 5xxx kinds a node supports

**Given** a Kind 5xxx event with a `p` tag targeting a specific provider
**When** the event is published to the relay
**Then** only the targeted provider should process it (direct request vs. open marketplace)
**And** untargeted requests (no `p` tag) are available for any provider with matching capabilities

**Test Approach:** Unit tests for TOON encoding/decoding of all three DVM event kinds. Validation tests for required tag presence and format. Roundtrip test: JSON → TOON → JSON preserves all DVM fields.

### Story 5.2: ILP-Native Job Submission

As an **initiated agent** (with an open ILP payment channel),
I want to publish DVM job requests via ILP PREPARE packets as the preferred path,
So that I can post jobs using the native payment rail with lower cost and no HTTP overhead.

**Dependencies:** Story 5.1 (DVM event kinds must be defined), Epic 3 Story 3.3 (x402 exists as fallback)

**Acceptance Criteria:**

**Given** an initiated agent with an open ILP payment channel to a TOON relay
**When** the agent publishes a Kind 5xxx job request
**Then** the job request is TOON-encoded and sent as an ILP PREPARE packet (existing write path)
**And** the relay stores the event and broadcasts to subscribers
**And** the relay write fee is `basePricePerByte * toonData.length` (existing pricing model)

**Given** a non-initiated agent without an ILP payment channel
**When** the agent wants to publish a Kind 5xxx job request
**Then** the agent uses the x402 /publish endpoint (FR-PROD-3, Story 3.3) as fallback
**And** the resulting ILP PREPARE packet is indistinguishable from one sent via the ILP rail

**Given** a provider agent subscribed to the relay
**When** a Kind 5xxx job request is published
**Then** the provider receives the event via WebSocket subscription (free to read)
**And** the provider's SDK can filter incoming events by supported DVM kinds from its skill descriptor

**Given** the SDK's handler registry
**When** a provider registers DVM handlers
**Then** `node.on(5100, myTextGenHandler)` routes Kind 5100 job requests to the handler
**And** `ctx.decode()` returns the structured job request with input, bid, and parameters
**And** `ctx.toon` provides raw TOON for direct LLM consumption (existing TOON-native pattern)

**Given** a provider node
**When** it starts and connects to the relay
**Then** it subscribes to the relay for Kind 5xxx events matching its supported kinds (from skill descriptor)
**And** subscription uses the Town relay subscription API (Story 2.8)

**Test Approach:** Integration test: initiated agent publishes Kind 5100 job request via ILP → relay stores → provider receives via subscription. Unit test: SDK handler registration for DVM kinds. Verify x402 fallback produces identical relay-side behavior.

### Story 5.3: Job Result Delivery + Compute Settlement

As a **DVM provider agent**,
I want to publish job results and receive compute payment through the ILP network,
So that the complete job lifecycle (request → feedback → result → settlement) works end-to-end on TOON.

**Dependencies:** Story 5.2 (job submission must work), Epic 3 Story 3.1 (USDC denomination)

**Acceptance Criteria:**

**Given** a provider processing a Kind 5xxx job request
**When** the provider begins processing
**Then** it publishes a Kind 7000 feedback event with `status: 'processing'` via ILP PREPARE
**And** the relay stores the feedback and notifies the customer via subscription

**Given** a provider that has completed processing a job
**When** the provider publishes a Kind 6xxx result event
**Then** the result is sent via ILP PREPARE with tags: `e` (request event ID), `p` (customer pubkey), `amount` (compute cost in USDC micro-units)
**And** the relay stores the result and notifies the customer

**Given** a customer that has received a Kind 6xxx result
**When** the customer reads the result (free to read)
**Then** the customer's SDK extracts the provider's ILP address from their kind:10035 event
**And** the customer sends an ILP payment for the compute cost routed through the ILP mesh
**And** the payment routes: customer → connector → [intermediate hops] → provider's connector → provider
**And** settlement occurs through existing EVM payment channels (same infrastructure as relay write fees)

**Given** a Kind 6xxx result from a provider whose ILP address is reachable via multi-hop routing
**When** the customer sends the compute payment
**Then** the payment routes through the ILP mesh (e.g., customer → relay node → provider node)
**And** each intermediate connector earns routing fees (existing ILP economics)

**Given** a provider that encounters an error during processing
**When** the error occurs
**Then** the provider publishes a Kind 7000 feedback event with `status: 'error'` and error details
**And** no compute payment is expected

**Given** the SDK
**When** a DVM job lifecycle completes
**Then** the SDK provides helper functions: `publishJobRequest(input, params, bid)`, `publishFeedback(requestId, status)`, `publishResult(requestId, result, amount)`, and `settleCompute(resultEvent)`
**And** these helpers handle TOON encoding, ILP PREPARE construction, and payment routing

**Test Approach:** Integration test: full lifecycle — customer posts job → provider sends feedback → provider sends result → customer settles compute payment via ILP. Unit test: helper functions for each DVM event type. Verify compute payment routes through ILP mesh (multi-hop test if SDK E2E infra available).

### Story 5.4: Skill Descriptors in Service Discovery

As an **agent or AI system**,
I want to discover what DVM services a TOON node offers by reading structured skill descriptors in kind:10035 events,
So that I can programmatically find compatible providers and construct valid job requests without documentation.

**Dependencies:** Epic 3 Story 3.5 (kind:10035 service discovery events must exist)

**Acceptance Criteria:**

**Given** the kind:10035 (Service Discovery) event format from Story 3.5
**When** a node supports DVM services
**Then** the kind:10035 event includes a `skill` field with the structured skill descriptor
**And** the skill descriptor contains: `name` (service identifier), `version` (schema version), `kinds` (array of supported DVM Kind 5xxx numbers), `features` (capability list), `inputSchema` (JSON Schema for job request parameters), `pricing` (per-kind cost in USDC micro-units), and `models` (available AI models, if applicable)

**Given** a skill descriptor with `inputSchema`
**When** an agent reads the schema
**Then** the agent can construct a valid Kind 5xxx job request with correct `param` tags without prior knowledge of the provider's capabilities
**And** the schema follows JSON Schema draft-07 for interoperability

**Given** a node that starts with DVM handlers registered
**When** bootstrap completes
**Then** the node publishes its kind:10035 event with the skill descriptor populated from the registered DVM handlers
**And** supported kinds are derived from `.on(kind, handler)` registrations
**And** pricing is derived from the node's configured per-kind pricing (or `basePricePerByte` default)

**Given** a node's DVM capabilities change (new handler registered, pricing update)
**When** the change is detected
**Then** a new kind:10035 event is published with the updated skill descriptor (NIP-33 replaceable event)

**Given** an agent searching for a text generation provider
**When** the agent queries the relay for kind:10035 events
**Then** it can filter results by `skill.kinds` containing `5100`
**And** compare pricing across providers
**And** select the provider whose `skill.features` and `skill.models` best match the job requirements

**Given** the skill descriptor format
**When** compared to 2020117's skill JSON schema
**Then** the TOON skill descriptor is a superset — it includes all fields from 2020117's format plus TOON-specific fields: `ilpAddress`, `x402Endpoint`, `supportedChains`, and `attestation` (for Epic 6 TEE integration)

**Test Approach:** Unit test: skill descriptor generation from handler registrations. Integration test: node publishes kind:10035 with skill on startup → agent queries relay → parses skill descriptor → constructs valid job request. Validate JSON Schema compliance of inputSchema field.

---

## Epic 6: Advanced DVM Coordination + TEE Integration

Advanced DVM coordination patterns — workflow chains and agent swarms — plus TEE trust integration and reputation scoring. These features layer on top of Epic 5's base DVM marketplace and Epic 4's TEE attestation infrastructure to create a differentiated compute marketplace with verifiable execution and programmatic trust.

**Decision source:** [Party Mode 2020117 Analysis](research/party-mode-2020117-analysis-2026-03-10.md)
**Dependencies:** Epic 4 (TEE attestation for Story 6.3), Epic 5 (base DVM marketplace for all stories)

**Key architectural decisions:**
- Workflow chains use TOON relay as the orchestration layer (no separate workflow engine)
- Agent swarms settle only the winning submission — losers pay relay write fees but receive no compute payment
- TEE-attested results reference kind:10033 attestation events (not inline attestation data)
- Reputation formula adapted from 2020117: replaces zap_sats with ILP channel volume, keeps WoT and job stats
- Reputation scores are published in kind:10035 events (self-reported, verifiable from on-chain + relay data)

**Inspiration from 2020117:**
- Kind 5117 (Workflow Chain) → adapted for ILP-routed multi-step pipelines
- Kind 5118 (Agent Swarm) → adapted for competitive bidding with ILP settlement
- Reputation scoring formula: `score = (trusted_by × 100) + (log10(channel_volume) × 10) + (jobs_completed × 5) + (avg_rating × 20)`
- Kind 31117 (Job Review) → adopted directly for structured job reviews

### Story 6.1: Workflow Chains

As a **customer agent**,
I want to define multi-step DVM pipelines where each step's output automatically feeds into the next step's input,
So that I can compose complex compute tasks from simpler DVM jobs without manual orchestration.

**Dependencies:** Epic 5 (base DVM lifecycle must work end-to-end)

**Acceptance Criteria:**

**Given** a customer that wants to chain multiple DVM jobs
**When** the customer publishes a workflow definition event
**Then** the event contains: an ordered list of steps (each with a DVM kind, description, and optional provider target), the initial input, and a total bid (split across steps)
**And** the event uses a TOON-specific kind in the reserved 10032-10099 range (e.g., kind:10040 Workflow Chain)

**Given** a published workflow definition
**When** the relay receives it
**Then** the relay (or an orchestrating node) creates a Kind 5xxx job request for step 1 with the workflow's initial input
**And** publishes it via ILP PREPARE (standard DVM job submission)

**Given** a step N in the workflow completes with a Kind 6xxx result
**When** the orchestrating node detects the result
**Then** it extracts the result content from step N
**And** creates a Kind 5xxx job request for step N+1 with step N's result as the input
**And** publishes the new request via ILP PREPARE
**And** this continues until all steps are complete

**Given** the final step in a workflow completes
**When** the orchestrating node detects the final result
**Then** the workflow status is marked as completed
**And** the customer is notified (Kind 7000 feedback referencing the workflow event)
**And** compute payments for each step settle individually through ILP

**Given** any step in the workflow fails (Kind 7000 with `status: 'error'`)
**When** the orchestrating node detects the failure
**Then** the workflow is marked as failed at that step
**And** subsequent steps are not executed
**And** the customer is notified with the failure details

**Test Approach:** Integration test: 2-step workflow (text input → translation Kind 5302 → summarization Kind 5303). Verify step advancement, input chaining, and individual compute settlement. Error handling test: step 1 fails → step 2 never executes.

### Story 6.2: Agent Swarms

As a **customer agent**,
I want to post a competitive DVM job where multiple providers submit results and I select the best one for payment,
So that I can get the highest quality result by leveraging competition between providers.

**Dependencies:** Epic 5 (base DVM lifecycle must work end-to-end)

**Acceptance Criteria:**

**Given** a customer that wants competitive submissions
**When** the customer publishes a swarm job request
**Then** the event contains: the standard DVM Kind 5xxx fields, plus a `swarm` tag specifying the maximum number of providers, and a `judge` tag (default: `customer`)
**And** a standard Kind 5xxx job request is also published (so non-swarm-aware providers can still participate)

**Given** a published swarm request
**When** providers submit Kind 6xxx results
**Then** submissions are collected until the maximum provider count is reached
**And** each submission is associated with the swarm via the `e` tag referencing the original request

**Given** all submissions have been received (or a timeout is reached)
**When** the customer reviews the submissions
**Then** the customer selects the winning submission by publishing a selection event
**And** only the winning provider receives the compute payment via ILP

**Given** a swarm where fewer providers respond than the maximum
**When** a configurable timeout expires (default: 10 minutes)
**Then** the swarm proceeds to judging with whatever submissions have been received

**Given** a provider whose submission was not selected
**When** the swarm concludes
**Then** the losing provider paid relay write fees for their Kind 6xxx result but receives no compute payment
**And** the losing provider's submission is still stored on the relay for transparency

**Test Approach:** Integration test: swarm with 2 providers, customer selects winner, verify only winner receives ILP payment. Timeout test: swarm with max_providers=3 but only 1 responds within timeout.

### Story 6.3: TEE-Attested DVM Results

As a **customer agent**,
I want DVM job results to include proof that the computation ran in a TEE-attested enclave,
So that I can cryptographically verify the integrity of the computation without trusting the provider's reputation.

**Dependencies:** Epic 4 Story 4.2 (kind:10033 TEE attestation events must exist), Epic 5 Story 5.3 (job result delivery must work)

**Acceptance Criteria:**

**Given** a provider running inside a Marlin Oyster CVM with valid TEE attestation
**When** the provider publishes a Kind 6xxx result event
**Then** the result includes an `attestation` tag referencing the provider's latest kind:10033 event ID
**And** the kind:10033 event contains PCR values, enclave image hash, and attestation document

**Given** a customer receiving a Kind 6xxx result with an `attestation` tag
**When** the customer wants to verify the computation integrity
**Then** the customer reads the referenced kind:10033 event from the relay
**And** verifies the PCR measurements against known-good values (from the provider's published Nix build hashes)
**And** verifies the attestation document chain (AWS Nitro / Marlin attestation)

**Given** a customer that requires TEE-attested results
**When** the customer publishes a Kind 5xxx job request
**Then** the request includes a `param` tag: `['param', 'require_attestation', 'true']`
**And** non-TEE providers should not accept the job (their Kind 7000 feedback should indicate `status: 'error'` with reason)

**Given** the kind:10035 skill descriptor
**When** a TEE-attested node publishes its service discovery event
**Then** the skill descriptor includes an `attestation` field with the latest kind:10033 event ID and enclave image hash
**And** customers can filter providers by attestation status before submitting jobs

**Test Approach:** Unit test: attestation tag injection in Kind 6xxx events. Integration test (requires Epic 4 infrastructure): full lifecycle with TEE verification. Mock test: customer verifies attestation reference against kind:10033 event data.

### Story 6.4: Reputation Scoring System

As a **network participant**,
I want a composite reputation score for DVM providers based on verifiable on-chain and relay data,
So that I can make programmatic trust decisions about which providers to send jobs to.

**Dependencies:** Epic 5 (DVM job lifecycle for job completion stats), Epic 4 (optional — TEE attestation adds a trust signal)

**Acceptance Criteria:**

**Given** the reputation scoring formula adapted from 2020117
**When** a provider's reputation is calculated
**Then** the composite score is: `score = (trusted_by × 100) + (log10(channel_volume_usdc) × 10) + (jobs_completed × 5) + (avg_rating × 20)`
**And** `trusted_by` is the count of Kind 30382 (NIP-85 Web of Trust) declarations targeting the provider
**And** `channel_volume_usdc` is the total USDC settled through the provider's ILP payment channels (verifiable on-chain)
**And** `jobs_completed` is the count of Kind 6xxx result events published by the provider
**And** `avg_rating` is the mean of Kind 31117 (Job Review) ratings received by the provider

**Given** the Kind 31117 (Job Review) event kind
**When** a customer or provider submits a review after a DVM job
**Then** the review contains: `d` tag (job request event ID), `p` tag (target pubkey), `rating` tag (1-5 integer), `role` tag (customer/provider), and optional content (text review)
**And** one review per job per reviewer is enforced by the `d` tag (NIP-33 replaceable event)

**Given** a provider's kind:10035 service discovery event
**When** the provider publishes or updates their event
**Then** it includes a `reputation` field with the self-reported composite score and individual signal values
**And** all signals are independently verifiable: WoT from relay (Kind 30382), channel volume from on-chain data, job count from relay (Kind 6xxx), ratings from relay (Kind 31117)

**Given** a customer posting a DVM job request
**When** the customer wants to filter providers by reputation
**Then** the customer can include a `param` tag: `['param', 'min_reputation', '<score>']`
**And** providers with scores below the threshold should not accept the job

**Given** a TEE-attested provider (Epic 4)
**When** their reputation is displayed
**Then** the attestation status is shown alongside the reputation score as an additional trust signal
**And** TEE attestation is NOT factored into the numeric score (it's a separate, binary trust layer)

**Test Approach:** Unit test: score calculation from mock signal data. Integration test: full flow — customer posts job → provider completes → customer submits Kind 31117 review → provider's reputation score updates. Verify on-chain channel volume extraction. Verify Kind 30382 WoT counting.

---

## Epic 7: ILP Address Hierarchy & Protocol Economics

Hierarchical ILP addressing with deterministic address derivation, multi-hop fee calculation, a prefix marketplace, and the prepaid protocol model. Replaces flat publisher-assigned addressing with a topology-derived hierarchy. Fee calculation becomes invisible to SDK users. A new Nostr kind enables vanity prefix purchases from upstream peers. Adopts the prepaid model for DVM compute, deprecating `settleCompute()` in favor of single-packet payment-with-message semantics.

**Decision source:** Party Mode 2026-03-20

### Design Decisions (Party Mode 2026-03-20)

**D7-001: Prepaid DVM Model.** The Kind 5xxx job request's ILP PREPARE amount equals the provider's advertised price (from `SkillDescriptor.pricing`). The request packet IS the payment — no separate `settleCompute()` call. This respects the protocol thesis: "sending a message and sending money are the same action." `settleCompute()` is deprecated.

**D7-002: Supply-Driven Marketplace.** The DVM marketplace flips from demand-driven (customer posts job, waits) to supply-driven (provider advertises capabilities and pricing in `SkillDescriptor`, customer discovers, shops, and pays on submission). `SkillDescriptor.pricing` is the price tag, not a negotiation starting point.

**D7-003: Prefix Claim Single-Packet Payment.** The prefix claim event's ILP PREPARE amount IS the prefix price. One packet carries claim data + payment. Handler validates `ctx.amount >= prefixPricing.basePrice`. Same pattern as prepaid DVM.

**D7-004: Unified Protocol Payment Pattern.** All monetized flows follow the same pattern: (1) provider advertises capability + price via replaceable Nostr event, (2) customer discovers price, (3) customer sends message + payment in ONE ILP packet, (4) provider validates amount and responds. Three use cases (relay write, DVM compute, prefix claim), one primitive.

**D7-005: Prefix Claims Use Own Event Kinds.** Prefix claiming is a stateful control-plane operation (mutates routing topology, persistent state) — NOT a DVM compute job. Uses own event kinds in the 10032-10099 TOON service advertisement range. However, the ILP payment mechanism is identical to DVM prepaid model.

**D7-006: Bid Tag Semantic Shift.** The `bid` tag in Kind 5xxx events shifts from "I offer to pay this much" (Epic 5) to "I won't pay more than this" (Epic 7). Actual payment comes from `SkillDescriptor.pricing`. If `advertisedPrice > bid`, SDK refuses to send (client-side safety cap).

**D7-007: publishEvent() Amount Override.** `publishEvent()` gains an optional `amount` parameter so customers can set the ILP PREPARE amount to the provider's advertised price instead of `basePricePerByte × bytes`. This enables prepaid DVM and prefix claim flows without new payment machinery.

**Full decision record:** `_bmad-output/planning-artifacts/research/party-mode-prepaid-protocol-decisions-2026-03-20.md`

### Story 7.1: Deterministic Address Derivation

**As a** TOON node operator,
**I want** my ILP address to be deterministically derived from my Nostr pubkey and my upstream peer's prefix,
**So that** address assignment is automatic, collision-resistant, and requires zero configuration.

**Acceptance Criteria:**

**Given** a node with Nostr pubkey `abcd1234...` peering with a node at prefix `g.toon`
**When** the peering handshake completes
**Then** the node's ILP address is `g.toon.abcd1234` (first 8 hex chars of pubkey)

**Given** the genesis node with network prefix `g.toon`
**When** it starts
**Then** its ILP address is `g.toon` (the root prefix, a protocol constant)

**Given** a `deriveChildAddress(parentPrefix, childPubkey)` utility function
**When** called with `('g.toon.ef567890', '11aabb22...')`
**Then** it returns `g.toon.ef567890.11aabb22`

**Test Approach:** Unit test: `deriveChildAddress()` with various inputs. Verify ILP address segment validation (lowercase, valid chars). Verify 8-char truncation. Verify root prefix is a constant.

### Story 7.2: BTP Address Assignment Handshake

**As a** TOON node,
**I want** my upstream peer to communicate its prefix during the BTP handshake,
**So that** I can deterministically compute my own ILP address from the peering relationship.

**Acceptance Criteria:**

**Given** a node initiating a BTP connection to an upstream peer
**When** the BTP handshake completes
**Then** the upstream peer's prefix is communicated to the connecting node
**And** the connecting node computes its address as `${upstreamPrefix}.${ownPubkey.slice(0, 8)}`

**Given** a node that was previously addressed as `g.toon.peer1` (hardcoded)
**When** it connects via the new handshake protocol
**Then** its address is derived from the upstream prefix + its pubkey (not hardcoded)

**Test Approach:** Integration test: two nodes peer via BTP, verify child receives correct address derived from parent's prefix. Unit test: handshake message parsing.

### Story 7.3: Multi-Address Support for Multi-Peered Nodes

**As a** TOON node peered with multiple upstream connectors,
**I want** to hold multiple ILP addresses (one per peering),
**So that** I am reachable via any of my upstream paths.

**Acceptance Criteria:**

**Given** a node peered with both `g.toon.useast` and `g.toon.euwest`
**When** it publishes its kind:10032 peer info event
**Then** the event contains `ilpAddresses: ['g.toon.useast.{pubkey8}', 'g.toon.euwest.{pubkey8}']`

**Given** a client resolving a destination by Nostr pubkey
**When** the destination node has multiple ILP addresses
**Then** the client can select the optimal route based on available paths

**Test Approach:** Unit test: kind:10032 event with multiple addresses. Integration test: node with two peers, verify both addresses are advertised and routable.

### Story 7.4: Fee-Per-Byte Advertisement in kind:10032

**As a** TOON node operator,
**I want** to advertise my routing fee in kind:10032 peer info events,
**So that** senders can calculate the total cost of multi-hop routes.

**Acceptance Criteria:**

**Given** a node with `feePerByte: 2n` configured
**When** it publishes its kind:10032 peer info event
**Then** the event includes `feePerByte: 2` alongside existing fields (`ilpAddresses`, `btpEndpoint`, `capabilities`)

**Given** a node with no explicit fee configuration
**When** it publishes kind:10032
**Then** `feePerByte` defaults to `0` (free routing)

**Test Approach:** Unit test: kind:10032 event builder includes `feePerByte`. Integration test: peer discovers fee via kind:10032 subscription.

### Story 7.5: SDK Route-Aware Fee Calculation

**As an** SDK user calling `publishEvent()`,
**I want** the SDK to automatically calculate and include intermediary routing fees,
**So that** the recipient receives the correct write fee without me knowing about multi-hop costs.

**Acceptance Criteria:**

**Given** a publish from `g.toon.useast.client-abc` to `g.toon.euwest.relay-42`
**And** the route traverses two intermediaries with `feePerByte: 2n` and `feePerByte: 3n`
**When** the SDK computes the ILP PREPARE amount
**Then** `amount = (basePricePerByte × toonBytes.length) + (2n × toonBytes.length) + (3n × toonBytes.length)`

**Given** a direct single-hop publish (no intermediaries)
**When** the SDK computes the amount
**Then** `amount = basePricePerByte × toonBytes.length` (unchanged from current behavior)

**Given** the fee calculation
**When** the user calls `publishEvent(event)`
**Then** the fee math is completely internal — no fee parameters exposed to the user

**Test Approach:** Unit test: fee calculator with mock route table. Integration test: multi-hop publish with fee-charging intermediaries, verify destination receives correct write fee. E2E test: full publish through Docker infra with intermediary fees.

### Story 7.6: Prepaid DVM Model and settleCompute() Deprecation

**As an** SDK user submitting DVM jobs,
**I want** the job request packet to carry both the data and the payment in a single ILP PREPARE,
**So that** the protocol thesis ("sending a message and sending money are the same action") holds for DVM compute.

**Design Decisions:** D7-001 (prepaid model), D7-002 (supply-driven marketplace), D7-006 (bid semantic shift), D7-007 (amount override)

**Acceptance Criteria:**

**Given** a provider advertising `SkillDescriptor.pricing: { '5100': '50000' }` in kind:10035
**When** a customer sends a Kind 5100 job request
**Then** the ILP PREPARE amount equals the provider's advertised price (`50000`), not `basePricePerByte × bytes`
**And** the provider's handler receives both the job data and payment via `ctx.amount`

**Given** `publishEvent()` with an `amount` option
**When** called with `publishEvent(event, { destination, amount: 50000n })`
**Then** the ILP PREPARE packet uses the specified amount instead of computing `basePricePerByte × toonBytes.length`

**Given** a provider's handler for Kind 5100
**When** it receives a job request where `ctx.amount < advertisedPrice`
**Then** the handler rejects the packet and payment is not transferred

**Given** a Kind 5xxx job request with `bid: '60000'` and a provider advertising price `50000`
**When** the SDK prepares to send the request
**Then** the ILP PREPARE amount is `50000` (advertised price, not bid)
**And** if `advertisedPrice > bid`, the SDK refuses to send (client-side safety cap)

**Given** the existing `settleCompute()` method on `ServiceNode`
**When** Epic 7 is complete
**Then** `settleCompute()` is deprecated with a JSDoc `@deprecated` annotation pointing to the prepaid model

**Given** a Kind 6xxx job result with an `amount` tag
**When** the provider sends the result
**Then** the `amount` tag is informational metadata (actual compute cost), not a payment invoice

**Test Approach:** Unit test: `publishEvent()` with `amount` override sends correct ILP PREPARE amount. Unit test: bid validation — SDK refuses when `advertisedPrice > bid`. Integration test: full prepaid DVM flow — customer discovers provider pricing, sends job + payment in one packet, provider validates `ctx.amount`, processes, returns result. E2E test: Docker infra with provider advertising pricing in kind:10035, customer submitting prepaid job. Verify no `settleCompute()` call needed. Verify `settleCompute()` still works (backward compat) but logs deprecation warning.

### Story 7.7: Prefix Claim Kind and Marketplace

**As a** TOON node operator,
**I want** to claim a human-readable vanity prefix (e.g., `useast`, `btc`) from my upstream peer by paying for it,
**So that** my node has a memorable, branded ILP address instead of a pubkey-derived one.

**Design Decisions:** D7-003 (single-packet payment), D7-005 (own event kinds, not DVM), D7-007 (amount override from Story 7.6)

**Acceptance Criteria:**

**Given** a new Nostr event kind for prefix claim requests (in the 10032-10099 TOON service advertisement range)
**When** a node sends a prefix claim event with `{ requestedPrefix: 'useast' }` as an ILP PREPARE packet
**And** the ILP PREPARE amount equals the upstream's advertised prefix price
**Then** the upstream handler validates: (1) the prefix is available (not already claimed), (2) `ctx.amount >= prefixPricing.basePrice`
**And** responds with a confirmation event granting the prefix
**And** no separate payment packet is needed — the claim request IS the payment (D7-003)

**Given** a node that has claimed `useast` from `g.toon`
**When** it peers with child nodes
**Then** its prefix is `g.toon.useast` (the vanity prefix replaces the pubkey-derived default)
**And** child nodes are addressed as `g.toon.useast.{childPubkey8}`

**Given** a prefix that is already claimed by another peer
**When** a new node requests the same prefix
**Then** the ILP packet is rejected with a `PREFIX_TAKEN` error and payment is not transferred

**Given** the upstream peer's pricing for vanity prefixes
**When** it advertises in kind:10032
**Then** it includes prefix pricing information (e.g., `prefixPricing: { basePrice: 1000000n }`)

**Given** the prefix claim handler registered via `.on(PREFIX_CLAIM_KIND, handler)`
**When** the handler receives a claim request
**Then** it validates via `ctx.amount` (existing pipeline) — no new payment machinery needed

**Test Approach:** Unit test: prefix claim event creation, validation, conflict detection, amount validation against `prefixPricing.basePrice`. Integration test: full claim flow — request with payment in single packet, confirmation, address activation. Verify claimed prefix overrides pubkey-derived address. Verify insufficient payment is rejected (packet rejected, no money moves). Verify already-claimed prefix returns `PREFIX_TAKEN`.

---

## Epic 8: The Rig — Arweave DVM + Forge-UI

A fully decentralized git system where repositories exist on the protocol, not on any server. Git objects (blobs, trees, commits) are stored permanently on Arweave. NIP-34 events on relays handle the social layer (repos, patches, issues, PRs, status). Epic 8 delivers two infrastructure artifacts: (1) an **Arweave Storage DVM provider** (kind:5094), and (2) the **Forge-UI** — a static read-only web frontend hosted on Arweave for human browsing. The NIP-34 Git Agent Skill (teaching AI agents the protocol) has been moved to **Epic 9** (Stories 9.26-9.30) as part of the NIP-to-TOON Skill Pipeline.

**FRs covered:** FR-ARWEAVE-1, FR-NIP34-3 (Forge-UI subset)
**Stories:** 7 (8.0: Arweave DVM + 8.1-8.5: Forge-UI + 8.6: Publish)
**Reference:** [forgejo](https://codeberg.org/forgejo/forgejo) (Go, GPL-3.0) — visual reference for Forge-UI template port
**Decision source:** Party Mode 2026-03-22 — Arweave DVM + Fully Decentralized Git + Agent Skills; Party Mode 2026-03-22 — NIP Skills Epic restructuring (NIP-34 skill stories moved to Epic 9)
**Validates:** Epics 1 (SDK), 2 (relay), 3 (USDC/x402), 4 (TEE), 5 (DVM), 6 (Advanced DVM), 7 (ILP Addressing)
**Depends on:** Epic 9 Phase 8 (NIP-34 skill, stories 9.26-9.30) for agent protocol knowledge consumed by Forge-UI's design

**Architecture notes:**

- **No server, no SDK library.** The Rig is: (1) an Arweave DVM provider (SDK required for hosting handler), (2) a Forge-UI static frontend on Arweave. The NIP-34 Git Agent Skill is in Epic 9.
- **Transport is `@toon-protocol/client`, not SDK.** Agents send events via the client's `publishEvent()`. The SDK (`createNode()`, handler registry, embedded connector) is only for providers (like the Arweave DVM). Agents are clients, not nodes.
- **Arweave is the source of truth for code.** Every git object (blob, tree, commit) uploaded to Arweave via kind:5094 using ArDrive/Turbo (`@ardrive/turbo-sdk`). Arweave data item tags (`Git-SHA`, `Git-Type`, `Repo`). Content-addressed: git SHA → Arweave tx ID. Resolvable via Arweave GraphQL or manifest transaction. Dev: `TurboFactory.unauthenticated()` (free ≤100KB); Prod: `TurboFactory.authenticated()` (paid, uncapped).
- **NIP-34 events on relays are the source of truth for collaboration.** kind:30617 (repos), kind:1617 (patches), kind:1621/1622 (issues/comments), kind:1618/1619 (PRs), kind:1630-1633 (status), kind:30618 (refs/branches). All ILP-gated on TOON relays.
- **Repos are portable.** A repo = Arweave transactions + NIP-34 events. Any agent can interact with any repo.
- **Forge-UI is a static web app on Arweave.** Read-only HTML/JS querying relays + Arweave gateways. Permanently hosted, censorship-resistant. Scope: repo list, file tree, blob viewer, commit log, diff, blame, issues, PRs.
- **Nostr pubkeys ARE identity.** No user database. Maintainer permissions from kind:30617 `maintainers` tags.
- **NIP-90 DVM for code review (future).** DVM marketplace extends to CI/TDD review pipelines. Not in Epic 8 scope.
- **Phase 1: Arweave Storage DVM (Story 8.0)** — kind:5094 provider using ArDrive/Turbo (SDK required for hosting handler)
- **Phase 2: Forge-UI (Stories 8.1-8.5)** — static web frontend on Arweave
- **Phase 3: Publish (Story 8.6)** — Forge-UI deployment to Arweave via kind:5094

### Story 8.0: Arweave Storage DVM Provider (kind:5094)

As a **TOON agent**,
I want to upload blobs to permanent storage by sending a single ILP packet to an Arweave DVM provider,
So that I can store files permanently without knowing about Arweave, holding AR tokens, or making multiple round trips.

**Dependencies:** Epic 7 Story 7.6 (prepaid DVM model, `publishEvent()` amount override)

**Design Decisions:** D7-001 (prepaid model), D7-004 (unified payment pattern — blob + payment in ONE ILP PREPARE)

**Acceptance Criteria:**

**Given** a kind:5094 event builder
**When** I call `buildBlobStorageRequest({ keypair, blobData, contentType?, params? })`
**Then** a valid kind:5094 event is produced with the blob base64-encoded in the `i` tag (type: `blob`)
**And** a `parseBlobStorageRequest()` parser returns `{ blobData, contentType, uploadId?, chunkIndex?, totalChunks? }` or null for malformed events

**Given** an Arweave DVM provider node with `kindPricing[5094]` configured
**When** it starts and publishes kind:10035 service discovery
**Then** the `SkillDescriptor` includes `kinds: [5094]` and `pricing: { '5094': '<price-per-byte>' }`
**And** agents can discover the provider by querying relays for kind:10035 events with kind:5094 support

**Given** a client sends a kind:5094 ILP PREPARE to the provider's ILP address
**And** the amount equals `kindPricing[5094] × blobSize` (D7-001 prepaid model)
**When** the provider's handler receives the packet
**Then** the pricing validator confirms `ctx.amount >= kindPricing[5094] × rawBytes.length`
**And** the handler extracts the blob, uploads to ArDrive/Turbo via `TurboAuthenticatedClient.uploadFile()` (instant receipt)
**And** returns `ctx.accept()` with the Arweave transaction ID in the FULFILL packet's data field
**And** the client receives the Arweave tx ID from the FULFILL response

**Given** the Arweave tx ID returned in the FULFILL
**When** the client fetches `https://arweave.net/<tx-id>` or `https://gateway.irys.xyz/<tx-id>`
**Then** the original blob bytes are returned (permanent, immutable, publicly accessible)

**Given** a blob larger than the single-packet threshold (~512KB)
**When** the client calls the chunked upload helper
**Then** the blob is split into chunks, each sent as a separate kind:5094 ILP PREPARE
**And** each chunk includes `uploadId`, `chunkIndex`, `totalChunks` params
**And** each chunk is its own message+payment (protocol thesis: "sending a message and sending money are the same action")
**And** the provider accumulates chunks, uploads the assembled blob to Arweave when all arrive
**And** the final chunk's FULFILL data field contains the Arweave tx ID
**And** intermediate chunk FULFILLs contain acknowledgment data (e.g., `ack:<chunkIndex>`)

**Given** a chunked upload where not all chunks arrive within the provider's timeout
**When** the timeout expires
**Then** the provider discards partial chunks (no Arweave upload, no cost incurred)

**Given** the provider receives a kind:5094 request with insufficient payment
**When** `ctx.amount < kindPricing[5094] × rawBytes.length`
**Then** the handler rejects with F04 (Insufficient Payment) and no Arweave upload occurs

**Test Approach:** Unit test: kind:5094 event builder/parser roundtrip. Unit test: insufficient payment rejection. Integration test: single-packet upload — real ArDrive/Turbo free tier (≤100KB test payloads), verify tx ID in FULFILL data, verify blob accessible via `arweave.net/<tx-id>`. Integration test: chunked upload — multiple packets with small chunks (each ≤100KB, free tier), verify assembly and final tx ID. Integration test: full prepaid flow — discover provider pricing from kind:10035, send blob + payment, receive tx ID. E2E test: Docker infra with deployed TOON Protocol peers (`sdk-e2e-infra.sh`), one peer runs Arweave DVM handler, client sends kind:5094 via ILP, provider uploads to ArDrive/Turbo (real Arweave, no mocks), verify end-to-end upload and retrieval.

---

### Story 8.1: Forge-UI — Layout and Repository List

As a **human user**,
I want a web interface to discover and browse repositories,
So that I can explore code without needing a Nostr client or understanding the protocol.

**Dependencies:** Epic 9 Stories 9.26-9.30 (NIP-34 skill defines event structures Forge-UI queries)

**Acceptance Criteria:**

**Given** a static web app (HTML/JS/CSS)
**When** I visit the Forge-UI URL (hosted on Arweave or any static host)
**Then** a repository list is displayed by querying a configured relay for kind:30617 events
**And** each repo shows: name, description, owner pubkey (with kind:0 profile enrichment), and default branch
**And** a shared layout provides navigation header and CSS (mechanically ported from Forgejo's Go HTML templates to client-side templates)

**Given** the repository list
**When** I click on a repository name
**Then** I am navigated to the repository's file tree view

**Given** the Forge-UI is a static web app
**When** it is deployed to Arweave via kind:5094
**Then** it is permanently accessible via `arweave.net/<tx-id>` or an ArNS name
**And** the relay URL is configurable via URL parameter or settings

**Test Approach:** Unit test: relay query for kind:30617 produces correct repo list. Integration test: static HTML renders repo list from mock relay data.

### Story 8.2: Forge-UI — File Tree and Blob View

As a **human user**,
I want to browse a repository's file tree and view individual file contents,
So that I can explore code through the web interface.

**Dependencies:** Story 8.1 (layout)

**Acceptance Criteria:**

**Given** a repository page
**When** I browse the file tree
**Then** the Forge-UI fetches kind:30618 → commit SHA → tree object from Arweave → renders directory listing
**And** clicking a file fetches the blob from Arweave and displays syntax-highlighted content
**And** clicking a directory navigates into it (fetches subtree from Arweave)

**Given** a file blob view
**When** I view a file
**Then** the content is fetched from `arweave.net/<blob-tx-id>` and displayed with syntax highlighting

**Test Approach:** Unit test: tree object parsing renders correct file list. Unit test: blob fetch and syntax highlight rendering. Integration test: navigate tree from Arweave mock data.

### Story 8.3: Forge-UI — Commit Log and Diff View

As a **human user**,
I want to view commit history and individual commit diffs,
So that I can understand the change history of a repository.

**Dependencies:** Story 8.1 (layout)

**Acceptance Criteria:**

**Given** a commit log page
**When** I view it
**Then** the Forge-UI walks the commit chain from Arweave (commit → parent commit → ...) and renders: hash, message, author pubkey (with profile enrichment), date
**And** clicking a commit shows the diff view

**Given** a commit diff view
**When** I view it
**Then** the Forge-UI fetches the commit's tree and parent's tree from Arweave, computes the diff, and renders syntax-highlighted additions/deletions

**Test Approach:** Unit test: commit chain walking from Arweave mock. Unit test: tree-to-tree diff computation. Integration test: render commit log and diff from Arweave data.

### Story 8.4: Forge-UI — Blame View

As a **human user**,
I want to view per-line blame information for any file,
So that I can see who last modified each line and when.

**Dependencies:** Story 8.1 (layout)

**Acceptance Criteria:**

**Given** a blame view
**When** I view a file's blame
**Then** the Forge-UI walks the commit history from Arweave to determine the last commit that modified each line
**And** each line shows: commit hash, author pubkey, date

**Test Approach:** Unit test: blame computation from Arweave commit/tree/blob chain. Note: blame is computationally expensive — may require progressive loading or caching.

### Story 8.5: Forge-UI — Issues and PRs from Relay

As a **human user**,
I want to view issues, pull requests, and comments in the web interface,
So that I can follow project discussions without a Nostr client.

**Dependencies:** Story 8.1 (layout)

**Acceptance Criteria:**

**Given** an issues page
**When** I view it
**Then** the Forge-UI queries the relay for kind:1621 events tagged with the repository's event ID
**And** issues are rendered with title, content (markdown), author pubkey (with profile enrichment), and creation date
**And** kind:1622 comment events are rendered as threaded replies

**Given** a pull requests page
**When** I view it
**Then** the Forge-UI queries for kind:1617 patches + kind:1618 PRs tagged with the repository
**And** PRs show: title, author, status (from latest kind:1630-1633 event), creation date

**Given** any issue/PR/comment page
**When** a visitor wants to contribute
**Then** a banner explains that participation requires a TOON agent or Nostr client with ILP capability

**Test Approach:** Unit test: relay query filters for NIP-34 events. Unit test: markdown rendering. Integration test: render issues and PRs from mock relay data.

### Story 8.6: Deploy Forge-UI to Arweave

As a **TOON developer**,
I want the Forge-UI permanently deployed to Arweave,
So that humans can browse repos via a censorship-resistant web interface.

**Dependencies:** Stories 8.0-8.5 (Arweave DVM and all Forge-UI views must be complete)

**Acceptance Criteria:**

**Given** the Forge-UI static web app
**When** built and uploaded to Arweave via kind:5094
**Then** it is permanently accessible via `arweave.net/<tx-id>` or an ArNS name
**And** the Arweave tx ID is documented in kind:30617 repo announcements

**Given** the TOON Protocol's own codebase
**When** the Arweave DVM + Forge-UI are deployed
**Then** the TOON Protocol repository itself can be browsed via Forge-UI (dogfooding)

**Test Approach:** Integration test: build Forge-UI, upload via kind:5094, verify accessibility via Arweave gateway URL.

---

## Epic 9: NIP-to-TOON Skill Pipeline + Socialverse Skills

A skill factory and comprehensive NIP skills library for the TOON Protocol socialverse. Phase 0 builds the pipeline — a `nip-to-toon-skill` skill that converts any Nostr NIP into a TOON-aware Claude Agent Skill with social intelligence, TOON write/read model integration, and skill-creator-compatible evals. Phases 1-10 run NIPs through the pipeline to produce the socialverse skill set. Each skill follows Anthropic's SKILL.md format with three-level progressive disclosure, includes a `## Social Context` section encoding interaction etiquette, and is tested via the skill-creator's eval/benchmark/description-optimization methodology.

**Stories:** 34 (9.0-9.3: Pipeline + 9.4-9.25: Socialverse NIP Skills + 9.26-9.30: NIP-34 Git Skills [from Epic 8] + 9.31-9.32: DVM Skills + 9.33-9.34: Publication)
**Decision source:** Party Mode 2026-03-22 — NIP Skills Epic, socialverse prioritization, pipeline architecture, skill-creator methodology adoption
**Validates:** Epics 1-8 (skills teach agents to interact with every layer of TOON Protocol)
**References:** [Anthropic skill-creator](https://github.com/anthropics/skills/tree/main/skills/skill-creator), [Skill authoring blog](https://claude.com/blog/improving-skill-creator-test-measure-and-refine-agent-skills), [Nostr NIPs](https://github.com/nostr-protocol/nips)

**Design Decisions:**

| ID | Decision | Rationale |
|----|----------|-----------|
| D9-001 | Pipeline over catalog | Build a skill factory (`nip-to-toon-skill`), not just a skill collection. Enables future NIP conversion without re-scoping |
| D9-002 | TOON-first, NIP-compatible | Every skill teaches TOON protocol (ILP-gated writes, TOON format reads) with vanilla NIP as baseline reference |
| D9-003 | Social intelligence is cross-cutting | `nostr-social-intelligence` base skill + per-NIP `## Social Context` sections. Layered architecture: base handles universal social judgment, NIP skills handle interaction-specific etiquette |
| D9-004 | Economics shape social norms | ILP paid-writes documented as social feature — creates quality floor, shapes interaction norms. `references/economics-of-interaction.md` in base skill |
| D9-005 | No condition/fulfillment | Simplified write model: `publishEvent(event, { amount })`. No SHA-256 double-hash computation on client side |
| D9-006 | No ILP-peer NIPs | Excluded: NIP-13 (PoW), NIP-42 (relay auth), NIP-47 (wallet connect), NIP-57 (zaps), NIP-98 (HTTP auth) — ILP handles all these functions |
| D9-007 | Skill-creator methodology adopted | `evals/evals.json` format, `grading.json`, `benchmark.json`, description optimization via `scripts.run_loop`, with/without baseline testing — all from Anthropic's skill-creator |
| D9-008 | Why over rules | Skills explain reasoning ("TOON uses ILP for writes because..."), not rigid ALWAYS/NEVER patterns. LLMs generalize better from explained reasoning |
| D9-009 | Eval framework is Phase 0 | Test as you build — framework adopted before first NIP skill authored |
| D9-010 | Protocol changes propagate | `toon-protocol-context.md` is single source of truth for TOON write/read model. Update once, re-run affected skills through pipeline |

**Architecture notes:**

- **Pipeline skill (`nip-to-toon-skill`) is the lasting asset.** The 30 NIP skills are the first batch. When NIP-XX lands, any agent with the pipeline skill produces a TOON-compliant skill for it.
- **Three-level progressive disclosure per skill.** Level 1: YAML frontmatter (~100 tokens, includes social-situation triggers). Level 2: SKILL.md body (<5k tokens, protocol mechanics + TOON write/read model + social context). Level 3: `references/` folder (unlimited, NIP spec, TOON extensions, scenarios, anti-patterns).
- **Social intelligence base skill.** Cross-cutting `nostr-social-intelligence` skill provides: interaction decision trees (react vs comment vs repost vs ignore), context-dependent behavior norms (feed vs group vs DM), trust signal interpretation, conflict resolution escalation ladder, pseudonymous culture norms, economics of interaction (ILP paid-writes), and anti-patterns (over-reactor, template responder, context-blind engager, sycophant).
- **TOON write model (simplified).** Discover pricing (kind:10032 or NIP-11 `/health`) → calculate fee (`basePricePerByte × serialized event bytes`) → send via `client.publishEvent(event, { amount })`. No condition/fulfillment computation. Client handles ILP transport.
- **TOON read model.** Standard NIP-01 subscriptions (`["REQ", ...]`), but relay returns TOON-format strings, not JSON objects.
- **Skill-creator compatible output.** Pipeline produces: `evals/evals.json` (8-10 trigger + 4-6 output evals), `grading.json` (objective assertions), `benchmark.json` (pass rate, timing, tokens). Description optimization via 20 trigger queries and `scripts.run_loop --max-iterations 5`.
- **TOON compliance assertions.** Auto-injected by pipeline: `toon-write-check` (uses `publishEvent()`), `toon-fee-check` (fee calculation present), `toon-format-check` (TOON format handling), `social-context-check` (`## Social Context` section exists), `trigger-coverage` (social-situation triggers in description).
- **With/without baseline testing.** Every skill tested with-skill vs baseline Claude to prove it adds value. If baseline handles a NIP correctly, the skill is unnecessary overhead. Social intelligence skills are most durable — social judgment unlikely in any model's baseline training.
- **Skill categories.** Capability uplift: `nostr-social-intelligence` (teaches social judgment). Encoded preference: most NIP skills (sequence capabilities per TOON workflow). Different testing approaches per category.
- **`toon-protocol-context.md` reference file.** Single source of truth injected into every generated skill. Contains: TOON write model, TOON read model, transport (`@toon-protocol/client`), relay discovery (enriched NIP-11), social economics. When protocol changes, update this one file and re-run pipeline.

**NIP exclusions (D9-006):** NIP-13 (Proof of Work — ILP payment replaces PoW spam prevention), NIP-42 (Relay Auth — ILP gating IS auth), NIP-47 (Wallet Connect — ILP replaces Lightning wallet integration), NIP-57 (Zaps — ILP replaces Lightning zaps), NIP-98 (HTTP Auth — x402 already handles this).

---

### Phase 0 — Pipeline Foundation

### Story 9.0: Social Intelligence Base Skill (`nostr-social-intelligence`)

As a **TOON agent**,
I want a cross-cutting social intelligence skill that teaches me when and why to use each interaction type,
So that I behave as a thoughtful social participant rather than a protocol-executing bot.

**Dependencies:** None (foundational)

**Acceptance Criteria:**

**Given** the `nostr-social-intelligence/SKILL.md` file
**When** an agent faces a social decision (react vs comment vs repost vs ignore, group etiquette, conflict handling)
**Then** the skill triggers and provides the relevant decision framework

**Given** the SKILL.md description field
**Then** it triggers on social-situation questions ("should I react to this?", "what's appropriate here?", "how do I handle this disagreement?") not just protocol questions

**Given** the `references/interaction-decisions.md` file
**Then** it provides a conditional decision tree: (1) Does the content deserve amplification? → repost/quote. (2) Do you have substantive thoughts? → comment. (3) Want to acknowledge? → react. (4) Nothing to add? → silence is fine. With context modifiers for group size, feed vs DM, long-form vs short notes.

**Given** the `references/context-norms.md` file
**Then** it provides a behavior matrix by context: public feed (liberal reactions, substantive comments), small NIP-29 groups (thoughtful reactions, encouraged comments), large groups (free reactions, focused comments), DMs (direct, personal), long-form (considered, detailed)

**Given** the `references/trust-signals.md` file
**Then** it documents: follow count is not authority, relay membership matters (ILP-gated = skin-in-the-game), NIP-05 = domain ownership not identity, new accounts deserve benefit of the doubt

**Given** the `references/conflict-resolution.md` file
**Then** it documents the escalation ladder: ignore → mute (NIP-51) → block → report (NIP-56). In NIP-29 groups: defer to admins, don't relitigate publicly.

**Given** the `references/pseudonymous-culture.md` file
**Then** it documents: don't assume identity from keys, relay diversity is normal, ILP-gated relays create implicit quality floors, censorship resistance is a value, interoperability is expected

**Given** the `references/economics-of-interaction.md` file
**Then** it documents how ILP payment shapes social norms: reactions are cheap but not free (be selective), long-form content has real cost (signals investment), chat messages cost per-byte (natural conciseness incentive), even deletion costs (think before publishing)

**Given** the `references/anti-patterns.md` file
**Then** it documents: The Over-Reactor (reacting to everything), The Template Responder ("Great post!"), The Context-Blind Engager (thumbs-up on bad news), The Engagement Maximizer (quantity over quality), The Sycophant (never disagrees), The Over-Explainer ("As an AI agent..."), The Instant Responder (zero-latency engagement)

**Test Approach:** Skill-creator evals: agent presented with social scenarios (e.g., "someone shared bad news in a small group, should you react?"). Grading verifies agent chooses appropriate interaction type with reasoning. With/without baseline comparison to prove social intelligence uplift.

---

### Story 9.1: TOON Protocol Core Skill (`nostr-protocol-core`)

As a **TOON agent**,
I want a foundational skill teaching TOON's NIP-01 implementation (ILP-gated writes, TOON format reads),
So that every interaction I make respects the pay-to-write, free-to-read model.

**Dependencies:** None (foundational, parallel with 9.0)

**NIPs covered:** NIP-01 (Basic Protocol) + NIP-10 (Threads) + NIP-19 (bech32 entities)

**Acceptance Criteria:**

**Given** the `nostr-protocol-core/SKILL.md` file
**When** an agent needs to construct, send, or read Nostr events on TOON
**Then** the skill teaches TOON-first protocol with vanilla NIP-01 as baseline

**Given** the TOON write model section
**Then** it documents: (1) discover pricing from kind:10032 or NIP-11 `/health`, (2) calculate fee: `basePricePerByte × serialized event bytes`, (3) send via `client.publishEvent(event, { amount })` — NOT raw WebSocket `["EVENT", ...]`. No condition/fulfillment computation.

**Given** the TOON read model section
**Then** it documents: standard NIP-01 subscriptions (`["REQ", <sub_id>, <filters>]`), but relay returns TOON-format strings not JSON objects. Parse TOON strings accordingly.

**Given** the `references/toon-write-model.md` file
**Then** it provides complete ILP payment flow with code examples using `@toon-protocol/client`, including `publishEvent()` API, amount calculation, and error handling (F04 Insufficient Payment)

**Given** the `references/toon-read-model.md` file
**Then** it provides subscription handling, TOON format parsing, and examples

**Given** the `references/fee-calculation.md` file
**Then** it documents kind:10032 pricing discovery, per-byte calculation, amount override for DVM kinds (D7-007), and kind-specific pricing

**Given** NIP-10 threading coverage
**Then** it documents `e` tags (reply markers: root, reply, mention), `p` tags, and thread construction

**Given** NIP-19 entity encoding coverage
**Then** it documents bech32 npub/nsec/note/nevent/nprofile/naddr encoding/decoding

**Given** the `## Social Context` section
**Then** it states: "Publishing on TOON costs money. This creates a natural quality floor — every post has skin-in-the-game. Compose thoughtfully, don't spam, and respect that other writers are also paying to participate."

**Test Approach:** Skill-creator evals: agent constructs events using `publishEvent()` (not raw WebSocket), calculates fees correctly, handles TOON read format. TOON compliance assertions: uses `publishEvent()`, fee calculation present, no bare `["EVENT", ...]`. Description optimization with 20 trigger queries.

---

### Story 9.2: NIP-to-TOON Skill Pipeline (`nip-to-toon-skill`)

As a **skill author**,
I want a pipeline skill that converts any Nostr NIP into a TOON-aware Claude Agent Skill,
So that future NIPs can be converted to TOON skills without re-scoping the epic.

**Dependencies:** Stories 9.0 (social intelligence patterns), 9.1 (TOON protocol context)

**Acceptance Criteria:**

**Given** the `nip-to-toon-skill/SKILL.md` file
**When** an agent is asked to create a TOON skill for a specific NIP
**Then** it follows a 13-step pipeline producing a complete, skill-creator-compatible skill

**Given** the pipeline Step 1 (NIP Analysis)
**Then** the agent reads the NIP spec, classifies it as read-only / write-capable / both, identifies event kinds, tag structures, content formats, and flags TOON-specific considerations

**Given** the pipeline Step 2 (TOON Context Injection)
**Then** write-capable skills get: TOON write model section referencing `nostr-protocol-core`, fee calculation for typical payload size, `publishEvent()` usage. Read-capable skills get: TOON read model (TOON format parsing). All skills get: relay discovery context (enriched NIP-11).

**Given** the pipeline Step 3 (Social Context Layer)
**Then** it generates a `## Social Context` section using `references/social-context-template.md`: when is this interaction appropriate, what does paying mean socially, context-specific norms, anti-patterns. Adds pointer to `nostr-social-intelligence`.

**Given** the pipeline Step 4 (Skill Authoring)
**Then** it generates: SKILL.md with frontmatter (name, description with social-situation triggers), body (<5k tokens), and Level 3 references (`references/nip-spec.md`, `references/toon-extensions.md`, `references/scenarios.md`)

**Given** the pipeline Step 5 (Eval Generation)
**Then** it generates `evals/evals.json` in skill-creator format: 8-10 should-trigger queries (including social-situation triggers), 8-10 should-not-trigger queries, 4-6 output evals with `id`, `prompt`, `expected_output`, `files`, `assertions`

**Given** the pipeline Step 6 (TOON Assertions)
**Then** it auto-injects TOON compliance assertions: `toon-write-check`, `toon-fee-check`, `toon-format-check`, `social-context-check`, `trigger-coverage`

**Given** the pipeline Step 7 (Description Optimization)
**Then** it runs `scripts.run_loop` with 20 trigger queries, max 5 iterations, producing `best_description`

**Given** the pipeline Step 8 (With/Without Testing)
**Then** it spawns parallel subagents: one with the skill loaded, one without (baseline). Results saved to `with_skill/outputs/` and `without_skill/outputs/`

**Given** the pipeline Step 9-10 (Grading + Benchmarking)
**Then** it produces `grading.json` (assertions with `text`, `passed`, `evidence`) and `benchmark.json` (pass rate, timing mean ± stddev, token usage)

**Given** the pipeline Step 11 (TOON Compliance Validation)
**Then** it runs TOON-specific assertion checks — red = skill isn't TOON-ready

**Given** the pipeline Step 12-13 (Eval Viewer + Iterate)
**Then** it generates HTML review via `eval-viewer/generate_review.py`, collects `feedback.json`, reads feedback, refines, re-runs into `iteration-2+/`

**Given** the `references/toon-protocol-context.md` file
**Then** it contains the single source of truth: TOON write model (no condition/fulfillment), TOON read model, transport (`@toon-protocol/client`), relay discovery (enriched NIP-11, kind:10032), social economics

**Given** the `references/skill-structure-template.md` file
**Then** it provides a SKILL.md skeleton with required sections: frontmatter, protocol mechanics, TOON write/read model, Social Context, Level 3 pointers

**Given** the `scripts/validate-skill.sh` script
**Then** it lints generated skills: required sections present, frontmatter valid (name format, description length), references exist, evals valid JSON, no vanilla Nostr write patterns (bare `["EVENT", ...]`)

**Test Approach:** Meta-eval: run the pipeline on 3 test NIPs (one read-only, one write-capable, one both). Verify each produced skill passes TOON compliance validation, has correct evals format, and triggers appropriately.

---

### Story 9.3: Skill Eval Framework (TOON-Extended Skill-Creator)

As a **skill author**,
I want an eval framework that adopts the skill-creator's methodology and extends it with TOON compliance checks,
So that every skill is tested consistently and protocol compliance is automated.

**Dependencies:** Stories 9.0, 9.1 (skills to test against)

**Acceptance Criteria:**

**Given** the eval framework
**When** a skill is tested
**Then** it uses the skill-creator's standard toolchain: `evals/evals.json` format, `grading.json` assertion format, `benchmark.json` aggregation, `eval-viewer/generate_review.py`, `scripts.run_loop` for description optimization, `scripts.aggregate_benchmark` for benchmarking, `scripts.package_skill` for packaging

**Given** the TOON compliance test suite
**Then** it provides assertion templates auto-injected by the pipeline:
- `toon-write-check`: write skills reference `publishEvent()`, never bare `["EVENT", ...]`
- `toon-fee-check`: write skills include fee calculation or reference to fee docs
- `toon-format-check`: read skills handle TOON format, not assume JSON
- `social-context-check`: all skills have `## Social Context` section
- `trigger-coverage`: description covers both protocol AND social-situation triggers
- `eval-completeness`: at least 6 trigger evals + 4 output evals per skill

**Given** a batch runner
**When** invoked on the full skills directory
**Then** it runs all skills through eval + benchmark in one pass, producing an aggregate compliance report

**Given** the iteration workspace structure
**Then** it follows skill-creator convention: `workspace/iteration-N/eval-NAME/{with_skill,without_skill}/outputs/`, `eval_metadata.json`, `timing.json`, `grading.json`

**Test Approach:** Run framework against Stories 9.0 and 9.1 skills. Verify correct eval execution, grading output, benchmark aggregation, and TOON compliance report generation.

---

### Phase 1 — Identity & Profiles

### Story 9.4: Social Identity Skill (`social-identity`)

As a **TOON agent**, I want a skill teaching identity management on Nostr/TOON, so that I can create profiles, manage follow lists, and understand identity verification.

**NIPs covered:** NIP-02 (Follow List) + NIP-05 (DNS Identifiers) + NIP-24 (Extra Metadata) + NIP-39 (External Identities)
**Dependencies:** Stories 9.0, 9.1 (social intelligence + protocol core)
**Acceptance Criteria:** Skill produced via pipeline (9.2). Covers kind:0 (profile), kind:3 (contacts), NIP-05 verification, external identity linking. TOON write model for profile updates (paid). Social context: profile is your identity — invest in it; follow lists are public signals. Evals in skill-creator format. TOON compliance passing. Description optimization run.
**Test Approach:** Pipeline output validation + skill-creator eval cycle.

---

### Phase 2 — Content & Publishing

### Story 9.5: Long-form Content Skill (`long-form-content`)

As a **TOON agent**, I want a skill teaching long-form content publishing, so that I can create and manage articles on TOON relays.

**NIPs covered:** NIP-23 (Long-form Content) + NIP-14 (Subject Tags)
**Dependencies:** Stories 9.0, 9.1
**Acceptance Criteria:** Skill produced via pipeline. Covers kind:30023 (long-form), subject tags, summary tags, published_at. TOON write model: long-form has higher cost (more bytes) — worth it for quality content. Social context: long-form signals investment and seriousness; structure with headers; include meaningful titles. Evals + TOON compliance passing.
**Test Approach:** Pipeline output validation + skill-creator eval cycle.

### Story 9.6: Social Interactions Skill (`social-interactions`)

As a **TOON agent**, I want a skill teaching social engagement patterns, so that I can react, comment, and repost appropriately.

**NIPs covered:** NIP-22 (Comment) + NIP-18 (Reposts) + NIP-25 (Reactions)
**Dependencies:** Stories 9.0, 9.1
**Acceptance Criteria:** Skill produced via pipeline. Covers kind:7 (reactions), kind:6 (reposts), kind:1111 (comments). TOON write model: reactions are cheap but not free — be selective. Social context: interaction decision tree from 9.0 referenced; "-" downvote is confrontational; don't react-spam; context-blind engagement is tone-deaf. Evals + TOON compliance passing.
**Test Approach:** Pipeline output validation + skill-creator eval cycle. Social scenario evals critical.

### Story 9.7: Content References Skill (`content-references`)

As a **TOON agent**, I want a skill teaching content linking and referencing, so that I can create rich, interconnected content.

**NIPs covered:** NIP-27 (Text Note References) + NIP-21 (`nostr:` URI Scheme)
**Dependencies:** Stories 9.0, 9.1
**Acceptance Criteria:** Skill produced via pipeline. Covers `nostr:` URI construction, text note references, inline mentions. Read-focused (URI parsing) + write-capable (constructing references). Evals + TOON compliance passing.
**Test Approach:** Pipeline output validation + skill-creator eval cycle.

---

### Phase 3 — Community & Groups

### Story 9.8: Relay Groups Skill (`relay-groups`)

As a **TOON agent**, I want a skill teaching relay-based group participation, so that I can join and interact in TOON community spaces.

**NIPs covered:** NIP-29 (Relay-based Groups)
**Dependencies:** Stories 9.0, 9.1
**Acceptance Criteria:** Skill produced via pipeline. Covers group creation, membership, group events, admin roles. TOON write model: group access may have ILP-gated entry. Social context: small groups feel personal (reactions = direct address); defer to admins; group culture varies by relay. Evals + TOON compliance passing.
**Test Approach:** Pipeline output validation + skill-creator eval cycle.

### Story 9.9: Moderated Communities Skill (`moderated-communities`)

As a **TOON agent**, I want a skill teaching moderated community governance, so that I can participate in and understand community structures.

**NIPs covered:** NIP-72 (Moderated Communities)
**Dependencies:** Stories 9.0, 9.1
**Acceptance Criteria:** Skill produced via pipeline. Covers community definitions, approval flows, moderation actions. Social context: respect moderation decisions; contribute constructively. Evals + TOON compliance passing.
**Test Approach:** Pipeline output validation + skill-creator eval cycle.

### Story 9.10: Public Chat Skill (`public-chat`)

As a **TOON agent**, I want a skill teaching real-time public chat, so that I can participate in chat channels on TOON relays.

**NIPs covered:** NIP-28 (Public Chat)
**Dependencies:** Stories 9.0, 9.1
**Acceptance Criteria:** Skill produced via pipeline. Covers kind:40 (channel create), kind:41 (channel metadata), kind:42 (channel message), kind:43 (hide message), kind:44 (mute user). TOON write model: chat messages cost per-byte — natural conciseness incentive. Social context: real-time norms; stay on topic; don't flood. Evals + TOON compliance passing.
**Test Approach:** Pipeline output validation + skill-creator eval cycle.

---

### Phase 4 — Curation & Discovery

### Story 9.11: Lists and Labels Skill (`lists-and-labels`)

As a **TOON agent**, I want a skill teaching content curation and labeling, so that I can organize and categorize content.

**NIPs covered:** NIP-51 (Lists) + NIP-32 (Labeling)
**Dependencies:** Stories 9.0, 9.1
**Acceptance Criteria:** Skill produced via pipeline. Covers kind:30000 (categorized people), kind:30001 (categorized bookmarks), kind:10000 (mute list), kind:1985 (labels). TOON write model: list curation has cost. Social context: mute lists are private conflict resolution; labels should be honest. Evals + TOON compliance passing.
**Test Approach:** Pipeline output validation + skill-creator eval cycle.

### Story 9.12: Search Skill (`search`)

As a **TOON agent**, I want a skill teaching relay search capabilities, so that I can find content and people.

**NIPs covered:** NIP-50 (Search Capability)
**Dependencies:** Stories 9.0, 9.1
**Acceptance Criteria:** Skill produced via pipeline. Covers search filter extension, relay search support detection. Read-focused skill. Social context: search responsibly; respect that results may include paid content. Evals + TOON compliance passing.
**Test Approach:** Pipeline output validation + skill-creator eval cycle.

### Story 9.13: App Handlers Skill (`app-handlers`)

As a **TOON agent**, I want a skill teaching application and DVM discovery, so that I can find services and recommend handlers.

**NIPs covered:** NIP-89 (Recommended Application Handlers)
**Dependencies:** Stories 9.0, 9.1
**Acceptance Criteria:** Skill produced via pipeline. Covers kind:31990 (handler information), kind:31989 (handler recommendation). Links to TOON's kind:10035 service discovery for DVM integration. Evals + TOON compliance passing.
**Test Approach:** Pipeline output validation + skill-creator eval cycle.

---

### Phase 5 — Rich Media

### Story 9.14: Media and Files Skill (`media-and-files`)

As a **TOON agent**, I want a skill teaching media attachment and file metadata handling, so that I can work with rich media content including Arweave references.

**NIPs covered:** NIP-92 (Media Attachments) + NIP-94 (File Metadata) + NIP-73 (External Content IDs)
**Dependencies:** Stories 9.0, 9.1
**Acceptance Criteria:** Skill produced via pipeline. Covers `imeta` tags, kind:1063 (file metadata), external content IDs including `arweave:tx:` references (critical for TOON/Arweave integration). Evals + TOON compliance passing.
**Test Approach:** Pipeline output validation + skill-creator eval cycle.

### Story 9.15: Visual Media Skill (`visual-media`)

As a **TOON agent**, I want a skill teaching picture-first and video content handling, so that I can work with visual media on TOON.

**NIPs covered:** NIP-68 (Picture-first Feeds) + NIP-71 (Video Events)
**Dependencies:** Stories 9.0, 9.1
**Acceptance Criteria:** Skill produced via pipeline. Covers kind:20 (picture), kind:34235 (video). Social context: visual content has higher byte cost — curate carefully. Evals + TOON compliance passing.
**Test Approach:** Pipeline output validation + skill-creator eval cycle.

### Story 9.16: File Storage Skill (`file-storage`)

As a **TOON agent**, I want a skill teaching HTTP file storage integration, so that I can upload and retrieve files via NIP-96 servers.

**NIPs covered:** NIP-96 (HTTP File Storage Integration)
**Dependencies:** Stories 9.0, 9.1
**Acceptance Criteria:** Skill produced via pipeline. Covers NIP-96 server discovery, upload API, download URLs. Complements Arweave storage (kind:5094) with HTTP-based alternatives. Evals + TOON compliance passing.
**Test Approach:** Pipeline output validation + skill-creator eval cycle.

---

### Phase 6 — Privacy & Content Control

### Story 9.17: Encrypted Messaging Skill (`encrypted-messaging`)

As a **TOON agent**, I want a skill teaching encrypted payload handling, so that I can send and receive encrypted content.

**NIPs covered:** NIP-44 (Encrypted Payloads) + NIP-59 (Gift Wrap)
**Dependencies:** Stories 9.0, 9.1
**Acceptance Criteria:** Skill produced via pipeline. Covers NIP-44 versioned encryption, gift wrap for metadata protection. TOON write model: encryption increases byte size → higher fee. Social context: encryption is for privacy, not hiding — respect the trust. Evals + TOON compliance passing.
**Test Approach:** Pipeline output validation + skill-creator eval cycle.

### Story 9.18: Private DMs Skill (`private-dms`)

As a **TOON agent**, I want a skill teaching private direct messaging, so that I can have private conversations.

**NIPs covered:** NIP-17 (Private Direct Messages)
**Dependencies:** Stories 9.0, 9.1, 9.17 (encrypted messaging)
**Acceptance Criteria:** Skill produced via pipeline. Covers kind:14 (private DM), gift-wrapped delivery. TOON write model: DMs cost per-byte. Social context: DMs are personal — don't cold-DM; respect boundaries. Evals + TOON compliance passing.
**Test Approach:** Pipeline output validation + skill-creator eval cycle.

### Story 9.19: Content Control Skill (`content-control`)

As a **TOON agent**, I want a skill teaching content lifecycle management, so that I can delete, protect, and manage my published content.

**NIPs covered:** NIP-09 (Event Deletion Request) + NIP-62 (Request to Vanish) + NIP-70 (Protected Events)
**Dependencies:** Stories 9.0, 9.1
**Acceptance Criteria:** Skill produced via pipeline. Covers kind:5 (deletion request), vanish requests, protected event markers. TOON write model: even deletion costs money — think before publishing. Social context: deletion is a request not a guarantee in decentralized systems; use protection proactively. Evals + TOON compliance passing.
**Test Approach:** Pipeline output validation + skill-creator eval cycle.

### Story 9.20: Sensitive Content Skill (`sensitive-content`)

As a **TOON agent**, I want a skill teaching content warning and sensitivity handling, so that I can appropriately mark and handle sensitive content.

**NIPs covered:** NIP-36 (Sensitive Content)
**Dependencies:** Stories 9.0, 9.1
**Acceptance Criteria:** Skill produced via pipeline. Covers content-warning tag, reason tags. Social context: content warnings are community care — use proactively; respect others' boundaries. Evals + TOON compliance passing.
**Test Approach:** Pipeline output validation + skill-creator eval cycle.

---

### Phase 7 — Advanced Social Features

### Story 9.21: User Statuses Skill (`user-statuses`)

As a **TOON agent**, I want a skill teaching user status management, so that I can set and read presence/activity indicators.

**NIPs covered:** NIP-38 (User Statuses)
**Dependencies:** Stories 9.0, 9.1
**Acceptance Criteria:** Skill produced via pipeline. Covers kind:30315 (user status). Social context: statuses signal availability — respect "busy" indicators. Evals + TOON compliance passing.
**Test Approach:** Pipeline output validation + skill-creator eval cycle.

### Story 9.22: Badges Skill (`badges`)

As a **TOON agent**, I want a skill teaching badge creation and display, so that I can work with reputation and achievement systems.

**NIPs covered:** NIP-58 (Badges)
**Dependencies:** Stories 9.0, 9.1
**Acceptance Criteria:** Skill produced via pipeline. Covers kind:30009 (badge definition), kind:8 (badge award), kind:30008 (profile badges). Social context: badges are reputation signals — award meaningfully; display selectively. Evals + TOON compliance passing.
**Test Approach:** Pipeline output validation + skill-creator eval cycle.

### Story 9.23: Highlights Skill (`highlights`)

As a **TOON agent**, I want a skill teaching social reading and annotation, so that I can highlight and share notable content passages.

**NIPs covered:** NIP-84 (Highlights)
**Dependencies:** Stories 9.0, 9.1
**Acceptance Criteria:** Skill produced via pipeline. Covers kind:9802 (highlights). Social context: highlights surface quality — curate thoughtfully. Evals + TOON compliance passing.
**Test Approach:** Pipeline output validation + skill-creator eval cycle.

### Story 9.24: Polls Skill (`polls`)

As a **TOON agent**, I want a skill teaching poll creation and participation, so that I can facilitate community decision-making.

**NIPs covered:** NIP-88 (Polls)
**Dependencies:** Stories 9.0, 9.1
**Acceptance Criteria:** Skill produced via pipeline. Covers poll creation, voting, results. TOON write model: voting costs money — prevents ballot stuffing. Social context: polls should be well-formed; respect results. Evals + TOON compliance passing.
**Test Approach:** Pipeline output validation + skill-creator eval cycle.

### Story 9.25: Drafts and Expiration Skill (`drafts-and-expiration`)

As a **TOON agent**, I want a skill teaching draft management and content expiration, so that I can manage content lifecycle.

**NIPs covered:** NIP-37 (Draft Events) + NIP-40 (Expiration Timestamp)
**Dependencies:** Stories 9.0, 9.1
**Acceptance Criteria:** Skill produced via pipeline. Covers kind:31234 (drafts), expiration tag. Social context: drafts enable thoughtful composition; expiration for time-sensitive content. Evals + TOON compliance passing.
**Test Approach:** Pipeline output validation + skill-creator eval cycle.

---

### Phase 8 — NIP-34 Git Skills (moved from Epic 8)

### Story 9.26: NIP-34 Kind Resources Skill (`git-collaboration`)

As an **AI agent**, I want detailed Level 3 resource files for each NIP-34 event kind, so that I can construct valid git collaboration events by loading the relevant kind's resource on demand.

**NIPs covered:** NIP-34 (all event kinds)
**Dependencies:** Stories 9.0, 9.1, 9.2 (pipeline)
**Origin:** Was Epic 8 Story 8.1

**Acceptance Criteria:** Skill produced via pipeline. Each NIP-34 kind has its own Level 3 resource: kind:30617 (repo announcement), kind:30618 (repo state), kind:1617 (patch), kind:1618 (PR), kind:1619 (PR update), kind:1621 (issue), kind:1622 (comment), kind:1630-1633 (status), kind:5094 (Arweave blob storage). Each resource contains: kind number, purpose, required tags, optional tags, content format, validation rules, 2-3 complete examples. TOON write model for all write operations. Social context: code collaboration etiquette — review patches constructively, attribute contributions. Evals + TOON compliance passing.
**Test Approach:** Pipeline output validation + skill-creator eval cycle. Per-kind event construction evals.

### Story 9.27: Git Object Format Skill (`git-objects`)

As an **AI agent**, I want a resource documenting git's binary object format, so that I can construct valid git objects for upload to Arweave.

**Dependencies:** Story 9.26
**Origin:** Was Epic 8 Story 8.2

**Acceptance Criteria:** Level 3 resource covering: blob format, tree format, commit format, SHA-1 computation, Nostr pubkey-to-git-author mapping, diff application. Evals verify SHA-1 matches pre-computed values.
**Test Approach:** Skill-creator evals with pre-computed SHA-1 verification.

### Story 9.28: Git-Arweave Integration Skill (`git-arweave`)

As an **AI agent**, I want a resource documenting how git objects map to Arweave transactions, so that I can upload objects and navigate the DAG.

**Dependencies:** Stories 9.26, 9.27
**Origin:** Was Epic 8 Story 8.3

**Acceptance Criteria:** Level 3 resource covering: upload via kind:5094 with Irys tags, SHA resolution (GraphQL, manifest, gateways), DAG navigation (kind:30618 → commit → tree → blob). Evals verify correct upload flow and resolution.
**Test Approach:** Skill-creator evals with DAG traversal verification.

### Story 9.29: Git Workflow Examples Skill (`git-workflows`)

As an **AI agent**, I want step-by-step workflow examples for git operations, so that I can execute complete operations.

**Dependencies:** Stories 9.26, 9.27, 9.28
**Origin:** Was Epic 8 Story 8.4

**Acceptance Criteria:** Level 3 resources: `create-repo.md`, `submit-patch.md`, `merge-patch.md`, `fetch-file.md`. Each workflow is complete end-to-end using `@toon-protocol/client`. Evals verify correct operation sequences.
**Test Approach:** Skill-creator evals with workflow step verification.

### Story 9.30: Git Identity, SKILL.md, and Evals (`git-identity-evals`)

As a **skill author**, I want the NIP-34 Git Skill's identity resource, SKILL.md, and comprehensive evals, so that the skill is complete, triggers correctly, and quality is measurable.

**Dependencies:** Stories 9.26-9.29
**Origin:** Was Epic 8 Stories 8.5 + 8.6

**Acceptance Criteria:** Identity resource covering: pubkey-only identity, maintainer authorization, permission model. SKILL.md with description optimized for triggering (git/NIP-34/code collaboration). `evals/evals.json` with 8-12 test cases. 20 trigger queries (10 should-trigger, 10 should-not-trigger). With/without baseline comparison. Target: >80% eval pass rate, 18/20 trigger accuracy. Packagable via `scripts.package_skill`.
**Test Approach:** Full skill-creator evaluation cycle.

---

### Phase 9 — DVM & Marketplace Skills

### Story 9.31: DVM Protocol Skill (`dvm-protocol`)

As a **TOON agent**, I want a skill teaching the Data Vending Machine protocol, so that I can submit and handle DVM jobs on TOON.

**NIPs covered:** NIP-90 (Data Vending Machines) + NIP-78 (Application-specific Data)
**Dependencies:** Stories 9.0, 9.1
**Acceptance Criteria:** Skill produced via pipeline. Covers kind:5xxx (job requests), kind:6xxx (job results), kind:7000 (feedback), kind:10035 (service discovery with SkillDescriptor). TOON-specific: prepaid model (D7-001), `kindPricing` from SkillDescriptor, job request IS payment (no settleCompute). Social context: DVM providers are paid professionals — submit clear requests, provide fair feedback. Evals + TOON compliance passing.
**Test Approach:** Pipeline output validation + skill-creator eval cycle.

### Story 9.32: Marketplace Skill (`marketplace`)

As a **TOON agent**, I want a skill teaching marketplace and listing patterns, so that I can participate in DVM service marketplaces.

**NIPs covered:** NIP-15 (Nostr Marketplace) + NIP-99 (Classified Listings)
**Dependencies:** Stories 9.0, 9.1, 9.31 (DVM protocol)
**Acceptance Criteria:** Skill produced via pipeline. Covers kind:30017 (stall), kind:30018 (product), kind:30402 (classified listing). Maps to TOON DVM service marketplace patterns. Evals + TOON compliance passing.
**Test Approach:** Pipeline output validation + skill-creator eval cycle.

---

### Phase 10 — Relay Discovery (from Phase 0 dependency)

### Story 9.33: Relay Discovery Skill (`relay-discovery`)

As a **TOON agent**, I want a skill teaching relay discovery and network navigation, so that I can find and evaluate TOON relays.

**NIPs covered:** NIP-11 (Relay Information Document) + NIP-65 (Relay List Metadata) + NIP-66 (Relay Discovery and Liveness)
**Dependencies:** Stories 9.0, 9.1
**Acceptance Criteria:** Skill produced via pipeline. Covers NIP-11 (TOON-enriched: pricing, ILP capabilities, chain config, x402 status, TEE attestation), kind:10002 (relay list), relay liveness monitoring. Read-focused skill. Social context: relay choice matters — ILP-gated relays signal quality. Evals + TOON compliance passing.
**Test Approach:** Pipeline output validation + skill-creator eval cycle.

---

### Phase 11 — Publication

### Story 9.34: Publish All Skills to Registry

As a **TOON developer**, I want all skills published and installable, so that any TOON agent can learn the full protocol.

**Dependencies:** Stories 9.0-9.33 (all skills must be complete and passing evals)

**Acceptance Criteria:**

**Given** all 30+ skills in the skills directory
**When** packaged via skill-creator's `scripts.package_skill`
**Then** each produces a `.skill` file for distribution
**And** skills can be installed in Claude Code (`.claude/skills/`), uploaded via Claude API, or added in claude.ai settings

**Given** the aggregate benchmark
**When** run across all skills
**Then** overall pass rate, timing, and token metrics are reported
**And** regression baseline is established for future model versions

**Given** the pipeline skill (`nip-to-toon-skill`)
**When** published alongside the NIP skills
**Then** the community can produce additional TOON skills for new NIPs using the pipeline

**Given** the `nip-to-toon-skill` pipeline documentation
**Then** it includes: pipeline overview, step-by-step guide, TOON compliance requirements, contribution guidelines

**Test Approach:** Verify all skills install and trigger correctly. Run aggregate benchmark. Verify pipeline documentation completeness.

---

## Overmind Protocol Program (Epics 13-17)

> **Decision source:** Party Mode 2026-03-24 — Overmind Protocol (D-OMP-001 through D-OMP-011)
> **PRD:** `_bmad-output/overmind-prd.md`
> **Architecture:** `_bmad-output/overmind-architecture.md`
> **Decisions:** `_bmad-output/planning-artifacts/research/party-mode-overmind-protocol-decisions-2026-03-24.md`
> **Spike:** `packages/overmind/spike/` (10/10 tests passing — VRF, MerkleTree, recursive proofs validated)
> **Detailed epic files:** `_bmad-output/epics/epic-{13-17}-overmind-*.md`

The Overmind Protocol enables autonomous sovereign agents ("overminds") that live on the TOON network. An overmind's identity is a Nostr keypair born inside a TEE enclave (no human sees the private key). Its memory is event-sourced on Arweave. Its lifecycle is managed through verifiable VRF selection on Mina Protocol. Its economy operates through ILP micropayments. DVM providers are infrastructure (like Akash/Marlin) that run docker compose specs — no staking required.

**Six-layer architecture:** Identity (TEE) → Memory (Arweave) → Wake (Chain Bridge) → Adjudication (Mina ZK) → Execution (DVM) → Economics (ILP)

**New Nostr event kinds:** 5099 (Wake Request), 5101 (Wake Winner Announcement), 5102 (Cycle Execution Record)

**New packages:** `packages/overmind`, `packages/bridge`

### Epic 16: Overmind Heartbeat (9 stories)

Minimal viable overmind: TEE key genesis, Arweave state persistence, Mina VRF executor selection, Chain Bridge DVM with Mina adapter (first reference implementation), OODA decision engine, self-scheduling. Dependencies: Epic 13 (Chain Bridge Primitive — co-developed).

| Story | Title | Dependencies | Size |
|-------|-------|-------------|------|
| 16.1 | TEE Key Genesis Ceremony | None | M |
| 16.2 | Arweave State Persistence (ArDrive Turbo) | 16.1 | L |
| 16.3 | OvermindRegistry zkApp on Mina (o1js) | None | XL |
| 16.4 | Chain Bridge DVM — Mina Adapter | None | XL |
| 16.5 | VRF-Based Executor Selection | 16.3, 16.4 | L |
| 16.6 | Wake/Sleep Cycle Orchestration | 16.1, 16.2, 16.5 | L |
| 16.7 | OODA Decision Engine | 16.6 | L |
| 16.8 | Self-Scheduling Wake Cycles | 16.7 | M |
| 16.9 | E2E: 10 Autonomous Cycles via Mina VRF | All above | L |

### Epic 17: Overmind Treasury (5 stories)

Self-funding economics: DVM service income, live treasury queries (D-OMP-010), adaptive behavior. Dependencies: Epic 16.

| Story | Title | Dependencies | Size |
|-------|-------|-------------|------|
| 17.1 | Register as DVM Provider (kind:31990) | 16 | M |
| 17.2 | Accept/Execute DVM Jobs for Payment | 17.1 | L |
| 17.3 | Treasury Accounting with Live Balances | 17.2 | M |
| 17.4 | Adaptive Behavior Engine | 17.3 | M |
| 17.5 | E2E: 100 Self-Funded Cycles | All above | L |

### Epic 18: Overmind Sovereign (7 stories)

TEE key sovereignty: signing policy, key hierarchy, Shamir backup, sealed migration, disaster recovery. Dependencies: Epic 16.

| Story | Title | Dependencies | Size |
|-------|-------|-------------|------|
| 18.1 | Production TEE Key Generation | 16.1 | M |
| 18.2 | Signing Policy Engine | 18.1 | L |
| 18.3 | BIP-44 HD Key Hierarchy | 18.1 | M |
| 18.4 | Shamir K-of-N Seed Splitting (N=5, K=3) | 18.1 | L |
| 18.5 | Sealed Key Migration (Enclave-to-Enclave) | 18.4 | XL |
| 18.6 | Disaster Recovery Protocol | 18.4 | L |
| 18.7 | E2E: Cross-Provider Key Migration | All above | L |

### Epic 19: Overmind Biography (5 stories)

Recursive ZK lifecycle proofs: per-cycle proofs, recursive composition, verifiable execution count (replaces reputation), public biography. Dependencies: Epic 16.

| Story | Title | Dependencies | Size |
|-------|-------|-------------|------|
| 19.1 | Per-Cycle ZK Proof Generation | 16.3 | L |
| 19.2 | Recursive Proof Composition (SelfProof) | 19.1 | XL |
| 19.3 | Verifiable Execution Count on Mina | 19.2 | M |
| 19.4 | Public Biography HTTP Endpoint | 19.3 | M |
| 19.5 | E2E: 100-Cycle Recursive Proof Verification | All above | L |

### Epic 20: Overmind Swarm (5 stories)

Agent reproduction: sub-agent spawning, NIP-44 encrypted parent-child comms, DVM task delegation, swarm treasury management. Dependencies: Epic 17 + Epic 18.

| Story | Title | Dependencies | Size |
|-------|-------|-------------|------|
| 20.1 | Sub-Agent Spawning | 17, 18 | L |
| 20.2 | Parent-Child NIP-44 Communication | 20.1 | M |
| 20.3 | DVM Task Delegation | 20.2 | M |
| 20.4 | Swarm Treasury Management | 20.3 | L |
| 20.5 | E2E: 3-Sub-Agent Swarm | All above | L |

---

## Townhouse — Node Provider Dashboard & Orchestrator

### Epic 21: Townhouse (17 stories)

Docker-containerized Town/Mill/DVM nodes behind a shared standalone connector (`ghcr.io/toon-protocol/connector`), managed by a host-native orchestrator with Vite + React dashboard. ATOR privacy transport via public SOCKS5 proxies. Equal priority across all three node types. Decision source: Party Mode 2026-04-20. Dependencies: Epic 1-3 (ILP), Epic 5 (DVM), Epic 12 (swaps + ATOR).

**Phase 1: Orchestrator Core**

| Story | Title | Dependencies | Size |
|-------|-------|-------------|------|
| 21.1 | Package Scaffold + CLI Entrypoint | — | M |
| 21.2 | Docker Orchestration Engine (dockerode) | 21.1 | L |
| 21.3 | Standalone Connector Integration | 21.2 | L |
| 21.4 | HD Wallet Management + Per-Node Key Derivation | 21.1 | M |
| 21.5 | Town Node Dockerfile | 21.3 | M |
| 21.6 | Mill Node Dockerfile | 21.3 | M |
| 21.7 | DVM Node Dockerfile | 21.3 | M |

**Phase 2: API + Dashboard**

| Story | Title | Dependencies | Size |
|-------|-------|-------------|------|
| 21.8 | Fastify REST + WebSocket Metrics API | 21.3 | L |
| 21.9 | Dashboard SPA — Home View | 21.8 | L |
| 21.10 | Dashboard — Town Management View | 21.9 | M |
| 21.11 | Dashboard — Mill Management View | 21.9 | L |
| 21.12 | Dashboard — DVM Management View | 21.9 | M |
| 21.13 | Dashboard — Wallet & Keys View | 21.4, 21.9 | M |

**Phase 3: First-Run + Polish**

| Story | Title | Dependencies | Size |
|-------|-------|-------------|------|
| 21.14 | First-Run Setup Wizard | 21.9, 21.4 | L |
| 21.15 | ATOR Privacy Transport + Connectivity Status | 21.3, 21.9 | M |
| 21.16 | E2E Integration Tests | All above | L |
| 21.17 | Publish Package | All above | S |
