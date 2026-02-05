/**
 * SPSP Server over Nostr
 *
 * Handles incoming SPSP requests via Nostr events.
 * Publishes static SPSP info and responds to dynamic requests.
 */

import {
  SimplePool,
  type Event,
  type Filter,
  finalizeEvent,
  type EventTemplate,
  getPublicKey,
} from 'nostr-tools';
import * as nip44 from 'nostr-tools/nip44';
import {
  SPSP_INFO_KIND,
  SPSP_REQUEST_KIND,
  SPSP_RESPONSE_KIND,
  buildSpspInfoEvent,
  type SpspRequest,
  type SpspResponse,
} from '../events/index.js';

export interface SpspServerConfig {
  /** Nostr relays */
  relays: string[];

  /** Our secret key (hex) */
  secretKey: Uint8Array;

  /** ILP destination account */
  destinationAccount: string;

  /** Optional: existing SimplePool */
  pool?: SimplePool;

  /** Whether to enable STREAM receipts */
  receiptsEnabled?: boolean;
}

export type SharedSecretGenerator = () => string;

/**
 * NostrSpspServer handles SPSP parameter serving via Nostr
 */
export class NostrSpspServer {
  private readonly pool: SimplePool;
  private readonly relays: string[];
  private readonly secretKey: Uint8Array;
  private readonly pubkey: string;
  private readonly destinationAccount: string;
  private readonly receiptsEnabled: boolean;
  private readonly ownPool: boolean;

  private subscription: { close: () => void } | null = null;
  private secretGenerator: SharedSecretGenerator;

  constructor(config: SpspServerConfig) {
    this.relays = config.relays;
    this.secretKey = config.secretKey;
    this.pubkey = getPublicKey(config.secretKey);
    this.destinationAccount = config.destinationAccount;
    this.receiptsEnabled = config.receiptsEnabled ?? false;

    if (config.pool) {
      this.pool = config.pool;
      this.ownPool = false;
    } else {
      this.pool = new SimplePool();
      this.ownPool = true;
    }

    // Default secret generator - random 32 bytes base64
    this.secretGenerator = () => {
      const bytes = new Uint8Array(32);
      crypto.getRandomValues(bytes);
      return btoa(String.fromCharCode(...bytes));
    };
  }

  /**
   * Set custom shared secret generator
   */
  setSecretGenerator(generator: SharedSecretGenerator): void {
    this.secretGenerator = generator;
  }

  /**
   * Publish static SPSP info (kind:10047)
   *
   * Use for long-lived payment endpoints where the shared secret
   * doesn't need to change per payment.
   */
  async publishStaticSpspInfo(sharedSecret: string): Promise<void> {
    const eventTemplate = buildSpspInfoEvent({
      destinationAccount: this.destinationAccount,
      sharedSecret,
      receiptsEnabled: this.receiptsEnabled,
    });

    const signedEvent = finalizeEvent(eventTemplate, this.secretKey);
    await this.pool.publish(this.relays, signedEvent);
  }

  /**
   * Start listening for SPSP requests (kind:23194)
   *
   * Automatically responds with fresh SPSP parameters.
   */
  startListening(): void {
    if (this.subscription) {
      return; // Already listening
    }

    const filter: Filter = {
      kinds: [SPSP_REQUEST_KIND],
      '#p': [this.pubkey],
    };

    this.subscription = this.pool.subscribeMany(
      this.relays,
      filter,
      {
        onevent: (event: Event) => {
          this.handleRequest(event).catch((err) => {
            console.error('Failed to handle SPSP request:', err);
          });
        },
      }
    );
  }

  /**
   * Stop listening for requests
   */
  stopListening(): void {
    if (this.subscription) {
      this.subscription.close();
      this.subscription = null;
    }
  }

  /**
   * Handle incoming SPSP request
   */
  private async handleRequest(event: Event): Promise<void> {
    try {
      // Decrypt request
      const conversationKey = nip44.getConversationKey(this.secretKey, event.pubkey);
      const decrypted = nip44.decrypt(event.content, conversationKey);
      const request = JSON.parse(decrypted) as SpspRequest;

      if (request.method !== 'spsp_setup') {
        await this.sendErrorResponse(event, 'UNKNOWN_METHOD', 'Unknown method');
        return;
      }

      // Generate fresh shared secret
      const sharedSecret = this.secretGenerator();

      // Build response
      const response: SpspResponse = {
        result_type: 'spsp_setup',
        result: {
          destination_account: this.destinationAccount,
          shared_secret: sharedSecret,
          receipts_enabled: this.receiptsEnabled,
        },
      };

      await this.sendResponse(event, response);
    } catch (err) {
      await this.sendErrorResponse(
        event,
        'INTERNAL_ERROR',
        err instanceof Error ? err.message : 'Unknown error'
      );
    }
  }

  /**
   * Send SPSP response
   */
  private async sendResponse(requestEvent: Event, response: SpspResponse): Promise<void> {
    const conversationKey = nip44.getConversationKey(this.secretKey, requestEvent.pubkey);
    const encryptedContent = nip44.encrypt(JSON.stringify(response), conversationKey);

    const eventTemplate: EventTemplate = {
      kind: SPSP_RESPONSE_KIND,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ['p', requestEvent.pubkey],
        ['e', requestEvent.id],
      ],
      content: encryptedContent,
    };

    const signedEvent = finalizeEvent(eventTemplate, this.secretKey);
    await this.pool.publish(this.relays, signedEvent);
  }

  /**
   * Send error response
   */
  private async sendErrorResponse(
    requestEvent: Event,
    code: string,
    message: string
  ): Promise<void> {
    const response: SpspResponse = {
      result_type: 'spsp_setup',
      error: { code, message },
    };

    await this.sendResponse(requestEvent, response);
  }

  /**
   * Close the pool if we own it
   */
  close(): void {
    this.stopListening();
    if (this.ownPool) {
      this.pool.close(this.relays);
    }
  }
}
