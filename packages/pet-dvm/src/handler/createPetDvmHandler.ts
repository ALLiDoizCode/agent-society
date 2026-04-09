/**
 * createPetDvmHandler -- Factory function for the Pet DVM handler.
 *
 * Creates a handler function compatible with HandlerRegistry.on() that:
 * 1. Parses Kind 5900 pet interaction requests
 * 2. Processes them through PetGameEngine
 * 3. Ingests interactions into PetBrain (Memvid)
 * 4. Publishes optimistic Kind 14919 events
 * 5. Queues interactions for async ZK proof generation
 *
 * Follows the same pattern as createArweaveDvmHandler in packages/sdk.
 *
 * @module handler/createPetDvmHandler
 */

import path from 'node:path';
import { PetBrain } from '@toon-protocol/memvid-node';
import { createPetGameEngine } from '../engine/PetGameEngine';
import { GameEngineError } from '../engine/types';
import type { PetDvmConfig, HandlerContext, HandlerResponse } from './types';
import { parsePetInteractionRequest } from './parsePetInteractionRequest';
import { PetStateManager } from './PetStateManager';
import { ProofQueue } from './ProofQueue';
import { buildPetInteractionEvent } from './buildPetInteractionEvent';
import { calculatePetInteractionPrice } from '../pricing/calculatePetInteractionPrice';
import { CheckpointManager } from '../checkpoint/CheckpointManager';

/**
 * Creates a Pet DVM handler for Kind 5900 pet interaction requests.
 *
 * @param config - Handler configuration with brain storage path and publish callback.
 * @returns A handler function compatible with HandlerRegistry.on().
 */
export function createPetDvmHandler(
  config: PetDvmConfig
): (ctx: HandlerContext) => Promise<HandlerResponse> {
  const stateManager = new PetStateManager();
  const proofQueue = new ProofQueue(config.proofBatchSize ?? 10);
  // Instantiate CheckpointManager once at factory time (not per-request)
  const checkpointManager = config.checkpointConfig
    ? new CheckpointManager(config.checkpointConfig)
    : undefined;

  return async (ctx: HandlerContext): Promise<HandlerResponse> => {
    // a. Decode event via ctx.decode()
    const event = ctx.decode();

    // b. Parse pet interaction request; reject F00 if malformed
    const request = parsePetInteractionRequest(event);
    if (!request) {
      return {
        accept: false,
        code: 'F00',
        message: 'Malformed pet interaction request: missing or invalid tags',
      };
    }

    // b2. Validate ILP payment covers required PET token cost (when pricingConfig is set)
    if (config.pricingConfig !== undefined) {
      const requiredAmount = calculatePetInteractionPrice(
        request.tokenCost,
        config.pricingConfig
      );
      if (ctx.amount < requiredAmount) {
        return {
          accept: false,
          code: 'F01',
          message: `Insufficient ILP payment: required ${requiredAmount}, received ${ctx.amount}`,
        };
      }
    }

    // c. Load pet state via PetStateManager.getOrCreate(blobbiId)
    const currentState = stateManager.getOrCreate(request.blobbiId);

    // d. Create PetGameEngine from current state
    // d2. Wrap in try/catch for INVALID_STAGE (corrupt persisted state)
    let engine;
    try {
      engine = createPetGameEngine(currentState);
    } catch (err) {
      if (err instanceof GameEngineError && err.code === 'INVALID_STAGE') {
        return {
          accept: false,
          code: 'T00',
          message: 'Internal state error',
        };
      }
      throw err;
    }

    // e. Call engine.processInteraction(action) -- map GameEngineError to ILP codes
    const action = {
      actionType: request.actionType,
      itemId: request.itemId,
      timestamp: request.timestamp,
      tokenCost: request.tokenCost,
      isSleeping: request.isSleeping,
    };

    let interactionResult;
    try {
      interactionResult = engine.processInteraction(action);
    } catch (err) {
      if (err instanceof GameEngineError) {
        switch (err.code) {
          case 'TIMESTAMP_REGRESSION':
            return {
              accept: false,
              code: 'F00',
              message: 'Timestamp must be strictly after previous interaction',
            };
          case 'INVALID_ACTION':
            return {
              accept: false,
              code: 'F00',
              message: `Action ${action.actionType} not allowed for current pet state`,
            };
          case 'TOKEN_COST_MISMATCH':
            return {
              accept: false,
              code: 'F00',
              message:
                'Token cost does not match required amount for this action',
            };
          case 'COOLDOWN_ACTIVE':
            return {
              accept: false,
              code: 'F00',
              message: `Cooldown not elapsed for action ${action.actionType}`,
            };
          default:
            return {
              accept: false,
              code: 'T00',
              message: 'Internal processing error',
            };
        }
      }
      throw err;
    }

    // f. Load or create PetBrain
    // Sanitize blobbiId to prevent path traversal (CWE-22):
    // reject any blobbiId containing path separators or parent-directory references
    if (
      request.blobbiId.includes('/') ||
      request.blobbiId.includes('\\') ||
      request.blobbiId.includes('\0') ||
      request.blobbiId === '..' ||
      request.blobbiId.startsWith('../') ||
      request.blobbiId.startsWith('..\\')
    ) {
      return {
        accept: false,
        code: 'F00',
        message:
          'Invalid blobbiId: contains path separator or traversal sequence',
      };
    }
    const brainPath = path.join(
      config.brainStoragePath,
      `${request.blobbiId}.mv2`
    );
    let brain: InstanceType<typeof PetBrain>;
    try {
      brain = PetBrain.open(brainPath);
    } catch {
      try {
        brain = PetBrain.create(brainPath);
      } catch {
        return {
          accept: false,
          code: 'T00',
          message: 'Brain storage unavailable',
        };
      }
    }

    // g-n. Wrap in try/finally to guarantee brain.close()
    let brainHash: string;
    try {
      // h. Ingest interaction into brain
      brain.putBytes(Buffer.from(JSON.stringify(event)));

      // i. Commit brain
      brain.commit();

      // j. Compute brain hash
      brainHash = brain.hash();
    } finally {
      // Always release native resources
      brain.close();
    }

    // k. Get new state from engine, set brainHash
    // Deep-copy priorState to prevent aliasing if Map entry is later overwritten
    const priorState: typeof currentState = {
      ...currentState,
      stats: { ...currentState.stats },
      cooldownTimestamps: [...currentState.cooldownTimestamps],
    };
    const newState = engine.getState();
    newState.brainHash = brainHash;

    // l. Save updated state
    stateManager.save(request.blobbiId, newState);

    // l2. Fire-and-forget Arweave checkpoint if threshold reached
    if (checkpointManager !== undefined) {
      const shouldCheckpoint = checkpointManager.recordInteraction(
        request.blobbiId
      );
      if (shouldCheckpoint) {
        checkpointManager.checkpoint(request.blobbiId, brainHash).catch(() => {
          // CheckpointManager already emits 'error' event — swallow here
        });
      }
    }

    // m. Check evolution eligibility (note only, no auto-evolve in this story)
    const evolutionCheck = engine.checkEvolution();

    // n. Queue interaction for proof batch
    // Deep-copy newState to prevent aliasing with stateManager's Map entry
    const newStateCopy = {
      ...newState,
      stats: { ...newState.stats },
      cooldownTimestamps: [...newState.cooldownTimestamps],
    };
    proofQueue.push({
      blobbiId: request.blobbiId,
      priorState,
      newState: newStateCopy,
      action,
      interactionResult,
      eventId: event.id,
    });

    // o. Publish optimistic Kind 14919 event (fire-and-forget)
    const optimisticEvent = buildPetInteractionEvent({
      blobbiId: request.blobbiId,
      actionType: request.actionType,
      itemId: request.itemId,
      tokenCost: request.tokenCost,
      cycle: interactionResult.cycle,
      stage: interactionResult.stage,
      brainHash,
      interactionResult,
    });

    // Fire-and-forget: errors logged but do NOT cause handler to reject
    config.publishEvent(optimisticEvent).catch((err: unknown) => {
      // Publish errors are non-fatal -- log and continue (AC-6)
      console.warn(
        '[pet-dvm] Failed to publish optimistic Kind 14919 event:',
        err instanceof Error ? err.message : err
      );
    });

    // p. Return accept with base64-encoded new state (include evolution eligibility)
    const responsePayload = {
      ...newState,
      ...(evolutionCheck
        ? { canEvolve: true, evolveTo: evolutionCheck.toStage }
        : {}),
    };
    return {
      accept: true,
      data: Buffer.from(JSON.stringify(responsePayload)).toString('base64'),
    };
  };
}
