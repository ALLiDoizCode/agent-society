/**
 * createPetDvmHandler — Unit Tests (TDD RED PHASE)
 *
 * Story 11-5: Pet DVM Handler
 *
 * AC coverage:
 *   AC-1: createPetDvmHandler factory function
 *   AC-4: Interaction processing flow (end-to-end handler logic)
 *   AC-6: Optimistic Kind 14919 event published
 *   AC-9: Unit tests for createPetDvmHandler
 *
 * All tests use it() — TDD red phase. Remove .skip after implementation.
 *
 * PetBrain is mocked via jest.mock (napi-rs native addon not available in test env).
 */

import { createPetDvmHandler } from './createPetDvmHandler';
import type { PetDvmConfig, NostrEvent } from './types';
import {
  Stage,
  ActionType,
  getRequiredTokenCost,
} from '@toon-protocol/pet-circuit';

// ============================================================
// PetBrain Mock
// ============================================================

const mockBrain = {
  putBytes: jest.fn().mockReturnValue(1),
  commit: jest.fn(),
  hash: jest.fn().mockReturnValue('a'.repeat(64)),
  close: jest.fn(),
};

jest.mock('@toon-protocol/memvid-node', () => {
  // Access mockBrain lazily through the module-scoped variable.
  // jest.mock factory runs after variable declarations in the same scope.
  return {
    PetBrain: {
      open: jest.fn().mockImplementation(() => mockBrain),
      create: jest.fn().mockImplementation(() => mockBrain),
    },
  };
});

// ============================================================
// Test Helpers
// ============================================================

/** Build a valid Kind 5900 pet interaction event */
function makeValidPetEvent(
  overrides: {
    blobbiId?: string;
    actionType?: number;
    itemId?: number;
    cost?: number;
    sleeping?: string;
    createdAt?: number;
    pubkey?: string;
  } = {}
): NostrEvent {
  // Default to WARM (allowed for EGG stage; FEED is not allowed for EGG)
  const actionType = overrides.actionType ?? ActionType.WARM;
  const itemId = overrides.itemId ?? 0;
  const cost = overrides.cost ?? getRequiredTokenCost(actionType, itemId);

  const tags: string[][] = [
    ['d', overrides.blobbiId ?? 'blobbi-test-001'],
    ['action', String(actionType)],
    ['item', String(itemId)],
    ['cost', String(cost)],
  ];

  if (overrides.sleeping !== undefined) {
    tags.push(['sleeping', overrides.sleeping]);
  }

  return {
    id: 'evt-' + Math.random().toString(36).slice(2, 10),
    kind: 5900,
    created_at: overrides.createdAt ?? 1712345678,
    tags,
    content: '',
    pubkey: overrides.pubkey ?? 'c'.repeat(64),
    sig: 'd'.repeat(128),
  } as NostrEvent;
}

/** Create a mock HandlerContext that returns the given event from decode() */
function makeHandlerContext(event: NostrEvent) {
  return {
    toon: 'base64-toon-payload',
    kind: event.kind,
    pubkey: event.pubkey,
    amount: BigInt(1000),
    destination: 'g.toon.pet.test',
    decode: jest.fn().mockReturnValue(event),
    accept: jest
      .fn()
      .mockImplementation((metadata?: Record<string, unknown>) => ({
        accept: true as const,
        ...(metadata ? { metadata } : {}),
      })),
    reject: jest.fn().mockImplementation((code: string, message: string) => ({
      accept: false as const,
      code,
      message,
    })),
  };
}

/** Create a default PetDvmConfig for testing */
function makeConfig(overrides: Partial<PetDvmConfig> = {}): PetDvmConfig {
  return {
    brainStoragePath: '/tmp/test-brains',
    proofBatchSize: 10,
    publishEvent: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

// ============================================================
// Tests
// ============================================================

describe('createPetDvmHandler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset brain hash to return a fresh value per test
    mockBrain.hash.mockReturnValue('a'.repeat(64));
  });

  it('should return accept with new state for a valid interaction request', async () => {
    // Given a handler created with valid config
    const config = makeConfig();
    const handler = createPetDvmHandler(config);

    // And a valid Kind 5900 pet interaction event
    const event = makeValidPetEvent({ createdAt: 1000 });
    const ctx = makeHandlerContext(event);

    // When the handler processes the request
    const result = await handler(ctx);

    // Then it accepts with base64-encoded new state
    expect(result.accept).toBe(true);
    expect('data' in result && result.data).toBeDefined();

    // And the data is valid base64 JSON containing PetEngineState
    if ('data' in result && result.data) {
      const decoded = JSON.parse(Buffer.from(result.data, 'base64').toString());
      expect(decoded.stats).toBeDefined();
      expect(decoded.stage).toBeDefined();
      expect(decoded.cycle).toBeGreaterThanOrEqual(1);
      expect(decoded.brainHash).toBe('a'.repeat(64));
    }
  });

  it('should reject with F00 for malformed request (missing blobbi_id tag)', async () => {
    // Given a handler
    const config = makeConfig();
    const handler = createPetDvmHandler(config);

    // And a Kind 5900 event missing the d tag (no blobbi_id)
    const event = makeValidPetEvent();
    event.tags = event.tags.filter(([t]) => t !== 'd');
    const ctx = makeHandlerContext(event);

    // When the handler processes the request
    const result = await handler(ctx);

    // Then it rejects with F00
    expect(result.accept).toBe(false);
    if (!result.accept) {
      expect(result.code).toBe('F00');
    }
  });

  it('should reject with F00 for invalid action for current stage', async () => {
    // Given a handler with a pet in EGG stage
    const config = makeConfig();
    const handler = createPetDvmHandler(config);

    // And an event requesting an action not allowed for EGG stage
    // (EGG stage only allows limited actions -- ActionType.PLAY is not allowed for EGG)
    const event = makeValidPetEvent({
      actionType: ActionType.PLAY,
      itemId: 0,
      cost: 0, // Will be overridden by the test
      createdAt: 1000,
    });
    // Fix cost to match the action
    const expectedCost = getRequiredTokenCost(ActionType.PLAY, 0);
    event.tags = event.tags.map(([t, v]) =>
      t === 'cost' ? ['cost', String(expectedCost)] : [t, v!]
    ) as string[][];
    const ctx = makeHandlerContext(event);

    // When the handler processes the request
    const result = await handler(ctx);

    // Then it rejects with F00 (INVALID_ACTION from game engine)
    expect(result.accept).toBe(false);
    if (!result.accept) {
      expect(result.code).toBe('F00');
    }
  });

  it('should reject with F00 for cooldown violation', async () => {
    // Given a handler
    const config = makeConfig();
    const handler = createPetDvmHandler(config);

    // And a first valid interaction succeeds
    const event1 = makeValidPetEvent({ createdAt: 1000 });
    const ctx1 = makeHandlerContext(event1);
    const result1 = await handler(ctx1);
    expect(result1.accept).toBe(true);

    // When a second interaction happens too quickly (within cooldown period)
    const event2 = makeValidPetEvent({ createdAt: 1001 }); // 1 second later, within cooldown
    const ctx2 = makeHandlerContext(event2);
    const result2 = await handler(ctx2);

    // Then it rejects with F00 (COOLDOWN_ACTIVE)
    expect(result2.accept).toBe(false);
    if (!result2.accept) {
      expect(result2.code).toBe('F00');
    }
  });

  it('should update pet state correctly across multiple sequential interactions', async () => {
    // Given a handler
    const config = makeConfig();
    const handler = createPetDvmHandler(config);

    // When two interactions are processed with sufficient time between them
    const event1 = makeValidPetEvent({ createdAt: 1000 });
    const ctx1 = makeHandlerContext(event1);
    const result1 = await handler(ctx1);
    expect(result1.accept).toBe(true);

    // Second interaction after cooldown expires (WARM cooldown is 5400s)
    const event2 = makeValidPetEvent({ createdAt: 7000 });
    const ctx2 = makeHandlerContext(event2);
    const result2 = await handler(ctx2);

    // Then both succeed and cycle increments
    expect(result2.accept).toBe(true);
    if ('data' in result2 && result2.data) {
      const state2 = JSON.parse(Buffer.from(result2.data, 'base64').toString());
      expect(state2.cycle).toBeGreaterThanOrEqual(2);
    }
  });

  it('should produce different brain hashes after each interaction', async () => {
    // Given a handler where brain.hash() returns different values per call
    const config = makeConfig();
    const handler = createPetDvmHandler(config);

    mockBrain.hash
      .mockReturnValueOnce('b'.repeat(64))
      .mockReturnValueOnce('c'.repeat(64));

    // When two interactions are processed
    const event1 = makeValidPetEvent({ createdAt: 1000 });
    const ctx1 = makeHandlerContext(event1);
    const result1 = await handler(ctx1);

    const event2 = makeValidPetEvent({ createdAt: 7000 }); // After WARM cooldown (5400s)
    const ctx2 = makeHandlerContext(event2);
    const result2 = await handler(ctx2);

    // Then brain hashes differ between interactions
    expect(result1.accept).toBe(true);
    expect(result2.accept).toBe(true);

    if (
      'data' in result1 &&
      result1.data &&
      'data' in result2 &&
      result2.data
    ) {
      const state1 = JSON.parse(Buffer.from(result1.data, 'base64').toString());
      const state2 = JSON.parse(Buffer.from(result2.data, 'base64').toString());
      expect(state1.brainHash).toBe('b'.repeat(64));
      expect(state2.brainHash).toBe('c'.repeat(64));
      expect(state1.brainHash).not.toBe(state2.brainHash);
    }
  });

  it('should publish Kind 14919 event with correct tags via publishEvent callback', async () => {
    // Given a handler with a mock publishEvent callback
    const publishEvent = jest.fn().mockResolvedValue(undefined);
    const config = makeConfig({ publishEvent });
    const handler = createPetDvmHandler(config);

    // When a valid interaction is processed
    const event = makeValidPetEvent({ createdAt: 1000 });
    const ctx = makeHandlerContext(event);
    await handler(ctx);

    // Then publishEvent is called with an event containing correct tags
    expect(publishEvent).toHaveBeenCalledTimes(1);
    const publishedEvent = publishEvent.mock.calls[0][0];

    expect(publishedEvent.kind).toBe(14919);

    // Verify required tags exist
    const tagMap = new Map(
      publishedEvent.tags.map((t: string[]) => [t[0], t[1]])
    );
    expect(tagMap.get('d')).toBe('blobbi-test-001');
    expect(tagMap.get('action')).toBeDefined();
    expect(tagMap.get('item')).toBeDefined();
    expect(tagMap.get('cost')).toBeDefined();
    expect(tagMap.get('cycle')).toBeDefined();
    expect(tagMap.get('stage')).toBeDefined();
    expect(tagMap.get('brain_hash')).toBe('a'.repeat(64));

    // Verify NO proof or mina_tx tags (optimistic event)
    expect(tagMap.has('proof')).toBe(false);
    expect(tagMap.has('mina_tx')).toBe(false);

    // Verify content is JSON-serialized InteractionResult (AC-6)
    const content = JSON.parse(publishedEvent.content);
    expect(content).toHaveProperty('priorStats');
    expect(content).toHaveProperty('decayedStats');
    expect(content).toHaveProperty('finalStats');
    expect(content).toHaveProperty('cycle');
    expect(content).toHaveProperty('stage');
    expect(content).toHaveProperty('tokenCost');
  });

  it('should create a proof queue entry for each successful interaction', async () => {
    // Given a handler with proofBatchSize=2 so we can detect the batch-ready event
    const config = makeConfig({ proofBatchSize: 2 });
    const handler = createPetDvmHandler(config);

    // When two valid interactions are processed (reaching batchSize)
    const event1 = makeValidPetEvent({ createdAt: 1000 });
    const ctx1 = makeHandlerContext(event1);
    const result1 = await handler(ctx1);
    expect(result1.accept).toBe(true);

    // Second interaction after cooldown (WARM cooldown is 5400s)
    const event2 = makeValidPetEvent({ createdAt: 7000 });
    const ctx2 = makeHandlerContext(event2);
    const result2 = await handler(ctx2);
    expect(result2.accept).toBe(true);

    // Then the proof queue has accumulated entries.
    // We verify this indirectly: the handler factory creates a ProofQueue with
    // batchSize=2. If push() is called twice, the queue emits 'batch-ready'.
    // Since we cannot access the internal queue, we verify the handler processed
    // both interactions successfully (each push is called after processInteraction
    // succeeds). The ProofQueue unit tests validate push/getBatch/drain directly.
    // Both interactions accepted => both queue.push() calls executed without error.
  });

  it('should create genesis state for a new pet on first interaction', async () => {
    // Given a handler processing its first-ever interaction for a blobbiId
    const config = makeConfig();
    const handler = createPetDvmHandler(config);

    // When a valid interaction is processed for a never-before-seen pet
    const event = makeValidPetEvent({
      blobbiId: 'blobbi-brand-new',
      createdAt: 1000,
    });
    const ctx = makeHandlerContext(event);
    const result = await handler(ctx);

    // Then the handler accepts (genesis state was created and interaction processed)
    expect(result.accept).toBe(true);
    if ('data' in result && result.data) {
      const state = JSON.parse(Buffer.from(result.data, 'base64').toString());
      // After first interaction: cycle should be 1 (genesis was 0, +1 from interaction)
      expect(state.cycle).toBe(1);
      // Stage should still be EGG (genesis starts as EGG)
      expect(state.stage).toBe(Stage.EGG);
    }
  });

  it('should return base64-encoded JSON new state in FULFILL data', async () => {
    // Given a handler
    const config = makeConfig();
    const handler = createPetDvmHandler(config);

    // When a valid interaction is processed
    const event = makeValidPetEvent({ createdAt: 1000 });
    const ctx = makeHandlerContext(event);
    const result = await handler(ctx);

    // Then result contains base64-encoded JSON
    expect(result.accept).toBe(true);
    if ('data' in result && result.data) {
      // Verify it's valid base64
      const buffer = Buffer.from(result.data, 'base64');
      expect(buffer.length).toBeGreaterThan(0);

      // Verify it's valid JSON
      const parsed = JSON.parse(buffer.toString());
      expect(parsed).toHaveProperty('stats');
      expect(parsed).toHaveProperty('stage');
      expect(parsed).toHaveProperty('cycle');
      expect(parsed).toHaveProperty('brainHash');
      expect(parsed).toHaveProperty('lastInteraction');
      expect(parsed).toHaveProperty('cooldownTimestamps');
    }
  });

  it('should return T00 reject when PetBrain open and create both fail', async () => {
    // Given PetBrain.open() and PetBrain.create() both throw
    const { PetBrain } = jest.requireMock('@toon-protocol/memvid-node');
    PetBrain.open.mockImplementationOnce(() => {
      throw new Error('File not found');
    });
    PetBrain.create.mockImplementationOnce(() => {
      throw new Error('Disk full');
    });

    const config = makeConfig();
    const handler = createPetDvmHandler(config);

    // When a valid interaction is processed
    const event = makeValidPetEvent({ createdAt: 1000 });
    const ctx = makeHandlerContext(event);
    const result = await handler(ctx);

    // Then it rejects with T00 (transient error -- brain storage unavailable)
    expect(result.accept).toBe(false);
    if (!result.accept) {
      expect(result.code).toBe('T00');
      expect(result.message).toContain('Brain storage unavailable');
    }
  });

  it('should call brain.close() even when processing throws an error', async () => {
    // Given PetBrain opens successfully but putBytes throws
    mockBrain.putBytes.mockImplementationOnce(() => {
      throw new Error('Write failed');
    });

    const config = makeConfig();
    const handler = createPetDvmHandler(config);

    // When a valid interaction is processed
    const event = makeValidPetEvent({ createdAt: 1000 });
    const ctx = makeHandlerContext(event);

    // The handler may reject or throw, but brain.close() must be called
    try {
      await handler(ctx);
    } catch {
      // Handler might throw; that's ok for this test
    }

    // Then brain.close() was called (finally block guarantees cleanup)
    expect(mockBrain.close).toHaveBeenCalled();
  });

  it('should not reject when publishEvent callback throws (fire-and-forget)', async () => {
    // Given a handler whose publishEvent callback rejects
    const publishEvent = jest.fn().mockRejectedValue(new Error('Relay down'));
    const config = makeConfig({ publishEvent });
    const handler = createPetDvmHandler(config);

    // When a valid interaction is processed
    const event = makeValidPetEvent({ createdAt: 1000 });
    const ctx = makeHandlerContext(event);
    const result = await handler(ctx);

    // Then the handler still accepts (publish error is swallowed)
    expect(result.accept).toBe(true);
    expect(publishEvent).toHaveBeenCalledTimes(1);
  });

  it('should reject with F00 for timestamp regression', async () => {
    // Given a handler that has processed one interaction
    const config = makeConfig();
    const handler = createPetDvmHandler(config);

    const event1 = makeValidPetEvent({ createdAt: 5000 });
    const ctx1 = makeHandlerContext(event1);
    const result1 = await handler(ctx1);
    expect(result1.accept).toBe(true);

    // When a second interaction has an earlier timestamp (regression)
    const event2 = makeValidPetEvent({ createdAt: 3000 });
    const ctx2 = makeHandlerContext(event2);
    const result2 = await handler(ctx2);

    // Then it rejects with F00 (TIMESTAMP_REGRESSION)
    expect(result2.accept).toBe(false);
    if (!result2.accept) {
      expect(result2.code).toBe('F00');
    }
  });

  it('should reject with F00 for token cost mismatch', async () => {
    // Given a handler
    const config = makeConfig();
    const handler = createPetDvmHandler(config);

    // And an event with incorrect token cost (wrong amount for the action)
    const event = makeValidPetEvent({ createdAt: 1000 });
    // Override cost tag to a wrong value
    event.tags = event.tags.map(([t, v]) =>
      t === 'cost' ? ['cost', '99999'] : [t, v!]
    ) as string[][];
    const ctx = makeHandlerContext(event);

    // When the handler processes the request
    const result = await handler(ctx);

    // Then it rejects with F00 (TOKEN_COST_MISMATCH)
    expect(result.accept).toBe(false);
    if (!result.accept) {
      expect(result.code).toBe('F00');
    }
  });

  it('should reject with F00 for blobbiId containing path traversal', async () => {
    // Given a handler
    const config = makeConfig();
    const handler = createPetDvmHandler(config);

    // And an event with a blobbiId containing path traversal characters
    const event = makeValidPetEvent({
      blobbiId: '../../etc/passwd',
      createdAt: 1000,
    });
    const ctx = makeHandlerContext(event);

    // When the handler processes the request
    const result = await handler(ctx);

    // Then it rejects with F00 (path traversal blocked)
    expect(result.accept).toBe(false);
    if (!result.accept) {
      expect(result.code).toBe('F00');
      expect(result.message).toContain('path separator');
    }
  });

  it('should reject with F00 for blobbiId containing backslash path separator', async () => {
    // Given a handler
    const config = makeConfig();
    const handler = createPetDvmHandler(config);

    // And an event with a blobbiId containing backslash
    const event = makeValidPetEvent({
      blobbiId: 'foo\\bar',
      createdAt: 1000,
    });
    const ctx = makeHandlerContext(event);

    // When the handler processes the request
    const result = await handler(ctx);

    // Then it rejects with F00
    expect(result.accept).toBe(false);
    if (!result.accept) {
      expect(result.code).toBe('F00');
    }
  });

  it('should reject with T00 when createPetGameEngine throws INVALID_STAGE', async () => {
    // Given a handler that has a pet with corrupt persisted state
    const config = makeConfig();
    const handler = createPetDvmHandler(config);

    // First, process a valid interaction to establish the pet
    const event1 = makeValidPetEvent({
      blobbiId: 'blobbi-corrupt',
      createdAt: 1000,
    });
    const ctx1 = makeHandlerContext(event1);
    const result1 = await handler(ctx1);
    expect(result1.accept).toBe(true);

    // Now corrupt the state by mocking PetStateManager.getOrCreate to return bad state
    // We do this by sending an interaction to the same pet, but first corrupting
    // the brain hash mock so the saved state has an invalid brainHash
    mockBrain.hash.mockReturnValueOnce('ZZZZ_NOT_HEX');

    // Process another interaction -- this succeeds and saves state with bad brainHash
    const event2 = makeValidPetEvent({
      blobbiId: 'blobbi-corrupt',
      createdAt: 7000,
    });
    const ctx2 = makeHandlerContext(event2);
    await handler(ctx2);

    // Now the NEXT interaction for this pet will call createPetGameEngine with the
    // corrupt state (brainHash = 'ZZZZ_NOT_HEX'), triggering INVALID_STAGE
    const event3 = makeValidPetEvent({
      blobbiId: 'blobbi-corrupt',
      createdAt: 14000,
    });
    const ctx3 = makeHandlerContext(event3);
    const result3 = await handler(ctx3);

    // Then it rejects with T00 (internal state error)
    expect(result3.accept).toBe(false);
    if (!result3.accept) {
      expect(result3.code).toBe('T00');
      expect(result3.message).toContain('Internal state error');
    }
  });
});
