# Epic 10: ElizaOS Plugin

**Phase:** Integration
**Estimated Stories:** 10
**Dependencies:** Epic 9 (agent-society published to npm)
**External Dependency:** `@agent-runtime/connector` published as npm library (work tracked in agent-runtime repo — see `ELIZAOS-INTEGRATION-HANDOFF.md`)
**Blocks:** Epics 11–16 (future NIP/feature epics benefit from ElizaOS runtime)

---

## Epic Goal

Create `@agent-society/elizaos-plugin` — an ElizaOS plugin that wraps the entire agent-society + agent-runtime stack as a single in-process Service, with Actions for payments/discovery/trust, Providers for LLM context injection, and Evaluators for learning from outcomes. The end state: one ElizaOS character file, one process, a fully functional ILP-connected Nostr payment agent.

## Epic Description

### Existing System Context

- **Current functionality:** agent-society provides Nostr peer discovery, SPSP, trust scoring, BLS, and relay. agent-runtime provides ILP connector with BTP, routing, and settlement. After Epics 9-10, both are importable npm libraries.
- **Technology stack:** ElizaOS (agent runtime framework), TypeScript, @elizaos/core
- **Integration points:** ElizaOS Plugin interface (Services, Actions, Providers, Evaluators, Events, Routes)

### Target Architecture

```
ElizaOS Agent Process
├── AgentSocietyService (ElizaOS Service)
│   ├── ConnectorNode (BTP server — external peers connect here)
│   ├── BusinessLogicServer (BLS — handles incoming payments)
│   ├── NostrRelayServer (NIP-01 relay — external Nostr clients connect)
│   ├── BootstrapService (discovers peers, negotiates SPSP)
│   ├── SocialTrustManager (trust from social graph)
│   └── NostrSpspClient/Server (payment setup)
│
├── Actions
│   ├── PAY — "Pay Alice 5 USD"
│   ├── REQUEST_PAYMENT — "Request 10 USD from Bob"
│   ├── DISCOVER_PEERS — "Find new payment peers"
│   ├── CHECK_TRUST — "How much do I trust Carol?"
│   ├── BOOTSTRAP_NETWORK — "Bootstrap my ILP network"
│   └── PUBLISH_PEER_INFO — "Update my ILP peer info"
│
├── Providers (inject context into LLM decisions)
│   ├── trustScore — trust scores for mentioned peers
│   ├── peerStatus — connected peer status
│   ├── ilpBalance — connector balances per peer
│   ├── networkStatus — bootstrap phase, relay health
│   └── paymentHistory — recent payment records
│
├── Evaluators (learn from outcomes)
│   ├── paymentOutcome — assess success/failure, record in memory
│   └── trustEvolution — track trust changes over time
│
└── Routes (HTTP API for external tools)
    ├── GET /status
    ├── GET /peers
    ├── GET /trust/:pubkey
    └── GET /payments
```

### What's Being Built

**Part A — Integration Refactoring (in @agent-society/core)**

Before building the plugin, core needs to compose the connector directly:

1. **createDirectRuntimeClient()** — in-process alternative to HTTP client, wraps ConnectorNode
2. **Make BLS handlePayment() public** — so connector can call it directly
3. **createAgentSocietyNode()** — single composition function that wires connector ↔ BLS ↔ bootstrap ↔ SPSP ↔ trust ↔ relay into one object with `start()`/`stop()` lifecycle
4. **Add @agent-runtime/connector as dependency** of @agent-society/core

**Part B — ElizaOS Plugin Package**

5. **Package scaffolding** — new `packages/elizaos-plugin/` with package.json, tsconfig, tsup
6. **AgentSocietyService** — ElizaOS Service wrapping `createAgentSocietyNode()`, reads config from character settings/secrets
7. **PAY Action** — end-to-end payment: resolve recipient → check trust → SPSP negotiate → send ILP packet → record outcome
8. **Discovery & Trust Actions** — DISCOVER_PEERS, CHECK_TRUST, BOOTSTRAP_NETWORK, PUBLISH_PEER_INFO, REQUEST_PAYMENT
9. **Providers** — trustScore, peerStatus, ilpBalance, networkStatus, paymentHistory
10. **Evaluators, Events, Routes** — paymentOutcome, trustEvolution evaluators; custom event types; REST routes

### Character Configuration

With the plugin installed, an agent needs only a character file:

```jsonc
{
  "name": "PaymentAgent",
  "plugins": ["@agent-society/elizaos-plugin"],
  "settings": {
    "AGENT_SOCIETY_ILP_ADDRESS": "g.agent.payment-agent",
    "BTP_PORT": "7768",
    "RELAY_PORT": "7100",
    "AGENT_SOCIETY_RELAYS": "wss://relay.damus.io,wss://relay.nostr.band",
    "AGENT_SOCIETY_AUTO_BOOTSTRAP": "true",
    "AGENT_SOCIETY_TRUST_THRESHOLD": "0.5",
    "AGENT_SOCIETY_MAX_PAYMENT": "100"
  },
  "secrets": {
    "AGENT_SOCIETY_NOSTR_PRIVATE_KEY": "<hex-encoded-nostr-private-key>"
  }
}
```

## Acceptance Criteria

- [ ] `npm install @agent-society/elizaos-plugin` works
- [ ] Plugin loads in ElizaOS runtime without errors
- [ ] Agent bootstraps into ILP network on startup (BTP port open, peers discovered)
- [ ] "Pay Alice 5 USD" works end-to-end via PAY action (resolve → trust → SPSP → ILP → fulfill)
- [ ] Trust scores appear in LLM context when peers are mentioned (trustScoreProvider)
- [ ] Peer status and balances available via providers
- [ ] Payment outcomes recorded in ElizaOS Memory
- [ ] `GET /status` returns network health
- [ ] No HTTP between connector and BLS (direct function calls)
- [ ] Single character file is the only required configuration

## Stories

| # | Story | Description | Size |
|---|-------|-------------|------|
| 10.1 | Create createDirectRuntimeClient() | In-process AgentRuntimeClient that wraps ConnectorNode.sendPacket() directly | M |
| 10.2 | Make BLS handlePayment() public | Change from private to public method on BusinessLogicServer | S |
| 10.3 | Create createAgentSocietyNode() composition function | Single function that wires connector ↔ BLS ↔ bootstrap ↔ SPSP ↔ trust with start()/stop() lifecycle | L |
| 10.4 | Add @agent-runtime/connector dependency to core | Add dependency, update exports to re-export connector types | S |
| 10.5 | Create ElizaOS plugin package scaffolding | New packages/elizaos-plugin/ with package.json, tsconfig, tsup, README | S |
| 10.6 | Implement AgentSocietyService | ElizaOS Service wrapping createAgentSocietyNode(), config from character settings | L |
| 10.7 | Implement PAY action | End-to-end payment flow: resolve recipient, trust check, SPSP, ILP send, record outcome | L |
| 10.8 | Implement discovery and trust actions | DISCOVER_PEERS, CHECK_TRUST, BOOTSTRAP_NETWORK, PUBLISH_PEER_INFO, REQUEST_PAYMENT | L |
| 10.9 | Implement providers | trustScore, peerStatus, ilpBalance, networkStatus, paymentHistory providers | L |
| 10.10 | Implement evaluators, events, and routes | paymentOutcome + trustEvolution evaluators, custom event types, REST routes, publish to npm | M |

---
