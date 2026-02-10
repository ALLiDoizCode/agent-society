# Epic 4: ILP-Gated Relay

**Goal:** Deliver a reference implementation of a Nostr relay where writes require ILP payment, demonstrating the pay-to-write pattern and providing agents with spam-resistant infrastructure.

## Story 4.1: Basic Nostr Relay (Read Path)

**As a** relay operator,
**I want** a WebSocket server that handles NIP-01 read operations,
**so that** clients can query events without payment.

**Acceptance Criteria:**
1. WebSocket server accepts connections on configurable port
2. Server handles NIP-01 `REQ` messages with subscription filters
3. Server responds with matching events from in-memory store
4. Server sends `EOSE` (end of stored events) after initial results
5. Server handles `CLOSE` messages to terminate subscriptions
6. Unit tests verify REQ/EOSE/CLOSE message handling

## Story 4.2: Event Storage with SQLite

**As a** relay operator,
**I want** events persisted to SQLite,
**so that** events survive relay restarts.

**Acceptance Criteria:**
1. SQLite database created with events table (id, pubkey, kind, content, tags, created_at, sig)
2. Events are stored on successful write
3. REQ queries read from SQLite with proper filtering
4. Replaceable events (kinds 10000-19999) replace previous events from same pubkey
5. Database file location is configurable
6. Unit tests verify persistence and replacement logic

## Story 4.3: TOON Encoding for Events

**As a** library developer,
**I want** utilities to encode/decode Nostr events in TOON format,
**so that** events can be embedded in ILP packets.

**Acceptance Criteria:**
1. `encodeEventToToon(event: NostrEvent): Uint8Array` function implemented
2. `decodeEventFromToon(data: Uint8Array): NostrEvent` function implemented
3. Encoding preserves all event fields including signature
4. Round-trip (encode → decode) produces identical event
5. Unit tests verify encoding/decoding for various event types

## Story 4.4: ILP Payment Verification (BLS Pattern)

**As a** relay operator,
**I want** a Business Logic Server that verifies ILP payments before accepting writes,
**so that** only paid events are stored.

**Acceptance Criteria:**
1. BLS HTTP endpoint accepts ILP STREAM packets
2. BLS extracts TOON-encoded event from packet data
3. BLS verifies payment amount meets pricing requirements
4. BLS returns accept/reject response per ILP STREAM protocol
5. On accept, event is passed to relay for storage
6. Unit tests verify payment verification and accept/reject flows

## Story 4.5: Configurable Pricing Service

**As a** relay operator,
**I want** to configure pricing for event storage,
**so that** I can set sustainable rates for my relay.

**Acceptance Criteria:**
1. `PricingConfig` interface with: `basePricePerByte`, `kindOverrides: Map<number, number>`
2. `PricingService` class calculates price for given event
3. Price = `eventSizeBytes * basePricePerByte` (or kind override if present)
4. Default prices configurable via environment variables or config file
5. Unit tests verify price calculation with various configs

## Story 4.6: Self-Write Bypass

**As an** agent operator,
**I want** my own events stored without payment,
**so that** I don't pay myself to write to my own relay.

**Acceptance Criteria:**
1. Relay configured with owner pubkey
2. Events signed by owner pubkey bypass payment verification
3. Owner events still go through normal validation (valid signature, etc.)
4. Unit tests verify bypass for owner and payment requirement for others

## Story 4.7: Integration Example

**As a** developer,
**I want** a complete example of an agent using the ILP-gated relay,
**so that** I can understand the end-to-end flow.

**Acceptance Criteria:**
1. Example in `packages/examples/ilp-gated-relay-demo`
2. Example includes: agent setup, relay startup, payment flow, event verification
3. README with step-by-step instructions
4. Example uses mocked ILP connector for local testing without real payments
5. Code is well-commented explaining each step
