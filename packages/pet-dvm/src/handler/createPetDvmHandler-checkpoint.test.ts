/**
 * createPetDvmHandler — Checkpoint integration tests.
 *
 * Story 11-12: Arweave Checkpoint Automation
 *
 * AC coverage:
 *   AC-4: Integration into createPetDvmHandler
 *     AT-8: No checkpoint when checkpointConfig absent
 *     AT-9: Checkpoint fires after checkpointThreshold interactions
 *
 * PetBrain is mocked (napi-rs native addon not available in test env).
 * ArweaveUploadAdapter is mocked — no @ardrive/turbo-sdk loaded in tests.
 */

import { writeFile, rm, mkdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createPetDvmHandler } from './createPetDvmHandler';
import type { PetDvmConfig, NostrEvent } from './types';
import { ActionType, getRequiredTokenCost } from '@toon-protocol/pet-circuit';
import type { ArweaveUploadAdapter } from '../checkpoint/types';

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
  return {
    PetBrain: {
      open: jest.fn().mockImplementation(() => mockBrain),
      create: jest.fn().mockImplementation(() => mockBrain),
    },
  };
});

// ============================================================
// Helpers
// ============================================================

function makeValidPetEvent(
  overrides: {
    blobbiId?: string;
    actionType?: number;
    createdAt?: number;
  } = {}
): NostrEvent {
  const actionType = overrides.actionType ?? ActionType.WARM;
  const itemId = 0;
  const cost = getRequiredTokenCost(actionType, itemId);
  return {
    id: 'evt-' + Math.random().toString(36).slice(2, 10),
    kind: 5900,
    created_at: overrides.createdAt ?? Math.floor(Date.now() / 1000),
    tags: [
      ['d', overrides.blobbiId ?? 'blobbi-checkpoint-001'],
      ['action', String(actionType)],
      ['item', String(itemId)],
      ['cost', String(cost)],
    ],
    content: '',
    pubkey: 'c'.repeat(64),
    sig: 'd'.repeat(128),
  } as NostrEvent;
}

function makeHandlerContext(event: NostrEvent) {
  return {
    toon: 'base64-toon-payload',
    kind: event.kind,
    pubkey: event.pubkey,
    amount: BigInt(1_000_000),
    destination: 'g.toon.pet.test',
    decode: jest.fn().mockReturnValue(event),
    accept: jest.fn().mockImplementation(() => ({ accept: true as const })),
    reject: jest.fn().mockImplementation((code: string, message: string) => ({
      accept: false as const,
      code,
      message,
    })),
  };
}

function makeMockAdapter(): ArweaveUploadAdapter {
  return {
    upload: jest.fn().mockResolvedValue({ txId: 'mock-arweave-tx' }),
  };
}

// ============================================================
// Tests
// ============================================================

describe('createPetDvmHandler — checkpoint integration', () => {
  let tmpDir: string;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockBrain.hash.mockReturnValue('a'.repeat(64));
    tmpDir = path.join(os.tmpdir(), `pet-dvm-checkpoint-test-${Date.now()}`);
    await mkdir(tmpDir, { recursive: true });
    // Create a dummy .mv2 file for the default pet so checkpoint can read it
    await writeFile(
      path.join(tmpDir, 'blobbi-checkpoint-001.mv2'),
      Buffer.from('brain-data')
    );
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  // AT-8: No checkpoint when checkpointConfig absent
  it('does NOT call upload adapter when checkpointConfig is absent', async () => {
    const mockAdapter = makeMockAdapter();
    const config: PetDvmConfig = {
      brainStoragePath: tmpDir,
      proofBatchSize: 10,
      publishEvent: jest.fn().mockResolvedValue(undefined),
      // No checkpointConfig
    };
    const handler = createPetDvmHandler(config);

    // Process 5 interactions (more than any threshold)
    for (let i = 0; i < 5; i++) {
      const event = makeValidPetEvent({ createdAt: 1712345678 + i * 10000 });
      const ctx = makeHandlerContext(event);
      await handler(ctx);
    }

    // Upload should never be called — no checkpoint config
    expect(mockAdapter.upload).not.toHaveBeenCalled();
  });

  // AT-9: Checkpoint fires after threshold interactions
  it('fires checkpoint upload exactly once after checkpointThreshold interactions', async () => {
    const mockAdapter = makeMockAdapter();
    const config: PetDvmConfig = {
      brainStoragePath: tmpDir,
      proofBatchSize: 10,
      publishEvent: jest.fn().mockResolvedValue(undefined),
      checkpointConfig: {
        arweaveAdapter: mockAdapter,
        brainStoragePath: tmpDir,
        checkpointThreshold: 3,
      },
    };
    const handler = createPetDvmHandler(config);

    // Process exactly 3 interactions (threshold = 3)
    for (let i = 0; i < 3; i++) {
      const event = makeValidPetEvent({ createdAt: 1712345678 + i * 10000 });
      const ctx = makeHandlerContext(event);
      const result = await handler(ctx);
      expect(result.accept).toBe(true);
    }

    // The checkpoint is fire-and-forget — wait a tick for it to settle
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Upload called exactly once (on the 3rd interaction)
    expect(mockAdapter.upload).toHaveBeenCalledTimes(1);

    // Upload called with Pet-Brain-Id tag
    const [, tags] = (mockAdapter.upload as jest.Mock).mock.calls[0] as [
      Buffer,
      Record<string, string>,
    ];
    expect(tags['Pet-Brain-Id']).toBe('blobbi-checkpoint-001');
  });

  it('fires checkpoint again after a second batch of threshold interactions', async () => {
    const mockAdapter = makeMockAdapter();
    const config: PetDvmConfig = {
      brainStoragePath: tmpDir,
      proofBatchSize: 10,
      publishEvent: jest.fn().mockResolvedValue(undefined),
      checkpointConfig: {
        arweaveAdapter: mockAdapter,
        brainStoragePath: tmpDir,
        checkpointThreshold: 2,
      },
    };
    const handler = createPetDvmHandler(config);

    // First batch: 2 interactions → 1 checkpoint
    for (let i = 0; i < 2; i++) {
      const event = makeValidPetEvent({ createdAt: 1712345678 + i * 10000 });
      await handler(makeHandlerContext(event));
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(mockAdapter.upload).toHaveBeenCalledTimes(1);

    // Second batch: 2 more interactions → 2nd checkpoint
    for (let i = 0; i < 2; i++) {
      const event = makeValidPetEvent({
        createdAt: 1712345678 + 200000 + i * 10000,
      });
      await handler(makeHandlerContext(event));
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(mockAdapter.upload).toHaveBeenCalledTimes(2);
  });
});
