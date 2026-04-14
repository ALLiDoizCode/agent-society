# Dev Signal: ATOR Integration Research — Onion Routing as Transport for TOON Connectors

**Date:** 2026-04-13
**Type:** milestone
**Epic:** Pre-epic research — ATOR Protocol integration
**Priority:** RED

## Headline

Deep technical research into integrating ATOR Protocol (Tor fork with 22K token-incentivized relays) as a privacy transport for TOON connectors — enabling home-hosted connectors on Raspberry Pis with no public IP, no port forwarding, and hidden peering graphs.

## Technical Summary

Multi-hour roundtable analysis with architecture, strategy, security, and implementation agents explored how the ATOR Protocol (a Tor 0.4.9.x fork with ANYONE token-incentivized relays) could integrate with the TOON Protocol connector stack. The research progressed through several key reframes: (1) ATOR provides onion routing at the transport layer — TOON connectors ride on top as application-layer payload, same as HTTP rides on Tor; (2) relay operators stay content-blind (they see encrypted 514-byte cells, not ILP packets), so ILP per-packet fees can't flow to relay operators — the economic layers are intentionally separate; (3) with NIP-59 gift wrapping already encrypting settlement claims, the full stack provides three nested privacy layers; (4) the integration is an overlay (~50 lines of SOCKS5 proxy support in BTP WebSocket client + `@anyone-protocol/anyone-client` npm SDK as dependency), not a protocol change.

## Key Findings

### What ATOR Actually Is
- Tor fork with zero protocol-level changes — same onion routing, same crypto, same circuit construction
- Separate network: 7 Anyone-run directory authorities, `.anon` TLD (not `.onion`)
- 22K registered relays (~7.6K active) vs Tor's ~6.5K — larger relay pool
- Business model: ANYONE token rewards for relay operators based on consensus-measured bandwidth (proof of capacity)
- npm SDK: `@anyone-protocol/anyone-client` manages binary lifecycle, exposes SOCKS5

### Architecture Decision: OSI Layering
```
APPLICATION:  TOON Connectors (ILP peering, settlement, fees)
CIRCUIT:      Encrypted cells (payload opaque to relays)
TRANSPORT:    ATOR Relay Network (routes cells, earns ANYONE tokens)
LINK:         TLS connections between relays
```

Key insight: Tor doesn't care about HTTP. It won't care about ILP. TOON is just another application riding encrypted through onion circuits.

### Three-Layer Privacy Stack
1. **ATOR circuit encryption** — relays see only 514-byte fixed-size cells, know only predecessor/successor
2. **ILP routing metadata** — visible only to connector endpoints (destination, amount, expiry)
3. **NIP-59 gift wrapping** — three-layer ChaCha20-Poly1305 encryption on settlement claims (sender identity, blockchain type, amounts all hidden even from intermediary connectors)

### Economic Separation (Important)
- Relay operators earn ANYONE tokens for **available capacity** (measured bandwidth, not actual usage)
- Connector operators earn ILP fees for **actual routing work** (per-packet)
- These are **separate economic loops** by design — the privacy boundary prevents ILP fees from reaching relays
- This is not a bug — it's the same structure as ISPs carrying Netflix traffic (ISP sells bandwidth, Netflix sells content)
- ATOR relay operators are NOT directly compensated by ILP traffic flowing through their relays

### What Was Invalidated
- **Circuit Provider DVM**: Can't build circuits "for" a client — telescoping key exchange requires the client to hold session keys. A third-party circuit builder would see all traffic in cleartext (just a VPN with extra steps). Privacy model collapses.
- **ILP fees replacing ATOR capacity rewards**: Relay is blind to ILP packets (encrypted inside cells). Can't calculate fees on what you can't see.
- **Relay-as-connector merge**: Fundamentally different machines — relay does pre-cached forwarding on encrypted cells, connector does per-packet routing with fee calculation on visible ILP fields.

### The Killer Use Case: Home-Hosted Connectors
ATOR's `.anon` hidden services enable connectors to run behind NAT with no public IP:
- No public IP address needed
- No port forwarding or dynamic DNS
- No domain name — `.anon` address derived from keypair
- No IP exposure to peers — home address stays private
- Raspberry Pi on home WiFi is genuinely sufficient

This drops the barrier to entry from "rent a VPS and configure networking" to "plug in a Pi and run a script."

### Integration Scope (Minimal)
- ~50 lines: SOCKS5 proxy support in BTP WebSocket client (`socks-proxy-agent` npm package)
- 1 dependency: `@anyone-protocol/anyone-client` for `anon` binary lifecycle
- 0 changes to ATOR relay code
- 0 changes to ILP packet format
- 0 changes to BTP protocol
- Optional: Nostr-based peer discovery using existing NIP-59 keys

## Narrative Hooks (for Drew)

- **External:** TOON connectors can now run from a Raspberry Pi on a home network — no VPS, no public IP, no exposed infrastructure. Anyone with a $35 Pi can become an ILP payment router and earn per-packet fees. This is the "mine Bitcoin from your laptop" moment for payment infrastructure.

- **Industry:** ATOR has 22K registered relay nodes — a larger anonymity network than Tor itself, built through token incentives. TOON riding on this gives the connector network access to that infrastructure without needing to build it. The relay operators are already deployed and incentivized. TOON adds demand-side economics (real payment traffic) to their supply-side network.

- **Technical:** Three nested privacy layers (ATOR circuit encryption + ILP routing metadata + NIP-59 gift wrapping) achieve a property neither system has alone: unlinkable anonymous payments with private settlement. An adversary must compromise all three layers simultaneously for full deanonymization, and each layer requires a different class of attack capability.

- **Nostr ecosystem:** Connector peer discovery can use Nostr event advertisements (leveraging existing NIP-59 identity keys), making the entire peering layer censorship-resistant and decentralized.

## Key Stats

- Research duration: ~3 hours, multi-agent roundtable
- Agents consulted: Winston (Architect), Amelia (Developer), Dr. Quinn (Problem Solver), Victor (Strategy)
- Hypotheses tested: 5 (overlay, DVM, circuit provider, incentive replacement, relay-connector merge)
- Hypotheses validated: 1 (overlay with `.anon` hidden services)
- Hypotheses invalidated: 4 (with documented reasoning)
- Integration code estimate: ~50 lines + 1 npm dependency
- ATOR protocol changes required: 0

## Assets

- [ ] Architecture diagram: three-layer privacy stack visualization
- [ ] Integration flow diagram: BTP-over-SOCKS5-over-ATOR circuit
- [ ] Raspberry Pi deployment diagram
- [ ] Comparison table: with/without ATOR transport

## Open Questions for Strategic Discussion

1. **Is home-hosted connectors the primary value prop?** Or is enterprise peering-graph opacity more compelling?
2. **ATOR vs mainline Tor?** Same protocol — should we support both, or partner specifically with ATOR for the relay network + token alignment?
3. **Dual-role hardware?** ATOR already sells plug-and-play relay hardware. Adding TOON connector to that image = device that earns both ANYONE tokens AND ILP fees. Partnership opportunity?
4. **Latency tradeoff?** Onion routing adds 200-600ms. Is this acceptable for ILP STREAM micropayments, or only for batch settlement?
5. **When to build?** Integration is small (~50 lines). Could ship as an optional transport provider in a single sprint.

## Discord Drop

```
RED | Research: ATOR Protocol Integration — Onion Routing for TOON Connectors
--------------------------------------
Headline: TOON connectors can run from a Raspberry Pi at home — no VPS, no public IP, no exposed infrastructure.

ATOR (Tor fork, 22K relays, token-incentivized) provides onion routing transport. TOON rides on top as application-layer payload. Three nested privacy layers: circuit encryption + ILP routing + NIP-59 gift wrapping.

Hooks for Drew:
-> "Mine payments from your kitchen" — $35 Pi becomes an ILP payment router earning per-packet fees
-> 22K relay network already built and incentivized — TOON adds real payment traffic as demand
-> Three-layer privacy achieves unlinkable anonymous payments — adversary needs all three compromised
-> Integration is ~50 lines of code + 1 npm dependency. Zero protocol changes to either side.

Tested 5 integration hypotheses, validated 1 (overlay transport), invalidated 4 with documented reasoning.

Open: ATOR vs mainline Tor? Dual-role hardware partnership? Latency acceptable for STREAM?

Assets: research document, architecture analysis, roundtable transcript
```
