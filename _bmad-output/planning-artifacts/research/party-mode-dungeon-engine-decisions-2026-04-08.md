# Party Mode Decision Record: TOON Game Engine & Pet Dungeon Crawl

**Date:** 2026-04-08
**Participants:** All BMAD agents (Party Mode)
**Topic:** Research novel game engine architectures with ILP+Nostr+DVM stack; design Pet Dungeon Crawl extension for Epic 11
**Status:** Approved — decisions shape Epic 11 Sprint 5 (Stories 11-15 through 11-18)

---

## Context

Jonathan asked the team to research what kind of game engine can be built with the TOON Protocol stack (ILP + Nostr + DVM). The discussion explored the intersection of protocol primitives and game mechanics, producing the "Living Dungeon" concept — pets crawl procedurally-generated dungeons served as DVM compute services.

---

## Key Insights

### 1. TOON IS a Game Engine

The four network primitives map directly to game architecture layers:

| Primitive | Game Layer |
|-----------|-----------|
| Messaging (kind:1) | Real-time game events, chat, coordination |
| Blob Storage (kind:5094) | Asset storage, save states, world data |
| Compute (kind:5250) | Game logic execution, AI NPCs, physics |
| Chain Bridge (kind:5260) | On-chain settlement, item ownership, achievements |

### 2. The "Optimistic Game Engine" Pattern

TOON enables a novel game architecture category:

- **Pessimistic** (MUD, Dojo): On-chain execution — slow, expensive, trustless
- **Traditional** (Immutable, Ronin): Off-chain server — fast, trusted
- **Optimistic** (TOON): Off-chain execution + async ZK proof + on-chain settlement on dispute

The ProofQueue pattern (already built for Pet DVM) is the core mechanism: gameplay responds in ~100ms, ZK proofs generate in the background, blockchain settlement happens only when needed.

### 3. ZK-CRDTs (Novel Concept)

Dr. Quinn proposed "ZK-CRDTs" — convergent data types where the merge function is a zero-knowledge proof. Each player's actions generate ZK proofs published to the relay. Any observer can verify all proofs and reconstruct world state. Conflicts resolved by circuit rules, not servers.

**Sweet spot:** Turn-based and strategy games where tick rate is seconds/minutes (not milliseconds).

### 4. Marketplace-as-World

DVM providers ARE the game world. Different providers serve different aspects:
- Provider A: dungeon logic (kind:5250)
- Provider B: NPC AI (kind:5250)
- Provider C: item crafting (kind:5250)

All discoverable via kind:10035. If one goes down, the marketplace surfaces alternatives. The game world is a marketplace, not a server farm.

### 5. Novel Game Archetypes (TOON-Only)

| Archetype | Mechanism |
|-----------|-----------|
| Economic Warfare | ILP routing IS gameplay; prefix claims (kind:10034) = territory |
| Proof-of-Play | ZK proof chains replace rankings; achievements are math, not server trust |
| Emergent World | Permissionless kind system lets players propose new mechanics as DVM services |
| Memvid NPCs | NPCs with permanent Arweave memory that evolves through player interaction |
| Cross-Game Items | ZK proof of provenance travels across games via Chain Bridge |

---

## Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| D11-PM-001 | **Idle Dungeon for MVP** — one DVM call = one dungeon run | Simplest UX, cheapest (one ILP payment), best ZK profile (one state transition per run) |
| D11-PM-002 | **Pet stats determine dungeon outcomes** — discipline→combat, energy→range, happiness→luck, hunger→survival | Creates virtuous loop between pet care and dungeon rewards; well-cared-for pets go deeper |
| D11-PM-003 | **Separate DVM handler** — DungeonDvmHandler alongside PetDvmHandler | Clean separation; dungeon is additive, not disruptive to existing pet infrastructure |
| D11-PM-004 | **Stat deltas feed through PetDvmHandler** — dungeon effects are ZK-proven via existing circuit | Reuses existing ZK infrastructure; no new circuit for dungeon MVP |
| D11-PM-005 | **Adventure logs on Arweave** — permanent narrative records via kind:5094 | Pet builds provable biography; permanent, verifiable adventure history |
| D11-PM-006 | **Marketplace-as-world** — anyone can publish a dungeon as DVM provider | Proves marketplace thesis; third-party content via kind:10035 SkillDescriptors |
| D11-PM-007 | **rot.js as dungeon engine** — BSD-3, TypeScript, seedable RNG, headless, ~2,700 stars | Best fit: deterministic (ZK-compatible), headless (DVM-compatible), feature-complete (procedural gen, pathfinding, FOV, scheduling) |
| D11-PM-008 | **Slay the Web action/state pattern** — `action(state) → newState` pure functions | Maps 1:1 to ZK state transitions; same architecture as PetGameEngine |
| D11-PM-009 | **Ninja Adventure + 0x72 Dungeon Tileset II (both CC0)** as asset combo | Ninja Adventure = 80% coverage (100+ animated monsters, multiple dungeon tilesets, items, effects, sound). 0x72 = dungeon-specific supplement (12+ monster types, focused dungeon tiles). Both CC0 — zero licensing friction for third-party dungeon creators. Minifantasy (paid) available as premium upgrade path. |
| D11-PM-010 | **No changes to existing Epic 11 stories** — dungeon is Sprint 5 extension | Stories 11-1 through 11-14 unchanged; 4 new stories (11-15 to 11-18) added |

---

## Technology Research Summary

### Tier 1: Must-Use

| Library | License | Language | Stars | Key Feature |
|---------|---------|----------|-------|-------------|
| **rot.js** (`rot-js` on npm) | BSD-3 | TypeScript | ~2,700 | Seedable RNG, dungeon gen (BSP/Cellular/Maze/Rogue), A* pathfinding, FOV, turn scheduling. All headless. |
| **Slay the Web** pattern | — | JavaScript | ~250 | UI-agnostic game engine with `action(state) → newState` architecture. Perfect ZK compatibility. |
| **node-roguelike** (`roguelike` on npm) | BSD-2 | JavaScript | — | THREE generator types + key/door puzzles. Same author has `node-gacha` for loot tables. |

### Tier 2: Supplements

| Library | License | What It Adds |
|---------|---------|--------------|
| `@mikewesthad/dungeon` | ISC | Simple brute-force room builder, returns 2D arrays |
| `dungeoneer` | MIT | Bob Nystrom's Hauberk algorithm, typed tiles |
| `dungeon` (semibran) | MIT | Explicitly seedable — designed for deterministic gen |

### Tier 3: Investigated but Not Recommended

| Library | Why Not |
|---------|---------|
| Excalibur.js | Too heavy, canvas-dependent — not headless |
| RanvierMUD | Designed for persistent multiplayer MUD, overkill for turn-based DVM |
| bracket-lib (Rust) | Good but adds WASM compilation complexity without sufficient benefit over rot.js |

### Asset Selection (FINALIZED)

**Dungeon Assets (CC0):**
- **Ninja Adventure** by Pixel-boy & AAA (CC0, free) — base pack: 100+ animated monsters, dungeon/cave/castle tilesets, items, effects, sound, music
- **0x72 Dungeon Tileset II v1.7** (CC0, free) — dungeon-focused: 12+ animated monsters, heroes, dungeon tiles
- **0x72 Extensions** (CC0, free) — Autotile Remix (procedural gen), Dark Dungeon theme, Stairs, Extended pack
- Dungeon Crawl Stone Soup — **rejected** for dated visual style

**Pet/Blobbi Sprites (CC0):**
- **Animated Slimes** by Stealthix (CC0, free) — 16x16 slimes in 5 colors, 4-direction animated movement
- **16 Blobbi type variants** generated via palette-swap script (`assets/dungeon/pets-slimes/generate-blobbi-variants.py`)
- Existing Ditto SVG Blobbi art does NOT match 16x16 pixel art style — dungeon uses pixel slime proxies
- **Pixel Mob!** by Henry Software (CC0, $7) identified as upgrade path for more creature variety

All assets stored in `assets/dungeon/` with binary files gitignored (README.md has download links).

---

## Competitive Landscape

| Platform | Model | TOON Advantage |
|----------|-------|----------------|
| Immutable X | L2 for NFT games, centralized servers | TOON: no server requirement, ZK-proven state |
| Ronin/Axie | App-specific chain | TOON: chain-agnostic via Chain Bridge |
| Dark Forest | ZK game on Ethereum | TOON: off-chain execution (orders of magnitude cheaper) |
| MUD/Lattice | On-chain game engine (EVM) | TOON: off-chain compute, on-chain settlement only |
| Dojo/Starknet | Cairo-based game framework | TOON: not locked to one ZK system |
| World Engine (Argus) | Sharded on-chain worlds | TOON: provider marketplace = natural sharding |

**Critical differentiator:** TOON separates concerns: Nostr for real-time events, ILP for payments, Arweave for persistence, ZK for verification, DVM for compute. Every other platform conflates at least two.

---

## New Stories (Epic 11, Sprint 5)

| ID | Title | Dependencies | Scope |
|----|-------|-------------|-------|
| 11-15 | Dungeon Engine Core | 11-4 (Game Engine) | rot.js integration, procedural gen, encounter resolution, loot tables. `DungeonGameEngine` class. Headless, deterministic, seedable. |
| 11-16 | Pet-Dungeon Stat Bridge | 11-15, 11-4 | Map pet stats → dungeon modifiers. Pure functions, boundary-tested. |
| 11-17 | Dungeon DVM Handler | 11-15, 11-16, 11-5 | `DungeonDvmHandler` wrapping dungeon engine as kind:5250 compute DVM. SkillDescriptor for marketplace. |
| 11-18 | Dungeon Adventure Log | 11-17 | Narrative generator + Arweave upload via kind:5094. Permanent adventure biography. |

**Dependency chain:** 11-15 → 11-16 → 11-17 → 11-18 (sequential)

---

## Documents Updated

- `_bmad-output/implementation-artifacts/sprint-status.yaml` — added 11-15 through 11-18
- `_bmad-output/project-context.md` — updated Epic 11 scope, added dungeon architecture section, added to Example Applications table
- `_bmad-output/planning-artifacts/pet-zkapp-integration-architecture.md` — added section 14 (dungeon system map, enforcement boundaries, data flow, event kinds, SkillDescriptor, decisions), added Q9-Q11 to open questions
- `_bmad-output/planning-artifacts/test-design-epic-11.md` — added Sprint 5 test strategies for 11-15 through 11-18, new risks R-023/R-024/R-025, Sprint 5 quality gates G16-G20

---

## Next Steps

1. ~~Finalize animated sprite asset pack selection~~ — DONE (Ninja Adventure + 0x72 + Animated Slimes + 16 Blobbi variants generated)
2. Complete existing Sprint 2 stories (11-5 done, 11-6 and 11-7 backlog)
3. Continue through Sprints 3-4 as planned
4. Create detailed story files for 11-15 through 11-18 when Sprint 5 begins
5. Spike: verify rot.js headless compatibility in Node.js (no DOM/Canvas dependency)
