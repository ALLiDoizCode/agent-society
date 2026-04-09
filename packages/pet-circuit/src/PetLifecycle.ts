/* eslint-disable @typescript-eslint/no-non-null-assertion -- bounds-checked constant table lookups in circuit constraints */
/**
 * PetLifecycle ZkProgram -- ZK-Proven Pet Game Rules
 *
 * Encodes all pet interaction rules as o1js circuit constraints with recursive
 * proof chaining. Every pet interaction is cryptographically proven correct and
 * the proof chain forms a verifiable pet biography.
 *
 * Methods:
 * - genesis(): Create initial proof for a new pet (egg stage)
 * - interact(): Process a pet interaction with full constraint enforcement
 * - evolve(): Process a stage transition (egg->baby or baby->adult)
 *
 * Trust model: Tier 1 (Full ZK -- Zero Trust -- Math)
 *
 * @module PetLifecycle
 */

import {
  ZkProgram,
  Field,
  SelfProof,
  Poseidon,
  Signature,
  PublicKey,
  UInt32,
  UInt64,
  Struct,
  Provable,
  Bool,
} from 'o1js';

import { PetStats, PetAction, PetState } from './structs';
import {
  ACTION_COUNT,
  COOLDOWN_DURATIONS,
  STAGE_ALLOWED_ACTIONS,
  SHOP_ITEMS,
  MAX_ITEM_ID,
  Stage,
  MAX_CLOCK_SKEW,
  MAX_BATCH_WINDOW,
} from './constants';
import { assertAllStatsInRange } from './utils';

// ============================================================
// Private Input Structs (not part of public state)
// ============================================================

/**
 * Cooldown timestamp array: 11 UInt64 values, one per action type.
 * Passed as private input; circuit verifies Poseidon hash matches cooldownHash.
 */
export class CooldownTimestamps extends Struct({
  ts0: UInt64,
  ts1: UInt64,
  ts2: UInt64,
  ts3: UInt64,
  ts4: UInt64,
  ts5: UInt64,
  ts6: UInt64,
  ts7: UInt64,
  ts8: UInt64,
  ts9: UInt64,
  ts10: UInt64,
}) {
  /** Get timestamp for a specific action type index */
  getByIndex(index: UInt32): UInt64 {
    // Use Provable.switch to select the correct timestamp by index
    const bools = Array.from({ length: ACTION_COUNT }, (_, i) =>
      index.equals(UInt32.from(i))
    );
    return Provable.switch(bools, UInt64, [
      this.ts0,
      this.ts1,
      this.ts2,
      this.ts3,
      this.ts4,
      this.ts5,
      this.ts6,
      this.ts7,
      this.ts8,
      this.ts9,
      this.ts10,
    ]);
  }

  /** Return a new CooldownTimestamps with one index updated */
  setByIndex(index: UInt32, value: UInt64): CooldownTimestamps {
    const select = (i: number, current: UInt64) =>
      Provable.if(index.equals(UInt32.from(i)), UInt64, value, current);
    return new CooldownTimestamps({
      ts0: select(0, this.ts0),
      ts1: select(1, this.ts1),
      ts2: select(2, this.ts2),
      ts3: select(3, this.ts3),
      ts4: select(4, this.ts4),
      ts5: select(5, this.ts5),
      ts6: select(6, this.ts6),
      ts7: select(7, this.ts7),
      ts8: select(8, this.ts8),
      ts9: select(9, this.ts9),
      ts10: select(10, this.ts10),
    });
  }

  /** Compute Poseidon hash of all 11 timestamps (as Fields) */
  hash(): Field {
    return Poseidon.hash([
      this.ts0.value,
      this.ts1.value,
      this.ts2.value,
      this.ts3.value,
      this.ts4.value,
      this.ts5.value,
      this.ts6.value,
      this.ts7.value,
      this.ts8.value,
      this.ts9.value,
      this.ts10.value,
    ]);
  }
}

// ============================================================
// ZkProgram Definition
// ============================================================

export const PetLifecycle = ZkProgram({
  name: 'PetLifecycle',
  publicOutput: PetState,

  methods: {
    /**
     * Genesis: create the initial proof for a new pet (egg stage).
     * Sets all stats to 100, cycle to 1, stage to 0 (egg).
     */
    genesis: {
      privateInputs: [Field], // brainHash
      async method(brainHash: Field) {
        const stats = new PetStats({
          hunger: UInt32.from(100),
          happiness: UInt32.from(100),
          health: UInt32.from(100),
          hygiene: UInt32.from(100),
          energy: UInt32.from(100),
        });

        // Initial lifecycleHash = Poseidon([0, 1, brainHash, 0, 0, 0])
        // Represents: [prevHash=0, cycle=1, brainHash, interactionHash=0, stage=0, totalSpent=0]
        const lifecycleHash = Poseidon.hash([
          Field(0),
          Field(1),
          brainHash,
          Field(0),
          Field(0),
          Field(0),
        ]);

        // Initial cooldownHash = Poseidon([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
        const cooldownHash = Poseidon.hash(Array(ACTION_COUNT).fill(Field(0)));

        return {
          publicOutput: new PetState({
            stats,
            stage: UInt32.from(0),
            cycle: UInt64.from(1),
            lastInteraction: UInt64.from(0),
            brainHash,
            totalSpent: UInt64.from(0),
            lifecycleHash,
            cooldownHash,
          }),
        };
      },
    },

    /**
     * Interact: process a single pet interaction.
     * Verifies prior proof and enforces all game rule constraints.
     *
     * Private inputs:
     * - earlierProof: SelfProof from previous step
     * - action: PetAction describing the interaction
     * - newStats: PetStats after decay + action application (computed off-chain by DVM/game engine;
     *     circuit verifies stats are in valid range [1,100] but does NOT re-derive the decay formula.
     *     Decay correctness is a Tier 2 DVM attestation responsibility -- see Story 11-5.)
     * - newBrainHash: Updated brain hash (must differ from previous)
     * - prevCooldowns: CooldownTimestamps from previous state
     * - newCooldowns: CooldownTimestamps with updated entry for current action
     * - ownerPublicKey: Mina public key of pet owner
     * - ownerSignature: Signature over interactionCommitment
     * - currentSlotTime: Network slot time for batch timestamp bounds
     */
    interact: {
      privateInputs: [
        SelfProof, // earlierProof
        PetAction, // action
        PetStats, // newStats (post-decay, post-action)
        Field, // newBrainHash
        CooldownTimestamps, // prevCooldowns
        CooldownTimestamps, // newCooldowns
        PublicKey, // ownerPublicKey
        Signature, // ownerSignature
        UInt64, // currentSlotTime
      ],
      async method(
        earlierProof: SelfProof<void, PetState>,
        action: PetAction,
        newStats: PetStats,
        newBrainHash: Field,
        prevCooldowns: CooldownTimestamps,
        newCooldowns: CooldownTimestamps,
        ownerPublicKey: PublicKey,
        ownerSignature: Signature,
        currentSlotTime: UInt64
      ) {
        // Verify the earlier proof
        earlierProof.verify();
        const prevState = earlierProof.publicOutput;

        // === Constraint 1: cycle increments by exactly 1 ===
        const newCycle = prevState.cycle.add(UInt64.from(1));

        // === Constraint 2: timestamp > previousTimestamp (time advances) ===
        action.timestamp.assertGreaterThan(prevState.lastInteraction);

        // === Constraint 8: brainHash changed from previous ===
        newBrainHash.assertNotEquals(prevState.brainHash);

        // === Constraint 4: actionType is in allowed set for current stage ===
        // We check by verifying the cooldown is non-zero (0 = unavailable)
        // Build the allowed check using Provable.switch over stages and actions
        {
          const stageChecks = [0, 1, 2].map((s) => {
            const actionChecks = Array.from(
              { length: ACTION_COUNT },
              (_, a) => {
                return STAGE_ALLOWED_ACTIONS[s]![a]! ? Bool(true) : Bool(false);
              }
            );
            // Select the boolean for the current actionType within this stage
            const actionBools = Array.from({ length: ACTION_COUNT }, (_, a) =>
              action.actionType.equals(UInt32.from(a))
            );
            return Provable.switch(actionBools, Bool, actionChecks);
          });
          const stageBools = [0, 1, 2].map((s) =>
            prevState.stage.equals(UInt32.from(s))
          );
          const isAllowed = Provable.switch(stageBools, Bool, stageChecks);
          isAllowed.assertTrue();
        }

        // === Constraint 3: cooldown check ===
        // Verify prevCooldowns hash matches previous cooldownHash
        prevCooldowns.hash().assertEquals(prevState.cooldownHash);

        // Get the last timestamp for this action type
        const lastActionTs = prevCooldowns.getByIndex(action.actionType);

        // Get the required cooldown duration for this action+stage
        {
          const cooldownLookup = [0, 1, 2].map((s) => {
            const durations = Array.from({ length: ACTION_COUNT }, (_, a) =>
              UInt64.from(COOLDOWN_DURATIONS[s]![a]!)
            );
            const actionBools = Array.from({ length: ACTION_COUNT }, (_, a) =>
              action.actionType.equals(UInt32.from(a))
            );
            return Provable.switch(actionBools, UInt64, durations);
          });
          const stageBools = [0, 1, 2].map((s) =>
            prevState.stage.equals(UInt32.from(s))
          );
          const requiredCooldown = Provable.switch(
            stageBools,
            UInt64,
            cooldownLookup
          );

          // Assert: timestamp - lastActionTs >= requiredCooldown
          // (if lastActionTs is 0, this is the first use and always passes since timestamp > 0 >= 0)
          const elapsed = action.timestamp.sub(lastActionTs);
          elapsed.assertGreaterThanOrEqual(requiredCooldown);
        }

        // Verify newCooldowns is prevCooldowns with only the current action's timestamp updated
        {
          const expectedNew = prevCooldowns.setByIndex(
            action.actionType,
            action.timestamp
          );
          newCooldowns.hash().assertEquals(expectedNew.hash());
        }

        // === Constraint 9: tokenCost >= requiredCost[actionType][itemId] ===
        // Build lookup table for required costs
        {
          // For base actions (itemId=0), cost is 0
          // For shop items, cost comes from the SHOP_ITEMS table
          // We build a flat lookup: for each (actionType, itemId) pair
          // Build shop item cost lookup
          const maxItems = MAX_ITEM_ID + 1; // 0 through MAX_ITEM_ID
          const itemCosts = Array.from({ length: maxItems }, (_, id) => {
            if (id === 0) return UInt64.from(0);
            const item = SHOP_ITEMS.find((si) => si.itemId === id);
            return UInt64.from(item ? item.tokenCost : 0);
          });
          const itemBools = Array.from({ length: maxItems }, (_, id) =>
            action.itemId.equals(UInt32.from(id))
          );
          const requiredCost = Provable.switch(itemBools, UInt64, itemCosts);
          action.tokenCost.assertGreaterThanOrEqual(requiredCost);
        }

        // === Constraint 10: totalSpent += tokenCost ===
        const newTotalSpent = prevState.totalSpent.add(action.tokenCost);

        // === Constraint 7: All stats within valid range [1, 100] ===
        // Note: the circuit verifies range bounds only. The actual decay+action arithmetic
        // is computed off-chain by the DVM/game engine and provided as a private input.
        // Decay correctness is enforced at Tier 2 (DVM attestation), not Tier 1 (ZK math).
        assertAllStatsInRange(newStats);

        // === Constraints 11-12: Owner signature verification (D8) ===
        // interactionCommitment = Poseidon.hash([actionType, itemId, timestamp, tokenCost])
        const interactionHash = Poseidon.hash([
          action.actionType.value,
          action.itemId.value,
          action.timestamp.value,
          action.tokenCost.value,
        ]);

        // Verify owner signed the interaction commitment
        const sigValid = ownerSignature.verify(ownerPublicKey, [
          interactionHash,
        ]);
        sigValid.assertTrue();

        // === Constraints 16-17: Slot-bounded batch timestamps (D10) ===
        // batchLastTimestamp <= currentSlotTime + MAX_CLOCK_SKEW (300s)
        action.timestamp.assertLessThanOrEqual(
          currentSlotTime.add(UInt64.from(MAX_CLOCK_SKEW))
        );
        // batchLastTimestamp >= currentSlotTime - MAX_BATCH_WINDOW (3600s)
        action.timestamp.assertGreaterThanOrEqual(
          currentSlotTime.sub(UInt64.from(MAX_BATCH_WINDOW))
        );

        // === Constraint 15: lifecycleHash chain (D9) ===
        const newLifecycleHash = Poseidon.hash([
          prevState.lifecycleHash,
          newCycle.value,
          newBrainHash,
          interactionHash,
          prevState.stage.value,
          newTotalSpent.value,
        ]);

        // === Constraint: cooldownHash updated ===
        const newCooldownHash = newCooldowns.hash();

        return {
          publicOutput: new PetState({
            stats: newStats,
            stage: prevState.stage,
            cycle: newCycle,
            lastInteraction: action.timestamp,
            brainHash: newBrainHash,
            totalSpent: newTotalSpent,
            lifecycleHash: newLifecycleHash,
            cooldownHash: newCooldownHash,
          }),
        };
      },
    },

    /**
     * Evolve: process a stage transition (egg->baby or baby->adult).
     * Enforces threshold requirements and stat reset rules.
     *
     * Private inputs:
     * - earlierProof: SelfProof from previous step
     * - newStage: UInt32 target stage
     * - newStats: PetStats after evolution reset rules applied
     */
    evolve: {
      privateInputs: [
        SelfProof, // earlierProof
        UInt32, // newStage
        PetStats, // newStats (post-reset)
      ],
      async method(
        earlierProof: SelfProof<void, PetState>,
        newStage: UInt32,
        newStats: PetStats
      ) {
        // Verify the earlier proof
        earlierProof.verify();
        const prevState = earlierProof.publicOutput;
        const prevStats = prevState.stats;

        // === Constraint 21: Stage only advances, never regresses ===
        newStage.assertGreaterThan(prevState.stage);

        // === Constraint: newStage <= 2 (max stage) ===
        newStage.assertLessThanOrEqual(UInt32.from(2));

        // Determine if this is a hatch (egg->baby) or evolution (baby->adult)
        const isHatch = prevState.stage.equals(UInt32.from(Stage.EGG));
        const isEvolve = prevState.stage.equals(UInt32.from(Stage.BABY));

        // At least one must be true (can't evolve from adult)
        isHatch.or(isEvolve).assertTrue();

        // === Constraint 18: Hatch requirements ===
        // cycle >= 7 AND health >= 70 AND hygiene >= 70 AND happiness >= 70 AND stage == 0
        {
          const hatchCycleOk = prevState.cycle.greaterThanOrEqual(
            UInt64.from(7)
          );
          const hatchHealthOk = prevStats.health.greaterThanOrEqual(
            UInt32.from(70)
          );
          const hatchHygieneOk = prevStats.hygiene.greaterThanOrEqual(
            UInt32.from(70)
          );
          const hatchHappinessOk = prevStats.happiness.greaterThanOrEqual(
            UInt32.from(70)
          );
          // If hatching, all conditions must hold
          const hatchValid = hatchCycleOk
            .and(hatchHealthOk)
            .and(hatchHygieneOk)
            .and(hatchHappinessOk);
          // Either this is not a hatch, or all conditions are met
          Provable.if(isHatch, Bool, hatchValid, Bool(true)).assertTrue();
        }

        // === Constraint 19: Evolution requirements ===
        // cycle >= 21 AND all stats >= 80 AND stage == 1
        {
          const evoCycleOk = prevState.cycle.greaterThanOrEqual(
            UInt64.from(21)
          );
          const evoHungerOk = prevStats.hunger.greaterThanOrEqual(
            UInt32.from(80)
          );
          const evoHappinessOk = prevStats.happiness.greaterThanOrEqual(
            UInt32.from(80)
          );
          const evoHealthOk = prevStats.health.greaterThanOrEqual(
            UInt32.from(80)
          );
          const evoHygieneOk = prevStats.hygiene.greaterThanOrEqual(
            UInt32.from(80)
          );
          const evoEnergyOk = prevStats.energy.greaterThanOrEqual(
            UInt32.from(80)
          );
          const evoValid = evoCycleOk
            .and(evoHungerOk)
            .and(evoHappinessOk)
            .and(evoHealthOk)
            .and(evoHygieneOk)
            .and(evoEnergyOk);
          Provable.if(isEvolve, Bool, evoValid, Bool(true)).assertTrue();
        }

        // === Constraint 20: Stats reset per Section 5.3 ===
        // Hatch: hunger/happiness/hygiene/energy reset to 100, health inherited
        // Evolve: all stats inherited
        {
          // On hatch: verify resets
          const hatchHunger = UInt32.from(100);
          const hatchHappiness = UInt32.from(100);
          const hatchHygiene = UInt32.from(100);
          const hatchEnergy = UInt32.from(100);
          const hatchHealth = prevStats.health; // inherited

          // Expected stats depend on isHatch vs isEvolve
          const expectedHunger = Provable.if(
            isHatch,
            UInt32,
            hatchHunger,
            prevStats.hunger
          );
          const expectedHappiness = Provable.if(
            isHatch,
            UInt32,
            hatchHappiness,
            prevStats.happiness
          );
          const expectedHealth = Provable.if(
            isHatch,
            UInt32,
            hatchHealth,
            prevStats.health
          );
          const expectedHygiene = Provable.if(
            isHatch,
            UInt32,
            hatchHygiene,
            prevStats.hygiene
          );
          const expectedEnergy = Provable.if(
            isHatch,
            UInt32,
            hatchEnergy,
            prevStats.energy
          );

          newStats.hunger.assertEquals(expectedHunger);
          newStats.happiness.assertEquals(expectedHappiness);
          newStats.health.assertEquals(expectedHealth);
          newStats.hygiene.assertEquals(expectedHygiene);
          newStats.energy.assertEquals(expectedEnergy);
        }

        // Ensure new stats are in range
        assertAllStatsInRange(newStats);

        // === Update lifecycleHash with evolution event ===
        // Use a special interactionHash = Poseidon([stage, newStage, 0, 0]) for evolution
        const evolutionHash = Poseidon.hash([
          prevState.stage.value,
          newStage.value,
          Field(0),
          Field(0),
        ]);
        const newLifecycleHash = Poseidon.hash([
          prevState.lifecycleHash,
          prevState.cycle.value,
          prevState.brainHash,
          evolutionHash,
          newStage.value,
          prevState.totalSpent.value,
        ]);

        return {
          publicOutput: new PetState({
            stats: newStats,
            stage: newStage,
            cycle: prevState.cycle, // cycle doesn't increment on evolve
            lastInteraction: prevState.lastInteraction,
            brainHash: prevState.brainHash,
            totalSpent: prevState.totalSpent,
            lifecycleHash: newLifecycleHash,
            cooldownHash: prevState.cooldownHash, // cooldowns preserved
          }),
        };
      },
    },
  },
});

// Export proof class
export const PetLifecycleProof = ZkProgram.Proof(PetLifecycle);

// CooldownTimestamps is already exported via class declaration above
