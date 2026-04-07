# Dev Signal: TOON Pets Foundation — Memvid Brain + Dogfood Stack

**Date:** 2026-04-07
**Type:** milestone
**Epic:** Epic 11 — TOON Pets: ZK-Proven Virtual Pet Economy (1/14 stories)
**Priority:** YELLOW

## Headline

TOON ships native Rust-to-Node bridge for AI pet brains and a one-command local network stack — foundation for the first ZK-proven virtual pet economy on Interledger.

## Technical Summary

Two significant deliverables landed. First: `@toon-protocol/memvid-node`, a napi-rs native addon that lets TypeScript talk to Memvid's Rust engine at native speed — create, search, hash, and manage `.mv2` pet brain files with BLAKE3 composite hashing ready for ZK circuit integration. Second: `docker-compose-dogfood.yml`, a zero-build Docker Compose stack that spins up a complete local TOON network (Anvil EVM, two TOON peers with Arweave DVM, Ditto frontend) using public images. Anyone can fund a wallet and create TOON events locally in under a minute.

## Narrative Hooks (for Drew)

- **External:** TOON is building virtual pets with provably fair genetics and evolution — no server-side RNG manipulation. Every pet interaction is hashable and verifiable via zero-knowledge proofs. This is the anti-lootbox.
- **Industry:** The Memvid integration bridges the Arweave/AO ecosystem's permanent storage with Interledger's payment rails. Pet brains stored permanently, interactions paid for via ILP micropayments. Two ecosystem play.
- **Technical:** napi-rs lets a Rust AI engine (Memvid) run at native speed inside a Node.js protocol stack — no WASM overhead, no subprocess IPC. The BLAKE3 hashing produces ZK-friendly field elements, so every pet state change is provable on Mina's zkApp chain.
- **Developer:** The dogfood stack means any developer can `docker compose up` a full TOON network locally. Zero build steps, public images, built-in faucet. This is the "hello world" moment for TOON developer onboarding.
- **Narrative arc:** Epic 11 is TOON's first consumer-facing primitive. Epics 1-10 built protocol infrastructure. Pets are the proof that the infrastructure works — a real application people can interact with, not just an API.

## Key Stats

- Stories delivered: 1/14 (Sprint 1 foundation)
- Tests: 4,189 passing (+25 new for memvid-node)
- Code reviews: 3 passes, 24 issues found and fixed, 0 remaining
- Security scan: 0 vulnerabilities (semgrep)
- Traceability: 93% AC coverage

## Deep Dive Resources (for Drew)

These docs have the full story — competitive positioning, vision, and technical credibility:

| Doc | What Drew gets |
|-----|---------------|
| [`toon-pet-zkapp-architecture-handoff.md`](_bmad-output/planning-artifacts/toon-pet-zkapp-architecture-handoff.md) | **Start here.** Vision, competitive analysis table (vs Tamagotchi, Axie, Blobbi), "four building blocks" framing, token economics (PET burn-per-interaction) |
| [`pet-zkapp-game-rules-canonical.md`](_bmad-output/planning-artifacts/pet-zkapp-game-rules-canonical.md) | Complete game rules — proves this is real, not vaporware. 500 lines of production-ready circuit logic |
| [`memvid-toon-integration-handoff.md`](_bmad-output/planning-artifacts/memvid-toon-integration-handoff.md) | The Arweave/AO connection story — why Memvid, what it enables, how it fits the permanent storage narrative |
| [`pet-zkapp-integration-architecture.md`](_bmad-output/planning-artifacts/pet-zkapp-integration-architecture.md) | Trust model visualization — "zero trust math → verifiable content → trust operator" gradient. Good for explaining why ZK matters |

## Assets

- [x] Architecture diagram (technical reference): [Three-Chain Convergence](assets/2026-04-07-epic-11-toon-pets-foundation-diagram.excalidraw.json) ([PNG](assets/2026-04-07-epic-11-toon-pets-foundation-diagram.excalidraw.png))
- [x] Story diagram (for Drew): [Why TOON Pets](assets/2026-04-07-epic-11-toon-pets-story-diagram.excalidraw.json) ([PNG](assets/2026-04-07-epic-11-toon-pets-story-diagram.excalidraw.png))
- [ ] Screenshot (recommended: `docker compose -f docker-compose-dogfood.yml up` terminal output + Ditto frontend once running)
- [x] Demo-able flow (dogfood stack is fully functional — Ditto frontend + local network)
- [ ] Metrics / benchmarks (native napi-rs vs WASM comparison would be compelling)

## Discord Drop

```
YELLOW | Epic 11: TOON Pets (1/14 stories)
--------------------------------------
Headline: Rust AI pet brains running native in Node.js + one-command local TOON network

Hooks for Drew:
-> Consumer angle: first ZK-proven virtual pets — provably fair genetics, no server-side RNG cheating
-> Ecosystem play: Memvid (Arweave/AO storage) + ILP micropayments + Mina ZK proofs = three-chain convergence
-> Developer story: `docker compose up` gives you a full TOON network with faucet — hello world moment
-> Arc: Epic 11 is TOON's first consumer-facing app. Infrastructure epics are done. Now it gets real.

Assets: dogfood stack is demo-able NOW, architecture diagram recommended
```
