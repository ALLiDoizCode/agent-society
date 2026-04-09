---
stepsCompleted: [1, 2, 3]
inputDocuments: []
workflowType: 'research'
lastStep: 1
research_type: 'technical'
research_topic: 'akash-network-deployment-cli'
research_goals: 'Creating a Claude Agent Skill for deploying applications on Akash Network using the CLI'
user_name: 'Jonathan'
date: '2026-04-09'
web_research_enabled: true
source_verification: true
---

# Research Report: technical

**Date:** 2026-04-09
**Author:** Jonathan
**Research Type:** technical

---

## Research Overview

[Research overview and methodology will be appended here]

---

## Technical Research Scope Confirmation

**Research Topic:** Akash Network CLI Deployment
**Research Goals:** Creating a Claude Agent Skill for deploying applications on Akash Network using the CLI

**Technical Research Scope:**

- Architecture Analysis - Akash decentralized cloud architecture, provider/tenant model, blockchain settlement
- Implementation Approaches - CLI deployment workflow end-to-end, SDL manifest format, bid/lease lifecycle
- Technology Stack - Akash CLI (provider-services), Cosmos SDK chain, SDL specification, certificate management
- Integration Patterns - CLI command sequences, provider marketplace interaction, wallet/key management
- Performance Considerations - deployment speed, provider selection, cost optimization

**Research Methodology:**

- Current web data with rigorous source verification
- Multi-source validation for critical technical claims
- Confidence level framework for uncertain information
- Comprehensive technical coverage with architecture-specific insights

**Scope Confirmed:** 2026-04-09

## Technology Stack Analysis

### Blockchain Layer — Cosmos SDK & CometBFT

Akash Network is built on the **Cosmos SDK** with **CometBFT** (formerly Tendermint) consensus. It uses delegated Proof-of-Stake (dPoS) and supports **IBC** (Inter-Blockchain Communication) for cross-chain interoperability. The native token **AKT** (denominated as `uakt` on-chain, 1 AKT = 1,000,000 uakt) is used for transaction fees, deployment escrow, staking, and governance.

_Architecture: Four-layer model — Blockchain Layer, Application Layer, Provider Layer, User Layer_
_Consensus: CometBFT (Tendermint-based), ~6 second block times_
_Token: AKT (utility + governance), minimum 0.5 AKT deposit required for deployments_
_Source: [Architecture Overview](https://akash.network/docs/architecture/overview/), [DAIC Capital Analysis](https://daic.capital/blog/akash-network-architecture)_

### CLI Tooling — `provider-services`

The primary CLI tool is **`provider-services`** (replacing the legacy `akash` command after the Mainnet4 repository split). Current version: **v0.10.0**.

_Installation Methods:_
- **macOS**: `brew tap akash-network/tap && brew install akash-provider-services`
- **Linux**: Binary download via official install script, add to PATH
- **Windows**: WSL2 recommended (follow Linux steps)
- **From Source**: Requires Go 1.21+, `make` build system

_Key Environment Variables:_
- `AKASH_KEY_NAME` — wallet key name
- `AKASH_ADDRESS` — account address (set after key creation)
- `AKASH_NET` — network base URL
- `AKASH_CHAIN_ID` — chain identifier (retrieved dynamically)
- `AKASH_NODE` — RPC endpoint
- `AKASH_GAS=auto`, `AKASH_GAS_ADJUSTMENT=1.25`, `AKASH_GAS_PRICES=0.025uakt`
- `AKASH_SIGN_MODE=amino-json`

_Authentication: JWT (default, automatic) or mTLS (optional, `provider-services tx cert generate client`)_
_Source: [CLI Installation Guide](https://akash.network/docs/developers/deployment/cli/installation-guide/)_

### Stack Definition Language (SDL)

Akash uses **SDL** (Stack Definition Language) — a YAML-based declarative format compatible with `.yml`/`.yaml` extensions, similar to Docker Compose. Current SDL version: **`"2.0"`**.

**Core SDL Sections:**

1. **`version`** — Must be `"2.0"`
2. **`services`** — Docker container workloads with `image`, `command`, `args`, `env`, `expose` (port/proto/global)
3. **`profiles.compute`** — Named resource profiles: `cpu` (vCPU, fractional or milli e.g. `"500m"`), `memory`, `storage` (with SI/binary suffixes: Ki, Mi, Gi, Ti)
4. **`profiles.placement`** — Datacenter attributes, auditor signatures (`signedBy`), and pricing per compute profile (denom: `uakt`, amount in micro-AKT)
5. **`deployment`** — Maps services → placement profiles → compute profiles with instance `count`

**Advanced SDL Features:**
- **Persistent Storage**: `persistent: true` attribute, max 2 volumes per profile
- **IP Leases**: Top-level `endpoints` section with `kind: ip` for dedicated IPv4
- **GPU Resources**: Requestable via compute profiles
- **Port Exposure**: `port`, `as` (external mapping), `proto` (tcp/http/https), `to` (service-level or global)

_Source: [SDL README on GitHub](https://github.com/akash-network/docs/blob/master/sdl/README.md), [Persistent Storage Docs](https://docs.akash.network/features/persistent-storage)_

### Container & Orchestration Platform

Akash providers run **Kubernetes** clusters with **Docker** containers. Deployments are fully portable — any Docker image works on Akash with no vendor lock-in. Providers manage their own K8s infrastructure and bid on deployment requests.

_Container Runtime: Docker (any public/private registry image)_
_Orchestration: Kubernetes (provider-managed)_
_Portability: Standard Docker images, no Akash-specific modifications needed_
_Source: [Akash Network Architecture](https://daic.capital/blog/akash-network-architecture)_

### Deployment Lifecycle Commands

The complete CLI deployment workflow:

| Step | Command | Purpose |
|------|---------|---------|
| 1. Create wallet | `provider-services keys add $AKASH_KEY_NAME` | Generate keypair, save mnemonic |
| 2. Fund account | Transfer ≥0.5 AKT to wallet address | Escrow deposit |
| 3. Create deployment | `provider-services tx deployment create deploy.yml --from $AKASH_KEY_NAME` | Submit SDL on-chain |
| 4. View bids | `provider-services query market bid list --owner $AKASH_ADDRESS` | Review provider offers (wait ~30s) |
| 5. Accept bid | `provider-services tx market lease create --dseq <seq> --provider <addr> --from $AKASH_KEY_NAME` | Create lease |
| 6. Send manifest | `provider-services send-manifest deploy.yml --dseq <seq> --provider <addr> --from $AKASH_KEY_NAME` | Deploy containers |
| 7. Check status | `provider-services lease-status --dseq <seq> --provider <addr>` | Verify running |
| 8. View logs | `provider-services lease-logs --dseq <seq> --provider <addr>` | Stream container logs |
| 9. Update | `provider-services tx deployment update deploy.yml --dseq <seq> --from $AKASH_KEY_NAME` + re-send manifest | Modify running deployment |
| 10. Close | `provider-services tx deployment close --dseq <seq> --from $AKASH_KEY_NAME` | Terminate, return escrow |

_Query Commands: `query deployment get`, `query market lease list`, `query provider list`_
_Source: [CLI Common Tasks](https://akash.network/docs/developers/deployment/cli/common-tasks/)_

### Supporting Ecosystem

- **Akash Console** — Web GUI for deployment management (no CLI needed)
- **Akash SDK** — Go and JavaScript/TypeScript libraries for programmatic deployments
- **SDL Examples** — 290+ ready-to-use deployment templates in the official repository
- **AuthZ** — Delegated permissions for team collaboration without exposing private keys
- **Mint & Burn ACT** — Token conversion via `akash tx bme` commands

_Community: Discord #developers channel for support_
_Source: [Akash Deployment Overview](https://akash.network/docs/developers/deployment/)_

### Technology Adoption Trends

_Decentralized Cloud Growth: Akash is classified as a DePIN (Decentralized Physical Infrastructure Network), part of the broader trend toward decentralized compute marketplaces_
_GPU Focus: Increasing demand for GPU resources for AI/ML workloads on Akash_
_Cost Advantage: Akash marketplace pricing typically undercuts centralized cloud providers by significant margins_
_Migration Pattern: Standard Docker containers mean zero migration friction from AWS/GCP/Azure_
_Source: [Coin Bureau Review](https://coinbureau.com/review/akash-network-review), [CoinMarketCap Analysis](https://coinmarketcap.com/cmc-ai/akash-network/what-is/)_

## Integration Patterns Analysis

### API Architecture — Three Complementary Interfaces

Akash nodes expose three API types that form a layered integration surface:

| API | Port | Protocol | Use Case |
|-----|------|----------|----------|
| **gRPC** | 9090 | Protocol Buffers / HTTP/2 | Primary interface — high performance, binary serialization, native streaming |
| **REST** | 1317 | HTTP/JSON | Auto-generated from gRPC via gRPC-Gateway — broader compatibility |
| **CometBFT RPC** | 26657 | JSON-RPC | Low-level blockchain queries — node status, blocks, validators, tx data |

The REST layer is **automatically generated** from gRPC service definitions via gRPC-Gateway — no manual endpoint creation needed. This means gRPC protobuf definitions are the single source of truth.

_Service Categories: Query Services (read-only state), Msg Services (tx submission), Reflection Services (dynamic discovery)_
_Akash-Specific Modules: Deployment, Market, Provider, Audit, Cert, Escrow_
_Source: [API Layer Architecture](https://akash.network/docs/node-operators/architecture/api-layer/)_

### Communication Protocols — Client-to-Provider

**On-Chain Communication (Blockchain Layer):**
- Deployment creation, bid management, and lease creation happen **on-chain** via signed transactions
- Clients construct protobuf messages, sign with private keys (chain ID + sequence), broadcast via gRPC `BroadcastTx` or REST `/cosmos/tx/v1beta1/txs`
- Three broadcast modes: `BROADCAST_MODE_SYNC`, `BROADCAST_MODE_ASYNC`, `BROADCAST_MODE_BLOCK`

**Off-Chain Communication (Provider Layer):**
- Manifest delivery and lease management happen **off-chain** directly between client and provider
- Secured via **mTLS** (mutual TLS) — both client and provider verify each other's certificates
- Each account creates a certificate on-chain before deploying or providing
- mTLS used for: sending manifests, getting lease status, streaming logs, shell access

**Real-Time Events:**
- WebSocket at `ws://localhost:26657/websocket` — subscribe to `NewBlock`, `Tx`, and custom Akash events
- JSON-RPC query interface for event filtering
- Enables real-time monitoring without polling

_Source: [mTLS Documentation](https://github.com/akash-network/docs/blob/master/decentralized-cloud/mtls.md), [API Layer](https://akash.network/docs/node-operators/architecture/api-layer/)_

### Provider Lease Management — gRPC Service (AEP-37)

The `LeaseRPC` gRPC service provides three key operations for lease control:

| Method | Purpose | Capabilities |
|--------|---------|--------------|
| `ServiceStatus` | Monitor service health | Streaming responses, filter by service name/replica |
| `ServiceLogs` | Retrieve/follow logs | Real-time streaming, selective filtering |
| `ServiceRestart` | Trigger service restart | Configurable timeout, per-replica status tracking |

_Status States: pending, active, failure_
_Benefits over REST: HTTP/2 multiplexing, protobuf serialization, bidirectional streaming, type safety_
_Source: [AEP-37 Lease Control API](https://akash.network/roadmap/aep-37/)_

### SDK Integration — Go and JavaScript/TypeScript

**Go SDK** — Primary implementation language, Apache 2.0 licensed
- Repository: `akash-network/node` (blockchain node), `akash-network/provider` (provider services)
- Full protobuf-generated client libraries

**JavaScript/TypeScript SDK** — Two packages:
- **`@akashnetwork/chain-sdk`** (recommended) — Developer-friendly API, full TypeScript support, IDE autocomplete
- **`@akashnetwork/akash-api`** — Consolidated gRPC API definitions for Node and Provider, includes code generation
- `akashjs` is **deprecated** — migrate to `chain-sdk`
- Supports CommonJS and ESM environments

**API Repository** — `akash-network/akash-api` consolidates all gRPC protobuf definitions and generates client code for multiple languages.

_Source: [akashjs GitHub](https://github.com/akash-network/akashjs), [akash-api GitHub](https://github.com/akash-network/akash-api)_

### AuthZ — Delegated Deployment Permissions

AuthZ enables team collaboration and CI/CD automation without sharing private keys.

**Supported Message Types:**
- `/akash.deployment.v1beta3.MsgCreateDeployment`
- `/akash.deployment.v1beta3.MsgUpdateDeployment`
- `/akash.deployment.v1beta3.MsgCloseDeployment`
- `/akash.market.v1beta3.MsgCreateLease`
- `/akash.market.v1beta3.MsgWithdrawLease`

**Grant Command:**
```bash
provider-services tx authz grant <grantee-address> generic \
  --msg-type /akash.deployment.v1beta3.MsgCreateDeployment \
  --from <your-wallet> --fees 5000uakt
```

**Deposit with Delegator:**
```bash
provider-services tx deployment deposit <amount> --dseq <id> \
  --from <deploy-wallet> --depositor-account <funding-wallet>
```

_Model: Granter authorizes Grantee, txs appear as Granter on-chain, Granter pays deposits/fees_
_Source: [AuthZ & Fee Grants](https://akash.network/docs/developers/deployment/authz/), [AuthZ Blog Post](https://akash.network/blog/how-to-deploy-on-akash-network-using-authz/)_

### Authentication Patterns

**JWT (Default)** — Automatically generated and managed by `provider-services` CLI. Zero setup required. This is the current recommended approach.

**mTLS (Optional)** — Certificate-based authentication:
```bash
provider-services tx cert generate client  # Generate certificate
provider-services tx cert publish client   # Publish to blockchain (~0.01 AKT, valid 1 year)
```

_Security: Production deployments should use reverse proxy, rate limiting, disabled unsafe CORS, API auth layers, firewall restrictions_
_Source: [CLI Installation Guide](https://akash.network/docs/developers/deployment/cli/installation-guide/)_

### CI/CD Integration Pattern

The CLI-first design of `provider-services` makes it naturally suited for CI/CD pipelines:

1. **Environment Variables** — All configuration via env vars (no interactive prompts needed)
2. **AuthZ Delegation** — CI/CD service account authorized by team wallet, no private key exposure
3. **Deterministic SDL** — YAML manifests versioned in git alongside application code
4. **Automated Workflow**: `create deployment → wait for bids → accept bid → send manifest → verify status`
5. **Templates** — 290+ SDL examples in [awesome-akash](https://github.com/akash-network/awesome-akash) repository

_Source: [Deployment Overview](https://akash.network/docs/developers/deployment/), [Awesome Akash](https://github.com/akash-network/awesome-akash)_

## Architectural Patterns and Design

### System Architecture — Four-Layer Model

Akash Network's architecture is divided into four interacting layers:

| Layer | Purpose | Key Components |
|-------|---------|----------------|
| **Blockchain Layer** | Smart contracts, payments, state machine | Cosmos SDK, CometBFT, IBC, escrow module, marketplace module |
| **Application Layer** | Deployment administration, SDL processing | SDL parser, deployment lifecycle manager, manifest handling |
| **Provider Layer** | Resource auctioning, workload execution | Kubernetes orchestration, bid engine, lease management |
| **User Layer** | Client interaction, deployment management | `provider-services` CLI, Akash Console, SDKs |

_Design Decision: Separation of on-chain (marketplace, payments) from off-chain (manifest delivery, workload execution) enables blockchain for trust/settlement while avoiding on-chain bottlenecks for compute-intensive operations._
_Source: [DAIC Capital Architecture Analysis](https://daic.capital/blog/akash-network-architecture)_

### Marketplace Pattern — Reverse Auction

Akash uses a **reverse auction** marketplace where tenants set price/terms and providers bid to fulfill:

**Lifecycle State Machine:**
1. **Order** — Tenant submits SDL to blockchain, generating an on-chain order
2. **Bid** — Providers bid on the order (requires a deposit for anti-spam/security)
3. **Lease** — Winning bid creates a lease; tenant sends manifest off-chain to provider
4. **Active** — Provider executes workloads, block-based payments flow from escrow
5. **Closed** — Tenant closes deployment, remaining escrow refunded, bid deposits returned

_Design Trade-off: Reverse auction drives costs down for tenants but requires providers to maintain competitive pricing. Bid deposits prevent spam but add friction._
_Audited Attributes: On-chain attestations allow tenants to filter providers by verified capabilities (e.g., GPU type, region, compliance)_
_Source: [Bids and Leases](https://akash.network/docs/getting-started/intro-to-akash/bids-and-leases/), [Marketplace Glossary](https://docs.akash.network/other-resources/marketplace)_

### Payment Architecture — Escrow-Based Block Payments

**Escrow Account Pattern:**
- Tenants deposit funds when creating a deployment (minimum 0.5 AKT)
- Payments are **block-based** — a fixed amount per block transfers from escrow to provider
- Settlement is batched (not per-block micropayments) for performance
- If escrow balance < amount owed → account and all payments close with state `OVERDRAWN`
- Tenants can add funds at any time to prevent overdraw
- Bid deposits held in escrow, refunded when bid closes

**Multi-Depositor Enhancement:**
- Multiple funding sources can contribute to a single deployment's escrow
- Enables enterprise billing flows and team funding models

_Design Decision: Block-based pricing with batched settlement avoids per-block transaction overhead while maintaining trustless payment guarantees._
_Source: [Payments Architecture](https://akash.network/docs/getting-started/intro-to-akash/payments/), [Escrow Glossary](https://docs.akash.network/glossary/escrow)_

### Provider Architecture — Kubernetes Orchestration

Providers run **Kubernetes clusters** with the **Akash Provider Daemon** managing the full lifecycle:

```
Provider Daemon
├── Bid Engine       — Monitors orders, calculates pricing, submits bids
├── Manifest Handler — Receives tenant manifests via mTLS
├── Cluster Manager  — Translates manifests → K8s resources (pods, services, volumes)
├── Lease Manager    — Tracks lease state, handles payments
└── Status Reporter  — Exposes service status, logs via gRPC (LeaseRPC)
```

**Tenant Isolation:** Containerized workloads provide process-level isolation. Each deployment runs in its own K8s namespace with resource limits enforced by the compute profile.

**Backend Extensibility:** While only Kubernetes is currently supported, the architecture allows for other backends (OpenStack, VMWare, OpenShift).

_Source: [Provider Daemon GitHub](https://github.com/akash-network/provider), [Containers & Kubernetes](https://akash.network/docs/architecture/containers-and-kubernetes/)_

### Scalability Patterns — Network Growth

**Current Scale (Q4 2025):**
- 70% GPU utilization rate
- 34,300 new leases in Q4 2025 (28% QoQ growth)
- Mainnet 14 migrated to **Cosmos SDK v0.53**

**Starcluster Initiative:**
- Protocol-owned compute combining centrally managed datacenters with decentralized marketplace
- ~7,200 NVIDIA GB200 GPUs via Starbonds funding
- Enterprise-grade "Nodekeepers" for hyperscale AI demand
- Hardware coming online late 2025 through early 2026

**AkashML:**
- Managed inference layer simplifying AI deployment on decentralized GPUs
- Confidential computing planned for Q1 2026

_Scaling Strategy: Hybrid model — decentralized marketplace for general compute + protocol-owned infrastructure for enterprise GPU demand_
_Source: [Messari State of Akash Q3 2025](https://messari.io/report/state-of-akash-q3-2025), [Messari Q4 2025](https://messari.io/report/state-of-akash-q4-2025), [StakeCito Scaling Analysis](https://www.stakecito.com/blog/scaling-akash-the-next-phase-of-gpu-growth-and-tokenomics-adjustments)_

### Security Architecture Patterns

| Layer | Mechanism | Purpose |
|-------|-----------|---------|
| **Identity** | Secp256k1 keypairs (Cosmos SDK) | Wallet/account identity |
| **Authentication** | JWT (default) or mTLS certificates | Client-to-provider auth |
| **Transport** | mTLS for off-chain, HTTPS for API | Encrypted communication |
| **Authorization** | AuthZ grants with message-type granularity | Delegated permissions |
| **Isolation** | K8s namespaces + container boundaries | Tenant workload isolation |
| **Economic** | Bid deposits + escrow accounts | Anti-spam, payment guarantees |
| **Audit** | On-chain audited attributes | Provider capability verification |

_Design Principle: Trust is minimized through on-chain settlement and cryptographic identity, while performance-sensitive operations (manifest delivery, log streaming) happen off-chain with mTLS._
_Source: [Security Glossary](https://docs.akash.network/glossary/security), [mTLS Documentation](https://github.com/akash-network/docs/blob/master/decentralized-cloud/mtls.md)_

### Deployment Architecture — CLI Skill Design Implications

For the Claude Agent Skill, the architectural patterns suggest these design considerations:

1. **Sequential State Machine** — Deployment follows a strict order: create → bid → lease → manifest → active. The skill must enforce this sequence.
2. **Polling Required** — After deployment creation, bids arrive asynchronously (~30s). The skill needs a wait-and-query pattern.
3. **Two Communication Channels** — On-chain (blockchain tx) for state changes, off-chain (mTLS/JWT) for manifest delivery and monitoring. Both must be orchestrated.
4. **Environment-Driven Config** — All configuration via env vars makes the CLI naturally scriptable but requires proper setup guidance.
5. **Error Recovery** — Overdraw protection means the skill should check/warn about escrow balance. Failed deployments should be closed to reclaim deposits.
6. **Provider Selection** — Audited attributes and pricing comparison are key decision points the skill should help users navigate.

<!-- Content will be appended sequentially through research workflow steps -->
