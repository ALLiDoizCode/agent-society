/**
 * Pet Interaction Request Parser
 *
 * Extracts and validates pet interaction fields from Kind 5900 Nostr events.
 * Returns null for malformed requests (missing tags, invalid values).
 *
 * @module handler/parsePetInteractionRequest
 */

import type { PetInteractionRequest, NostrEvent } from './types';

/**
 * Extract the first value for a given tag name from a Nostr event's tags array.
 */
function getTagValue(tags: string[][], name: string): string | undefined {
  for (const tag of tags) {
    if (tag[0] === name) {
      return tag[1];
    }
  }
  return undefined;
}

/**
 * Parse a Kind 5900 pet interaction request event into a typed request object.
 *
 * Returns null if:
 * - Missing required `d` tag (blobbi_id)
 * - Missing required `action` tag
 * - Missing required `item` tag
 * - Missing required `cost` tag
 * - Non-numeric action, item, or cost values
 *
 * @param event - A Nostr event (Kind 5900)
 * @returns Parsed PetInteractionRequest or null if malformed
 */
export function parsePetInteractionRequest(
  event: NostrEvent
): PetInteractionRequest | null {
  const blobbiId = getTagValue(event.tags, 'd');
  if (!blobbiId || blobbiId.trim() === '') return null;

  const actionStr = getTagValue(event.tags, 'action');
  if (!actionStr) return null;
  const actionType = Number(actionStr);
  if (!Number.isFinite(actionType) || !Number.isInteger(actionType))
    return null;

  const itemStr = getTagValue(event.tags, 'item');
  if (!itemStr) return null;
  const itemId = Number(itemStr);
  if (!Number.isFinite(itemId) || !Number.isInteger(itemId)) return null;

  const costStr = getTagValue(event.tags, 'cost');
  if (!costStr) return null;
  const tokenCost = Number(costStr);
  if (!Number.isFinite(tokenCost)) return null;

  const sleepingStr = getTagValue(event.tags, 'sleeping');
  const isSleeping = sleepingStr === 'true';

  return {
    blobbiId,
    actionType,
    itemId,
    timestamp: event.created_at,
    tokenCost,
    isSleeping,
    ownerPubkey: event.pubkey,
  };
}
