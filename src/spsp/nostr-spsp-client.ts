/**
 * SPSP Client over Nostr
 *
 * Implements SPSP (Simple Payment Setup Protocol) using Nostr events
 * instead of HTTPS. Supports both static SPSP info (kind:10047) and
 * dynamic request/response (kind:23194/23195, NIP-47 style).
 */

import { SimplePool, type Event, type Filter, finalizeEvent, type EventTemplate } from 'nostr-tools';
import * as nip44 from 'nostr-tools/nip44';
import {
  SPSP_INFO_KIND,
  SPSP_REQUEST_KIND,
  SPSP_RESPONSE_KIND,
  parseSpspInfo,
  type SpspInfo,
  type SpspRequest,
  type SpspResponse,
} from '../events/index.js';

export interface SpspParams {
  destinationAccount: string;
  sharedSecret: string;
  receiptsEnabled: boolean;
}

export interface NostrSpspClientConfig {
  /** Nostr relays */
  relays: string[];

  /** Our secret key (hex) for signing and encryption */
  secretKey: Uint8Array;

  /** Optional: existing SimplePool */
  pool?: SimplePool;

  /** Timeout for SPSP requests (ms) */
  requestTimeout?: number;
}

/**
 * NostrSpspClient handles SPSP parameter exchange via Nostr
 */
export class NostrSpspClient {
  private readonly pool: SimplePool;
  private readonly relays: string[];
  private readonly secretKey: Uint8Array;
  private readonly requestTimeout: number;
  private readonly ownPool: boolean;

  // Cache of static SPSP info
  private spspCache: Map<string, SpspInfo> = new Map();

  constructor(config: NostrSpspClientConfig) {
    this.relays = config.relays;
    this.secretKey = config.secretKey;
    this.requestTimeout = config.requestTimeout ?? 30000;

    if (config.pool) {
      this.pool = config.pool;
      this.ownPool = false;
    } else {
      this.pool = new SimplePool();
      this.ownPool = true;
    }
  }

  /**
   * Get SPSP parameters for a receiver (static method)
   *
   * Queries the receiver's kind:10047 event for SPSP info.
   * Use this for receivers with long-lived payment endpoints.
   */
  async getStaticSpspParams(receiverPubkey: string): Promise<SpspParams | null> {
    // Check cache
    const cached = this.spspCache.get(receiverPubkey);
    if (cached) {
      return {
        destinationAccount: cached.destinationAccount,
        sharedSecret: cached.sharedSecret,
        receiptsEnabled: cached.receiptsEnabled,
      };
    }

    // Query for SPSP info
    const events = await this.pool.querySync(this.relays, {
      kinds: [SPSP_INFO_KIND],
      authors: [receiverPubkey],
    });

    if (events.length === 0) {
      return null;
    }

    // Get most recent
    const latest = events.reduce((a, b) => (a.created_at > b.created_at ? a : b));
    const spspInfo = parseSpspInfo(latest);

    if (!spspInfo) {
      return null;
    }

    // Cache it
    this.spspCache.set(receiverPubkey, spspInfo);

    return {
      destinationAccount: spspInfo.destinationAccount,
      sharedSecret: spspInfo.sharedSecret,
      receiptsEnabled: spspInfo.receiptsEnabled,
    };
  }

  /**
   * Request fresh SPSP parameters (dynamic method, NIP-47 style)
   *
   * Sends an encrypted request and waits for encrypted response.
   * Use this when you need a fresh shared secret per payment.
   */
  async requestSpspParams(
    receiverPubkey: string,
    options?: {
      receiptNonce?: string;
      receiptSecret?: string;
    }
  ): Promise<SpspParams> {
    // Build request payload
    const request: SpspRequest = {
      method: 'spsp_setup',
      params: {
        receipt_nonce: options?.receiptNonce,
        receipt_secret: options?.receiptSecret,
      },
    };

    // Encrypt with NIP-44
    const conversationKey = nip44.getConversationKey(this.secretKey, receiverPubkey);
    const encryptedContent = nip44.encrypt(JSON.stringify(request), conversationKey);

    // Build and sign event
    const eventTemplate: EventTemplate = {
      kind: SPSP_REQUEST_KIND,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['p', receiverPubkey]],
      content: encryptedContent,
    };

    const signedEvent = finalizeEvent(eventTemplate, this.secretKey);

    // Subscribe for response before publishing request
    const responsePromise = this.waitForResponse(receiverPubkey, signedEvent.id);

    // Publish request
    await this.pool.publish(this.relays, signedEvent);

    // Wait for response
    const response = await responsePromise;

    if (response.error) {
      throw new Error(`SPSP request failed: ${response.error.code} - ${response.error.message}`);
    }

    if (!response.result) {
      throw new Error('SPSP response missing result');
    }

    return {
      destinationAccount: response.result.destination_account,
      sharedSecret: response.result.shared_secret,
      receiptsEnabled: response.result.receipts_enabled,
    };
  }

  /**
   * Wait for SPSP response
   */
  private async waitForResponse(
    fromPubkey: string,
    requestId: string
  ): Promise<SpspResponse> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        sub.close();
        reject(new Error('SPSP request timeout'));
      }, this.requestTimeout);

      const filter: Filter = {
        kinds: [SPSP_RESPONSE_KIND],
        authors: [fromPubkey],
        '#e': [requestId],
      };

      const sub = this.pool.subscribeMany(
        this.relays,
        filter,
        {
          onevent: (event: Event) => {
            clearTimeout(timeout);
            sub.close();

            try {
              // Decrypt response
              const conversationKey = nip44.getConversationKey(
                this.secretKey,
                fromPubkey
              );
              const decrypted = nip44.decrypt(event.content, conversationKey);
              const response = JSON.parse(decrypted) as SpspResponse;
              resolve(response);
            } catch (err) {
              reject(new Error(`Failed to decrypt SPSP response: ${err}`));
            }
          },
        }
      );
    });
  }

  /**
   * Clear the SPSP cache
   */
  clearCache(): void {
    this.spspCache.clear();
  }

  /**
   * Close the pool if we own it
   */
  close(): void {
    if (this.ownPool) {
      this.pool.close(this.relays);
    }
  }
}
