/**
 * Event parsers for Agent Society Protocol
 */

import type { Event } from 'nostr-tools';
import { ILP_PEER_INFO_KIND, SPSP_INFO_KIND, FOLLOW_LIST_KIND } from './kinds.js';
import type { IlpPeerInfo, SpspInfo, SocialRelationship } from './types.js';

/**
 * Parse a kind:10032 event into IlpPeerInfo
 */
export function parseIlpPeerInfo(event: Event): IlpPeerInfo | null {
  if (event.kind !== ILP_PEER_INFO_KIND) {
    return null;
  }

  const ilpTag = event.tags.find((t) => t[0] === 'ilp');
  const btpTag = event.tags.find((t) => t[0] === 'btp');

  if (!ilpTag || !btpTag) {
    return null;
  }

  const assets = event.tags
    .filter((t) => t[0] === 'asset')
    .map((t) => ({
      code: t[1],
      scale: parseInt(t[2], 10) || 0,
    }));

  const settlement = event.tags
    .filter((t) => t[0] === 'settlement')
    .map((t) => ({
      type: t[1],
      details: t.slice(2),
    }));

  const relays = event.tags.filter((t) => t[0] === 'relay').map((t) => t[1]);

  return {
    pubkey: event.pubkey,
    ilpAddress: ilpTag[1],
    btpEndpoint: btpTag[1],
    assets,
    settlement,
    relays,
    createdAt: event.created_at,
  };
}

/**
 * Parse a kind:10047 event into SpspInfo
 */
export function parseSpspInfo(event: Event): SpspInfo | null {
  if (event.kind !== SPSP_INFO_KIND) {
    return null;
  }

  const destTag = event.tags.find((t) => t[0] === 'destination');
  const secretTag = event.tags.find((t) => t[0] === 'secret');

  if (!destTag || !secretTag) {
    return null;
  }

  const receiptsTag = event.tags.find((t) => t[0] === 'receipts');

  return {
    pubkey: event.pubkey,
    destinationAccount: destTag[1],
    sharedSecret: secretTag[1],
    receiptsEnabled: receiptsTag?.[1] === 'true',
    createdAt: event.created_at,
  };
}

/**
 * Parse a kind:3 (NIP-02) follow list into social relationships
 */
export function parseFollowList(event: Event): SocialRelationship[] {
  if (event.kind !== FOLLOW_LIST_KIND) {
    return [];
  }

  return event.tags
    .filter((t) => t[0] === 'p')
    .map((t) => ({
      from: event.pubkey,
      to: t[1],
      relayHint: t[2] || undefined,
      petname: t[3] || undefined,
    }));
}

/**
 * Extract followed pubkeys from a kind:3 event
 */
export function extractFollowedPubkeys(event: Event): string[] {
  if (event.kind !== FOLLOW_LIST_KIND) {
    return [];
  }

  return event.tags.filter((t) => t[0] === 'p').map((t) => t[1]);
}
