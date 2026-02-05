/**
 * Type definitions for Agent Society Protocol events
 */

/**
 * ILP Peer information extracted from a kind:10032 event
 */
export interface IlpPeerInfo {
  /** Nostr public key (hex) */
  pubkey: string;

  /** ILP address prefix */
  ilpAddress: string;

  /** BTP WebSocket endpoint */
  btpEndpoint: string;

  /** Supported assets with scale */
  assets: Array<{
    code: string;
    scale: number;
  }>;

  /** Settlement methods */
  settlement: Array<{
    type: string;
    details: string[];
  }>;

  /** Preferred relays */
  relays: string[];

  /** Event timestamp */
  createdAt: number;
}

/**
 * SPSP parameters (static, from kind:10047)
 */
export interface SpspInfo {
  /** Nostr public key of receiver */
  pubkey: string;

  /** ILP destination account */
  destinationAccount: string;

  /** Base64-encoded shared secret */
  sharedSecret: string;

  /** Whether STREAM receipts are enabled */
  receiptsEnabled: boolean;

  /** Event timestamp */
  createdAt: number;
}

/**
 * SPSP request payload (encrypted content of kind:23194)
 */
export interface SpspRequest {
  method: 'spsp_setup';
  params: {
    receipt_nonce?: string;
    receipt_secret?: string;
  };
}

/**
 * SPSP response payload (encrypted content of kind:23195)
 */
export interface SpspResponse {
  result_type: 'spsp_setup';
  result?: {
    destination_account: string;
    shared_secret: string;
    receipts_enabled: boolean;
  };
  error?: {
    code: string;
    message: string;
  };
}

/**
 * Peer info for connector configuration
 */
export interface PeerConfig {
  /** Nostr public key */
  pubkey: string;

  /** Display name (from NIP-02 petname or NIP-01 metadata) */
  name?: string;

  /** ILP address prefix */
  ilpAddress: string;

  /** BTP endpoint to connect to */
  btpEndpoint: string;

  /** Credit limit (derived from social trust) */
  creditLimit: bigint;

  /** Settlement configuration */
  settlement?: {
    type: string;
    details: string[];
  };
}

/**
 * Social graph relationship
 */
export interface SocialRelationship {
  /** Source pubkey */
  from: string;

  /** Target pubkey */
  to: string;

  /** Petname assigned by 'from' to 'to' */
  petname?: string;

  /** Relay hint for 'to' */
  relayHint?: string;
}
