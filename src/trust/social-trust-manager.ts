/**
 * Social Trust Manager
 *
 * Computes credit limits and trust scores based on Nostr social graph.
 * Uses NIP-02 follow relationships to derive financial trust.
 */

import { SimplePool, type Event } from 'nostr-tools';
import { FOLLOW_LIST_KIND, extractFollowedPubkeys } from '../events/index.js';

export interface TrustConfig {
  /** Base credit for followed peers */
  baseCreditForFollowed: bigint;

  /** Credit multiplier per mutual follower */
  mutualFollowerBonus: bigint;

  /** Maximum bonus from mutual followers */
  maxMutualBonus: bigint;

  /** Credit for peers we don't follow (usually 0) */
  baseCreditForUnfollowed: bigint;

  /** Maximum total credit limit */
  maxCreditLimit: bigint;
}

export interface TrustScore {
  /** The peer's pubkey */
  pubkey: string;

  /** Whether we follow them */
  isFollowed: boolean;

  /** Whether they follow us */
  followsUs: boolean;

  /** Number of mutual followers */
  mutualFollowers: number;

  /** Computed credit limit */
  creditLimit: bigint;

  /** Trust score 0-100 */
  score: number;
}

const DEFAULT_CONFIG: TrustConfig = {
  baseCreditForFollowed: 1000n,
  mutualFollowerBonus: 100n,
  maxMutualBonus: 500n,
  baseCreditForUnfollowed: 0n,
  maxCreditLimit: 10000n,
};

/**
 * SocialTrustManager computes credit limits from social graph data
 */
export class SocialTrustManager {
  private readonly pool: SimplePool;
  private readonly relays: string[];
  private readonly myPubkey: string;
  private readonly config: TrustConfig;

  // Caches
  private myFollows: Set<string> = new Set();
  private myFollowers: Set<string> = new Set();
  private followGraphCache: Map<string, Set<string>> = new Map();

  constructor(
    pool: SimplePool,
    relays: string[],
    myPubkey: string,
    config: Partial<TrustConfig> = {}
  ) {
    this.pool = pool;
    this.relays = relays;
    this.myPubkey = myPubkey;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Initialize by loading our social graph
   */
  async initialize(): Promise<void> {
    await Promise.all([this.loadMyFollows(), this.loadMyFollowers()]);
  }

  /**
   * Compute trust score and credit limit for a peer
   */
  async computeTrust(peerPubkey: string): Promise<TrustScore> {
    // Ensure our data is loaded
    if (this.myFollows.size === 0) {
      await this.loadMyFollows();
    }

    const isFollowed = this.myFollows.has(peerPubkey);
    const followsUs = this.myFollowers.has(peerPubkey);

    // Load peer's follows for mutual calculation
    const peerFollows = await this.getFollows(peerPubkey);
    const mutualFollowers = this.countMutualFollowers(peerFollows);

    // Compute credit limit
    let creditLimit = isFollowed
      ? this.config.baseCreditForFollowed
      : this.config.baseCreditForUnfollowed;

    // Add mutual follower bonus
    const mutualBonus =
      BigInt(mutualFollowers) * this.config.mutualFollowerBonus;
    const cappedBonus =
      mutualBonus > this.config.maxMutualBonus
        ? this.config.maxMutualBonus
        : mutualBonus;

    creditLimit += cappedBonus;

    // Bonus for mutual follow (they follow us back)
    if (followsUs && isFollowed) {
      creditLimit += this.config.baseCreditForFollowed / 2n;
    }

    // Cap at max
    if (creditLimit > this.config.maxCreditLimit) {
      creditLimit = this.config.maxCreditLimit;
    }

    // Compute 0-100 score
    const score = Number((creditLimit * 100n) / this.config.maxCreditLimit);

    return {
      pubkey: peerPubkey,
      isFollowed,
      followsUs,
      mutualFollowers,
      creditLimit,
      score,
    };
  }

  /**
   * Get a trust calculator function for use with NostrPeerDiscoveryService
   */
  getTrustCalculator(): (pubkey: string, isFollowed: boolean) => bigint {
    return (pubkey: string, isFollowed: boolean): bigint => {
      // Synchronous version using cached data
      if (!isFollowed) {
        return this.config.baseCreditForUnfollowed;
      }

      let credit = this.config.baseCreditForFollowed;

      // Check if mutual follow
      if (this.myFollowers.has(pubkey)) {
        credit += this.config.baseCreditForFollowed / 2n;
      }

      // Use cached follow graph for mutual followers
      const peerFollows = this.followGraphCache.get(pubkey);
      if (peerFollows) {
        const mutuals = this.countMutualFollowers(peerFollows);
        const bonus = BigInt(mutuals) * this.config.mutualFollowerBonus;
        credit +=
          bonus > this.config.maxMutualBonus ? this.config.maxMutualBonus : bonus;
      }

      return credit > this.config.maxCreditLimit
        ? this.config.maxCreditLimit
        : credit;
    };
  }

  /**
   * Load our follow list
   */
  private async loadMyFollows(): Promise<void> {
    const follows = await this.getFollows(this.myPubkey);
    this.myFollows = follows;
  }

  /**
   * Load who follows us (expensive - queries all events tagging us)
   */
  private async loadMyFollowers(): Promise<void> {
    const events = await this.pool.querySync(this.relays, {
      kinds: [FOLLOW_LIST_KIND],
      '#p': [this.myPubkey],
    });

    this.myFollowers = new Set(events.map((e) => e.pubkey));
  }

  /**
   * Get follows for a pubkey (cached)
   */
  private async getFollows(pubkey: string): Promise<Set<string>> {
    // Check cache
    const cached = this.followGraphCache.get(pubkey);
    if (cached) {
      return cached;
    }

    // Query
    const events = await this.pool.querySync(this.relays, {
      kinds: [FOLLOW_LIST_KIND],
      authors: [pubkey],
    });

    if (events.length === 0) {
      const empty = new Set<string>();
      this.followGraphCache.set(pubkey, empty);
      return empty;
    }

    // Get most recent
    const latest = events.reduce((a, b) =>
      a.created_at > b.created_at ? a : b
    );
    const follows = new Set(extractFollowedPubkeys(latest));

    this.followGraphCache.set(pubkey, follows);
    return follows;
  }

  /**
   * Count mutual followers (people we both follow)
   */
  private countMutualFollowers(peerFollows: Set<string>): number {
    let count = 0;
    for (const pubkey of peerFollows) {
      if (this.myFollows.has(pubkey)) {
        count++;
      }
    }
    return count;
  }

  /**
   * Clear caches (call when social graph may have changed)
   */
  clearCache(): void {
    this.followGraphCache.clear();
    this.myFollows.clear();
    this.myFollowers.clear();
  }
}
