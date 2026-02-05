/**
 * Nostr-based Peer Discovery Service
 *
 * Discovers ILP peers by:
 * 1. Reading the agent's NIP-02 follow list
 * 2. Querying kind:10032 events from followed pubkeys
 * 3. Converting to peer configurations for the connector
 */

import { SimplePool, type Filter, type Event } from 'nostr-tools';
import {
  ILP_PEER_INFO_KIND,
  FOLLOW_LIST_KIND,
  parseIlpPeerInfo,
  extractFollowedPubkeys,
  type IlpPeerInfo,
  type PeerConfig,
} from '../events/index.js';

export interface NostrPeerDiscoveryConfig {
  /** Nostr relays to query */
  relays: string[];

  /** Our Nostr public key (hex) */
  pubkey: string;

  /** Optional: existing SimplePool instance */
  pool?: SimplePool;

  /** Timeout for relay queries (ms) */
  queryTimeout?: number;
}

export interface DiscoveredPeer extends IlpPeerInfo {
  /** Whether this peer is in our follow list */
  isFollowed: boolean;

  /** Petname from follow list (if any) */
  petname?: string;
}

/**
 * NostrPeerDiscoveryService discovers ILP peers via Nostr
 */
export class NostrPeerDiscoveryService {
  private readonly pool: SimplePool;
  private readonly relays: string[];
  private readonly pubkey: string;
  private readonly queryTimeout: number;
  private readonly ownPool: boolean;

  private followedPubkeys: Set<string> = new Set();
  private peerInfoCache: Map<string, IlpPeerInfo> = new Map();

  constructor(config: NostrPeerDiscoveryConfig) {
    this.relays = config.relays;
    this.pubkey = config.pubkey;
    this.queryTimeout = config.queryTimeout ?? 10000;

    if (config.pool) {
      this.pool = config.pool;
      this.ownPool = false;
    } else {
      this.pool = new SimplePool();
      this.ownPool = true;
    }
  }

  /**
   * Discover peers from our follow list
   *
   * @returns Array of discovered peers with ILP info
   */
  async discoverPeers(): Promise<DiscoveredPeer[]> {
    // 1. Get our follow list
    await this.refreshFollowList();

    if (this.followedPubkeys.size === 0) {
      return [];
    }

    // 2. Query ILP peer info from followed pubkeys
    const peerInfoEvents = await this.queryEvents({
      kinds: [ILP_PEER_INFO_KIND],
      authors: Array.from(this.followedPubkeys),
    });

    // 3. Parse and cache peer info
    const peers: DiscoveredPeer[] = [];

    for (const event of peerInfoEvents) {
      const peerInfo = parseIlpPeerInfo(event);
      if (peerInfo) {
        this.peerInfoCache.set(peerInfo.pubkey, peerInfo);
        peers.push({
          ...peerInfo,
          isFollowed: true,
        });
      }
    }

    return peers;
  }

  /**
   * Get peer info for a specific pubkey
   */
  async getPeerInfo(pubkey: string): Promise<IlpPeerInfo | null> {
    // Check cache first
    const cached = this.peerInfoCache.get(pubkey);
    if (cached) {
      return cached;
    }

    // Query from relays
    const events = await this.queryEvents({
      kinds: [ILP_PEER_INFO_KIND],
      authors: [pubkey],
    });

    if (events.length === 0) {
      return null;
    }

    // Get most recent event
    const latest = events.reduce((a, b) => (a.created_at > b.created_at ? a : b));
    const peerInfo = parseIlpPeerInfo(latest);

    if (peerInfo) {
      this.peerInfoCache.set(pubkey, peerInfo);
    }

    return peerInfo;
  }

  /**
   * Convert discovered peers to connector peer configs
   *
   * @param trustCalculator - Function to compute credit limit from social data
   */
  async getPeerConfigs(
    trustCalculator?: (pubkey: string, isFollowed: boolean) => bigint
  ): Promise<PeerConfig[]> {
    const peers = await this.discoverPeers();

    const defaultTrust = (pubkey: string, isFollowed: boolean): bigint => {
      // Simple default: followed peers get 1000 units, others get 0
      return isFollowed ? 1000n : 0n;
    };

    const calcTrust = trustCalculator ?? defaultTrust;

    return peers.map((peer) => ({
      pubkey: peer.pubkey,
      ilpAddress: peer.ilpAddress,
      btpEndpoint: peer.btpEndpoint,
      creditLimit: calcTrust(peer.pubkey, peer.isFollowed),
      settlement: peer.settlement[0], // Use first settlement method
    }));
  }

  /**
   * Subscribe to peer info updates
   *
   * @param onUpdate - Callback when a peer's info changes
   * @returns Unsubscribe function
   */
  subscribeToPeerUpdates(onUpdate: (peer: IlpPeerInfo) => void): () => void {
    const filter: Filter = {
      kinds: [ILP_PEER_INFO_KIND],
      authors: Array.from(this.followedPubkeys),
    };

    const sub = this.pool.subscribeMany(
      this.relays,
      filter,
      {
        onevent: (event) => {
          const peerInfo = parseIlpPeerInfo(event);
          if (peerInfo) {
            const existing = this.peerInfoCache.get(peerInfo.pubkey);
            // Only notify if newer than cached
            if (!existing || peerInfo.createdAt > existing.createdAt) {
              this.peerInfoCache.set(peerInfo.pubkey, peerInfo);
              onUpdate(peerInfo);
            }
          }
        },
      }
    );

    return () => sub.close();
  }

  /**
   * Refresh our follow list from relays
   */
  async refreshFollowList(): Promise<string[]> {
    const events = await this.queryEvents({
      kinds: [FOLLOW_LIST_KIND],
      authors: [this.pubkey],
    });

    if (events.length === 0) {
      return [];
    }

    // Get most recent follow list
    const latest = events.reduce((a, b) => (a.created_at > b.created_at ? a : b));
    const pubkeys = extractFollowedPubkeys(latest);

    this.followedPubkeys = new Set(pubkeys);
    return pubkeys;
  }

  /**
   * Check if we follow a pubkey
   */
  isFollowing(pubkey: string): boolean {
    return this.followedPubkeys.has(pubkey);
  }

  /**
   * Get all followed pubkeys
   */
  getFollowedPubkeys(): string[] {
    return Array.from(this.followedPubkeys);
  }

  /**
   * Close the pool if we own it
   */
  close(): void {
    if (this.ownPool) {
      this.pool.close(this.relays);
    }
  }

  /**
   * Query events with timeout
   */
  private async queryEvents(filter: Filter): Promise<Event[]> {
    return new Promise((resolve) => {
      const events: Event[] = [];

      const timeout = setTimeout(() => {
        resolve(events);
      }, this.queryTimeout);

      this.pool.querySync(this.relays, filter).then((results) => {
        clearTimeout(timeout);
        resolve(results);
      });
    });
  }
}
