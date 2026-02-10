# Epic 3: Social Trust Engine

**Goal:** Provide trust score computation from social graph data, enabling agents to derive credit limits from social relationships rather than manual configuration.

## Story 3.1: Social Distance Calculation

**As an** agent developer,
**I want** to calculate social distance between two pubkeys,
**so that** I can use proximity in the social graph as a trust signal.

**Acceptance Criteria:**
1. `SocialTrustManager` class created with constructor accepting relay URLs and optional SimplePool
2. `getSocialDistance(fromPubkey: string, toPubkey: string): Promise<number>` method implemented
3. Returns 1 for direct follows, 2 for follows-of-follows, etc.
4. Returns `Infinity` if no path found within configurable max depth (default 3)
5. Uses BFS algorithm for shortest path discovery
6. Unit tests verify distance calculation for various graph topologies

## Story 3.2: Mutual Followers Count

**As an** agent developer,
**I want** to count mutual followers between two pubkeys,
**so that** I can use shared connections as a trust signal.

**Acceptance Criteria:**
1. `getMutualFollowers(pubkeyA: string, pubkeyB: string): Promise<string[]>` method added
2. Returns array of pubkeys that follow both A and B
3. Method efficiently queries follower lists for both pubkeys
4. Unit tests verify correct intersection calculation

## Story 3.3: Configurable Trust Score Calculator

**As an** agent developer,
**I want** to configure how trust scores are computed from multiple signals,
**so that** I can tune trust derivation for my use case.

**Acceptance Criteria:**
1. `TrustConfig` interface defined with weights for: `socialDistance`, `mutualFollowers`, `reputation`
2. `computeTrustScore(fromPubkey, toPubkey, config?): Promise<TrustScore>` method added
3. `TrustScore` type includes: `score` (0-1), `socialDistance`, `mutualFollowerCount`, `breakdown`
4. Default config provides sensible weights (e.g., distance=0.5, mutuals=0.3, reputation=0.2)
5. Score of 1.0 = maximum trust, 0.0 = no trust
6. Unit tests verify score calculation with various configs and inputs

## Story 3.4: Trust Score to Credit Limit Mapping

**As an** agent developer,
**I want** to map trust scores to ILP credit limits,
**so that** I can automatically configure peer credit based on social trust.

**Acceptance Criteria:**
1. `CreditLimitConfig` interface defined with: `maxCredit`, `minCredit`, `curve` (linear/exponential)
2. `calculateCreditLimit(trustScore: TrustScore, config?): number` function implemented
3. Linear curve: `minCredit + (maxCredit - minCredit) * score`
4. Exponential curve: `minCredit + (maxCredit - minCredit) * score^2`
5. Unit tests verify credit calculations for various scores and configs
