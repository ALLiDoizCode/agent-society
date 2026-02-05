/**
 * Event builders for Agent Society Protocol
 */

import type { EventTemplate } from 'nostr-tools';
import { ILP_PEER_INFO_KIND, SPSP_INFO_KIND, FOLLOW_LIST_KIND } from './kinds.js';

export interface IlpPeerInfoParams {
  ilpAddress: string;
  btpEndpoint: string;
  assets?: Array<{ code: string; scale: number }>;
  settlement?: Array<{ type: string; details: string[] }>;
  relays?: string[];
}

/**
 * Build a kind:10032 ILP Peer Info event template
 */
export function buildIlpPeerInfoEvent(params: IlpPeerInfoParams): EventTemplate {
  const tags: string[][] = [
    ['ilp', params.ilpAddress],
    ['btp', params.btpEndpoint],
  ];

  if (params.assets) {
    for (const asset of params.assets) {
      tags.push(['asset', asset.code, asset.scale.toString()]);
    }
  }

  if (params.settlement) {
    for (const s of params.settlement) {
      tags.push(['settlement', s.type, ...s.details]);
    }
  }

  if (params.relays) {
    for (const relay of params.relays) {
      tags.push(['relay', relay]);
    }
  }

  return {
    kind: ILP_PEER_INFO_KIND,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: '',
  };
}

export interface SpspInfoParams {
  destinationAccount: string;
  sharedSecret: string;
  receiptsEnabled?: boolean;
}

/**
 * Build a kind:10047 SPSP Info event template
 */
export function buildSpspInfoEvent(params: SpspInfoParams): EventTemplate {
  const tags: string[][] = [
    ['destination', params.destinationAccount],
    ['secret', params.sharedSecret],
  ];

  if (params.receiptsEnabled !== undefined) {
    tags.push(['receipts', params.receiptsEnabled ? 'true' : 'false']);
  }

  return {
    kind: SPSP_INFO_KIND,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: '',
  };
}

export interface FollowParams {
  pubkey: string;
  relayHint?: string;
  petname?: string;
}

/**
 * Build a kind:3 follow list event template
 *
 * Note: This replaces the entire follow list, so include all follows.
 */
export function buildFollowListEvent(follows: FollowParams[]): EventTemplate {
  const tags = follows.map((f) => {
    const tag = ['p', f.pubkey];
    if (f.relayHint) tag.push(f.relayHint);
    else if (f.petname) tag.push(''); // Empty relay hint if petname provided
    if (f.petname) tag.push(f.petname);
    return tag;
  });

  return {
    kind: FOLLOW_LIST_KIND,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: '',
  };
}
