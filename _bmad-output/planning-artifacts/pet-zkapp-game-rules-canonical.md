# Pet zkApp Game Rules — Canonical Reference

**Date:** 2026-04-05
**Status:** Approved — canonical source for PetLifecycle ZkProgram implementation
**Canonical Source:** Ditto (`/Users/jonathangreen/Documents/ditto/`) per Jonathan's decision 2026-04-05
**Cooldown Source:** nostr-pet (`/Users/jonathangreen/Documents/nostr-pet/src/lib/cooldown-storage.ts`) — only formalized cooldown spec
**Companion Doc:** [TOON Pet zkApp Architecture Handoff](toon-pet-zkapp-architecture-handoff.md)

---

## Decision Log

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | **Ditto constants are canonical**, not nostr-pet | Ditto is the TOON-integrated production client. Live pets use these values. |
| D2 | **Cooldowns are circuit-enforced** | Stronger guarantees. DVM operators cannot spam interactions. |
| D3 | **Cooldown model: nostr-pet durations** | Ditto has no formalized cooldown-storage; nostr-pet is the only structured spec. |
| D4 | **Social tasks NOT circuit-enforced** | Hatching/evolution require Nostr posts (kind 1, 36767, 3367) — off-chain actions unprovable in Mina circuit. DVM attests social task completion. |
| D5 | **Circuit enforces: interaction count + stat thresholds + cooldowns + decay + token cost** | Everything that can be mathematically verified goes in-circuit. |
| D6 | **Stat floor is 1, not 0** | Ditto uses `STAT_MIN = 1`. A pet can never have 0 in any stat. |
| D7 | **Stat deltas floored before application** | `Math.floor(delta)` applied to all decay calculations before stat update. |
| D8 | **Owner signs Poseidon commitment with Mina key** | Per-interaction trustless timestamp verification at ~500 rows (not ~50,000 for Schnorr). Owner derives Mina key from same mnemonic as Nostr key. |
| D9 | **interactionHash committed to proof chain** | `Poseidon(actionType, itemId, timestamp, tokenCost)` included in lifecycleHash. Binds every interaction to the proof. ~50 rows. |
| D10 | **Slot-bounded batch timestamps** | `batchLastTimestamp <= currentSlotTime + 300s` and `>= currentSlotTime - 3600s`. Prevents clock manipulation. ~200 rows. |

---

## 1. Stat System

### 1.1 Stat Definitions

| Stat | Type | Min | Max | Default (new pet) |
|------|------|-----|-----|-------------------|
| `hunger` | UInt32 | 1 | 100 | 100 |
| `happiness` | UInt32 | 1 | 100 | 100 |
| `health` | UInt32 | 1 | 100 | 100 |
| `hygiene` | UInt32 | 1 | 100 | 100 |
| `energy` | UInt32 | 1 | 100 | 100 |

**Source:** `ditto/src/lib/blobbi.ts` lines 29, 34, 37-43

### 1.2 Clamping Rules

```
clampStat(value) = max(1, min(100, round(value)))
applyStat(current, delta) = clampStat(current + delta)
```

**Source:** `ditto/src/blobbi/actions/lib/blobbi-action-utils.ts` lines 97-108

**Circuit implication:** All stat operations must clamp to [1, 100] after application. Use `Math.round` equivalent for stat application, `Math.floor` for decay deltas.

### 1.3 Lifecycle Stages

| Stage | Value | Transitions To | Can Regress? |
|-------|-------|---------------|-------------|
| `egg` | 0 | `baby` (hatch) | No |
| `baby` | 1 | `adult` (evolve) | No |
| `adult` | 2 | — (terminal) | No |

**Circuit enforcement:** `newStage >= currentStage` (stage only advances, never regresses).

---

## 2. Decay Rates

All rates are **per hour**. Time conversion: `elapsedHours = elapsedSeconds / 3600`.

All decay deltas are **floored** before application: `statDelta = floor(rate × elapsedHours)`.

### 2.1 Egg Stage Decay

**Source:** `ditto/src/lib/blobbi-decay.ts` lines 64-77

| Stat | Rate/hr | Condition | Notes |
|------|---------|-----------|-------|
| hunger | — | Fixed at 100 | Eggs don't eat |
| energy | — | Fixed at 100 | Eggs don't tire |
| hygiene | **-8.0** | Always | |
| health (base) | **-1.0** | Always | |
| health (penalty) | **-2.0** | hygiene **<** 70 | Additive with base |
| health (penalty) | **-3.0** | hygiene **<** 40 | Additive with base + above |
| happiness | **+2.0** | health **>=** 70 AND hygiene **>=** 70 | Good care bonus |
| happiness | **-2.0** | health **>=** 40 AND hygiene **>=** 40 (but not both >=70) | Moderate |
| happiness | **-4.0** | health **<** 40 OR hygiene **<** 40 | Poor care |

**Egg health worst case:** `-1.0 + (-2.0) + (-3.0) = -6.0/hr` (when hygiene < 40)

**Egg happiness logic (pseudocode):**
```
if health >= 70 AND hygiene >= 70:
    happinessDelta = +2.0 × hours
elif health >= 40 AND hygiene >= 40:
    happinessDelta = -2.0 × hours
else:
    happinessDelta = -4.0 × hours
```

### 2.2 Baby Stage Decay

**Source:** `ditto/src/lib/blobbi-decay.ts` lines 84-106, 271-325

| Stat | Rate/hr | Condition |
|------|---------|-----------|
| hunger | **-7.0** | Always |
| happiness | **-4.0** | Always |
| hygiene | **-5.0** | Always |
| energy (awake) | **-8.0** | `state != sleeping` |
| energy (sleeping) | **+6.0** | `state == sleeping` |

**Baby Health Decay (cumulative penalties):**

| Component | Rate/hr | Condition |
|-----------|---------|-----------|
| base | **-0.75** | Always |
| hungerBelow70 | **-0.75** | hunger **<** 70 |
| hungerBelow40 | **-1.25** | hunger **<** 40 |
| hygieneBelow70 | **-0.75** | hygiene **<** 70 |
| hygieneBelow40 | **-1.25** | hygiene **<** 40 |
| energyBelow50 | **-0.5** | energy **<** 50 |
| energyBelow25 | **-1.0** | energy **<** 25 |
| happinessBelow50 | **-0.5** | happiness **<** 50 |
| happinessBelow25 | **-1.0** | happiness **<** 25 |
| **regeneration** | **+1.5** | hunger **>=** 80 AND happiness **>=** 80 AND hygiene **>=** 80 AND energy **>=** 80 |

**Baby health worst case:** `-0.75 + (-0.75 + -1.25) + (-0.75 + -1.25) + (-0.5 + -1.0) + (-0.5 + -1.0) = -7.75/hr`

### 2.3 Adult Stage Decay

**Source:** `ditto/src/lib/blobbi-decay.ts` lines 113-135, 330-384

| Stat | Rate/hr | Condition |
|------|---------|-----------|
| hunger | **-4.5** | Always |
| happiness | **-2.5** | Always |
| hygiene | **-3.5** | Always |
| energy (awake) | **-5.0** | `state != sleeping` |
| energy (sleeping) | **+5.0** | `state == sleeping` |

**Adult Health Decay (cumulative penalties):**

| Component | Rate/hr | Condition |
|-----------|---------|-----------|
| base | **-0.4** | Always |
| hungerBelow60 | **-0.5** | hunger **<** 60 |
| hungerBelow30 | **-1.0** | hunger **<** 30 |
| hygieneBelow60 | **-0.5** | hygiene **<** 60 |
| hygieneBelow30 | **-1.0** | hygiene **<** 30 |
| energyBelow40 | **-0.4** | energy **<** 40 |
| energyBelow20 | **-0.8** | energy **<** 20 |
| happinessBelow40 | **-0.4** | happiness **<** 40 |
| happinessBelow20 | **-0.8** | happiness **<** 20 |
| **regeneration** | **+1.0** | hunger **>=** 80 AND happiness **>=** 80 AND hygiene **>=** 80 AND energy **>=** 80 |

**Adult health worst case:** `-0.4 + (-0.5 + -1.0) + (-0.5 + -1.0) + (-0.4 + -0.8) + (-0.4 + -0.8) = -5.8/hr`

### 2.4 Decay Application Order

**Source:** `ditto/src/lib/blobbi-decay.ts` lines 271-325 (baby), 330-384 (adult)

```
1. Calculate elapsed hours = (currentTimestamp - lastDecayTimestamp) / 3600
2. Apply hunger, happiness, hygiene, energy deltas (independent, use NEW values after floor+clamp)
3. Calculate health delta using POST-DECAY stat values for threshold checks
4. Apply health delta
5. All deltas: floor(rate × elapsedHours), then clamp result to [1, 100]
```

**Critical for circuit:** Health penalties reference the **already-decayed** hunger/happiness/hygiene/energy values, not the pre-decay values. The circuit must apply non-health decay first, then compute health decay using the updated stats.

---

## 3. Action Effects

### 3.1 Base Actions (No Item)

**Source:** Extracted from nostr-pet cross-referenced with ditto

| Action | hunger | happiness | health | hygiene | energy | Egg? | Baby? | Adult? |
|--------|--------|-----------|--------|---------|--------|------|-------|--------|
| feed | +30 | +5 | — | — | — | No | Yes | Yes |
| play | — | +25 | — | -5 | -15 | No | Yes | Yes |
| clean | — | +10 | — | +40 | — | Yes | Yes | Yes |
| rest | — | +5 | — | — | +50 | No | Yes | Yes |
| warm | — | +2 | +5 | — | — | Yes | No | No |
| check | — | — | +2 | — | — | Yes | Yes | Yes |
| sing | — | +15 | — | — | -5 | Yes | No | No |
| talk | — | +10 | — | — | — | Yes | Yes | Yes |
| medicine | — | -5 | +30 | — | — | Yes | Yes | Yes |
| cruzar | — | +20 | — | — | -10 | No | No | Yes |
| play_music | — | +15 | — | — | — | Yes | Yes | Yes |

**Source for direct actions:** `ditto/src/blobbi/actions/hooks/useBlobbiDirectAction.ts` lines 35-38

### 3.2 Shop Items (Inventory Actions)

**Source:** `ditto/src/blobbi/shop/lib/blobbi-shop-items.ts`

#### Food Items (action: `feed`)

| Item ID | Price | hunger | happiness | health | hygiene | energy |
|---------|-------|--------|-----------|--------|---------|--------|
| food_apple | 10 | +15 | — | — | -2 | +5 |
| food_burger | 25 | +40 | +10 | — | -8 | +8 |
| food_cake | 50 | +20 | +30 | — | -10 | +10 |
| food_pizza | 35 | +35 | +15 | — | -9 | +10 |
| food_sushi | 45 | +30 | — | +10 | -6 | +7 |

#### Toy Items (action: `play`)

| Item ID | Price | happiness | energy | hygiene |
|---------|-------|-----------|--------|---------|
| toy_ball | 30 | +25 | -10 | -5 |
| toy_teddy | 60 | +40 | -15 | — |
| toy_blocks | 40 | +30 | -10 | — |

#### Medicine Items (action: `medicine`)

| Item ID | Price | health | happiness | energy |
|---------|-------|--------|-----------|--------|
| med_vitamins | 40 | +20 | — | — |
| med_super | 100 | +50 | -10 | +20 |
| med_bandage | 20 | +15 | — | — |
| med_elixir | 150 | +80 | +20 | +10 |
| med_shell_repair | 60 | +30 | — | — |
| med_calcium | 35 | +35 | — | — |

**Note:** `med_shell_repair` is egg-only. `med_elixir` is the most powerful healing item.

#### Hygiene Items (action: `clean`)

| Item ID | Price | hygiene | happiness |
|---------|-------|---------|-----------|
| hyg_soap | 15 | +30 | — |
| hyg_shampoo | 25 | +50 | +10 |
| hyg_bubble | 40 | +60 | +20 |
| hyg_towel | 20 | +25 | +5 |

### 3.3 Stage-Specific Action Restrictions

**Source:** `ditto/src/blobbi/actions/lib/blobbi-action-utils.ts` lines 386-409

| Stage | Allowed Inventory Actions | Allowed Direct Actions |
|-------|--------------------------|----------------------|
| egg | clean, medicine | play_music, sing |
| baby | feed, play, clean, medicine | play_music, sing |
| adult | feed, play, clean, medicine | play_music, sing, cruzar |

**Circuit enforcement:** Reject any action not in the allowed set for the current stage.

### 3.4 Egg-Specific Item Rules

**Source:** `ditto/src/blobbi/actions/lib/blobbi-action-utils.ts` lines 169-226

- `med_shell_repair`: **Only** usable by eggs (line 181)
- Food items: **Not** usable by eggs
- Toy items: **Not** usable by eggs
- Hygiene items: Usable by eggs only if they have hygiene effect
- When egg uses any action: hunger and energy forced to 100 (lines 142-143)

---

## 4. Cooldowns (Circuit-Enforced)

### 4.1 Simplified Circuit Model

**Design decision (D2):** The circuit enforces minimum elapsed time between consecutive uses of the same action type. This replaces the client-side session/global complexity with a single provable constraint:

```
ASSERT: currentTimestamp - lastTimestamp[actionType] >= cooldownSeconds
```

### 4.2 Cooldown Durations

**Source:** `nostr-pet/src/lib/cooldown-storage.ts`

Cooldown = **global cooldown** (the longer enforcement window). This is the circuit-enforced minimum gap.

#### Egg Stage Cooldowns

| Action | Cooldown (seconds) | Cooldown (human) | Max/day |
|--------|-------------------|------------------|---------|
| warm | 5,400 | 1.5 hours | ~16 |
| sing | 5,400 | 1.5 hours | ~16 |
| check | 3,600 | 1 hour | 24 |
| talk | 5,400 | 1.5 hours | ~16 |
| clean | 5,400 | 1.5 hours | ~16 |
| medicine | 7,200 | 2 hours | 12 |
| feed | ∞ | unavailable | 0 |
| play | ∞ | unavailable | 0 |
| rest | ∞ | unavailable | 0 |
| cruzar | ∞ | unavailable | 0 |

#### Baby Stage Cooldowns

| Action | Cooldown (seconds) | Cooldown (human) | Max/day |
|--------|-------------------|------------------|---------|
| feed | 5,400 | 1.5 hours | ~16 |
| play | 7,200 | 2 hours | 12 |
| clean | 5,400 | 1.5 hours | ~16 |
| rest | 14,400 | 4 hours | 6 |
| talk | 5,400 | 1.5 hours | ~16 |
| check | 3,600 | 1 hour | 24 |
| medicine | 7,200 | 2 hours | 12 |
| warm | ∞ | unavailable | 0 |
| sing | ∞ | unavailable | 0 |
| cruzar | ∞ | unavailable | 0 |

#### Adult Stage Cooldowns

| Action | Cooldown (seconds) | Cooldown (human) | Max/day |
|--------|-------------------|------------------|---------|
| feed | 5,400 | 1.5 hours | ~16 |
| play | 7,200 | 2 hours | 12 |
| clean | 5,400 | 1.5 hours | ~16 |
| rest | 14,400 | 4 hours | 6 |
| talk | 5,400 | 1.5 hours | ~16 |
| check | 3,600 | 1 hour | 24 |
| medicine | 10,800 | 3 hours | 8 |
| cruzar | 86,400 | 24 hours | 1 |
| warm | ∞ | unavailable | 0 |
| sing | ∞ | unavailable | 0 |

### 4.3 Cooldown Circuit Constraints

```
For each interaction proof:
  1. actionType must be in allowed set for current stage
  2. currentTimestamp > lastInteractionTimestamp (time advances)
  3. currentTimestamp - lastTimestamp[actionType] >= cooldownSeconds[stage][actionType]
  4. cooldownSeconds[stage][actionType] != ∞ (action available for stage)
```

**Implementation note:** The circuit stores `lastTimestamp` per action type. With 11 action types, this needs a compact representation — likely a Poseidon hash of the timestamp array, with the prior and new timestamps as private inputs.

---

## 5. Evolution Thresholds

### 5.1 Egg → Baby (Hatching)

**Source:** `ditto/src/blobbi/actions/hooks/useHatchTasks.ts` lines 33, 42

| Requirement | Value | Circuit-enforced? |
|-------------|-------|-------------------|
| Minimum interactions | **7** | **Yes** — `cycle >= 7` |
| health >= | **70** | **Yes** |
| hygiene >= | **70** | **Yes** |
| happiness >= | **70** | **Yes** |
| Publish kind:1 post | 1 post with "Hello Nostr!" prefix | **No** — DVM attests |
| Create kind:36767 theme | 1 event | **No** — DVM attests |
| Create kind:3367 color moment | 1 event | **No** — DVM attests |

**Circuit enforces:** `cycle >= 7 AND health >= 70 AND hygiene >= 70 AND happiness >= 70 AND stage == egg`

**DVM attests:** Social task completion (3 off-chain Nostr events). DVM includes attestation hash in proof private inputs.

### 5.2 Baby → Adult (Evolution)

**Source:** `ditto/src/blobbi/actions/hooks/useEvolveTasks.ts` lines 37-52

| Requirement | Value | Circuit-enforced? |
|-------------|-------|-------------------|
| Minimum interactions | **21** | **Yes** — `cycle >= 21` |
| hunger >= | **80** | **Yes** |
| happiness >= | **80** | **Yes** |
| health >= | **80** | **Yes** |
| hygiene >= | **80** | **Yes** |
| energy >= | **80** | **Yes** |
| Create kind:36767 themes | 3 events | **No** — DVM attests |
| Create kind:3367 color moments | 3 events | **No** — DVM attests |
| Publish kind:1 evolve post | 1 post with "Hello Nostr! Posting to evolve" prefix | **No** — DVM attests |
| Create kind:16769 wall edit | 1 event | **No** — DVM attests |

**Circuit enforces:** `cycle >= 21 AND hunger >= 80 AND happiness >= 80 AND health >= 80 AND hygiene >= 80 AND energy >= 80 AND stage == baby`

### 5.3 Stage Transition Effects

#### On Hatch (egg → baby):

| Stat | New Value |
|------|-----------|
| hunger | 100 (reset) |
| happiness | 100 (reset) |
| hygiene | 100 (reset) |
| energy | 100 (reset) |
| health | **inherited** from egg (after decay) |
| stage | `baby` (1) |
| state | `active` |

#### On Evolve (baby → adult):

| Stat | New Value |
|------|-----------|
| hunger | **inherited** from baby (after decay) |
| happiness | **inherited** from baby (after decay) |
| hygiene | **inherited** from baby (after decay) |
| energy | **inherited** from baby (after decay) |
| health | **inherited** from baby (after decay) |
| stage | `adult` (2) |
| state | `active` |

---

## 6. Warning & Critical Thresholds

These are **not circuit-enforced** — they drive UI indicators only. Documented for completeness.

**Source:** `ditto/src/lib/blobbi-decay.ts` lines 143-189

### Warning Thresholds (stat **<** threshold)

| Stat | Egg | Baby | Adult |
|------|-----|------|-------|
| hunger | — | 65 | 60 |
| happiness | 75 | 65 | 60 |
| health | 75 | 65 | 60 |
| hygiene | 75 | 65 | 60 |
| energy | — | 65 | 60 |

### Critical Thresholds (stat **<** threshold)

| Stat | Egg | Baby | Adult |
|------|-----|------|-------|
| hunger | — | 35 | 30 |
| happiness | 45 | 35 | 30 |
| health | 45 | 35 | 30 |
| hygiene | 45 | 35 | 30 |
| energy | — | 25 | 20 |

---

## 7. Operator Comparison (< vs <=)

**Critical for circuit implementation.** All threshold checks in ditto use strict operators:

| Check Type | Operator | Example |
|------------|----------|---------|
| Decay penalty trigger | `<` (strict less-than) | `hunger < 70` triggers penalty |
| Regen trigger | `>=` (greater-or-equal) | `hunger >= 80` enables regen |
| Evolution threshold | `>=` (greater-or-equal) | `health >= 70` required to hatch |
| Warning check | `<` (strict less-than) | `value < warningThreshold` |
| Critical check | `<` (strict less-than) | `value < criticalThreshold` |

**Source:** `ditto/src/lib/blobbi-decay.ts` lines 461, 475 (warning/critical), lines 240-255 (penalties), lines 317-319 (regen)

---

## 8. Divergences from nostr-pet

Where ditto differs from the original nostr-pet implementation, and why ditto is canonical:

| Aspect | nostr-pet | ditto (canonical) | Impact |
|--------|-----------|-------------------|--------|
| Baby hunger decay | -5.0/hr | **-7.0/hr** | 40% faster — pets need more attention |
| Baby energy decay | -6.0/hr | **-8.0/hr** | More frequent rest needed |
| Baby sleep recovery | +4.0/hr | **+6.0/hr** | Compensates faster energy drain |
| Adult sleep recovery | +4.0/hr | **+5.0/hr** | Slightly faster |
| Health penalty system | Simple (2 thresholds per stat) | **Complex (2 thresholds per stat, 4 stats)** | More nuanced health decline |
| Health penalty thresholds | <30, <20 | **Baby: <70/<40; Adult: <60/<30** | Penalties trigger earlier |
| Health regen rate (baby) | +2.0/hr | **+1.5/hr** | Slower recovery |
| Health regen rate (adult) | — | **+1.0/hr** | New mechanic |
| Stat floor | 0 | **1** | Pet can never reach absolute zero |
| Egg decay model | temperature + shell_integrity | **hygiene + health + happiness** | Simplified, no deprecated tags |
| Egg happiness | Fixed decay | **Conditional (+2 good, -2 moderate, -4 poor)** | Dynamic happiness response |
| Evolution requirements | 7 days + 40 care pts + stats | **7 interactions + stats + social tasks** | Interaction-based, not time-based |

---

## 9. PET Token Cost Table

**Per the architecture handoff, every interaction costs PET tokens burned on-chain.**

Token costs are NOT yet defined in either codebase. This table will be populated when Open Question #1 from the handoff is resolved (fixed vs market-determined pricing).

**Placeholder structure for circuit:**

```typescript
class PetAction extends Struct({
  actionType: UInt32,   // 0-10 (see action enum below)
  itemId: UInt32,       // 0 = no item, or shop item index
  timestamp: UInt64,    // unix seconds
  tokenCost: UInt64,    // PET tokens required — circuit verifies against lookup
})
```

**Action Type Enum (for circuit):**

| Value | Action |
|-------|--------|
| 0 | feed |
| 1 | play |
| 2 | clean |
| 3 | rest |
| 4 | warm |
| 5 | check |
| 6 | sing |
| 7 | talk |
| 8 | medicine |
| 9 | cruzar |
| 10 | play_music |

**Item ID mapping** will be a sequential index into the shop items table (Section 3.2). Circuit verifies `tokenCost >= lookupCost[actionType][itemId]`.

---

## 10. Circuit Constraint Summary

Everything the PetLifecycle ZkProgram must enforce:

### Per Interaction:
1. `cycle` increments by exactly 1
2. `timestamp > previousTimestamp` (time advances)
3. `timestamp - lastActionTimestamp[actionType] >= cooldown[stage][actionType]` (cooldown)
4. `actionType` is in allowed set for current `stage`
5. Decay correctly computed from `previousTimestamp` to `timestamp` using stage-specific rates
6. Action effects correctly applied to post-decay stats
7. All stats clamped to [1, 100] after decay + action
8. `brainHash` changed (proves .mv2 was updated)
9. `tokenCost >= requiredCost[actionType][itemId]`
10. `totalSpent += tokenCost`

### Owner Signature Verification (D8 — Trustless Timestamps):
11. `interactionCommitment = Poseidon.hash([actionType, itemId, timestamp, tokenCost])` (~50 rows)
12. `ownerSignature.verify(ownerPublicKey, [interactionCommitment])` — Mina-native Signature (~400 rows)
13. Owner's Mina pubkey matches on-chain `ownerX` field

### Interaction Content Binding (D9):
14. `interactionHash = Poseidon.hash([actionType, itemId, timestamp, tokenCost])` committed into lifecycleHash chain (~50 rows)
15. `lifecycleHash = Poseidon.hash([prevLifecycleHash, cycle, brainHash, interactionHash, stage, totalSpent])`

### Batch Timestamp Bounds (D10):
16. `batchLastTimestamp <= currentSlotTime + MAX_CLOCK_SKEW` (300 seconds)
17. `batchLastTimestamp >= currentSlotTime - MAX_BATCH_WINDOW` (3600 seconds)

### Per Evolution:
18. Hatching: `cycle >= 7 AND health >= 70 AND hygiene >= 70 AND happiness >= 70 AND stage == 0`
19. Evolution: `cycle >= 21 AND all stats >= 80 AND stage == 1`
20. Stage transitions reset stats per Section 5.3 rules
21. `stage` only advances (0→1→2), never regresses

### Structural:
22. Recursive proof chain — each proof references the prior proof's output
23. Genesis proof establishes initial state (all stats = 100, cycle = 1, stage = 0)

### Constraint Budget Estimate:

| Component | Rows | Notes |
|-----------|------|-------|
| Poseidon(interactionCommitment) | ~50 | Native hash |
| Signature.verify(owner, commitment) | ~400 | Pallas curve, native |
| Stat decay arithmetic | ~2,000 | Fixed-point math |
| Action effects + clamping | ~500 | Lookup + bounds |
| Cooldown check | ~200 | Timestamp comparison |
| brainHash commitment | ~50 | Poseidon |
| lifecycleHash chain | ~50 | Poseidon |
| interactionHash chain | ~50 | Poseidon |
| Slot-time bound check | ~200 | Network precondition |
| **Total per interaction** | **~3,500** | Well under 40K limit |
| **Batch of 10 (recursive)** | **~35,000** | ~30-50 seconds proof time |

---

## Appendix A: Fixed-Point Arithmetic for Circuit

Mina o1js operates on Field elements (integers). Decay rates like `-0.75/hr` need fixed-point representation.

**Recommended approach:** Scale all rates by 100 (two decimal places of precision).

| Original Rate | Scaled (×100) | Type |
|---------------|---------------|------|
| -7.0 | -700 | Int |
| -0.75 | -75 | Int |
| -1.25 | -125 | Int |
| +1.5 | +150 | Int |
| +6.0 | +600 | Int |

**Decay formula in circuit:**
```
scaledDelta = scaledRate × elapsedSeconds
actualDelta = floor(scaledDelta / 360000)  // divide by 3600×100
newStat = clamp(oldStat + actualDelta, 1, 100)
```

This preserves the precision of rates like -0.75 and -0.4 without floating-point arithmetic.

---

## Appendix B: Compact Cooldown State

With 11 action types, storing individual `lastTimestamp` per action in on-chain state is infeasible (8-field limit). Options:

**Option A: Poseidon Hash of Timestamp Array**
- Store `cooldownHash = Poseidon([lastTs_feed, lastTs_play, ..., lastTs_playMusic])` on-chain
- Private inputs: full timestamp array + prior proof
- Circuit verifies hash matches, checks cooldown, updates array, recomputes hash

**Option B: Merkle Tree of Timestamps**
- 11 leaves (one per action type), depth 4
- Store Merkle root on-chain
- Private input: Merkle witness for the specific action being performed
- More efficient per-interaction (only one witness needed), but more complex setup

**Recommendation:** Option A for simplicity. 11 Poseidon inputs is well within constraint budget.
