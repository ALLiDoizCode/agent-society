/**
 * PetZkApp SmartContract -- On-Chain Settlement for Pet Lifecycle Proofs
 *
 * Accepts PetLifecycle recursive proofs and maintains 8 on-chain Fields:
 * petId, brainHash, lifecycleHash, cycle, stage, ownerX, operatorX, totalSpent.
 *
 * The SmartContract is the settlement layer -- it does NOT compute game rules.
 * It verifies recursive proofs are valid, checks operator authorization, and
 * updates on-chain state to reflect the proof output.
 *
 * Trust model: Tier 1 (Full ZK -- Zero Trust -- Math)
 *
 * Story 11.3 -- Epic 11: TOON Pets
 *
 * @module PetZkApp
 */

import {
  SmartContract,
  State,
  state,
  method,
  Field,
  PublicKey,
  Poseidon,
  Signature,
  Provable,
} from 'o1js';

import { PetLifecycleProof } from './PetLifecycle';

/**
 * Concrete proof class for use in @method signatures.
 *
 * o1js requires the decorator metadata to reflect the actual proof class,
 * not a type alias. `ZkProgram.Proof()` returns a class value; extending it
 * creates a named class that TypeScript's emitDecoratorMetadata can capture.
 */
export class PetProof extends PetLifecycleProof {}

/**
 * PetZkApp SmartContract -- on-chain anchor for pet state.
 *
 * State fields (exactly 8):
 * 1. petId         -- Poseidon(ownerX, seed, blobbiId) -- unique pet identity
 * 2. brainHash     -- BLAKE3 of current .mv2 truncated to 253-bit Field
 * 3. lifecycleHash -- accumulated recursive proof output (Poseidon chain)
 * 4. cycle         -- total interaction count
 * 5. stage         -- 0=egg, 1=baby, 2=adult
 * 6. ownerX        -- owner public key x-coordinate (immutable after init)
 * 7. operatorX     -- current operator public key x-coordinate (DVM or owner)
 * 8. totalSpent    -- cumulative PET tokens spent
 */
export class PetZkApp extends SmartContract {
  @state(Field) petId = State<Field>();
  @state(Field) brainHash = State<Field>();
  @state(Field) lifecycleHash = State<Field>();
  @state(Field) cycle = State<Field>();
  @state(Field) stage = State<Field>();
  @state(Field) ownerX = State<Field>();
  @state(Field) operatorX = State<Field>();
  @state(Field) totalSpent = State<Field>();

  override events = {
    interaction: Field,
    evolution: Field,
    'operator-transfer': Field,
  };

  /**
   * Initialize a new pet on-chain from a genesis proof.
   *
   * @param ownerPubkey - Owner's full public key
   * @param operatorPubkey - Initial operator's full public key
   * @param seed - Random seed for petId derivation
   * @param blobbiId - Blobbi template ID
   * @param genesisProof - Genesis proof from PetLifecycle.genesis()
   */
  @method async initializePet(
    ownerPubkey: PublicKey,
    operatorPubkey: PublicKey,
    seed: Field,
    blobbiId: Field,
    genesisProof: PetProof
  ): Promise<void> {
    // Verify the genesis proof
    genesisProof.verify();

    // Assert all state fields are Field(0) (prevent double-init)
    const currentPetId = this.petId.getAndRequireEquals();
    const currentBrainHash = this.brainHash.getAndRequireEquals();
    const currentLifecycleHash = this.lifecycleHash.getAndRequireEquals();
    const currentCycle = this.cycle.getAndRequireEquals();
    const currentStage = this.stage.getAndRequireEquals();
    const currentOwnerX = this.ownerX.getAndRequireEquals();
    const currentOperatorX = this.operatorX.getAndRequireEquals();
    const currentTotalSpent = this.totalSpent.getAndRequireEquals();

    currentPetId.assertEquals(Field(0), 'pet already initialized');
    currentBrainHash.assertEquals(Field(0), 'pet already initialized');
    currentLifecycleHash.assertEquals(Field(0), 'pet already initialized');
    currentCycle.assertEquals(Field(0), 'pet already initialized');
    currentStage.assertEquals(Field(0), 'pet already initialized');
    currentOwnerX.assertEquals(Field(0), 'pet already initialized');
    currentOperatorX.assertEquals(Field(0), 'pet already initialized');
    currentTotalSpent.assertEquals(Field(0), 'pet already initialized');

    // Extract PetState from proof output
    const output = genesisProof.publicOutput;

    // Defense-in-depth: genesis proof must produce stage=0 (egg)
    output.stage.value.assertEquals(
      Field(0),
      'genesis proof must produce egg stage'
    );

    // Compute petId = Poseidon.hash([ownerPubkey.x, seed, blobbiId])
    const computedPetId = Poseidon.hash([ownerPubkey.x, seed, blobbiId]);

    // Set all 8 state fields
    this.petId.set(computedPetId);
    this.brainHash.set(output.brainHash);
    this.lifecycleHash.set(output.lifecycleHash);
    this.cycle.set(output.cycle.value);
    this.stage.set(output.stage.value);
    this.ownerX.set(ownerPubkey.x);
    this.operatorX.set(operatorPubkey.x);
    this.totalSpent.set(output.totalSpent.value);

    // Emit interaction event with the initial lifecycleHash
    this.emitEvent('interaction', output.lifecycleHash);
  }

  /**
   * Apply a recursive batch proof to update on-chain state.
   *
   * @param proof - Recursive batch proof from PetLifecycle
   * @param operatorPubkey - Operator's full public key (x must match stored operatorX)
   * @param operatorSig - Operator signature over [lifecycleHash]
   */
  @method async applyProof(
    proof: PetProof,
    operatorPubkey: PublicKey,
    operatorSig: Signature
  ): Promise<void> {
    // Verify the recursive proof
    proof.verify();

    // Read all 8 fields via getAndRequireEquals() to bind preconditions.
    // Fields not used for assertions are still read to prevent TOCTOU races
    // (ensures on-chain values haven't changed between proof generation and
    // transaction inclusion).
    const onChainPetId = this.petId.getAndRequireEquals();
    this.brainHash.getAndRequireEquals();
    this.lifecycleHash.getAndRequireEquals();

    // Defense-in-depth: pet must be initialized before accepting proofs
    onChainPetId.assertNotEquals(Field(0), 'pet not initialized');
    const onChainCycle = this.cycle.getAndRequireEquals();
    const onChainStage = this.stage.getAndRequireEquals();
    this.ownerX.getAndRequireEquals();
    const onChainOperatorX = this.operatorX.getAndRequireEquals();
    this.totalSpent.getAndRequireEquals();

    // Assert operator identity: passed pubkey x matches stored operatorX
    operatorPubkey.x.assertEquals(onChainOperatorX, 'operator pubkey mismatch');

    // Extract PetState from proof output
    const output = proof.publicOutput;

    // Assert cycle advanced (progress was made)
    output.cycle.value.assertGreaterThan(onChainCycle, 'cycle must advance');

    // Assert stage not regressed
    output.stage.value.assertGreaterThanOrEqual(
      onChainStage,
      'stage cannot regress'
    );

    // Verify operator signature over [lifecycleHash]
    operatorSig
      .verify(operatorPubkey, [output.lifecycleHash])
      .assertTrue('invalid operator signature');

    // Update mutable state fields (petId and ownerX are immutable)
    this.brainHash.set(output.brainHash);
    this.lifecycleHash.set(output.lifecycleHash);
    this.cycle.set(output.cycle.value);
    this.stage.set(output.stage.value);
    this.totalSpent.set(output.totalSpent.value);

    // Emit interaction event
    this.emitEvent('interaction', output.lifecycleHash);

    // Emit evolution event: circuits cannot conditionally emit, so we always
    // emit with Field(0) when stage is unchanged. Consumers must filter these.
    const stageChanged = output.stage.value.equals(onChainStage).not();
    const evolutionValue = Provable.if(
      stageChanged,
      output.stage.value,
      Field(0)
    );
    this.emitEvent('evolution', evolutionValue);
  }

  /**
   * Transfer operator to a new public key (only owner can do this).
   *
   * @param newOperator - New operator's full public key
   * @param ownerPubkey - Owner's full public key (x must match stored ownerX)
   * @param ownerSig - Owner signature over [newOperator.x]
   */
  @method async transferOperator(
    newOperator: PublicKey,
    ownerPubkey: PublicKey,
    ownerSig: Signature
  ): Promise<void> {
    // Read petId to ensure pet is initialized (defense-in-depth)
    const onChainPetId = this.petId.getAndRequireEquals();
    onChainPetId.assertNotEquals(Field(0), 'pet not initialized');

    // Read current ownerX
    const onChainOwnerX = this.ownerX.getAndRequireEquals();

    // Assert owner identity: passed pubkey x matches stored ownerX
    ownerPubkey.x.assertEquals(onChainOwnerX, 'owner pubkey mismatch');

    // Verify owner signature over [newOperator.x]
    ownerSig
      .verify(ownerPubkey, [newOperator.x])
      .assertTrue('invalid owner signature');

    // Update operatorX
    this.operatorX.set(newOperator.x);

    // Emit operator-transfer event
    this.emitEvent('operator-transfer', newOperator.x);
  }
}
