/**
 * parsePetInteractionRequest -- Unit Tests
 *
 * Story 11-5: Pet DVM Handler
 *
 * AC coverage:
 *   AC-2: Request parsing -- extract tags from Kind 5900 events
 *   AC-12: parsePetInteractionRequest tests
 */

import { parsePetInteractionRequest } from './parsePetInteractionRequest';
import type { PetInteractionRequest, NostrEvent } from './types';

// ============================================================
// Test Helpers
// ============================================================

/** Build a valid Kind 5900 Nostr event for testing */
function makeValidPetEvent(
  overrides: Partial<NostrEvent> = {},
  tagOverrides: Record<string, string> = {}
): NostrEvent {
  const tags: string[][] = [
    ['d', tagOverrides['d'] ?? 'blobbi-abc123'],
    ['action', tagOverrides['action'] ?? '0'],
    ['item', tagOverrides['item'] ?? '5'],
    ['cost', tagOverrides['cost'] ?? '45'],
  ];

  // Only add sleeping tag if explicitly provided
  if ('sleeping' in tagOverrides) {
    tags.push(['sleeping', tagOverrides['sleeping']!]);
  }

  return {
    id: 'event-id-001',
    kind: 5900,
    created_at: 1712345678,
    tags,
    content: '',
    pubkey: 'a'.repeat(64),
    sig: 'b'.repeat(128),
    ...overrides,
  } as NostrEvent;
}

// ============================================================
// Tests
// ============================================================

describe('parsePetInteractionRequest', () => {
  it('should parse a valid event correctly', () => {
    const event = makeValidPetEvent();
    const result = parsePetInteractionRequest(event);

    expect(result).not.toBeNull();
    const req = result as PetInteractionRequest;
    expect(req.blobbiId).toBe('blobbi-abc123');
    expect(req.actionType).toBe(0);
    expect(req.itemId).toBe(5);
    expect(req.timestamp).toBe(1712345678);
    expect(req.tokenCost).toBe(45);
    expect(req.isSleeping).toBe(false);
    expect(req.ownerPubkey).toBe('a'.repeat(64));
  });

  it('should return null when d tag is missing', () => {
    const event = makeValidPetEvent();
    event.tags = event.tags.filter(([t]) => t !== 'd');
    expect(parsePetInteractionRequest(event)).toBeNull();
  });

  it('should return null when action tag is missing', () => {
    const event = makeValidPetEvent();
    event.tags = event.tags.filter(([t]) => t !== 'action');
    expect(parsePetInteractionRequest(event)).toBeNull();
  });

  it('should return null when action tag has non-numeric value', () => {
    const event = makeValidPetEvent({}, { action: 'feed' });
    expect(parsePetInteractionRequest(event)).toBeNull();
  });

  it('should return null when item tag is missing', () => {
    const event = makeValidPetEvent();
    event.tags = event.tags.filter(([t]) => t !== 'item');
    expect(parsePetInteractionRequest(event)).toBeNull();
  });

  it('should return null when cost tag is missing', () => {
    const event = makeValidPetEvent();
    event.tags = event.tags.filter(([t]) => t !== 'cost');
    expect(parsePetInteractionRequest(event)).toBeNull();
  });

  it('should default isSleeping to false when sleeping tag is absent', () => {
    const event = makeValidPetEvent();
    const result = parsePetInteractionRequest(event);
    expect(result).not.toBeNull();
    expect((result as PetInteractionRequest).isSleeping).toBe(false);
  });

  it('should parse sleeping=true correctly', () => {
    const event = makeValidPetEvent({}, { sleeping: 'true' });
    const result = parsePetInteractionRequest(event);
    expect(result).not.toBeNull();
    expect((result as PetInteractionRequest).isSleeping).toBe(true);
  });

  it('should return null for non-numeric item', () => {
    const event = makeValidPetEvent({}, { item: 'sword' });
    expect(parsePetInteractionRequest(event)).toBeNull();
  });

  it('should return null for non-numeric cost', () => {
    const event = makeValidPetEvent({}, { cost: 'free' });
    expect(parsePetInteractionRequest(event)).toBeNull();
  });

  it('should return null when d tag has empty value', () => {
    const event = makeValidPetEvent({}, { d: '' });
    expect(parsePetInteractionRequest(event)).toBeNull();
  });

  it('should return null when d tag has whitespace-only value', () => {
    const event = makeValidPetEvent({}, { d: '   ' });
    expect(parsePetInteractionRequest(event)).toBeNull();
  });
});
