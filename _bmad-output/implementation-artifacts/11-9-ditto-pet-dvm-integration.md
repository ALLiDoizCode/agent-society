# Story 11.9: Ditto Pet DVM Integration

Status: ready-for-dev
ui_impact: false

## Story

As a ditto (React SPA) developer,
I want client-side utilities to discover Pet DVM providers, build Kind 5900 interaction requests, and parse Kind 6900/14919 results,
so that ditto can interact with TOON pets via ILP-routed DVM requests without embedding any server-side packages (no memvid-node, no pet-circuit, no o1js).

## Dependencies

- **Upstream:** Story 11-5 (Pet DVM Handler) -- `createPetDvmHandler` defines the Kind 5900 request contract and Kind 6900 response format. DONE.
- **Upstream:** Story 11-7 (Pet DVM E2E Test) -- validated the optimistic pipeline end-to-end. DONE.
- **Upstream:** Story 11-4 (Pet Game Engine) -- defines `PetEngineState`, `StatValues`, action types, stage enum. DONE.
- **Shared:** `@toon-protocol/core` -- `PET_INTERACTION_REQUEST_KIND` (5900), `PET_INTERACTION_RESULT_KIND` (6900), `PET_INTERACTION_EVENT_KIND` (14919), `SERVICE_DISCOVERY_KIND` (10035).
- **Shared:** `@toon-protocol/client` -- `ToonClient`, `publishEvent()`, existing ILP routing infrastructure.
- **Downstream:** Story 11-10 (Proof Status UI) -- consumes the event builder and parser created here.

## Acceptance Criteria

1. **AC-1 -- Pet DVM discovery utility:** Create a `filterPetDvmProviders(events: NostrEvent[])` function that:
   - Accepts raw `NostrEvent[]` (kind:10035 events) and internally parses content via `parseServiceDiscovery`
   - Filters events where `content.skill.kinds` includes `5900` (PET_INTERACTION_REQUEST_KIND)
   - Returns provider metadata: `ilpAddress`, `pricing` (per-interaction cost from `skill.pricing['5900']`), `pubkey` (from `event.pubkey`, cryptographically bound), `features` list (from `skill.features`)
   - Handles missing/malformed skill descriptors gracefully (returns empty array, no throw)
   - Sorts results by price ascending (cheapest first) as default

2. **AC-2 -- Kind 5900 event builder:** Create a `buildPetInteractionRequest(params)` function that:
   - Builds a valid Kind 5900 unsigned event with required tags: `['d', blobbiId]`, `['action', String(actionType)]`, `['item', String(itemId)]`, `['cost', String(tokenCost)]`, `['sleeping', String(isSleeping)]` (all tag values stringified per Nostr protocol)
   - Accepts typed params: `{ blobbiId: string, actionType: number, itemId: number, tokenCost: number, isSleeping: boolean }`
   - Returns `UnsignedNostrEvent` (kind, created_at using `Math.floor(Date.now() / 1000)`, tags, content) compatible with `nostr-tools/pure` `finalizeEvent`
   - Validates: actionType 0-10 (ACTION_COUNT), itemId >= 0, tokenCost >= 0, blobbiId non-empty
   - Throws `ValidationError` (from `@toon-protocol/client/errors`) on invalid input (consistent with builder pattern; parsers return null)

3. **AC-3 -- Kind 6900 result parser:** Create a `parsePetInteractionResult(data: string)` function that:
   - Decodes base64 JSON from `IlpSendResult.data` field using browser-safe `atob()` (NOT Node.js `Buffer` -- client package must be browser-compatible for ditto React SPA)
   - Returns typed `PetInteractionResultData`: `{ stats: StatValues, stage: number, cycle: number, lastInteraction: number, brainHash: string, cooldownTimestamps: number[] }` where `StatValues` is locally defined in `types.ts` with fields: `hunger`, `happiness`, `health`, `hygiene`, `energy` (all numbers)
   - Returns `null` for malformed/missing data (no throw)
   - Validates: `brainHash` is 64-char hex, `stats` has all 5 fields, `cycle >= 0`, `stage 0-2`

4. **AC-4 -- Kind 14919 event parser:** Create a `parsePetInteractionEvent(event)` function that:
   - Extracts tags from a Kind 14919 event: `d` (blobbiId), `action`, `item`, `cost`, `cycle`, `stage`, `brain_hash`
   - Detects proof status: `optimistic` (no `proof` tag) vs `proven` (has `proof` + `mina_tx` tags)
   - Returns typed `PetInteractionEventData` including all tag values + `proofStatus: 'optimistic' | 'proven'`
   - Parses `content` as JSON `InteractionResultContent` (locally defined mirror type with priorStats, decayedStats, finalStats -- must NOT import from `@toon-protocol/pet-dvm`)

5. **AC-5 -- Package export:** All utilities exported from a new `@toon-protocol/client/pet` subpath:
   - `filterPetDvmProviders`, `buildPetInteractionRequest`, `parsePetInteractionResult`, `parsePetInteractionEvent`
   - All types exported: `PetDvmProvider`, `PetInteractionRequestParams`, `PetInteractionResultData`, `PetInteractionEventData`
   - No dependency on `@toon-protocol/pet-dvm`, `@toon-protocol/pet-circuit`, `@toon-protocol/memvid-node`, or `o1js`

6. **AC-6 -- Unit tests:** >= 14 unit tests covering:
   - Discovery: valid provider, no-skill provider, malformed content, price sorting
   - Event builder: valid request, invalid actionType, empty blobbiId
   - Result parser: valid base64 response, malformed data, missing fields
   - Event parser: optimistic event, proven event, missing tags
   - Regression: Kind 31124 (existing Blobbi state) rendering unaffected (no imports or changes to existing client code outside the new pet subpath)

7. **AC-7 -- Build verification:** After all changes:
   - `pnpm build` compiles cleanly across all packages
   - `pnpm lint` passes
   - `pnpm test` passes (all existing + new tests)
   - No circular dependency introduced (client must NOT import from pet-dvm)

## Tasks / Subtasks

- [ ] Task 1: Create pet utility module (AC: 1, 2, 3, 4, 5)
  - [ ] 1.1 Create `packages/client/src/pet/types.ts` with all pet-related types
  - [ ] 1.2 Create `packages/client/src/pet/filterPetDvmProviders.ts` (AC-1)
  - [ ] 1.3 Create `packages/client/src/pet/buildPetInteractionRequest.ts` (AC-2)
  - [ ] 1.4 Create `packages/client/src/pet/parsePetInteractionResult.ts` (AC-3)
  - [ ] 1.5 Create `packages/client/src/pet/parsePetInteractionEvent.ts` (AC-4)
  - [ ] 1.6 Create `packages/client/src/pet/index.ts` barrel export
  - [ ] 1.7 Export pet module from `packages/client/src/index.ts`

- [ ] Task 2: Write unit tests (AC: 6)
  - [ ] 2.1 Create `packages/client/src/pet/filterPetDvmProviders.test.ts`
  - [ ] 2.2 Create `packages/client/src/pet/buildPetInteractionRequest.test.ts`
  - [ ] 2.3 Create `packages/client/src/pet/parsePetInteractionResult.test.ts`
  - [ ] 2.4 Create `packages/client/src/pet/parsePetInteractionEvent.test.ts`

- [ ] Task 3: Build and lint verification (AC: 7)
  - [ ] 3.1 Run `pnpm build` across workspace
  - [ ] 3.2 Run `pnpm lint` across workspace
  - [ ] 3.3 Run `pnpm test` -- all existing + new tests pass
  - [ ] 3.4 Verify no circular dependency: `packages/client` must NOT import from `@toon-protocol/pet-dvm`, `@toon-protocol/pet-circuit`, or `@toon-protocol/memvid-node` (grep imports in `packages/client/src/pet/`)

## Dev Notes

### Critical: Client Package Boundary

Ditto uses ONLY `@toon-protocol/client`. The client package must NOT import from:
- `@toon-protocol/pet-dvm` (server-side, napi-rs dependency)
- `@toon-protocol/pet-circuit` (o1js, heavy ZK prover)
- `@toon-protocol/memvid-node` (napi-rs native addon)

All types in `packages/client/src/pet/types.ts` must be defined locally or imported only from `@toon-protocol/core`.

### Kind Constants (from @toon-protocol/core/constants.ts)

```typescript
PET_INTERACTION_REQUEST_KIND = 5900   // Client -> DVM (Kind 5xxx)
PET_INTERACTION_RESULT_KIND = 6900    // DVM -> Client (Kind 6xxx)
PET_INTERACTION_EVENT_KIND = 14919    // DVM -> Relay (optimistic/proven interaction record)
SERVICE_DISCOVERY_KIND = 10035        // Provider advertisement
```

### Action Types (from pet-circuit/src/constants.ts)

```
0=Feed, 1=Play, 2=Clean, 3=Rest, 4=Warm, 5=Check, 6=Sing, 7=Talk, 8=Medicine, 9=Cruzar, 10=PlayMusic
```
Total: 11 action types (ACTION_COUNT = 11). Validate `0 <= actionType <= 10`.

### Stages

```
0=Egg, 1=Baby, 2=Adult
```
Validate `0 <= stage <= 2`.

### Kind 5900 Tag Contract (from parsePetInteractionRequest.ts)

The DVM handler expects these tags on Kind 5900 events:
- `['d', blobbiId]` -- required, non-empty
- `['action', String(actionType)]` -- required, integer
- `['item', String(itemId)]` -- required, integer
- `['cost', String(tokenCost)]` -- required, number
- `['sleeping', 'true'|'false']` -- required

### DVM Response Payload (from createPetDvmHandler)

The DVM returns base64-encoded JSON in `IlpSendResult.data`:
```typescript
{
  stats: { hunger, happiness, health, hygiene, energy },  // [1, 100]
  stage: number,       // 0-2
  cycle: number,       // >= 0
  lastInteraction: number,  // Unix timestamp
  cooldownTimestamps: number[],  // Per-action-type
  brainHash: string,   // 64-char hex (BLAKE3)
}
```
Decode: `JSON.parse(Buffer.from(data, 'base64').toString())`

For browser (ditto): `JSON.parse(atob(data))` or use a polyfill.

### Kind 14919 Tag Structure (from buildPetInteractionEvent.ts)

Tags on Kind 14919 events:
- `['d', blobbiId]`
- `['action', String(actionType)]`
- `['item', String(itemId)]`
- `['cost', String(tokenCost)]`
- `['cycle', String(cycle)]`
- `['stage', String(stage)]`
- `['brain_hash', brainHash]`
- `['proof', base64Proof]` -- only after batch proof (proven status)
- `['mina_tx', txHash]` -- only after Mina settlement (proven status)

Content: JSON `InteractionResult` (priorStats, decayedStats, finalStats, cycle, stage, tokenCost).

### Service Discovery Filtering (from core/events/service-discovery.ts)

The `ServiceDiscoveryContent` type has an optional `skill?: SkillDescriptor` field. `SkillDescriptor.kinds` is `number[]` of supported DVM kinds. Filter for `kinds.includes(5900)`.

`SkillDescriptor.pricing` is `Record<string, string>` where key is kind number as string. Pet interaction price: `pricing['5900']`.

### Existing Patterns in Client Package

- All source in `packages/client/src/`
- Tests co-located with source (`.test.ts` suffix)
- TypeScript strict mode
- Vitest test framework
- ESM module system with `.js` extension in imports
- Barrel exports through `index.ts` files

### Previous Story Intelligence (11-7)

- E2E test validated: Kind 5900 -> ILP -> DVM -> Kind 14919 pipeline works
- Port 19910 allocated for pet DVM E2E tests
- `waitForPetEvent` helper pattern for Kind 14919 relay queries
- DVM returns base64 JSON in ILP FULFILL data field
- Brain hash is 64-char hex string (256-bit BLAKE3)

### Base64 Decoding for Browser Environments

Ditto is a React SPA running in the browser. Use `atob()` for base64 decoding (available in all modern browsers). Do NOT use Node.js `Buffer` -- the client package must be browser-compatible. If `Buffer` is used elsewhere in client, check for a `toBase64`/`fromBase64` utility in `packages/client/src/utils/binary.ts`.

### Regression Risk: R-016

From test design: "Existing Kind 31124 rendering unchanged after new tag additions." The new pet utilities are additive -- they go in a new `pet/` subdirectory. No existing client files should be modified except `packages/client/src/index.ts` (to add the pet re-export).

### Project Structure Notes

- New files go in `packages/client/src/pet/` -- new subdirectory
- Follows existing pattern: `packages/client/src/channel/`, `packages/client/src/keys/`, `packages/client/src/signing/`
- Barrel export from `packages/client/src/pet/index.ts`
- Re-export from `packages/client/src/index.ts`

### References

- [Source: packages/pet-dvm/src/handler/parsePetInteractionRequest.ts] -- Tag contract for Kind 5900
- [Source: packages/pet-dvm/src/handler/buildPetInteractionEvent.ts] -- Tag structure for Kind 14919
- [Source: packages/pet-dvm/src/handler/types.ts] -- PetInteractionRequest, UnsignedEvent, HandlerResponse types
- [Source: packages/pet-dvm/src/engine/types.ts] -- PetEngineState, StatValues, InteractionResult
- [Source: packages/core/src/constants.ts] -- PET_INTERACTION_REQUEST_KIND, PET_INTERACTION_RESULT_KIND, PET_INTERACTION_EVENT_KIND
- [Source: packages/core/src/events/service-discovery.ts] -- ServiceDiscoveryContent, SkillDescriptor, parsing logic
- [Source: packages/client/src/index.ts] -- Existing client exports pattern
- [Source: packages/client/src/ToonClient.ts] -- publishEvent usage pattern
- [Source: _bmad-output/planning-artifacts/pet-zkapp-integration-architecture.md#8.3] -- Ditto integration requirements
- [Source: _bmad-output/planning-artifacts/test-design-epic-11.md] -- Story 11-9 test strategy, R-016 risk
- [Source: packages/pet-circuit/src/constants.ts] -- ActionType enum, Stage enum, ACTION_COUNT

## Dev Agent Record

### Agent Model Used

{{agent_model_name_version}}

### Debug Log References

### Completion Notes List

### File List

### Change Log
