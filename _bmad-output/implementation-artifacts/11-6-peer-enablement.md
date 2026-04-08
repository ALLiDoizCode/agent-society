# Story 11.6: Peer Enablement

Status: ready-for-dev

## Story

As a TOON Protocol operator,
I want the Pet DVM handler registered in the Docker peer entrypoint so that peers can process Kind 5900 pet interaction requests via ILP,
so that the deployed TOON infrastructure can serve pet interactions without code changes at the operator level.

## Dependencies

- **Upstream:** Story 11-5 (Pet DVM Handler) -- provides `createPetDvmHandler` factory. DONE.
- **Upstream:** Story 11-4 (Pet Game Engine) -- provides `PetGameEngine`. DONE.
- **Upstream:** Story 11-1 (napi-rs Memvid Binding) -- provides `PetBrain`. DONE.
- **Shared:** `docker/src/entrypoint-sdk.ts` -- the SDK-based Docker entrypoint where all handlers are registered.
- **Shared:** `docker/src/shared.ts` -- config parsing for Docker entrypoints (needs new env vars).
- **Shared:** `docker/package.json` -- workspace dependencies (needs `@toon-protocol/pet-dvm`).
- **Shared:** `docker-compose-sdk-e2e.yml` -- E2E infrastructure definition (needs pet DVM env vars).
- **Shared:** `packages/core/src/constants.ts` -- `PET_INTERACTION_REQUEST_KIND = 5900` (already defined in Story 11-5).
- **Downstream:** Story 11-7 (Pet DVM E2E Test) -- E2E validation against real infrastructure with pet DVM enabled.

## Acceptance Criteria

1. **AC-1 -- Pet DVM env vars in shared.ts:** Add pet DVM configuration to `docker/src/shared.ts`:
   - `PET_DVM_ENABLED` (string `'true'` / `'false'`, default: `'false'`) -- whether to register the pet DVM handler
   - `PET_BRAIN_STORAGE_PATH` (string, default: `'/data/pet-brains'`) -- directory for `.mv2` brain files
   - `PET_PROOF_BATCH_SIZE` (string of integer, default: `'10'`) -- number of interactions before emitting batch-ready event
   - Add to `Config` interface: `petDvmEnabled: boolean`, `petBrainStoragePath: string`, `petProofBatchSize: number`
   - Add parsing in `parseConfig()` function following the `x402Enabled` pattern (`=== 'true'`, default disabled)
   - `petProofBatchSize` must be a positive integer; throw `Error` with descriptive message if invalid

2. **AC-2 -- Pet DVM handler registration in entrypoint-sdk.ts:** Register `createPetDvmHandler` in `docker/src/entrypoint-sdk.ts` following the **exact same pattern** as the Arweave DVM handler (lines 313-323):
   - Import `createPetDvmHandler` from `@toon-protocol/pet-dvm`
   - Import `PET_INTERACTION_REQUEST_KIND` from `@toon-protocol/core`
   - Guard with `if (config.petDvmEnabled)` (same pattern as `if (config.ardriveEnabled)`)
   - Create the handler: `createPetDvmHandler({ brainStoragePath: config.petBrainStoragePath, proofBatchSize: config.petProofBatchSize, publishEvent: async (event) => { eventStore.store(event as unknown as Parameters<typeof eventStore.store>[0]); wsRelay.broadcastEvent(event as unknown as Parameters<typeof wsRelay.broadcastEvent>[0]); } })`
   - Register: `node.on(PET_INTERACTION_REQUEST_KIND, petDvmHandler)`
   - Log: `console.log('[Setup] Pet DVM handler registered for kind:5900');`
   - The `publishEvent` callback stores in the eventStore AND broadcasts to WebSocket subscribers (same as what the default handler does for incoming events). This ensures optimistic Kind 14919 events are visible to relay subscribers.

3. **AC-3 -- Service discovery integration:** Update the kind:10035 service discovery event construction in `entrypoint-sdk.ts` to advertise Pet DVM capabilities when enabled:
   - Add `PET_INTERACTION_REQUEST_KIND` to `supportedKinds` array
   - Add `'pet-dvm'` to `capabilities` array
   - Add a `petSkill` descriptor to `serviceDiscoveryContent` (separate field from the existing `skill` for backward compatibility):
     ```typescript
     serviceDiscoveryContent.petSkill = { name: 'pet-dvm', version: '0.1', kinds: [PET_INTERACTION_REQUEST_KIND], features: ['pet-interaction', 'proof-queue'], inputSchema: {}, pricing: { [String(PET_INTERACTION_REQUEST_KIND)]: String(config.basePricePerByte) } };
     ```
   - The skill descriptor goes into a separate `petSkill` field (the existing `skill` field is a single object for Arweave DVM; use a separate key for backward compatibility -- see Dev Notes "Service Discovery: Skill Descriptor Pattern")

4. **AC-4 -- Docker package dependency:** Add `@toon-protocol/pet-dvm` as a workspace dependency in `docker/package.json`:
   - `"@toon-protocol/pet-dvm": "workspace:*"`
   - This enables the import in `entrypoint-sdk.ts`

5. **AC-5 -- Docker Compose env vars:** Update `docker-compose-sdk-e2e.yml` to enable Pet DVM on peer1:
   - Add `PET_DVM_ENABLED: 'true'` to peer1 environment
   - Add `PET_BRAIN_STORAGE_PATH: /data/pet-brains` to peer1 environment
   - Add `PET_PROOF_BATCH_SIZE: '5'` to peer1 environment (smaller batch for E2E testing)
   - peer2: Add `PET_DVM_ENABLED: 'false'` (explicit opt-out, or omit to rely on default). Prefer explicit for documentation clarity.
   - Add a comment: `# Pet DVM: enabled on peer1 (pet interaction provider)`

6. **AC-6 -- Brain storage directory creation:** Ensure the brain storage directory exists before the handler processes its first request:
   - In `entrypoint-sdk.ts`, after creating the pet DVM handler and before `node.start()`, call `import { mkdirSync } from 'node:fs'; mkdirSync(config.petBrainStoragePath, { recursive: true });`
   - This prevents the handler from failing on first request because the directory doesn't exist
   - Log: `console.log('[Setup] Pet brain storage directory: ' + config.petBrainStoragePath);`

7. **AC-7 -- Health endpoint pet DVM status:** Add pet DVM status to the `/health` response when enabled:
   - Add `petDvm: { enabled: true, brainStoragePath: config.petBrainStoragePath, proofBatchSize: config.petProofBatchSize }` to the health response object when `config.petDvmEnabled` is true
   - Follow the same conditional spread pattern used by `tee`: `...(config.petDvmEnabled && { petDvm: { enabled: true } })`

8. **AC-8 -- Unit tests for shared.ts pet DVM config parsing:** Add tests to existing Docker test file (or create `docker/src/shared.test.ts` if none exists):
   - Test: `PET_DVM_ENABLED=true` sets `petDvmEnabled: true`
   - Test: `PET_DVM_ENABLED` omitted sets `petDvmEnabled: false` (default)
   - Test: `PET_BRAIN_STORAGE_PATH` custom value parsed correctly
   - Test: `PET_BRAIN_STORAGE_PATH` omitted defaults to `/data/pet-brains`
   - Test: `PET_PROOF_BATCH_SIZE=5` parsed as number 5
   - Test: `PET_PROOF_BATCH_SIZE` omitted defaults to 10
   - Test: `PET_PROOF_BATCH_SIZE=abc` throws descriptive error

9. **AC-9 -- Static analysis test:** Add a static analysis test in `docker/src/entrypoint-sdk-validation.test.ts` (file-content assertion pattern: read source files as strings and assert expected imports/registrations are present):
   - Test: `entrypoint-sdk.ts` imports `createPetDvmHandler` from `@toon-protocol/pet-dvm`
   - Test: `entrypoint-sdk.ts` imports `PET_INTERACTION_REQUEST_KIND` from `@toon-protocol/core`
   - Test: `entrypoint-sdk.ts` contains `node.on(PET_INTERACTION_REQUEST_KIND` or `node.on(5900`
   - Test: `docker-compose-sdk-e2e.yml` contains `PET_DVM_ENABLED`
   - Test: `docker/package.json` contains `@toon-protocol/pet-dvm`

10. **AC-10 -- Build verification:** After all changes:
    - `pnpm build` in `docker/` compiles cleanly (TypeScript + esbuild)
    - `pnpm build` in root monorepo compiles cleanly
    - `pnpm test` in `docker/` passes all tests (existing + new)
    - `pnpm lint` passes in `docker/`

## Tasks / Subtasks

- [ ] Task 1: Add pet DVM config to shared.ts (AC: 1)
  - [ ] 1.1 Add `petDvmEnabled`, `petBrainStoragePath`, `petProofBatchSize` to `Config` interface
  - [ ] 1.2 Add environment variable parsing in `parseConfig()` with defaults and validation
  - [ ] 1.3 Add `petDvmEnabled`, `petBrainStoragePath`, `petProofBatchSize` to return object

- [ ] Task 2: Add @toon-protocol/pet-dvm dependency (AC: 4)
  - [ ] 2.1 Add `"@toon-protocol/pet-dvm": "workspace:*"` to `docker/package.json` dependencies
  - [ ] 2.2 Run `pnpm install` to update lockfile

- [ ] Task 3: Register Pet DVM handler in entrypoint-sdk.ts (AC: 2, 6)
  - [ ] 3.1 Add imports: `createPetDvmHandler` from `@toon-protocol/pet-dvm`, `PET_INTERACTION_REQUEST_KIND` from `@toon-protocol/core`, `mkdirSync` from `node:fs`
  - [ ] 3.2 Add guarded handler registration block after the Arweave DVM block (lines 313-323 pattern)
  - [ ] 3.3 Add brain storage directory creation (`mkdirSync` with `recursive: true`)
  - [ ] 3.4 Create `publishEvent` callback that stores in eventStore AND broadcasts to wsRelay

- [ ] Task 4: Update service discovery for Pet DVM (AC: 3)
  - [ ] 4.1 Add `PET_INTERACTION_REQUEST_KIND` to `supportedKinds` array when pet DVM is enabled
  - [ ] 4.2 Add `'pet-dvm'` to `capabilities` array when pet DVM is enabled
  - [ ] 4.3 Add `petSkill` descriptor to `serviceDiscoveryContent` (separate field from existing `skill`)

- [ ] Task 5: Add pet DVM status to health endpoint (AC: 7)
  - [ ] 5.1 Add conditional `petDvm` field to health response JSON

- [ ] Task 6: Update Docker Compose (AC: 5)
  - [ ] 6.1 Add `PET_DVM_ENABLED`, `PET_BRAIN_STORAGE_PATH`, `PET_PROOF_BATCH_SIZE` to peer1 environment
  - [ ] 6.2 Add `PET_DVM_ENABLED: 'false'` to peer2 environment
  - [ ] 6.3 Add comment explaining pet DVM peer assignment

- [ ] Task 7: Tests (AC: 8, 9)
  - [ ] 7.1 Write shared.ts pet DVM config parsing unit tests
  - [ ] 7.2 Write static analysis tests for entrypoint integration points

- [ ] Task 8: Build and test verification (AC: 10)
  - [ ] 8.1 Run `pnpm build` in `docker/` -- TypeScript + esbuild compiles cleanly
  - [ ] 8.2 Run `pnpm build` in root -- monorepo builds cleanly
  - [ ] 8.3 Run `pnpm test` in `docker/` -- all tests pass
  - [ ] 8.4 Run `pnpm lint` in `docker/` -- passes

## Dev Notes

### Critical: Follow the Arweave DVM Pattern EXACTLY

The Arweave DVM handler registration in `entrypoint-sdk.ts` (lines 313-323) is the canonical reference:

```typescript
// --- Arweave DVM handler (kind:5094) ---
if (config.ardriveEnabled) {
  const chunkManager = new ChunkManager();
  const turboAdapter = new TurboUploadAdapter();
  const arweaveHandler = createArweaveDvmHandler({
    turboAdapter,
    chunkManager,
  });
  node.on(5094, arweaveHandler);
  console.log('[Setup] Arweave DVM handler registered for kind:5094');
}
```

The Pet DVM handler registration MUST follow this same pattern:

```typescript
// --- Pet DVM handler (kind:5900) ---
if (config.petDvmEnabled) {
  mkdirSync(config.petBrainStoragePath, { recursive: true });
  const petDvmHandler = createPetDvmHandler({
    brainStoragePath: config.petBrainStoragePath,
    proofBatchSize: config.petProofBatchSize,
    publishEvent: async (event) => {
      // Store optimistic Kind 14919 events in relay + broadcast to WS subscribers
      eventStore.store(event as any);
      wsRelay.broadcastEvent(event as any);
    },
  });
  node.on(PET_INTERACTION_REQUEST_KIND, petDvmHandler);
  console.log('[Setup] Pet DVM handler registered for kind:5900');
  console.log(`[Setup] Pet brain storage: ${config.petBrainStoragePath}`);
}
```

### publishEvent Callback Design

The `publishEvent` callback in `PetDvmConfig` expects `(event: UnsignedEvent) => Promise<void>`. The entrypoint must bridge this to the eventStore and wsRelay. The `UnsignedEvent` from pet-dvm is a minimal type (`{ kind, created_at, tags, content }`). The eventStore and wsRelay expect full `NostrEvent` (with `id`, `pubkey`, `sig`). Use type assertion (`as any`) since the DVM handler builds the event but the signing happens at a different layer -- for this story, optimistic events are unsigned placeholders. In Story 11-7 (E2E), proper signing will be validated.

**Do NOT use `node.publishEvent()`** for optimistic events. While `node.publishEvent()` exists on `ServiceNode`, it routes events over ILP to a destination peer. Optimistic Kind 14919 events should only be stored locally and broadcast to WebSocket subscribers -- the `eventStore.store()` + `wsRelay.broadcastEvent()` pattern shown above is correct. The events are unsigned placeholders; proper signing is validated in Story 11-7 (E2E).

### Type Compatibility Between pet-dvm and docker

The pet-dvm package uses Jest (different from docker's vitest). The handler types are duplicated locally in pet-dvm to avoid circular dependencies. The Docker entrypoint imports the `createPetDvmHandler` function which returns `(ctx: HandlerContext) => Promise<HandlerResponse>` -- this is structurally compatible with the SDK's handler signature that `node.on()` expects. TypeScript structural typing handles this transparently.

If the compiler complains about `HandlerContext` type mismatch between pet-dvm's local duplicate and SDK's real type, use a type assertion: `node.on(PET_INTERACTION_REQUEST_KIND, petDvmHandler as any)`. Document the reason in a comment.

### Service Discovery: Skill Descriptor Pattern

The current entrypoint builds a single `skill` field for Arweave DVM (line 552 in `entrypoint-sdk.ts`). When Pet DVM is also enabled, there are two DVM skill descriptors.

**Decision: Use `petSkill` field** (option 2 -- additive, no breakage). The existing `skill` field is consumed by SDK E2E tests and client code as a single object. Adding a separate `petSkill` field avoids breaking any existing consumers. A future story can migrate to a `skills` array if needed.

### Config Parsing Pattern in shared.ts

Follow the `x402Enabled` pattern (`=== 'true'`, default disabled). **WARNING:** Do NOT follow `ardriveEnabled` -- it uses `!== 'false'` which means default **enabled**. Pet DVM must default to disabled.

```typescript
// Pet DVM (default: disabled)
const petDvmEnabled = env['PET_DVM_ENABLED'] === 'true';
const petBrainStoragePath = env['PET_BRAIN_STORAGE_PATH'] || '/data/pet-brains';
const petProofBatchSize = parseInt(env['PET_PROOF_BATCH_SIZE'] || '10', 10);
if (isNaN(petProofBatchSize) || petProofBatchSize <= 0) {
  throw new Error(
    `PET_PROOF_BATCH_SIZE must be a positive integer: ${env['PET_PROOF_BATCH_SIZE']}`
  );
}
```

### Docker Compose: Why Peer1 Only

Pet DVM is enabled only on peer1 (the genesis-like node) because:
- peer1 is the "provider" node in E2E tests (cheapest `BASE_PRICE_PER_BYTE: '5'`)
- peer1 already runs Arweave DVM (`ARDRIVE_ENABLED: 'true'`)
- Having exactly one Pet DVM provider simplifies the E2E test flow in Story 11-7
- peer2 can optionally enable it later if needed for multi-provider testing

### No napi-rs Runtime in Docker Image (Yet)

The Docker image (`toon:optimized`) is built from `docker/Dockerfile.oyster` or similar. The `@toon-protocol/memvid-node` package is a napi-rs native addon that requires the Rust-compiled `.node` binary. For this story, the Pet DVM handler will be registered but may fail at runtime if the native binary is not present in the Docker image.

**This is acceptable for Story 11-6.** The purpose of this story is peer enablement (wiring + config + tests). Story 11-7 (E2E) will handle the Docker image build pipeline to include the napi-rs binary. The static analysis tests and config parsing tests in this story do NOT require the native addon at runtime.

### Files to Touch

| File | Change |
|------|--------|
| `docker/src/shared.ts` | Add `petDvmEnabled`, `petBrainStoragePath`, `petProofBatchSize` to Config + parseConfig |
| `docker/src/entrypoint-sdk.ts` | Import pet-dvm + core, register handler, update service discovery, update health |
| `docker/package.json` | Add `@toon-protocol/pet-dvm` dependency |
| `docker-compose-sdk-e2e.yml` | Add `PET_DVM_ENABLED`, `PET_BRAIN_STORAGE_PATH`, `PET_PROOF_BATCH_SIZE` env vars |
| `docker/src/shared.test.ts` (new or extend) | Config parsing tests |
| `docker/src/entrypoint-sdk-validation.test.ts` (new) | Static analysis tests |

### Project Structure Notes

- Alignment with unified project structure: Docker entrypoints live in `docker/src/`, tests alongside source files
- `@toon-protocol/pet-dvm` is a workspace package in `packages/pet-dvm/` -- the workspace dependency is standard
- The handler registration pattern is well-established (Arweave DVM in Epic 8)
- No new packages created; this story only wires existing packages together

### References

- [Source: docker/src/entrypoint-sdk.ts] -- Arweave DVM handler registration pattern (lines 313-323)
- [Source: docker/src/shared.ts] -- Config parsing patterns (ardriveEnabled, x402Enabled)
- [Source: docker/package.json] -- Current workspace dependencies
- [Source: docker-compose-sdk-e2e.yml] -- Peer environment configuration
- [Source: packages/pet-dvm/src/handler/createPetDvmHandler.ts] -- Handler factory function
- [Source: packages/pet-dvm/src/handler/types.ts] -- PetDvmConfig, HandlerContext, HandlerResponse types
- [Source: packages/core/src/constants.ts] -- PET_INTERACTION_REQUEST_KIND = 5900
- [Source: _bmad-output/implementation-artifacts/11-5-pet-dvm-handler.md] -- Previous story with handler implementation details
- [Source: _bmad-output/planning-artifacts/toon-pet-zkapp-architecture-handoff.md] -- Architecture overview
- [Source: _bmad-output/auto-bmad-artifacts/epic-11-start-report.md] -- Epic analysis and dependency graph
- [Source: _bmad-output/planning-artifacts/test-design-epic-11.md] -- Risk R-007 (cross-package type mismatch), R-008 (proof queue persistence)
- [Source: _bmad-output/project-context.md] -- Docker entrypoint patterns, testing standards, dependency rules

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
