/**
 * PetBreeding ZkProgram -- ZK-Proven Offspring Derivation
 *
 * Proves correct cross-breeding of two adult pets. Both parents must be at
 * adult stage (2) with all stats >= 60. The offspring starts as an egg with
 * a deterministically-derived brainHash and lifecycle chain rooted in both
 * parent histories.
 *
 * Trust model: Tier 1 (Full ZK -- Zero Trust -- Math)
 *
 * @module PetBreeding
 */

import { ZkProgram, Field, UInt32, Poseidon } from 'o1js';

import { PetStats, BreedingState } from './structs';
import { PetLifecycleProof } from './PetLifecycle';
import { ACTION_COUNT } from './constants';
import { assertAllStatsInRange } from './utils';

// ============================================================
// Breeding thresholds
// ============================================================

/** Minimum stat value required in each stat for a parent to breed. */
export const BREEDING_STAT_MIN = 60;

/** Adult stage index (the only stage that can breed). */
const ADULT_STAGE = 2;

// ============================================================
// ZkProgram Definition
// ============================================================

export const PetBreeding = ZkProgram({
  name: 'PetBreeding',
  publicOutput: BreedingState,

  methods: {
    /**
     * breed: Prove correct offspring derivation from two adult parent pets.
     *
     * Private inputs:
     * - parentAProof: Final PetLifecycle proof for parent A (must be adult, all stats >= 60)
     * - parentBProof: Final PetLifecycle proof for parent B (must be adult, all stats >= 60)
     * - offspringStats: Initial offspring stats (computed off-chain; circuit verifies range [1,100])
     */
    breed: {
      privateInputs: [
        PetLifecycleProof, // parentAProof
        PetLifecycleProof, // parentBProof
        PetStats, // offspringStats
      ],
      async method(
        parentAProof: InstanceType<typeof PetLifecycleProof>,
        parentBProof: InstanceType<typeof PetLifecycleProof>,
        offspringStats: PetStats
      ) {
        // Verify both parent proofs
        parentAProof.verify();
        parentBProof.verify();

        const parentA = parentAProof.publicOutput;
        const parentB = parentBProof.publicOutput;

        // === Constraint 1: Parent A must be adult (stage == 2) ===
        parentA.stage.assertEquals(UInt32.from(ADULT_STAGE));

        // === Constraint 2: Parent B must be adult (stage == 2) ===
        parentB.stage.assertEquals(UInt32.from(ADULT_STAGE));

        // === Constraints 3-7: Parent A stat thresholds (each >= 60) ===
        parentA.stats.hunger.assertGreaterThanOrEqual(
          UInt32.from(BREEDING_STAT_MIN)
        );
        parentA.stats.happiness.assertGreaterThanOrEqual(
          UInt32.from(BREEDING_STAT_MIN)
        );
        parentA.stats.health.assertGreaterThanOrEqual(
          UInt32.from(BREEDING_STAT_MIN)
        );
        parentA.stats.hygiene.assertGreaterThanOrEqual(
          UInt32.from(BREEDING_STAT_MIN)
        );
        parentA.stats.energy.assertGreaterThanOrEqual(
          UInt32.from(BREEDING_STAT_MIN)
        );

        // === Constraints 8-12: Parent B stat thresholds (each >= 60) ===
        parentB.stats.hunger.assertGreaterThanOrEqual(
          UInt32.from(BREEDING_STAT_MIN)
        );
        parentB.stats.happiness.assertGreaterThanOrEqual(
          UInt32.from(BREEDING_STAT_MIN)
        );
        parentB.stats.health.assertGreaterThanOrEqual(
          UInt32.from(BREEDING_STAT_MIN)
        );
        parentB.stats.hygiene.assertGreaterThanOrEqual(
          UInt32.from(BREEDING_STAT_MIN)
        );
        parentB.stats.energy.assertGreaterThanOrEqual(
          UInt32.from(BREEDING_STAT_MIN)
        );

        // === Constraint 13: Parents must be distinct (no self-breeding) ===
        parentA.lifecycleHash.assertNotEquals(parentB.lifecycleHash);

        // === Constraint 14: Offspring stats in valid range [1, 100] ===
        assertAllStatsInRange(offspringStats);

        // === Offspring brainHash: deterministic from both parent brainHashes ===
        const offspringBrainHash = Poseidon.hash([
          parentA.brainHash,
          parentB.brainHash,
        ]);

        // === Offspring lifecycleHash: chain rooted in both parents ===
        // Domain separator Field(0) distinguishes breeding from interact/evolve events
        const lifecycleHash = Poseidon.hash([
          parentA.lifecycleHash,
          parentB.lifecycleHash,
          offspringBrainHash,
          Field(0),
        ]);

        // === Offspring cooldownHash: all zeros (same as genesis) ===
        const cooldownHash = Poseidon.hash(Array(ACTION_COUNT).fill(Field(0)));

        return {
          publicOutput: new BreedingState({
            stats: offspringStats,
            stage: UInt32.from(0), // always egg
            parentAHash: parentA.lifecycleHash,
            parentBHash: parentB.lifecycleHash,
            offspringBrainHash,
            lifecycleHash,
            cooldownHash,
          }),
        };
      },
    },
  },
});

// Export proof class
export const PetBreedingProof = ZkProgram.Proof(PetBreeding);
