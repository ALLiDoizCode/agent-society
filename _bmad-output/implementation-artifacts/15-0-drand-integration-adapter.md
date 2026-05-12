# Story 15.0: drand Integration + Session Randomness Adapter

Status: ready-for-dev

## Story

As a Loony harness developer,
I want a verified drand quicknet beacon adapter that fetches and validates threshold-BLS randomness and converts it to an o1js-compatible Field value,
so that story 15.7 (SessionRegistry zkApp) has a trustless, unbiasable entropy source for its VRF seed that is 30× faster and bias-free compared to Mina's block hash.

## Acceptance Criteria

1. **AC-15.0-1:** `getBeacon()` returns a `DrandBeacon` with `round > 0`, non-empty 64-char hex `randomness`, and non-empty 96-char hex `signature`
2. **AC-15.0-2:** `verifyBeacon(beacon)` returns `true` for a real quicknet beacon fetched from the live API; returns `false` for a beacon with a tampered `randomness` field (where `randomness !== sha256(signature)`)
3. **AC-15.0-3:** `getBeacon(specificRound)` returns the beacon for exactly that round number — `result.round === specificRound`
4. **AC-15.0-4:** `toField(randomness)` returns a `bigint` value strictly less than Mina's field modulus (`2n ** 254n + 45560315531506369815346746415080538113n`); output is deterministic for the same hex input
5. **AC-15.0-5:** Network failure triggers up to 3 retry attempts with 1s backoff; after 3 failures throws `DrandError` (not a raw fetch Error)
6. **AC-15.0-6:** A pinned real quicknet beacon (round + signature from the live chain) verifies correctly against the hardcoded group public key — proves the key is correct and the verification logic is sound

## Tasks / Subtasks

- [ ] Scaffold `packages/loony` package (AC: all)
  - [ ] Create `packages/loony/package.json` — name `@toon-protocol/loony`, ESM-only, tsup build, vitest
  - [ ] Create `packages/loony/tsconfig.json` — extends root, `"type": "module"`, bundler resolution
  - [ ] Create `packages/loony/vitest.config.ts` — standard vitest config matching sibling packages
  - [ ] Add `packages/loony` to root pnpm workspace (`pnpm-workspace.yaml`)
  - [ ] Verify `pnpm install` resolves without errors

- [ ] Implement `DrandAdapter` (AC: 1, 2, 3, 5)
  - [ ] Create `packages/loony/src/drand-adapter.ts`
  - [ ] Define `DrandBeacon` interface and `DrandError` class
  - [ ] Implement `getBeacon(round?: number)` with fetch + retry logic
  - [ ] Implement `verifyBeacon(beacon)` using `sha256(signature) === randomness` fast-path check

- [ ] Implement `toField` conversion (AC: 4)
  - [ ] Implement `toField(randomness: string): bigint` — truncate to 62 hex chars, convert to BigInt, assert < field modulus
  - [ ] Export the Mina field modulus constant for downstream use

- [ ] Write tests (AC: 1–6)
  - [ ] `packages/loony/src/drand-adapter.test.ts`
  - [ ] Unit test: mock fetch — happy path returns correct shape (AC-1)
  - [ ] Unit test: `verifyBeacon` rejects tampered randomness (AC-2)
  - [ ] Unit test: `getBeacon(round)` passes round number in URL (AC-3)
  - [ ] Unit test: `toField` output < field modulus, deterministic (AC-4)
  - [ ] Unit test: 3 retries then `DrandError` (AC-5)
  - [ ] Integration test (pinned): real beacon round + real signature verifies against hardcoded key (AC-6) — gate with `RUN_DRAND_INTEGRATION=true` env var; include a comment `// Gate: RUN_DRAND_INTEGRATION=true. Run before marking story done.`

## Dev Notes

### Why This Story Exists First

Story 15.7 (Mina zkApp SessionRegistry) needs `DrandAdapter.toField(beacon.randomness)` as the `Provable.witness` Field input to `openSession()`. This adapter must exist and be verified before 15.7 starts. It has zero TOON dependencies — it is the fastest, safest story to build in Phase 0.

drand quicknet is the VRF entropy source because it is genuinely unbiasable (threshold BLS — deterministic, no last-revealer attack), runs 3-second rounds vs 90-second Mina slots, and is already used by Filecoin for leader election in production. [Source: research/technical-mina-vrf-vs-alternatives-decentralized-harness-loop-research-2026-05-12.md]

### Package Scaffolding — CRITICAL

`packages/loony` does not exist yet. This story creates the minimal scaffold. Story 15.1 fills in the agent-level bootstrap (`createLoonyAgent` etc.) on top.

The package MUST follow the ESM-only monorepo pattern. Key requirements from `project-context.md`:
- `"type": "module"` in package.json
- `moduleResolution: "bundler"` in tsconfig
- `tsup` for build (ESM + dts + sourcemaps)
- `vitest` for tests (NOT Jest — this package has no o1js deps)
- Leaf node: imports only `@noble/curves` (transitive, no install needed) — NEVER imports `@toon-protocol/core`, `@toon-protocol/bls`, etc.

### drand quicknet API

```
Base URL:  https://api.drand.sh/52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971
Latest:    {base}/public/latest
By round:  {base}/public/{round}
Chain info: {base}/info  ← fetch this once to extract/verify the group public key
```

Response shape:
```ts
interface DrandBeacon {
  round: number           // monotonically increasing
  randomness: string      // 64-char hex = sha256(signature)
  signature: string       // 96-char hex — 48-byte G1 BLS point (quicknet uses G1 sigs)
}
```

Chain info shape (for key extraction):
```json
{
  "public_key": "<192-char hex — 96-byte G2 BLS point>",
  "period": 3,
  "genesis_time": 1692803367,
  "hash": "52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971",
  "groupHash": "...",
  "schemeID": "bls-unchained-g1-rfc9380",
  "metadata": {"beaconID": "quicknet"}
}
```

**Hardcode the group public key** — fetch it ONCE from the info endpoint during development, paste it as a constant. Never trust the server to provide it at runtime.

### Beacon Verification — Correct Approach

drand quicknet uses **unchained mode** with **G1 signatures** (signatures are 48-byte G1 points; public key is 96-byte G2 point). This is the "short signature" scheme in noble/curves terminology.

The `randomness` field is just `sha256(signature)` — a simple hash, not a separate BLS value. Verification has two steps:

**Step 1 — Fast-path integrity check (always run):**
```ts
import { sha256 } from '@noble/hashes/sha256'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils'

const sigBytes = hexToBytes(beacon.signature)
const expectedRandomness = bytesToHex(sha256(sigBytes))
if (expectedRandomness !== beacon.randomness) return false  // tampered
```

**Step 2 — BLS signature verification (run for untrusted sources):**
```ts
import { bls12_381 as bls } from '@noble/curves/bls12-381'

// quicknet message = sha256(round_as_8_byte_big_endian)
const roundBuf = new Uint8Array(8)
new DataView(roundBuf.buffer).setBigUint64(0, BigInt(beacon.round), false)  // big-endian
const msg = sha256(roundBuf)

// verifyShortSignature: sig is G1 (48 bytes), pubkey is G2 (96 bytes)
const valid = await bls.verifyShortSignature(
  hexToBytes(beacon.signature),
  msg,
  hexToBytes(QUICKNET_PUBLIC_KEY)  // hardcoded 96-byte G2 hex
)
```

**Note on @noble/curves version:** The root workspace has `@noble/curves@1.9.7` (installed as a transitive dep of nostr-tools). The `bls12-381.js` module is present at `/node_modules/@noble/curves/bls12-381.js`. **Do NOT add `@noble/curves` to `packages/loony/package.json` dependencies** — it is already hoisted to the root. Import it directly: `import { bls12_381 } from '@noble/curves/bls12-381'`.

Also needed: `@noble/hashes/sha256` and `@noble/hashes/utils` — similarly already hoisted via nostr-tools `@noble/hashes@2.0.1`.

### toField Conversion

The drand `randomness` is a 32-byte (64 hex char) value. The Mina field modulus is:
```
p = 2^254 + 45560315531506369815346746415080538113n
  = 28948022309329048855892746252171976963363056475044522677612243764558120899501n
```

Safe conversion:
```ts
const MINA_FIELD_MODULUS = 28948022309329048855892746252171976963363056475044522677612243764558120899501n

export function toField(randomness: string): bigint {
  // Take first 62 hex chars (31 bytes = 248 bits) — safely below the 254-bit field modulus
  const value = BigInt('0x' + randomness.slice(0, 62))
  if (value >= MINA_FIELD_MODULUS) throw new Error('Field overflow — should not happen with 62-char truncation')
  return value
}
```

31 bytes = 248 bits. The Mina field modulus is ~254 bits. A 248-bit value is always below it — the overflow check is a safety assertion, not a real branch.

### Retry Logic

```ts
async function fetchWithRetry(url: string, maxAttempts = 3, delayMs = 1000): Promise<Response> {
  let lastError: unknown
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res
    } catch (err) {
      lastError = err
      if (attempt < maxAttempts - 1) await new Promise(r => setTimeout(r, delayMs))
    }
  }
  throw new DrandError(`Failed after ${maxAttempts} attempts`, { cause: lastError })
}
```

Use `AbortSignal.timeout(5000)` — available in Node.js >=20 (project requires >=20). Do not add `node-fetch` or `axios`.

### Complete Interface

```ts
// packages/loony/src/drand-adapter.ts

export class DrandError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'DrandError'
  }
}

export interface DrandBeacon {
  round: number
  randomness: string   // 64-char hex = sha256(signature)
  signature: string    // 96-char hex = 48-byte G1 BLS point
}

export const QUICKNET_CHAIN_HASH = '52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971'
export const QUICKNET_BASE_URL = `https://api.drand.sh/${QUICKNET_CHAIN_HASH}`

// Hardcode this from: GET https://api.drand.sh/{QUICKNET_CHAIN_HASH}/info → .public_key
// 192-char hex (96-byte G2 point)
export const QUICKNET_PUBLIC_KEY = '<fetch from info endpoint during implementation>'

export const MINA_FIELD_MODULUS = 28948022309329048855892746252171976963363056475044522677612243764558120899501n

export class DrandAdapter {
  async getBeacon(round?: number): Promise<DrandBeacon>
  async verifyBeacon(beacon: DrandBeacon): Promise<boolean>
  toField(randomness: string): bigint
}
```

### Files to Create

| File | Action | Notes |
|---|---|---|
| `packages/loony/package.json` | CREATE | name: `@toon-protocol/loony`; ESM-only; tsup; vitest |
| `packages/loony/tsconfig.json` | CREATE | extend root; bundler resolution |
| `packages/loony/vitest.config.ts` | CREATE | standard pattern |
| `packages/loony/src/drand-adapter.ts` | CREATE | main implementation |
| `packages/loony/src/drand-adapter.test.ts` | CREATE | unit + integration tests |
| `packages/loony/src/index.ts` | CREATE | re-export `DrandAdapter`, `DrandBeacon`, `DrandError`, `toField`, constants |
| `pnpm-workspace.yaml` | UPDATE | add `packages/loony` to workspace |

### Package.json Template

```json
{
  "name": "@toon-protocol/loony",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  },
  "scripts": {
    "build": "tsup src/index.ts --format esm --dts --sourcemap",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "devDependencies": {
    "tsup": "workspace:*",
    "typescript": "workspace:*",
    "vitest": "workspace:*"
  }
}
```

Note: No runtime `dependencies` field needed — `@noble/curves` and `@noble/hashes` are hoisted to the monorepo root via nostr-tools. If `pnpm install` cannot resolve them as peer deps, add them as `peerDependencies` and note they are satisfied by the monorepo root.

### Testing Pattern

Match the existing vitest pattern from any `packages/sdk` or `packages/core` test file. Tests use `.test.ts` extension, vitest globals (`describe`, `it`, `expect`, `vi`), and `vi.spyOn` / `vi.fn()` for mocking `fetch`.

For the pinned integration test, use a real beacon value fetched during development. Pin the `round`, `randomness`, and `signature` as constants in the test. Gate with:
```ts
const RUN_DRAND_INTEGRATION = process.env.RUN_DRAND_INTEGRATION === 'true'
describe.skipIf(!RUN_DRAND_INTEGRATION)('drand integration', () => { ... })
// Gate: RUN_DRAND_INTEGRATION=true. Run before marking story done.
```

### Key Constraints from project-context.md

- ESM-only — all imports use `.js` extension in compiled output (tsup handles this)
- `strict: true`, `noUncheckedIndexedAccess: true`, `noImplicitOverride: true`
- `moduleResolution: "bundler"` — no need for `.js` extension in TypeScript source imports
- Tests use vitest (NOT Jest) — this package has no o1js
- Do NOT run `pnpm test` at workspace root — use `pnpm --filter @toon-protocol/loony test`
- Sub-agent Bash commands must set `timeout: 60000` for builds, `120000` for tests

### References

- Story spec: [Source: _bmad-output/planning-artifacts/epic-15-loony-decentralized-harness.md#Story 15.0]
- OS model decision: [Source: _bmad-output/planning-artifacts/epic-15-loony-decentralized-harness.md#Summary]
- drand research: [Source: _bmad-output/planning-artifacts/research/technical-mina-vrf-vs-alternatives-decentralized-harness-loop-research-2026-05-12.md#Section 3.1]
- ESM/tsup conventions: [Source: _bmad-output/project-context.md#Technology Stack & Versions]
- Package boundary rules: [Source: _bmad-output/project-context.md#Boundary Rules]
- @noble/curves available: `/node_modules/@noble/curves/bls12-381.js` (v1.9.7, hoisted from nostr-tools)
- @noble/hashes available: `/node_modules/@noble/hashes/` (v2.0.1, hoisted from nostr-tools)
- drand quicknet API: https://api.drand.sh/52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971/info
- drand quicknet docs: https://docs.drand.love/

## Dev Agent Record

### Agent Model Used

_to be filled by dev agent_

### Debug Log References

### Completion Notes List

### File List

### Review Findings

_Code review required before closing this story. Replace this line with a dated entry: `Code review YYYY-MM-DD — [findings or "no issues found"]`_

## Story Close-Out Checklist

- [ ] Verify `### Review Findings` contains a dated entry — do NOT flip sprint-status to `done` with a blank or "Pending review" section
- [ ] Does this story contain regex or template substitution logic? If yes, at least one unit test must use a realistic real-world input string (actual drand API response, actual hex values from live chain)
- [ ] Are any tests gated by `skipIf`, `describe.skip`, or a `RUN_*` env var? If yes: the pinned integration test MUST be run with `RUN_DRAND_INTEGRATION=true pnpm --filter @toon-protocol/loony test` before marking done, OR have the comment `// Gate: RUN_DRAND_INTEGRATION=true. Run before marking story done.`
- [ ] Update sprint-status to `done` (with PR number in trailing comment)
