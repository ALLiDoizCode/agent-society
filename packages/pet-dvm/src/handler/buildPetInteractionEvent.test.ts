/**
 * buildPetInteractionEvent -- Unit Tests
 *
 * Story 11-5: Pet DVM Handler
 *
 * AC coverage:
 *   AC-6: Optimistic Kind 14919 event builder
 *
 * Tests the exported buildPetInteractionEvent function directly.
 */

import {
  buildPetInteractionEvent,
  type BuildPetInteractionEventParams,
} from './buildPetInteractionEvent';
import type { InteractionResult } from '../engine/types';
import { Stage } from '@toon-protocol/pet-circuit';

// ============================================================
// Test Helpers
// ============================================================

function makeParams(
  overrides: Partial<BuildPetInteractionEventParams> = {}
): BuildPetInteractionEventParams {
  const defaultResult: InteractionResult = {
    priorStats: {
      hunger: 100,
      happiness: 100,
      health: 100,
      hygiene: 100,
      energy: 100,
    },
    decayedStats: {
      hunger: 95,
      happiness: 95,
      health: 95,
      hygiene: 95,
      energy: 95,
    },
    finalStats: {
      hunger: 90,
      happiness: 80,
      health: 95,
      hygiene: 85,
      energy: 75,
    },
    cycle: 1,
    stage: Stage.EGG,
    tokenCost: 45,
  };

  return {
    blobbiId: 'blobbi-abc123',
    actionType: 0,
    itemId: 5,
    tokenCost: 45,
    cycle: 1,
    stage: Stage.EGG,
    brainHash: 'a'.repeat(64),
    interactionResult: defaultResult,
    ...overrides,
  };
}

// ============================================================
// Tests
// ============================================================

describe('buildPetInteractionEvent', () => {
  it('should return an event with kind 14919', () => {
    const event = buildPetInteractionEvent(makeParams());
    expect(event.kind).toBe(14919);
  });

  it('should include all required tags in correct order', () => {
    const params = makeParams({
      blobbiId: 'blobbi-xyz',
      actionType: 2,
      itemId: 3,
      tokenCost: 60,
      cycle: 5,
      stage: Stage.BABY,
      brainHash: 'b'.repeat(64),
    });

    const event = buildPetInteractionEvent(params);
    const tagMap = new Map(event.tags.map((t) => [t[0], t[1]]));

    expect(tagMap.get('d')).toBe('blobbi-xyz');
    expect(tagMap.get('action')).toBe('2');
    expect(tagMap.get('item')).toBe('3');
    expect(tagMap.get('cost')).toBe('60');
    expect(tagMap.get('cycle')).toBe('5');
    expect(tagMap.get('stage')).toBe(String(Stage.BABY));
    expect(tagMap.get('brain_hash')).toBe('b'.repeat(64));
  });

  it('should NOT include proof or mina_tx tags (optimistic event)', () => {
    const event = buildPetInteractionEvent(makeParams());
    const tagNames = event.tags.map((t) => t[0]);

    expect(tagNames).not.toContain('proof');
    expect(tagNames).not.toContain('mina_tx');
  });

  it('should set content to JSON-serialized InteractionResult', () => {
    const result: InteractionResult = {
      priorStats: {
        hunger: 100,
        happiness: 90,
        health: 80,
        hygiene: 70,
        energy: 60,
      },
      decayedStats: {
        hunger: 95,
        happiness: 85,
        health: 75,
        hygiene: 65,
        energy: 55,
      },
      finalStats: {
        hunger: 90,
        happiness: 80,
        health: 70,
        hygiene: 60,
        energy: 50,
      },
      cycle: 3,
      stage: Stage.ADULT,
      tokenCost: 100,
    };

    const event = buildPetInteractionEvent(
      makeParams({ interactionResult: result })
    );
    const parsed = JSON.parse(event.content);

    expect(parsed.priorStats).toEqual(result.priorStats);
    expect(parsed.decayedStats).toEqual(result.decayedStats);
    expect(parsed.finalStats).toEqual(result.finalStats);
    expect(parsed.cycle).toBe(3);
    expect(parsed.stage).toBe(Stage.ADULT);
    expect(parsed.tokenCost).toBe(100);
  });

  it('should set created_at to a reasonable Unix timestamp', () => {
    const before = Math.floor(Date.now() / 1000);
    const event = buildPetInteractionEvent(makeParams());
    const after = Math.floor(Date.now() / 1000);

    expect(event.created_at).toBeGreaterThanOrEqual(before);
    expect(event.created_at).toBeLessThanOrEqual(after);
  });

  it('should convert all tag values to strings', () => {
    const event = buildPetInteractionEvent(
      makeParams({
        actionType: 0,
        itemId: 5,
        tokenCost: 45,
        cycle: 1,
        stage: 0,
      })
    );

    for (const tag of event.tags) {
      for (const val of tag) {
        expect(typeof val).toBe('string');
      }
    }
  });
});
