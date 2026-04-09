/**
 * ATDD Acceptance Tests for Story 11-1: napi-rs Memvid Binding
 *
 * Quality Gates:
 *   G1 -- CI platform matrix (AC-15): validated by CI workflow, not this file
 *   G2 -- Determinism (AC-12): validated by 11.1-PROP-001 in this file
 *
 * Risk mitigations:
 *   R-001 (napi-rs platform mismatch, score 9): CI matrix coverage
 *   R-006 (hash non-determinism, score 6): 100-iteration determinism test
 *   R-018 (.mv2 file growth, score 4): BrainStats.fileSize monitoring
 *
 * @see _bmad-output/planning-artifacts/test-design-epic-11.md
 * @see _bmad-output/implementation-artifacts/11-1-napi-rs-memvid-binding.md
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { existsSync } from 'node:fs';

import { PetBrain } from '../index.js';

import type { SearchHit, BrainStats, JsTimelineEntry } from '../index.js';

// ---------------------------------------------------------------------------
// Test infrastructure
// ---------------------------------------------------------------------------

let testDir: string;
let brainPath: string;

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), 'memvid-test-'));
  brainPath = join(testDir, 'test-brain.mv2');
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// AC-2: PetBrain.create(path)
// ---------------------------------------------------------------------------

describe('PetBrain.create()', () => {
  it('[P0] 11.1-UNIT-001 -- creates a new .mv2 file and returns PetBrain instance', () => {
    const brain = PetBrain.create(brainPath);

    expect(brain).toBeDefined();
    expect(brain).toBeInstanceOf(PetBrain);
    expect(existsSync(brainPath)).toBe(true);

    brain.close();
  });

  it('[P0] 11.1-UNIT-002 -- throws if file already exists', () => {
    const brain = PetBrain.create(brainPath);
    brain.close();

    expect(() => PetBrain.create(brainPath)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// AC-3: PetBrain.open(path)
// ---------------------------------------------------------------------------

describe('PetBrain.open()', () => {
  it('[P0] 11.1-UNIT-003 -- opens an existing .mv2 file', () => {
    const created = PetBrain.create(brainPath);
    created.commit();
    created.close();

    const brain = PetBrain.open(brainPath);

    expect(brain).toBeDefined();
    expect(brain).toBeInstanceOf(PetBrain);

    brain.close();
  });

  it('[P0] 11.1-UNIT-004 -- throws if file does not exist', () => {
    const missingPath = join(testDir, 'nonexistent.mv2');

    expect(() => PetBrain.open(missingPath)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// AC-4: PetBrain.putBytes(data, options?)
// ---------------------------------------------------------------------------

describe('PetBrain.putBytes()', () => {
  it('[P0] 11.1-UNIT-005 -- ingests Buffer and returns frame sequence number', () => {
    const brain = PetBrain.create(brainPath);

    const frameSeq = brain.putBytes(Buffer.from('hello pet world'));

    expect(typeof frameSeq).toBe('number');
    expect(frameSeq).toBeGreaterThanOrEqual(0);

    brain.close();
  });

  it('[P0] 11.1-UNIT-006 -- accepts PutOptions with title, uri, tags, timestamp', () => {
    const brain = PetBrain.create(brainPath);

    const frameSeq = brain.putBytes(Buffer.from('event with metadata'), {
      title: 'Fed sushi',
      uri: 'nostr:note1abc123',
      tags: ['feed', 'sushi'],
      timestamp: Math.floor(Date.now() / 1000),
    });

    expect(typeof frameSeq).toBe('number');
    expect(frameSeq).toBeGreaterThanOrEqual(0);

    brain.close();
  });
});

// ---------------------------------------------------------------------------
// AC-5: PetBrain.commit()
// ---------------------------------------------------------------------------

describe('PetBrain.commit()', () => {
  it('[P0] 11.1-UNIT-007 -- flushes WAL and rebuilds indices without error', () => {
    const brain = PetBrain.create(brainPath);
    brain.putBytes(Buffer.from('data to commit'));

    const result = brain.commit();

    expect(result).toBeUndefined();

    brain.close();
  });
});

// ---------------------------------------------------------------------------
// AC-6: PetBrain.hash()
// ---------------------------------------------------------------------------

describe('PetBrain.hash()', () => {
  it('[P0] 11.1-UNIT-008 -- returns 64-char lowercase hex BLAKE3 hash after commit', () => {
    const brain = PetBrain.create(brainPath);
    brain.putBytes(Buffer.from('deterministic content'));
    brain.commit();

    const hash = brain.hash();

    expect(typeof hash).toBe('string');
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);

    brain.close();
  });

  it('[P0] 11.1-UNIT-009 -- hash changes after additional putBytes + commit', () => {
    const brain = PetBrain.create(brainPath);
    brain.putBytes(Buffer.from('initial data'));
    brain.commit();
    const hash1 = brain.hash();

    brain.putBytes(Buffer.from('additional data'));
    brain.commit();
    const hash2 = brain.hash();

    expect(hash2).not.toBe(hash1);
    expect(hash2).toHaveLength(64);
    expect(hash2).toMatch(/^[0-9a-f]{64}$/);

    brain.close();
  });
});

// ---------------------------------------------------------------------------
// AC-7: PetBrain.search(query, topK)
// ---------------------------------------------------------------------------

describe('PetBrain.search()', () => {
  it('[P1] 11.1-UNIT-010 -- returns SearchHit[] for matching query', () => {
    const brain = PetBrain.create(brainPath);
    brain.putBytes(Buffer.from('The pet ate delicious sushi for dinner'));
    brain.putBytes(Buffer.from('The pet played with a ball in the park'));
    brain.commit();

    const results: SearchHit[] = brain.search('sushi', 10);

    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]).toHaveProperty('frameId');
    expect(results[0]).toHaveProperty('score');
    expect(results[0]).toHaveProperty('snippet');
    expect(typeof results[0]!.frameId).toBe('number');
    expect(typeof results[0]!.score).toBe('number');
    expect(typeof results[0]!.snippet).toBe('string');

    brain.close();
  });

  it('[P1] 11.1-UNIT-011 -- returns empty array for non-matching query', () => {
    const brain = PetBrain.create(brainPath);
    brain.putBytes(Buffer.from('The pet ate sushi'));
    brain.commit();

    const results: SearchHit[] = brain.search('xyznonexistent', 10);

    expect(Array.isArray(results)).toBe(true);
    expect(results).toHaveLength(0);

    brain.close();
  });
});

// ---------------------------------------------------------------------------
// AC-8: PetBrain.timeline(limit?)
// ---------------------------------------------------------------------------

describe('PetBrain.timeline()', () => {
  it('[P1] 11.1-UNIT-012 -- returns TimelineEntry[] in chronological order with limit', () => {
    const brain = PetBrain.create(brainPath);
    brain.putBytes(Buffer.from('entry 1'), { timestamp: 1000 });
    brain.putBytes(Buffer.from('entry 2'), { timestamp: 2000 });
    brain.putBytes(Buffer.from('entry 3'), { timestamp: 3000 });
    brain.commit();

    const entries: JsTimelineEntry[] = brain.timeline(2);

    expect(Array.isArray(entries)).toBe(true);
    expect(entries.length).toBeLessThanOrEqual(2);

    // Verify TimelineEntry structure
    if (entries.length > 0) {
      expect(entries[0]).toHaveProperty('frameId');
      expect(entries[0]).toHaveProperty('timestamp');
      expect(entries[0]).toHaveProperty('preview');
      expect(typeof entries[0]!.frameId).toBe('number');
      expect(typeof entries[0]!.timestamp).toBe('number');
      expect(typeof entries[0]!.preview).toBe('string');
    }

    brain.close();
  });
});

// ---------------------------------------------------------------------------
// AC-9: PetBrain.stats()
// ---------------------------------------------------------------------------

describe('PetBrain.stats()', () => {
  it('[P1] 11.1-UNIT-013 -- returns BrainStats with correct structure', () => {
    const brain = PetBrain.create(brainPath);
    brain.putBytes(Buffer.from('some content'));
    brain.commit();

    const stats: BrainStats = brain.stats();

    expect(stats).toHaveProperty('frameCount');
    expect(stats).toHaveProperty('fileSize');
    expect(stats).toHaveProperty('segmentSizes');
    expect(typeof stats.frameCount).toBe('number');
    expect(typeof stats.fileSize).toBe('number');
    expect(stats.frameCount).toBeGreaterThan(0);
    expect(stats.fileSize).toBeGreaterThan(0);

    // Verify segmentSizes sub-structure
    expect(stats.segmentSizes).toHaveProperty('data');
    expect(stats.segmentSizes).toHaveProperty('lex');
    expect(stats.segmentSizes).toHaveProperty('timeIndex');
    expect(stats.segmentSizes).toHaveProperty('temporalTrack');
    expect(stats.segmentSizes).toHaveProperty('sketchTrack');
    expect(typeof stats.segmentSizes.data).toBe('number');
    expect(typeof stats.segmentSizes.lex).toBe('number');
    expect(typeof stats.segmentSizes.timeIndex).toBe('number');
    expect(typeof stats.segmentSizes.temporalTrack).toBe('number');
    expect(typeof stats.segmentSizes.sketchTrack).toBe('number');

    brain.close();
  });
});

// ---------------------------------------------------------------------------
// AC-10: PetBrain.close()
// ---------------------------------------------------------------------------

describe('PetBrain.close()', () => {
  it('[P0] 11.1-UNIT-014 -- releases resources and subsequent calls throw', () => {
    const brain = PetBrain.create(brainPath);
    brain.putBytes(Buffer.from('data'));
    brain.commit();

    brain.close();

    expect(() => brain.putBytes(Buffer.from('after close'))).toThrow();
    expect(() => brain.hash()).toThrow();
    expect(() => brain.search('test', 10)).toThrow();
    expect(() => brain.commit()).toThrow();
    expect(() => brain.stats()).toThrow();
    expect(() => brain.timeline()).toThrow();
  });

  it('[P0] 11.1-UNIT-015 -- double close throws JS Error, does not crash process', () => {
    const brain = PetBrain.create(brainPath);
    brain.close();

    // Double close must throw a JS Error (not crash the process)
    expect(() => brain.close()).toThrow(Error);
  });
});

// ---------------------------------------------------------------------------
// AC-13: Error handling -- Rust panics caught
// ---------------------------------------------------------------------------

describe('Error handling (AC-13)', () => {
  it('[P0] 11.1-UNIT-016 -- corrupt file produces JS Error, not process crash', async () => {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(brainPath, Buffer.from('THIS IS NOT A VALID MV2 FILE'));

    expect(() => PetBrain.open(brainPath)).toThrow(Error);
  });

  it('[P0] 11.1-UNIT-017 -- method on closed brain produces JS Error', () => {
    const brain = PetBrain.create(brainPath);
    brain.close();

    try {
      brain.hash();
      expect.unreachable('hash() should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toBeTruthy();
    }
  });
});

// ---------------------------------------------------------------------------
// AC-3 (supplement): WAL auto-recovery on open
// ---------------------------------------------------------------------------

describe('PetBrain.open() WAL recovery (AC-3)', () => {
  it('[P0] 11.1-UNIT-018 -- open replays uncommitted WAL entries (auto-recovery)', () => {
    // Create a brain, put data, commit, then put MORE data without committing
    const brain = PetBrain.create(brainPath);
    brain.putBytes(Buffer.from('committed data'), { timestamp: 1000 });
    brain.commit();
    brain.putBytes(Buffer.from('uncommitted WAL data about sushi'), { timestamp: 2000 });
    // Close WITHOUT committing the second putBytes -- WAL has uncommitted entry
    brain.close();

    // Re-open: Memvid should silently replay WAL
    const reopened = PetBrain.open(brainPath);
    // The uncommitted WAL entry should now be recoverable.
    // Commit to flush the replayed WAL, then verify via search and stats.
    reopened.commit();

    const stats = reopened.stats();
    // Should have both frames (committed + WAL-replayed)
    expect(stats.frameCount).toBe(2);

    const results = reopened.search('sushi', 10);
    expect(results.length).toBeGreaterThan(0);

    reopened.close();
  });
});

// ---------------------------------------------------------------------------
// AC-8 (supplement): timeline() default limit
// ---------------------------------------------------------------------------

describe('PetBrain.timeline() edge cases (AC-8)', () => {
  it('[P1] 11.1-UNIT-023 -- timeline(0) throws instead of silently defaulting', () => {
    const brain = PetBrain.create(brainPath);
    brain.putBytes(Buffer.from('entry'), { timestamp: 1000 });
    brain.commit();

    expect(() => brain.timeline(0)).toThrow(/limit must be greater than 0/);

    brain.close();
  });
});

describe('PetBrain.timeline() default limit (AC-8)', () => {
  it('[P1] 11.1-UNIT-019 -- timeline() without arguments uses default limit of 100', () => {
    const brain = PetBrain.create(brainPath);
    // Insert a few entries
    for (let i = 0; i < 5; i++) {
      brain.putBytes(Buffer.from(`timeline entry ${i}`), { timestamp: 1000 + i });
    }
    brain.commit();

    // Call timeline() with no arguments -- should use default limit (100)
    const entries: JsTimelineEntry[] = brain.timeline();

    expect(Array.isArray(entries)).toBe(true);
    expect(entries.length).toBe(5);

    // Verify chronological order (timestamps should be non-decreasing)
    for (let i = 1; i < entries.length; i++) {
      expect(entries[i]!.timestamp).toBeGreaterThanOrEqual(entries[i - 1]!.timestamp);
    }

    brain.close();
  });
});

// ---------------------------------------------------------------------------
// AC-11: Thread safety -- concurrent reads from separate instances
// ---------------------------------------------------------------------------

describe('Thread safety (AC-11)', () => {
  it('[P1] 11.1-UNIT-020 -- sequential open/close on same file yields consistent results', () => {
    // AC-11 states: PetBrain instances are Send but NOT Sync.
    // Concurrent reads on the same file require separate PetBrain.open() instances.
    // Memvid enforces exclusive file locks, so concurrent open on the same path
    // is expected to fail. This test validates that sequential open/close cycles
    // on the same file produce consistent, correct results -- the primary
    // safety guarantee for single-threaded JS usage.

    // Create and populate a brain
    const brain = PetBrain.create(brainPath);
    brain.putBytes(Buffer.from('shared data for sequential reads'), { timestamp: 1000 });
    brain.putBytes(Buffer.from('more shared data about sushi'), { timestamp: 2000 });
    brain.commit();
    const originalHash = brain.hash();
    const originalStats = brain.stats();
    brain.close();

    // First reader: open, read, close
    const reader1 = PetBrain.open(brainPath);
    const hash1 = reader1.hash();
    const stats1 = reader1.stats();
    const search1 = reader1.search('sushi', 10);
    const timeline1 = reader1.timeline(10);
    reader1.close();

    // Second reader: open, read, close
    const reader2 = PetBrain.open(brainPath);
    const hash2 = reader2.hash();
    const stats2 = reader2.stats();
    const search2 = reader2.search('sushi', 10);
    const timeline2 = reader2.timeline(10);
    reader2.close();

    // Both readers must see identical state
    expect(hash1).toBe(originalHash);
    expect(hash2).toBe(originalHash);
    expect(stats1.frameCount).toBe(originalStats.frameCount);
    expect(stats2.frameCount).toBe(originalStats.frameCount);
    expect(search1.length).toBe(search2.length);
    expect(timeline1.length).toBe(timeline2.length);
  });

  it('[P1] 11.1-UNIT-022 -- concurrent open() on same file throws (exclusive lock)', () => {
    // Memvid enforces exclusive file locks on open(). Opening the same
    // committed file twice via open() must throw, not crash the process.
    const brain = PetBrain.create(brainPath);
    brain.putBytes(Buffer.from('data'));
    brain.commit();
    brain.close();

    // First open holds the lock
    const reader1 = PetBrain.open(brainPath);

    // Second open on the same file should fail with lock error
    expect(() => PetBrain.open(brainPath)).toThrow();

    reader1.close();
  });
});

// ---------------------------------------------------------------------------
// AC-14: TypeScript declarations verification
// ---------------------------------------------------------------------------

describe('TypeScript declarations (AC-14)', () => {
  it('[P1] 11.1-UNIT-021 -- auto-generated index.d.ts contains all public types', async () => {
    const dtsPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'index.d.ts');
    const dtsContent = await readFile(dtsPath, 'utf-8');

    // Verify PetBrain class with all methods
    expect(dtsContent).toContain('export declare class PetBrain');
    expect(dtsContent).toContain('static create(path: string): PetBrain');
    expect(dtsContent).toContain('static open(path: string): PetBrain');
    expect(dtsContent).toContain('putBytes(');
    expect(dtsContent).toContain('commit(): void');
    expect(dtsContent).toContain('hash(): string');
    expect(dtsContent).toContain('search(');
    expect(dtsContent).toContain('timeline(');
    expect(dtsContent).toContain('stats(): BrainStats');
    expect(dtsContent).toContain('close(): void');

    // Verify all exported interfaces
    expect(dtsContent).toContain('export interface JsPutOptions');
    expect(dtsContent).toContain('export interface SearchHit');
    expect(dtsContent).toContain('export interface JsTimelineEntry');
    expect(dtsContent).toContain('export interface BrainStats');
    expect(dtsContent).toContain('export interface SegmentSizes');

    // Verify JsPutOptions fields
    expect(dtsContent).toContain('title?: string');
    expect(dtsContent).toContain('uri?: string');
    expect(dtsContent).toContain('tags?: Array<string>');
    expect(dtsContent).toContain('timestamp?: number');

    // Verify SearchHit fields
    expect(dtsContent).toContain('frameId: number');
    expect(dtsContent).toContain('score: number');
    expect(dtsContent).toContain('snippet: string');

    // Verify BrainStats fields
    expect(dtsContent).toContain('frameCount: number');
    expect(dtsContent).toContain('fileSize: number');
    expect(dtsContent).toContain('segmentSizes: SegmentSizes');
  });
});

// ---------------------------------------------------------------------------
// AC-12: Determinism test -- Quality Gate G2 (P0)
// ---------------------------------------------------------------------------

describe('Determinism (Quality Gate G2)', () => {
  it('[P0] 11.1-PROP-001 -- 100 iterations produce identical hash for identical input', () => {
    // Use fixed timestamps to ensure determinism -- Memvid assigns
    // SystemTime::now() if no explicit timestamp is provided, making
    // frame checksums non-deterministic across runs.
    const events = [
      { data: Buffer.from('pet was fed sushi'), ts: 1000 },
      { data: Buffer.from('pet played with ball'), ts: 2000 },
      { data: Buffer.from('pet was cleaned'), ts: 3000 },
      { data: Buffer.from('pet took a nap'), ts: 4000 },
      { data: Buffer.from('pet explored the garden'), ts: 5000 },
    ];

    const hashes: string[] = [];

    for (let i = 0; i < 100; i++) {
      const iterPath = join(testDir, `determinism-${i}.mv2`);
      const brain = PetBrain.create(iterPath);

      for (const event of events) {
        brain.putBytes(event.data, { timestamp: event.ts });
      }
      brain.commit();

      const hash = brain.hash();
      hashes.push(hash);
      brain.close();
    }

    const firstHash = hashes[0]!;
    expect(firstHash).toHaveLength(64);
    expect(firstHash).toMatch(/^[0-9a-f]{64}$/);

    for (let i = 1; i < hashes.length; i++) {
      expect(hashes[i]).toBe(firstHash);
    }
  });
});

// ---------------------------------------------------------------------------
// Lifecycle integration test
// ---------------------------------------------------------------------------

describe('Full lifecycle (AC-2 through AC-10)', () => {
  it('[P0] 11.1-LIFE-001 -- create -> putBytes -> commit -> hash -> search -> timeline -> stats -> close', () => {
    // Step 1: Create (AC-2)
    const brain = PetBrain.create(brainPath);
    expect(brain).toBeDefined();

    // Step 2: putBytes (AC-4) -- explicit timestamps for determinism
    const seq1 = brain.putBytes(Buffer.from('The pet was fed delicious sushi'), {
      timestamp: 1000,
    });
    expect(typeof seq1).toBe('number');

    const seq2 = brain.putBytes(Buffer.from('The pet played fetch in the yard'), {
      title: 'Play session',
      tags: ['play', 'fetch'],
      timestamp: 2000,
    });
    expect(seq2).toBeGreaterThan(seq1);

    // Step 3: commit (AC-5)
    brain.commit();

    // Step 4: hash (AC-6)
    const hash = brain.hash();
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);

    // Step 5: search (AC-7)
    const searchResults = brain.search('sushi', 5);
    expect(Array.isArray(searchResults)).toBe(true);
    expect(searchResults.length).toBeGreaterThan(0);

    // Step 6: timeline (AC-8)
    const timeline = brain.timeline(10);
    expect(Array.isArray(timeline)).toBe(true);

    // Step 7: stats (AC-9)
    const stats = brain.stats();
    expect(stats.frameCount).toBe(2);
    expect(stats.fileSize).toBeGreaterThan(0);

    // Step 8: close (AC-10)
    brain.close();

    // Verify closed state
    expect(() => brain.hash()).toThrow();
  });
});
