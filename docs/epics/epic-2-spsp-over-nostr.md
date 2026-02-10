# Epic 2: SPSP Over Nostr

**Goal:** Enable agents to exchange SPSP parameters over Nostr, supporting both static (published) parameters and dynamic (request/response) handshakes with encryption. This eliminates the need for HTTPS infrastructure.

## Story 2.1: Static SPSP Info Query

**As an** agent developer,
**I want** to query a peer's published SPSP parameters,
**so that** I can set up payments without a request/response handshake.

**Acceptance Criteria:**
1. `NostrSpspClient` class created with constructor accepting relay URLs and optional SimplePool
2. `getSpspInfo(pubkey: string): Promise<SpspInfo | null>` method queries kind:10047 events
3. Returns parsed SpspInfo or null if peer has no published SPSP info
4. Method queries multiple relays and returns most recent event (by created_at)
5. Unit tests verify query construction, parsing, and null handling

## Story 2.2: Static SPSP Info Publishing

**As an** agent developer,
**I want** to publish my SPSP parameters to Nostr,
**so that** peers can discover my payment endpoint.

**Acceptance Criteria:**
1. `NostrSpspServer` class created with constructor accepting relay URLs, keypair, and optional SimplePool
2. `publishSpspInfo(info: SpspInfo): Promise<void>` method publishes kind:10047 replaceable event
3. Event is signed with provided secret key
4. Event is published to all configured relays
5. Method waits for at least one relay confirmation before resolving
6. Unit tests verify event construction and publishing flow

## Story 2.3: Dynamic SPSP Request (Client)

**As an** agent developer,
**I want** to request fresh SPSP parameters from a peer,
**so that** I can get a unique payment destination for my specific payment.

**Acceptance Criteria:**
1. `requestSpspInfo(recipientPubkey: string): Promise<SpspInfo>` method added to `NostrSpspClient`
2. Method generates kind:23194 ephemeral event with NIP-44 encrypted payload
3. Method subscribes for kind:23195 response from recipient
4. Response payload is decrypted and parsed to SpspInfo
5. Method times out after configurable duration (default 10s) with descriptive error
6. Unit tests verify encryption, request/response flow, and timeout handling

## Story 2.4: Dynamic SPSP Request Handler (Server)

**As an** agent developer,
**I want** to handle incoming SPSP requests and respond with fresh parameters,
**so that** I can provide unique payment destinations to requesters.

**Acceptance Criteria:**
1. `handleSpspRequests(generator: () => SpspInfo): Subscription` method added to `NostrSpspServer`
2. Method subscribes to kind:23194 events addressed to the agent's pubkey
3. Incoming requests are decrypted using NIP-44
4. Generator function is called to produce fresh SpspInfo for each request
5. Response is encrypted and published as kind:23195 event
6. Unit tests verify decryption, generator invocation, and response encryption
