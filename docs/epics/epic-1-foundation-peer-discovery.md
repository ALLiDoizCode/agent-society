# Epic 1: Foundation & Peer Discovery

**Goal:** Establish the project structure, build tooling, and core infrastructure, then deliver the ability to discover ILP peers from a Nostr follow list. This epic provides the foundational capability that all other features build upon.

## Story 1.1: Project Setup and Build Infrastructure

**As a** developer,
**I want** a properly configured TypeScript monorepo with build, test, and lint tooling,
**so that** I can develop, test, and publish the library packages.

**Acceptance Criteria:**
1. Monorepo structure created with `packages/core`, `packages/relay`, `packages/examples` directories
2. TypeScript configured with strict mode in root `tsconfig.json` with package-level extensions
3. Vitest configured for unit testing with coverage reporting
4. ESLint and Prettier configured for code quality
5. Package.json files configured for ESM output with proper exports
6. `npm run build` successfully compiles all packages
7. `npm run test` successfully runs (empty test suites pass)
8. `npm run lint` successfully validates code style

## Story 1.2: Event Kind Constants and Type Definitions

**As a** library consumer,
**I want** TypeScript types and constants for all ILP-related Nostr event kinds,
**so that** I can work with strongly-typed event data.

**Acceptance Criteria:**
1. Constants exported for event kinds: `ILP_PEER_INFO = 10032`, `SPSP_INFO = 10047`, `SPSP_REQUEST = 23194`, `SPSP_RESPONSE = 23195`
2. TypeScript interface `IlpPeerInfo` defined with fields: `ilpAddress`, `btpEndpoint`, `settlementEngine`, `assetCode`, `assetScale`
3. TypeScript interface `SpspInfo` defined with fields: `destinationAccount`, `sharedSecret`
4. TypeScript interface `SpspRequest` defined for dynamic SPSP requests
5. TypeScript interface `SpspResponse` defined for dynamic SPSP responses
6. All interfaces exported from `@agent-society/core`
7. Unit tests verify type exports are accessible

## Story 1.3: Event Parser and Builder Utilities

**As a** library consumer,
**I want** utilities to parse Nostr events into typed objects and build events from typed data,
**so that** I don't have to manually handle event serialization.

**Acceptance Criteria:**
1. `parseIlpPeerInfo(event: NostrEvent): IlpPeerInfo` parses kind:10032 events
2. `buildIlpPeerInfoEvent(info: IlpPeerInfo, secretKey): NostrEvent` creates signed kind:10032 events
3. `parseSpspInfo(event: NostrEvent): SpspInfo` parses kind:10047 events
4. `buildSpspInfoEvent(info: SpspInfo, secretKey): NostrEvent` creates signed kind:10047 events
5. Parsers throw descriptive errors for malformed events
6. Unit tests cover valid parsing, error cases, and round-trip (build → parse)

## Story 1.4: NIP-02 Follow List Discovery

**As an** agent developer,
**I want** to retrieve the list of pubkeys an agent follows,
**so that** I can identify potential ILP peers.

**Acceptance Criteria:**
1. `NostrPeerDiscovery` class created with constructor accepting relay URLs and optional SimplePool
2. `getFollows(pubkey: string): Promise<string[]>` method queries kind:3 events and returns followed pubkeys
3. Method queries multiple relays and deduplicates results
4. Method handles relay failures gracefully (continues with available relays)
5. Unit tests with mocked SimplePool verify correct filter construction and response parsing
6. Unit tests verify graceful handling of missing/empty follow lists

## Story 1.5: ILP Peer Info Discovery

**As an** agent developer,
**I want** to discover ILP connection info for peers in my follow list,
**so that** I can configure peering relationships.

**Acceptance Criteria:**
1. `discoverPeers(pubkey: string): Promise<Map<string, IlpPeerInfo>>` method added to `NostrPeerDiscovery`
2. Method retrieves follow list, then queries kind:10032 events for each followed pubkey
3. Returns Map of pubkey → IlpPeerInfo for peers with published ILP info
4. Peers without kind:10032 events are silently excluded from results
5. Method completes within 5 seconds for 100 follows (mocked test)
6. Unit tests verify correct aggregation of follow list and peer info queries

## Story 1.6: Peer Update Subscriptions

**As an** agent developer,
**I want** to subscribe to updates when peers change their ILP info,
**so that** my routing table stays current.

**Acceptance Criteria:**
1. `subscribeToPeerUpdates(pubkey: string, callback: (pubkey, info) => void): Subscription` method added
2. Subscription receives callbacks when kind:10032 events are published by followed pubkeys
3. `Subscription` object has `unsubscribe()` method to stop receiving updates
4. Callback receives parsed `IlpPeerInfo` (not raw events)
5. Unit tests verify subscription lifecycle and callback invocation
