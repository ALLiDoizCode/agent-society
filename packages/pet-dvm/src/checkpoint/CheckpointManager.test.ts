/**
 * CheckpointManager unit tests.
 *
 * Uses a mock ArweaveUploadAdapter and a real temp directory for .mv2 files.
 * No @ardrive/turbo-sdk loaded in tests.
 * Uses Jest globals (this package uses jest, not vitest).
 */

import { writeFile, rm, mkdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { CheckpointManager } from './CheckpointManager';
import { CheckpointConfigError } from './types';
import type { ArweaveUploadAdapter, CheckpointEvent, CheckpointError } from './types';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeMockAdapter(
  resolveValue: { txId: string } = { txId: 'mock-tx-id' },
  rejectWith?: Error
): ArweaveUploadAdapter {
  return {
    upload: rejectWith
      ? jest.fn().mockRejectedValue(rejectWith)
      : jest.fn().mockResolvedValue(resolveValue),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CheckpointManager', () => {
  let tmpDir: string;

  beforeEach(async () => {
    const dir = path.join(os.tmpdir(), `pet-dvm-cp-test-${Date.now()}`);
    await mkdir(dir, { recursive: true });
    tmpDir = dir;
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // AT-1: Constructor rejects threshold < 1
  // -------------------------------------------------------------------------
  describe('constructor', () => {
    it('throws CheckpointConfigError when checkpointThreshold is 0', () => {
      expect(
        () =>
          new CheckpointManager({
            arweaveAdapter: makeMockAdapter(),
            brainStoragePath: tmpDir,
            checkpointThreshold: 0,
          })
      ).toThrow(CheckpointConfigError);
    });

    it('throws CheckpointConfigError when checkpointThreshold is negative', () => {
      expect(
        () =>
          new CheckpointManager({
            arweaveAdapter: makeMockAdapter(),
            brainStoragePath: tmpDir,
            checkpointThreshold: -1,
          })
      ).toThrow(CheckpointConfigError);
    });

    it('does not throw for threshold = 1', () => {
      expect(
        () =>
          new CheckpointManager({
            arweaveAdapter: makeMockAdapter(),
            brainStoragePath: tmpDir,
            checkpointThreshold: 1,
          })
      ).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // AT-2 & AT-3: recordInteraction counter behaviour
  // -------------------------------------------------------------------------
  describe('recordInteraction', () => {
    it('returns false for the first two calls with threshold=3', () => {
      const manager = new CheckpointManager({
        arweaveAdapter: makeMockAdapter(),
        brainStoragePath: tmpDir,
        checkpointThreshold: 3,
      });
      expect(manager.recordInteraction('pet-1')).toBe(false);
      expect(manager.recordInteraction('pet-1')).toBe(false);
    });

    it('returns true on the Nth call (threshold=3) then resets counter', () => {
      const manager = new CheckpointManager({
        arweaveAdapter: makeMockAdapter(),
        brainStoragePath: tmpDir,
        checkpointThreshold: 3,
      });
      manager.recordInteraction('pet-1'); // 1
      manager.recordInteraction('pet-1'); // 2
      expect(manager.recordInteraction('pet-1')).toBe(true); // 3 → threshold
      expect(manager.recordInteraction('pet-1')).toBe(false); // reset → 1
    });

    it('tracks counters independently per blobbiId', () => {
      const manager = new CheckpointManager({
        arweaveAdapter: makeMockAdapter(),
        brainStoragePath: tmpDir,
        checkpointThreshold: 3,
      });
      // A: 1, 2, 3 (hits threshold on 3rd call)
      // B: only 1 call — should still be at count=1, not yet at threshold
      manager.recordInteraction('pet-A'); // A=1
      manager.recordInteraction('pet-A'); // A=2
      manager.recordInteraction('pet-B'); // B=1
      expect(manager.recordInteraction('pet-A')).toBe(true); // A=3 → threshold
      expect(manager.recordInteraction('pet-B')).toBe(false); // B=2, still below threshold=3
    });

    it('getInteractionCount returns 0 for unknown pet', () => {
      const manager = new CheckpointManager({
        arweaveAdapter: makeMockAdapter(),
        brainStoragePath: tmpDir,
        checkpointThreshold: 3,
      });
      expect(manager.getInteractionCount('never-seen')).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // AT-4 through AT-7: checkpoint upload behaviour
  // -------------------------------------------------------------------------
  describe('checkpoint', () => {
    it('uploads .mv2 buffer and emits checkpoint event with txId and brainHash', async () => {
      const brainContent = Buffer.from('mock-brain-data');
      const blobbiId = 'pet-happy';
      const brainHash = 'abc123hash';
      await writeFile(path.join(tmpDir, `${blobbiId}.mv2`), brainContent);

      const mockAdapter = makeMockAdapter({ txId: 'arweave-tx-1' });
      const manager = new CheckpointManager({
        arweaveAdapter: mockAdapter,
        brainStoragePath: tmpDir,
        checkpointThreshold: 3,
      });

      const checkpointEvents: CheckpointEvent[] = [];
      manager.on('checkpoint', (evt: CheckpointEvent) =>
        checkpointEvents.push(evt)
      );

      const result = await manager.checkpoint(blobbiId, brainHash);

      expect(result).toBeDefined();
      expect(result?.txId).toBe('arweave-tx-1');
      expect(result?.brainHash).toBe(brainHash);
      expect(result?.blobbiId).toBe(blobbiId);
      expect(checkpointEvents).toHaveLength(1);
      expect(checkpointEvents[0]?.txId).toBe('arweave-tx-1');
      expect(checkpointEvents[0]?.brainHash).toBe(brainHash);

      expect(mockAdapter.upload).toHaveBeenCalledTimes(1);
      const [uploadedBuffer] = (
        mockAdapter.upload as jest.Mock
      ).mock.calls[0] as [Buffer, Record<string, string>];
      expect(uploadedBuffer).toEqual(brainContent);
    });

    it('includes mandatory tags Pet-Brain-Id and Brain-Hash in upload call', async () => {
      const blobbiId = 'pet-tagged';
      const brainHash = 'hashvalue';
      await writeFile(path.join(tmpDir, `${blobbiId}.mv2`), Buffer.from('data'));

      const mockAdapter = makeMockAdapter({ txId: 'tx-tags' });
      const manager = new CheckpointManager({
        arweaveAdapter: mockAdapter,
        brainStoragePath: tmpDir,
        checkpointThreshold: 1,
      });

      await manager.checkpoint(blobbiId, brainHash);

      const [, tags] = (mockAdapter.upload as jest.Mock).mock.calls[0] as [
        Buffer,
        Record<string, string>,
      ];
      expect(tags['Pet-Brain-Id']).toBe(blobbiId);
      expect(tags['Brain-Hash']).toBe(brainHash);
      expect(tags['Content-Type']).toBe('application/octet-stream');
      expect(tags['Checkpoint-Timestamp']).toBeDefined();
    });

    // AT-7: Mandatory tags override caller-supplied arweaveTags
    it('mandatory tags override caller-supplied arweaveTags', async () => {
      const blobbiId = 'pet-override';
      const brainHash = 'hashoverride';
      await writeFile(path.join(tmpDir, `${blobbiId}.mv2`), Buffer.from('data'));

      const mockAdapter = makeMockAdapter({ txId: 'tx-override' });
      const manager = new CheckpointManager({
        arweaveAdapter: mockAdapter,
        brainStoragePath: tmpDir,
        checkpointThreshold: 1,
        arweaveTags: {
          'Pet-Brain-Id': 'CALLER-OVERRIDE', // should be overridden
          'Custom-Tag': 'custom-value', // should pass through
        },
      });

      await manager.checkpoint(blobbiId, brainHash);

      const [, tags] = (mockAdapter.upload as jest.Mock).mock.calls[0] as [
        Buffer,
        Record<string, string>,
      ];
      expect(tags['Pet-Brain-Id']).toBe(blobbiId); // mandatory overrides caller
      expect(tags['Custom-Tag']).toBe('custom-value'); // caller tag passes through
    });

    // AT-5: FILE_NOT_FOUND emits error, does not throw/reject
    it('emits error event with FILE_NOT_FOUND when .mv2 does not exist', async () => {
      const mockAdapter = makeMockAdapter();
      const manager = new CheckpointManager({
        arweaveAdapter: mockAdapter,
        brainStoragePath: tmpDir,
        checkpointThreshold: 1,
      });

      const errors: CheckpointError[] = [];
      manager.on('error', (err: CheckpointError) => errors.push(err));

      const result = await manager.checkpoint('nonexistent-pet', 'hash');

      expect(result).toBeUndefined();
      expect(errors).toHaveLength(1);
      expect(errors[0]?.code).toBe('FILE_NOT_FOUND');
      expect(errors[0]?.blobbiId).toBe('nonexistent-pet');
      expect(mockAdapter.upload).not.toHaveBeenCalled();
    });

    // AT-6: UPLOAD_FAILED emits error, does not throw/reject
    it('emits error event with UPLOAD_FAILED when upload adapter rejects', async () => {
      const blobbiId = 'pet-fail';
      await writeFile(
        path.join(tmpDir, `${blobbiId}.mv2`),
        Buffer.from('brain-data')
      );

      const mockAdapter = makeMockAdapter(
        undefined,
        new Error('Turbo network failure')
      );
      const manager = new CheckpointManager({
        arweaveAdapter: mockAdapter,
        brainStoragePath: tmpDir,
        checkpointThreshold: 1,
      });

      const errors: CheckpointError[] = [];
      manager.on('error', (err: CheckpointError) => errors.push(err));

      const result = await manager.checkpoint(blobbiId, 'hash');

      expect(result).toBeUndefined();
      expect(errors).toHaveLength(1);
      expect(errors[0]?.code).toBe('UPLOAD_FAILED');
      expect(errors[0]?.blobbiId).toBe(blobbiId);
    });
  });
});
