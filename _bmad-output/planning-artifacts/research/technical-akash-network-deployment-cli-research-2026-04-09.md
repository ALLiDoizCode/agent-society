---
stepsCompleted: [1, 2, 3, 4, 5, 6]
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

This technical research document provides a comprehensive analysis of Akash Network's CLI deployment system — covering the `provider-services` CLI toolchain, SDL manifest format, reverse-auction marketplace architecture, escrow payment model, and the complete deployment lifecycle from wallet creation through operational management. The research was conducted using current web sources (April 2026) with multi-source verification across official Akash documentation, GitHub repositories, Messari quarterly reports, and community resources.

Key findings include: Akash's four-layer architecture (Blockchain, Application, Provider, User) with clear on-chain/off-chain separation; a mature CLI workflow with 10 discrete steps; 290+ ready-made SDL templates; 50-85% cost savings vs centralized cloud; and a rapidly evolving platform with AkashML managed inference, BME tokenomics, and confidential computing. The full executive summary and strategic recommendations are in the Research Synthesis section below.

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

## Implementation Approaches and Technology Adoption

### Deployment Workflow — Practical Step-by-Step

The complete implementation workflow for deploying on Akash via CLI:

**Phase 1 — Setup (One-Time)**
1. Install `provider-services` CLI (Homebrew on macOS, binary on Linux)
2. Create wallet: `provider-services keys add $AKASH_KEY_NAME`
3. Fund wallet with minimum 0.5 AKT
4. Set environment variables (AKASH_KEY_NAME, AKASH_NODE, AKASH_CHAIN_ID, gas settings)
5. (Optional) Generate mTLS certificate for provider communication

**Phase 2 — Define Deployment**
1. Write SDL manifest (`deploy.yaml`) defining services, compute profiles, placement, pricing
2. Validate SDL structure (version `"2.0"`, required sections, resource formats)

**Phase 3 — Deploy**
1. `provider-services tx deployment create deploy.yml --from $AKASH_KEY_NAME`
2. Wait ~30 seconds for provider bids
3. `provider-services query market bid list --owner $AKASH_ADDRESS` — review bids
4. `provider-services tx market lease create --dseq <seq> --provider <addr> --from $AKASH_KEY_NAME`
5. `provider-services send-manifest deploy.yml --dseq <seq> --provider <addr> --from $AKASH_KEY_NAME`

**Phase 4 — Operate**
- Status: `provider-services lease-status --dseq <seq> --provider <addr>`
- Logs: `provider-services lease-logs --dseq <seq> --provider <addr>`
- Shell: `provider-services lease-shell --dseq <seq> --provider <addr> --service <name> --tty`
- Update: `provider-services tx deployment update deploy.yml --dseq <seq>` + re-send manifest
- Close: `provider-services tx deployment close --dseq <seq> --from $AKASH_KEY_NAME`

_Source: [CLI Common Tasks](https://akash.network/docs/developers/deployment/cli/common-tasks/), [Shell Access](https://docs.akash.network/features/deployment-shell-access)_

### SDL Validation — Common Errors and Best Practices

**Critical Validation Rules:**
- Persistent storage mount paths must be **absolute** (e.g., `/data` not `data`)
- Storage names in `profiles` stanza must match names in `services` stanza
- Each persistent volume needs a unique mount point — no duplicates
- `params > storage` section must contain both volume name and mount point
- Version must be exactly `"2.0"`

**SDL Best Practices:**
- Use the [SDL Examples Library](https://akash.network/docs/developers/deployment/akash-sdl/examples-library/) as starting points
- Test with minimal resources first, scale up after verification
- Set realistic pricing — too low means no bids, too high wastes escrow
- Always specify `global: true` on at least one port for external access

_Source: [SDL Validation Tests](https://akash.network/docs/akash-end-to-end-testing-provider/providerrepocoverage/), [SDL README](https://github.com/akash-network/docs/blob/master/sdl/README.md)_

### Template Library — 290+ Ready-Made Deployments

The [Awesome Akash](https://github.com/akash-network/awesome-akash) repository provides production-ready SDL templates across 30+ categories:

| Category | Count | Notable Examples |
|----------|-------|------------------|
| **AI - GPU** | 80+ | DeepSeek-R1, Llama-3.3-70B, ComfyUI, AUTOMATIC1111 |
| **AI - CPU** | 26 | Ollama, Flowise, Weaviate |
| **Databases** | 15+ | PostgreSQL, MongoDB, Redis, CockroachDB |
| **Web Apps** | 15+ | WordPress, Ghost, Wiki.js, Nginx |
| **Dev Tools** | 10+ | Code-Server, Jupyter, Jenkins, Gitea |
| **Blockchain** | 10+ | Bitcoin, Ethereum, Polkadot nodes |
| **Gaming** | 8+ | Minecraft, CS:GO, Palworld |
| **DeFi** | 8+ | Uniswap, PancakeSwap, Curve |

_Source: [Awesome Akash GitHub](https://github.com/akash-network/awesome-akash), [SDL Examples Library](https://akash.network/docs/developers/deployment/akash-sdl/examples-library/)_

### Cost Optimization Strategies

**Pricing Model:**
- Reverse auction — set your max price, providers bid lower
- Pricing in `uakt` (micro-AKT): 1 AKT = 1,000,000 uakt
- Block-based payments from escrow deposit
- [Usage Calculator](https://akash.network/pricing/usage-calculator/) for cost estimation

**Optimization Tactics:**
- Start with minimum resources, scale based on actual usage
- Compare multiple provider bids — prices vary significantly
- Use audited attributes to filter for quality providers
- Monitor escrow balance to avoid overdraw/deployment closure
- GPU pricing example: A100 at ~$1.10/hr (vs $3-5/hr on centralized clouds)

_Cost Advantage: Akash marketplace typically 50-85% cheaper than AWS/GCP/Azure for equivalent compute_
_Source: [Akash Pricing](https://akash.network/pricing/usage-calculator/), [Oreate AI Blog](https://www.oreateai.com/blog/akash-network-unlocking-affordable-gpu-power-for-the-ai-revolution/21aa9d1ec956c9a35e294b20106ac197)_

### Risk Assessment and Limitations

| Risk | Impact | Mitigation |
|------|--------|------------|
| **Data persistence** | Data lost on provider migration or lease expiry | Use persistent storage SDL; backup critical data externally |
| **AKT price volatility** | Cost unpredictability for long-term deployments | Use stablecoin payments where supported; monitor escrow closely |
| **Provider reliability** | Workload interruption if provider goes offline | Use audited providers; implement health checks; have redeployment plan |
| **GPU availability** | Cutting-edge GPUs may have limited supply | Use Starcluster committed pool; be flexible on GPU model |
| **No managed services** | No equivalent to RDS, S3, Lambda | Deploy your own databases/storage via SDL templates |
| **Learning curve** | CLI + blockchain concepts + SDL syntax | Use templates, skill guides, Akash Console for simpler deployments |

_Source: [DAIC Capital Analysis](https://daic.capital/blog/akash-network-blockchain), [StakeCito](https://www.stakecito.com/blog/understanding-akash-network-the-future-of-decentralized-cloud-computing)_

## Technical Research Recommendations

### Skill Design Recommendations

Based on this research, the Claude Agent Skill for Akash CLI deployment should cover:

1. **Setup Guide** — Installation, wallet creation, environment configuration, funding
2. **SDL Authoring** — Template selection, resource specification, pricing strategy, validation rules
3. **Deployment Lifecycle** — Create → bid review → lease → manifest → verify (with exact commands)
4. **Operations** — Status checks, log viewing, shell access, updates, closure
5. **Troubleshooting** — Common SDL errors, bid failures, escrow issues, provider problems
6. **Cost Guidance** — Pricing estimation, bid comparison, escrow management
7. **Advanced Features** — Persistent storage, IP leases, GPU resources, AuthZ delegation

### Key CLI Commands Reference (for Skill)

```bash
# Setup
provider-services keys add $AKASH_KEY_NAME
provider-services tx cert generate client  # Optional mTLS

# Deploy
provider-services tx deployment create deploy.yml --from $AKASH_KEY_NAME
provider-services query market bid list --owner $AKASH_ADDRESS
provider-services tx market lease create --dseq <seq> --provider <addr> --from $AKASH_KEY_NAME
provider-services send-manifest deploy.yml --dseq <seq> --provider <addr> --from $AKASH_KEY_NAME

# Operate
provider-services lease-status --dseq <seq> --provider <addr>
provider-services lease-logs --dseq <seq> --provider <addr>
provider-services lease-shell --dseq <seq> --provider <addr> --service <svc> --tty
provider-services tx deployment update deploy.yml --dseq <seq> --from $AKASH_KEY_NAME
provider-services tx deployment close --dseq <seq> --from $AKASH_KEY_NAME

# Query
provider-services query provider list
provider-services query deployment get --dseq <seq> --owner <addr>
provider-services query market lease list --owner <addr>

# AuthZ
provider-services tx authz grant <grantee> generic --msg-type /akash.deployment.v1beta3.MsgCreateDeployment --from <wallet>
```

### Success Metrics for Skill

- User can go from zero to running deployment in a single conversation
- SDL validation errors caught before on-chain submission
- Cost estimation provided before deployment creation
- Provider selection guidance based on workload type
- Complete operational lifecycle covered (deploy, monitor, update, close)

---

## Research Synthesis: Deploying on Akash Network via CLI — Comprehensive Technical Analysis

### Executive Summary

Akash Network is the leading decentralized compute marketplace, built on Cosmos SDK with CometBFT consensus, offering a Kubernetes-based cloud platform where tenants deploy Docker containers through a reverse-auction marketplace. The `provider-services` CLI (v0.10.0) provides complete deployment lifecycle management — from wallet creation and SDL manifest authoring through bid selection, lease management, and operational monitoring. With 428% year-over-year usage growth, 70%+ GPU utilization, and 34,300 new leases in Q4 2025 alone, Akash has established itself as the dominant DePIN compute platform.

For the purpose of creating a Claude Agent Skill, the CLI deployment workflow is well-structured and automatable: all configuration is environment-variable driven, the SDL format is declarative YAML (similar to Docker Compose), and the marketplace lifecycle follows a deterministic state machine (Order → Bid → Lease → Active → Closed). The 290+ SDL templates in Awesome Akash provide ready-made starting points across 30+ application categories. The platform's 2026 roadmap — including AkashML managed inference, BME tokenomics (buy-and-burn AKT → ACT stablecoin), confidential computing, and edge AI — signals continued rapid evolution that the skill should accommodate.

**Key Technical Findings:**

- `provider-services` CLI replaces legacy `akash` command; supports JWT (default) or mTLS authentication
- SDL v2.0 covers services, compute profiles, placement/pricing, persistent storage, IP leases, and GPU resources
- Three API layers (gRPC:9090, REST:1317, CometBFT RPC:26657) with gRPC as single source of truth
- Escrow-based block payments with multi-depositor support; minimum 0.5 AKT deposit
- AuthZ delegation enables CI/CD without private key exposure
- Cost advantage: 50-85% cheaper than AWS/GCP/Azure; A100 GPU at ~$1.10/hr

**Technical Recommendations:**

1. Build the skill around the 10-step CLI lifecycle with exact command templates
2. Include SDL authoring guidance with validation rules and template selection
3. Cover cost estimation, bid comparison, and escrow management
4. Address data persistence limitations and provider reliability risks
5. Keep skill extensible for AkashML, confidential computing, and BME/ACT features

### Table of Contents

1. Technical Research Introduction and Methodology
2. Akash Network Technical Landscape and Architecture
3. CLI Implementation — Complete Deployment Workflow
4. Technology Stack and Platform Evolution
5. Integration and Interoperability Patterns
6. Performance, Scalability, and Cost Analysis
7. Security and Trust Architecture
8. Strategic Recommendations for Skill Design
9. Implementation Roadmap and Risk Assessment
10. Future Technical Outlook (2026+)
11. Research Methodology and Source Documentation
12. Appendices and Quick Reference

### 1. Technical Research Introduction and Methodology

#### Technical Research Significance

The cloud computing market is projected at $650 billion in 2026, and decentralized alternatives are gaining traction as enterprises face pricing power concerns, data sovereignty issues, and high-profile outages from centralized providers. Akash Network, often called the "Airbnb for cloud computing," sits at the intersection of DePIN infrastructure, AI compute demand, and blockchain settlement — making it a strategically significant platform for developers seeking cost-effective, censorship-resistant deployment.

_Technical Importance: Akash is the largest decentralized compute marketplace by usage, with Kubernetes-compatible GPU markets reporting 428% YoY growth_
_Business Impact: 50-85% cost reduction vs centralized cloud enables new categories of economically viable AI/compute workloads_
_Source: [DePIN Scan](https://depinscan.io/news/2026-02-19/the-compute-revolution-decentralized-networks-vs-traditional-cloud-services), [WEEX Market Analysis](https://www.weex.com/questions/article/is-akash-a-good-coin-a-2026-market-analysis-17452)_

#### Technical Research Methodology

- **Technical Scope**: CLI toolchain, SDL specification, marketplace architecture, payment model, provider infrastructure, security, operational workflows
- **Data Sources**: Official Akash docs (akash.network/docs), GitHub repos (akash-network/*), Messari quarterly reports (Q1-Q4 2025), community resources, npm packages
- **Analysis Framework**: Architecture-first analysis → integration patterns → implementation workflow → risk assessment
- **Time Period**: Current as of April 2026, with historical context from Mainnet4 through Mainnet14
- **Technical Depth**: CLI command-level detail suitable for Claude Agent Skill authoring

#### Technical Research Goals Achievement

**Original Goal:** Creating a Claude Agent Skill for deploying applications on Akash Network using the CLI

**Achieved Objectives:**
- Complete CLI command reference with exact syntax for all deployment lifecycle operations
- SDL specification fully documented with validation rules and common error patterns
- Marketplace architecture (reverse auction, escrow, bid deposits) thoroughly analyzed
- Provider selection, cost optimization, and risk mitigation strategies documented
- 290+ SDL templates catalogued across 30+ categories for skill template guidance
- Security model (JWT/mTLS, AuthZ, K8s isolation) fully mapped
- 2026 roadmap features identified for skill extensibility planning

### 2. Akash Network Technical Landscape and Architecture

*Covered in detail in the "Architectural Patterns and Design" section above. Key points:*

- Four-layer architecture: Blockchain → Application → Provider → User
- Reverse auction marketplace with escrow-based block payments
- Provider Daemon orchestrates Kubernetes clusters with bid engine, manifest handler, cluster manager
- On-chain (deployment/bid/lease state) + off-chain (manifest delivery, logs, shell) communication model
- Audited attributes for provider capability verification

### 3. CLI Implementation — Complete Deployment Workflow

*Covered in detail in the "Implementation Approaches" section above. Key points:*

- Four-phase workflow: Setup → Define → Deploy → Operate
- 10 discrete CLI commands covering the full lifecycle
- Environment-variable driven configuration (non-interactive, CI/CD compatible)
- SDL validation rules for catching errors before on-chain submission
- Shell access, log streaming, and deployment updates for operational management

### 4. Technology Stack and Platform Evolution

*Covered in detail in the "Technology Stack Analysis" section above. Key additions:*

**Recent Platform Evolution (2025-2026):**
- **Mainnet 14**: Migrated to Cosmos SDK v0.53
- **AkashML** (Nov 2025): Managed AI inference layer, OpenAI-compatible API, 1.7B tokens/day on OpenRouter
- **BME Tokenomics** (March 2026): Tenant payments auto buy-and-burn AKT → mint ACT stablecoin for settlement
- **Starcluster**: Protocol-owned compute with 7,200 NVIDIA GB200 GPUs via Nodekeepers

_Source: [Akash 2026 Roadmap](https://akash.network/roadmap/2026/), [Metaverse Post on AkashML](https://mpost.io/akash-network-rolls-out-akashml-first-fully-managed-ai-inference-service-on-decentralized-gpus/)_

### 5. Integration and Interoperability Patterns

*Covered in detail in the "Integration Patterns Analysis" section above. Key points:*

- Three API layers: gRPC (primary), REST (auto-generated), CometBFT RPC (low-level)
- JS/TS SDK: `@akashnetwork/chain-sdk` (recommended), `akashjs` deprecated
- AuthZ for delegated deployment permissions (5 message types)
- WebSocket subscriptions for real-time blockchain event monitoring
- AEP-37 LeaseRPC gRPC service for streaming status/logs/restart

### 6. Performance, Scalability, and Cost Analysis

**Network Performance Metrics (Q4 2025):**
- 70%+ GPU utilization rate
- 34,300 new leases (28% QoQ growth)
- 1.7B tokens/day processed via AkashML

**Cost Comparison:**

| Resource | Akash (approx) | AWS (approx) | Savings |
|----------|----------------|--------------|---------|
| A100 GPU | ~$1.10/hr | ~$3-5/hr | 60-78% |
| 2 vCPU + 4GB | ~$5-10/mo | ~$30-50/mo | 70-85% |
| Web hosting | ~$2/mo | ~$10-20/mo | 80-90% |

_Note: Akash pricing varies by provider bids and AKT market price. Use the [Usage Calculator](https://akash.network/pricing/usage-calculator/) for current estimates._
_Source: [Akash Pricing](https://akash.network/pricing/usage-calculator/), [Oreate AI](https://www.oreateai.com/blog/akash-network-unlocking-affordable-gpu-power-for-the-ai-revolution/21aa9d1ec956c9a35e294b20106ac197)_

### 7. Security and Trust Architecture

*Covered in detail in the "Security Architecture Patterns" section above. Summary:*

Seven-layer security model: Identity (secp256k1), Authentication (JWT/mTLS), Transport (mTLS/HTTPS), Authorization (AuthZ), Isolation (K8s namespaces), Economic (deposits/escrow), Audit (on-chain attributes).

**Upcoming:** Confidential computing launching Q1 2026 — ensures application privacy even with physical machine access.

_Source: [Akash on X re: Confidential Computing](https://x.com/akashnet_/status/1981807867423568119)_

### 8. Strategic Recommendations for Skill Design

The Claude Agent Skill should be organized into **seven functional areas**:

| Area | Trigger Phrases | Key Content |
|------|----------------|-------------|
| **1. Setup** | "install akash", "set up wallet" | CLI install, key creation, env vars, funding |
| **2. SDL Authoring** | "create deployment file", "write SDL" | Template selection, resource specs, pricing, validation |
| **3. Deploy** | "deploy on akash", "create deployment" | Full 5-step deploy sequence with exact commands |
| **4. Operate** | "check deployment", "view logs" | Status, logs, shell, updates, closure |
| **5. Troubleshoot** | "deployment failed", "no bids" | SDL errors, bid failures, escrow, provider issues |
| **6. Optimize** | "reduce cost", "choose provider" | Bid comparison, resource right-sizing, escrow management |
| **7. Advanced** | "persistent storage", "GPU", "AuthZ" | Storage, IP leases, GPU SDL, delegation, CI/CD |

### 9. Implementation Roadmap and Risk Assessment

**Skill Implementation Phases:**

| Phase | Scope | Priority |
|-------|-------|----------|
| **Phase 1** | Core deployment lifecycle (setup, SDL, deploy, operate) | High |
| **Phase 2** | Troubleshooting and cost optimization guidance | High |
| **Phase 3** | Advanced features (persistent storage, GPU, IP leases) | Medium |
| **Phase 4** | AuthZ, CI/CD integration, team workflows | Medium |
| **Phase 5** | AkashML inference API, BME/ACT tokenomics | Low (future) |

**Risk Assessment:** See the "Risk Assessment and Limitations" table in the Implementation section above for the six identified risks and their mitigations.

### 10. Future Technical Outlook (2026+)

**2026 Roadmap Highlights:**

| Feature | Timeline | Impact |
|---------|----------|--------|
| Confidential Computing | Q1 2026 | Private workloads on shared infrastructure |
| Akash at Home (Edge AI) | March 2026 | Idle home compute for AI workloads |
| Lease-to-Lease Networking | May 2026 | Dynamic IP + secure inter-deployment communication |
| Reserved Instances + Preemptible | August 2026 | Cloud-style committed pricing + spot-like discounts |
| BME Tokenomics | Live (March 2026) | AKT buy-and-burn → ACT stablecoin settlement |

_Broader Trend: DePIN ecosystem now 1,170+ projects, 10.3M devices, ~$35-50B market cap. Decentralized compute is transitioning from niche to enterprise-viable._
_Source: [Akash 2026 Roadmap](https://akash.network/roadmap/2026/), [Cryptollia DePIN Analysis](https://cryptollia.com/articles/decentralized-ai-infrastructure-race-depin-tokenomics-compute-wars-2026)_

### 11. Research Methodology and Source Documentation

**Primary Sources:**
- [Akash Official Docs](https://akash.network/docs/) — CLI guides, SDL reference, architecture
- [Akash GitHub](https://github.com/akash-network) — Source code, SDL spec, provider daemon, akash-api
- [Akash 2026 Roadmap](https://akash.network/roadmap/2026/) — Platform evolution

**Secondary Sources:**
- [Messari Quarterly Reports](https://messari.io/project/akash-network-2) — Q1-Q4 2025 network metrics
- [DAIC Capital](https://daic.capital/blog/akash-network-architecture) — Architecture deep dive
- [StakeCito](https://www.stakecito.com/blog/understanding-akash-network-the-future-of-decentralized-cloud-computing) — Network analysis
- [DePIN Scan](https://depinscan.io/) — Market context
- [Awesome Akash](https://github.com/akash-network/awesome-akash) — SDL template library

**Research Quality:**
- All CLI commands verified against official documentation
- Architecture claims cross-referenced across 3+ sources
- Pricing data triangulated between Akash calculator, Messari reports, and community blogs
- Confidence: High for CLI workflow and SDL spec; Medium for pricing (market-dependent); High for architecture

### 12. Appendices — Quick Reference

**Environment Variables Cheatsheet:**
```bash
export AKASH_KEY_NAME="mykey"
export AKASH_NET="https://raw.githubusercontent.com/akash-network/net/main/mainnet"
export AKASH_CHAIN_ID=$(curl -s "$AKASH_NET/chain-id.txt")
export AKASH_NODE=$(curl -s "$AKASH_NET/rpc-nodes.txt" | head -1)
export AKASH_GAS=auto
export AKASH_GAS_ADJUSTMENT=1.25
export AKASH_GAS_PRICES=0.025uakt
export AKASH_SIGN_MODE=amino-json
```

**Minimal SDL Template:**
```yaml
---
version: "2.0"
services:
  web:
    image: nginx:latest
    expose:
      - port: 80
        as: 80
        to:
          - global: true
profiles:
  compute:
    web:
      resources:
        cpu:
          units: 0.5
        memory:
          size: 512Mi
        storage:
          size: 1Gi
  placement:
    dcloud:
      pricing:
        web:
          denom: uakt
          amount: 1000
deployment:
  web:
    dcloud:
      profile: web
      count: 1
```

**Complete CLI Workflow (Copy-Paste Ready):**
```bash
# 1. Create deployment
provider-services tx deployment create deploy.yml --from $AKASH_KEY_NAME

# 2. Wait for bids (~30s), then list
provider-services query market bid list --owner $AKASH_ADDRESS --dseq $DSEQ

# 3. Accept bid / create lease
provider-services tx market lease create --dseq $DSEQ --provider $PROVIDER --from $AKASH_KEY_NAME

# 4. Send manifest
provider-services send-manifest deploy.yml --dseq $DSEQ --provider $PROVIDER --from $AKASH_KEY_NAME

# 5. Verify
provider-services lease-status --dseq $DSEQ --provider $PROVIDER --from $AKASH_KEY_NAME
```

---

## Technical Research Conclusion

### Summary of Key Technical Findings

Akash Network provides a mature, well-documented CLI deployment system suitable for automation via a Claude Agent Skill. The `provider-services` CLI, SDL v2.0 manifest format, and reverse-auction marketplace create a deterministic, environment-variable-driven workflow that maps cleanly to guided conversational interactions. The platform's 290+ SDL templates, three-layer API, and AuthZ delegation system provide the depth needed for a comprehensive skill covering beginner through advanced use cases.

### Strategic Technical Impact

Building an Akash deployment skill positions TOON Protocol's skill library at the intersection of decentralized infrastructure and AI compute — two of the fastest-growing segments in Web3. With Akash's 428% YoY usage growth and the broader DePIN market reaching $35-50B, this skill addresses genuine developer demand for accessible decentralized cloud deployment.

### Next Steps

1. Use this research document as the knowledge base for skill authoring
2. Follow the 7-area skill design and 5-phase implementation roadmap
3. Start with the core deployment lifecycle (Phase 1), validate with real deployments
4. Extend to advanced features and future platform capabilities iteratively

---

**Technical Research Completion Date:** 2026-04-09
**Research Period:** Current comprehensive technical analysis (April 2026)
**Source Verification:** All technical facts cited with current sources
**Technical Confidence Level:** High — based on multiple authoritative technical sources

_This comprehensive technical research document serves as an authoritative reference on Akash Network CLI Deployment and provides the foundation for creating a Claude Agent Skill for deploying applications on the Akash decentralized cloud._
