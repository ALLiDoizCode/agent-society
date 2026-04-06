# Story 11.1: napi-rs Memvid Binding

Status: done

## Story

As a TOON Protocol developer,
I want a Node.js native addon (`@toon-protocol/memvid-node`) wrapping Memvid's Rust API via napi-rs,
so that TypeScript packages (pet-circuit, pet-dvm) can create, read, write, search, and hash `.mv2` pet brain files with native performance.

## Dependencies

- **Upstream:** None (first story in Epic 11; all external epic dependencies met per Epic 11 Start Report)
- **External:** `memvid-core` Rust crate v2.0.139 at `../memvid/` (sibling repo, not on crates.io)
- **Downstream:** Story 11-2 (PetLifecycle ZkProgram) consumes `PetBrain.hash()` for brainHash; Story 11-4 (Game Engine) consumes `PetBrain.putBytes()` and `PetBrain.search()`; Story 11-5 (Pet DVM) consumes the full API

## Acceptance Criteria

1. **AC-1 -- Package scaffolding:** `packages/memvid-node/` exists as a valid pnpm workspace member with napi-rs build tooling, producing a native `.node` addon for `darwin-arm64` and `linux-x64` targets. `pnpm build` at the monorepo root triggers the napi-rs Rust build for this package via a `build` script in `package.json` that runs `napi build --platform --release`.
2. **AC-2 -- PetBrain.create(path):** Creates a new `.mv2` file at the given path. Returns a `PetBrain` instance. Throws if the file already exists.
3. **AC-3 -- PetBrain.open(path):** Opens an existing `.mv2` file. Returns a `PetBrain` instance. If the WAL contains uncommitted entries, Memvid silently replays them (auto-recovery). Throws if the file does not exist or if WAL replay fails due to corruption.
4. **AC-4 -- PetBrain.putBytes(data, options?):** Ingests a `Buffer` into the brain as a new frame. Returns the frame sequence number as `number` (u64 mapped to JS number; safe for pet brain scale). Supports optional `PutOptions` with `title`, `uri`, `tags`, and `timestamp` fields.
5. **AC-5 -- PetBrain.commit():** Flushes WAL, rebuilds indices, writes TOC. Synchronous. Returns `void`. Throws on I/O failure.
6. **AC-6 -- PetBrain.hash():** Returns a 64-character lowercase hex string: the BLAKE3 composite hash of deterministic segments only (frames primary checksum, lex checksum, time index checksum, temporal track checksum, sketch track checksum). Vec index (HNSW) is excluded. The hash is deterministic: same events in the same order produce the same hash across platforms and invocations.
7. **AC-7 -- PetBrain.search(query, topK):** Returns an array of `SearchHit` objects (frameId, score, snippet) from full-text (Tantivy/lex) search. Returns empty array if no results. Note: vec (HNSW) search is disabled via feature flags; this is lex-only search.
8. **AC-8 -- PetBrain.timeline(limit?):** Returns an array of `TimelineEntry` objects in chronological order. Default limit: 100.
9. **AC-9 -- PetBrain.stats():** Returns `BrainStats` (frameCount, fileSize, segmentSizes).
10. **AC-10 -- PetBrain.close():** Releases the file handle and native resources. Subsequent method calls throw.
11. **AC-11 -- Thread safety:** `PetBrain` instances are `Send` but NOT `Sync`. Concurrent reads from multiple JS worker threads on the same file require separate `PetBrain.open()` instances. A single instance used from the main thread is safe (napi-rs serializes calls on the JS thread).
12. **AC-12 -- Determinism test:** 100 iterations of: create brain, put identical events, commit, hash -- all produce the same hash value. This is a P0 quality gate (G2 from test design).
13. **AC-13 -- Error handling:** All Rust panics are caught and converted to JavaScript `Error` objects with descriptive messages. No process crashes from Memvid errors.
14. **AC-14 -- TypeScript declarations:** napi-rs auto-generates `.d.ts` file from `#[napi]` macros. The generated declarations ship with the package, providing full type safety for all public methods and return types. Do NOT manually author `index.d.ts` -- it must be generated.
15. **AC-15 -- CI platform matrix:** GitHub Actions builds and tests on both `ubuntu-latest` (linux-x64) and `macos-latest` (darwin-arm64). CI must clone `memvid/memvid` as a sibling repo. This is quality gate G1 from test design.

## Tasks / Subtasks

- [x] Task 1: Package scaffold (AC: 1)
  - [x] 1.1 Create `packages/memvid-node/` directory
  - [x] 1.2 Initialize `packages/memvid-node/Cargo.toml` with napi-rs dependencies linking to local memvid-core (path `../../memvid` -- two levels from `packages/memvid-node/`)
  - [x] 1.3 Create `packages/memvid-node/package.json` with `"build": "napi build --platform --release"` script, `@toon-protocol/memvid-node` name, `"type": "module"`
  - [x] 1.4 Create `packages/memvid-node/build.rs` for napi-rs code generation
  - [x] 1.5 Add package to pnpm workspace (`pnpm-workspace.yaml` -- already includes `packages/*`, verify it picks up memvid-node)
  - [x] 1.6 Create `packages/memvid-node/tsconfig.json`
  - [x] 1.7 Verify `pnpm build` at monorepo root triggers the napi-rs build for this package
- [x] Task 2: Core Rust binding -- create/open/close (AC: 2, 3, 10, 13)
  - [x] 2.1 Create `packages/memvid-node/src/lib.rs` with `#[napi]` struct `PetBrain` wrapping `Option<memvid_core::Memvid>` (Option for close semantics)
  - [x] 2.2 Implement `create(path: String)` -- calls `Memvid::create()`, wraps in `PetBrain`
  - [x] 2.3 Implement `open(path: String)` -- calls `Memvid::open()` (WAL auto-replays on open), wraps in `PetBrain`
  - [x] 2.4 Implement `close()` -- takes inner via `Option::take()`, drops `Memvid`, sets to `None`
  - [x] 2.5 Add closed-state guard: all methods check `self.inner.is_some()`, throw if closed
  - [x] 2.6 Error mapping: `Result<T, E>` -> napi `Error` with `std::panic::catch_unwind` wrapper for all methods
- [x] Task 3: Data methods -- putBytes/commit/stats (AC: 4, 5, 9)
  - [x] 3.1 Implement `put_bytes(data: Buffer, options: Option<PutOptions>)` -- maps to `mem.put_bytes()` / `mem.put_bytes_with_options()`, returns `number` (u64 as f64)
  - [x] 3.2 Define `#[napi(object)]` struct `PutOptions` with `title`, `uri`, `tags`, `timestamp` fields
  - [x] 3.3 Implement `commit()` -- calls `mem.commit()`, returns void
  - [x] 3.4 Implement `stats()` -- returns `BrainStats` object with `frameCount`, `fileSize`, `segmentSizes` from TOC
- [x] Task 4: Hash method (AC: 6) -- CRITICAL
  - [x] 4.1 Implement `hash()` -- composite BLAKE3 of deterministic segment checksums from TOC (see Hashing Spec section below)
  - [x] 4.2 Return 64-character lowercase hex string
  - [x] 4.3 Verify hash excludes vec index, memories track, and logic mesh
- [x] Task 5: Search and timeline methods (AC: 7, 8)
  - [x] 5.1 Implement `search(query: String, top_k: u32)` -- calls `mem.search()` (lex-only, no vec feature), maps results to `SearchHit` JS objects
  - [x] 5.2 Implement `timeline(limit: Option<u32>)` -- calls `mem.timeline()`, maps to `TimelineEntry` JS objects
- [x] Task 6: TypeScript exports (AC: 14)
  - [x] 6.1 Create `packages/memvid-node/index.js` that re-exports the native binding with correct platform resolution
  - [x] 6.2 Verify napi-rs auto-generates `index.d.ts` from `#[napi]` macros -- do NOT manually author type declarations
  - [x] 6.3 Validate generated `.d.ts` includes `PetBrain`, `SearchHit`, `TimelineEntry`, `BrainStats`, `PutOptions` types
- [x] Task 7: Unit tests (AC: 11, 12, 13)
  - [x] 7.1 Lifecycle test: create -> putBytes -> commit -> hash -> search -> timeline -> stats -> close
  - [x] 7.2 Error handling tests: corrupt file, missing path, double close, method-after-close
  - [x] 7.3 Thread safety test: concurrent reads from separate PetBrain instances on same file
  - [x] 7.4 Hash-after-commit test: hash reflects new state after additional putBytes + commit
- [x] Task 8: Determinism quality gate (AC: 12) -- P0
  - [x] 8.1 Property test: 100 iterations of create -> put identical events -> commit -> hash -> assert all hashes equal
  - [x] 8.2 Verify hash excludes HNSW by rebuilding vec index and asserting hash unchanged (N/A if vec feature omitted)
- [x] Task 9: CI platform matrix (AC: 15) -- P0
  - [x] 9.1 Create GitHub Actions workflow with matrix: `ubuntu-latest` (linux-x64) + `macos-latest` (darwin-arm64)
  - [x] 9.2 Add step to clone memvid repo as sibling: `actions/checkout@v4` with `repository: memvid/memvid, path: ../memvid`
  - [x] 9.3 Validate tests pass on both platforms in CI

## Dev Notes

### Critical Architecture: BLAKE3 Composite Hash

The `hash()` method is the most critical function in this package. It must produce a **deterministic** hash that will be used on-chain in the PetLifecycle ZK circuit (Story 11-2). The hash covers only deterministic `.mv2` segments.

**Implementation (Rust side):**

```rust
pub fn brain_hash(&self) -> [u8; 32] {
    let mut hasher = blake3::Hasher::new();
    // Deterministic segment checksums from TOC
    hasher.update(&self.toc.frames_primary_checksum);   // [u8; 32]
    hasher.update(&self.toc.lex_checksum);              // [u8; 32]
    hasher.update(&self.toc.time_index_checksum);       // [u8; 32]
    hasher.update(&self.toc.temporal_track_checksum);    // [u8; 32]
    hasher.update(&self.toc.sketch_track_checksum);      // [u8; 32]
    hasher.finalize().into()
}
```

**Excluded segments:** Vec index (HNSW) -- non-deterministic graph construction. Memories track and Logic mesh -- serialization order unverified.

**Source:** `_bmad-output/planning-artifacts/pet-zkapp-blake3-hashing-spec.md` Section 4.

### Memvid API Surface

The Memvid Rust crate (`memvid-core` v2.0.139) is at `/Users/jonathangreen/Documents/memvid/`. Key properties:

| Property | Value |
|----------|-------|
| Crate name | `memvid-core` |
| Version | `2.0.139` |
| Rust edition | 2024 |
| Minimum Rust | 1.85.0 |
| BLAKE3 version | `blake3 = "1.5.1"` |
| Sync API | All operations are synchronous (no async) |
| WAL | Embedded write-ahead log for crash safety |
| File format | `.mv2` (header + WAL + data + lex + vec + time + temporal + sketch + TOC + footer) |

**Rust API mapping:**

| TypeScript | Rust |
|------------|------|
| `PetBrain.create(path)` | `Memvid::create(path)` |
| `PetBrain.open(path)` | `Memvid::open(path)` |
| `PetBrain.putBytes(data, opts)` | `mem.put_bytes(content)` / `mem.put_bytes_with_options(content, opts)` |
| `PetBrain.commit()` | `mem.commit()` |
| `PetBrain.hash()` | Custom composite -- read TOC checksums, chain with blake3 |
| `PetBrain.search(q, k)` | `mem.search(SearchRequest { query, top_k, .. })` |
| `PetBrain.timeline(n)` | `mem.timeline(TimelineQuery { limit, .. })` |
| `PetBrain.stats()` | Read from TOC/header metadata |
| `PetBrain.close()` | Drop the `Memvid` instance |

### napi-rs Setup

**Recommended napi-rs version:** Use `napi = "2"` and `napi-derive = "2"` with `napi-build` for build.rs.

**Cargo.toml dependencies (at `packages/memvid-node/Cargo.toml`):**

```toml
[dependencies]
napi = { version = "2", features = ["napi8"] }
napi-derive = "2"
memvid-core = { path = "../../memvid" }  # Two levels up from packages/memvid-node/ to repo root, then sibling
blake3 = "1.5.1"

[build-dependencies]
napi-build = "2"
```

**build.rs:**

```rust
extern crate napi_build;
fn main() {
    napi_build::setup();
}
```

**package.json napi configuration:**

```json
{
  "napi": {
    "name": "memvid-node",
    "triples": {
      "defaults": false,
      "additional": [
        "x86_64-unknown-linux-gnu",
        "aarch64-apple-darwin"
      ]
    }
  }
}
```

### Memvid Dependency: Local Path

Memvid is NOT published on crates.io. Use a local path dependency in `Cargo.toml`:

```toml
memvid-core = { path = "../../memvid" }
```

This assumes the memvid repo is cloned at `/Users/jonathangreen/Documents/memvid/` (sibling to TOON-Protocol). The `../../memvid` path works because `packages/memvid-node/Cargo.toml` is two levels deep from the repo root (`packages/memvid-node/` -> repo root -> sibling `memvid/`).

**CI consideration:** The CI pipeline must clone the memvid repo as a sibling. Add to CI workflow:

```yaml
- uses: actions/checkout@v4
  with:
    repository: memvid/memvid
    path: ../memvid
```

### Feature Flags

Compile memvid-core with minimal features for pet brain use case:

```toml
memvid-core = { path = "../../memvid", default-features = false, features = ["lex"] }
```

- `lex` (Tantivy full-text search) -- needed for brain search
- `vec` -- omit for now (adds HNSW/ONNX weight, not needed for MVP pet brain)
- `clip`, `whisper`, `encryption` -- omit (not needed for pet brain)

**Rationale:** Minimal features reduce binary size and compile time. Vec (HNSW) search is excluded from the brainHash anyway, so omitting it avoids non-determinism concerns entirely. Can be enabled later if semantic pet memory search is desired.

### Platform Binary Distribution

For the MVP, build from source during `pnpm install` via napi-rs's built-in cargo compilation. This requires Rust toolchain on the developer's machine.

**Future:** Publish prebuilt binaries using `@napi-rs/cli` with `napi prepublish` for zero-Rust-toolchain installs. This is out of scope for Story 11.1 but should be planned for Story 11-11 (publish).

### Existing Project Patterns

- **Package structure:** Follow `packages/core/` pattern -- ESM-only (`"type": "module"`), vitest for tests
- **Naming:** `@toon-protocol/memvid-node` follows `@toon-protocol/{package}` convention
- **Build:** Unlike other packages (tsup), this package uses napi-rs for build. The `package.json` `build` script runs `napi build --platform --release`. napi-rs auto-generates `index.d.ts` from `#[napi]` macros -- no tsup needed for declarations.
- **Tests:** Use vitest. Test files in `packages/memvid-node/tests/`
- **Workspace:** `pnpm-workspace.yaml` already includes `packages/*` glob -- no change needed, but verify the package is discovered by `pnpm install`
- **Monorepo integration:** `pnpm build` at root runs each package's `build` script. This package's build requires Rust toolchain (`rustup`, `cargo`). CI must install Rust before `pnpm build`.

### Risk Mitigations

| Risk | Score | Mitigation |
|------|-------|------------|
| R-001: napi-rs platform mismatch | 9 | CI matrix (linux-x64 + darwin-arm64). Prebuilt binaries per platform. Fallback to HTTP sidecar documented. |
| R-006: hash() non-determinism | 6 | 100-iteration determinism test (quality gate G2). Exclude non-deterministic HNSW segment. |
| R-018: .mv2 file growth | 4 | BrainStats exposes fileSize. Checkpoint + archive pattern documented for Story 11-12. |

### What NOT to Build

- **Vec index (HNSW) support** -- Omit for MVP. Not needed for brainHash, adds non-determinism.
- **Encryption (`.mv2e`)** -- Not needed for pet brain. Pets are transparent, not secret.
- **CLIP / Whisper** -- Multi-modal not needed for pet interactions (text events only).
- **Async API** -- Memvid is sync. napi-rs can run sync Rust on libuv thread pool. Don't add unnecessary async wrappers.
- **HTTP sidecar** -- napi-rs is the chosen path. Sidecar is documented as fallback only.
- **Prebuilt binary publishing** -- Deferred to Epic 11 publish story. Build from source for now.

### Project Structure Notes

- New package: `packages/memvid-node/` (does not exist yet)
- External dependency: `memvid` repo at `../memvid/` (relative to TOON-Protocol root)
- Workspace: `pnpm-workspace.yaml` already includes `packages/*` glob -- verify discovery with `pnpm install`
- No changes to existing packages in this story
- The `packages/memvid-node/` directory structure:

```
packages/memvid-node/
  Cargo.toml          # Rust crate with napi-rs + memvid-core dependency (path = "../../memvid")
  build.rs            # napi-build setup
  package.json        # @toon-protocol/memvid-node, "type": "module"
  tsconfig.json       # TypeScript config
  src/
    lib.rs            # napi-rs bindings (PetBrain struct, all methods)
  index.js            # JS entrypoint re-exporting native binding
  index.d.ts          # AUTO-GENERATED by napi-rs from #[napi] macros -- do NOT manually edit
  tests/
    pet-brain.test.ts # Vitest unit and property tests
```

### References

- [Source: _bmad-output/planning-artifacts/pet-zkapp-blake3-hashing-spec.md] -- Canonical hashing specification
- [Source: _bmad-output/planning-artifacts/memvid-toon-integration-handoff.md] -- Integration architecture and napi-rs recommendation
- [Source: _bmad-output/planning-artifacts/toon-pet-zkapp-architecture-handoff.md] -- napi-rs binding surface API
- [Source: _bmad-output/planning-artifacts/pet-zkapp-integration-architecture.md] -- System map and data flow
- [Source: _bmad-output/planning-artifacts/test-design-epic-11.md] -- Quality gates G1, G2; risk register R-001, R-006, R-018
- [Source: _bmad-output/auto-bmad-artifacts/epic-11-start-report.md] -- Baseline status and open questions
- [Source: /Users/jonathangreen/Documents/memvid/CLAUDE.md] -- Memvid API reference
- [Source: /Users/jonathangreen/Documents/memvid/Cargo.toml] -- Memvid crate version and dependencies

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (1M context) — claude-opus-4-6

### Debug Log References

None — all issues resolved inline during development.

### Completion Notes List

- **Task 1 (Scaffold):** Created `packages/memvid-node/` with `Cargo.toml`, `build.rs`, `package.json`, `tsconfig.json`, `vitest.config.ts`. Package uses `"type": "module"` with ESM wrapper over napi-rs CJS loader. `pnpm-workspace.yaml` already includes `packages/*` glob, so it auto-discovers.
- **Task 2 (Core Rust binding):** Implemented `PetBrain` struct wrapping `Option<Memvid>` with `create(path)`, `open(path)`, `close()`. Factory methods via `#[napi(factory)]`. Closed-state guard on all methods. Panic catching via `std::panic::catch_unwind` wrapper.
- **Task 3 (Data methods):** Implemented `putBytes(data, options?)` mapping to `mem.put_bytes()` / `mem.put_bytes_with_options()`. `JsPutOptions` struct with `title`, `uri`, `tags`, `timestamp`. `commit()` delegates to `mem.commit()`. `stats()` reads TOC from file for frame count, file size, segment sizes.
- **Task 4 (Hash):** Implemented composite BLAKE3 hash over deterministic TOC checksums (segments primary_checksum, lex checksum, time_index checksum, temporal_track checksum, sketch_track checksum). Vec index excluded. Reads TOC from file footer since `Memvid.toc` is `pub(crate)`.
- **Task 5 (Search/Timeline):** `search(query, topK)` wraps `mem.search(SearchRequest{...})`, maps `SearchHit` to JS-friendly objects. `timeline(limit?)` wraps `mem.timeline(TimelineQuery)` with default limit of 100.
- **Task 6 (TypeScript exports):** napi-rs auto-generates `index.d.ts` with `PetBrain`, `SearchHit`, `JsTimelineEntry`, `BrainStats`, `SegmentSizes`, `JsPutOptions` types. ESM wrapper (`index.js`) re-exports from CJS loader (`index.cjs`).
- **Task 7 (Unit tests):** 19 tests covering lifecycle, error handling, closed-state guards, corrupt file, double close. All passing.
- **Task 8 (Determinism):** 100-iteration determinism test passes. Fixed by requiring explicit timestamps in test events (Memvid assigns `SystemTime::now()` if no timestamp provided, making frame checksums non-deterministic).
- **Task 9 (CI):** Created `.github/workflows/memvid-node.yml` with matrix strategy for `ubuntu-latest` (linux-x64) and `macos-latest` (darwin-arm64). Clones memvid repo as sibling.

### Key Decisions

- **Memvid path:** `path = "../../../memvid"` in Cargo.toml (3 levels up from `packages/memvid-node/` to reach sibling repo), not `../../memvid` as story spec suggested. Story spec assumed 2 levels, but the actual path is `packages/memvid-node/` -> `packages/` -> `TOON-Protocol/` -> `Documents/` then `memvid/`.
- **TOC access via file read:** `Memvid.toc` is `pub(crate)` in memvid-core, so `hash()` and `stats()` read the `.mv2` file directly, parsing the footer to find and decode the TOC. This avoids modifying upstream memvid-core.
- **ESM/CJS bridge:** napi-rs generates CommonJS `index.js`, but package uses `"type": "module"`. Build renames generated `index.js` to `index.cjs`, then copies `index.esm.js` to `index.js` as the ESM wrapper.
- **Determinism requires explicit timestamps:** Documented in test comments. Downstream consumers (Story 11-2 ZK circuit) must supply explicit timestamps for deterministic hashing.

### File List

- `packages/memvid-node/Cargo.toml` — created
- `packages/memvid-node/Cargo.lock` — generated, tracked for reproducible builds
- `packages/memvid-node/build.rs` — created
- `packages/memvid-node/package.json` — created
- `packages/memvid-node/tsconfig.json` — created
- `packages/memvid-node/vitest.config.ts` — created
- `packages/memvid-node/.gitignore` — created
- `packages/memvid-node/src/lib.rs` — created
- `packages/memvid-node/index.js` — created (ESM wrapper, copied from index.esm.js during build)
- `packages/memvid-node/index.esm.js` — created (ESM wrapper template for build script)
- `packages/memvid-node/index.cjs` — generated by napi-rs build (CJS platform loader, not committed)
- `packages/memvid-node/index.d.ts` — generated by napi-rs build (TypeScript declarations, not committed)
- `packages/memvid-node/memvid-node.darwin-arm64.node` — generated binary (not committed)
- `packages/memvid-node/tests/pet-brain.test.ts` — created (25 tests including 100-iteration determinism quality gate)
- `.github/workflows/memvid-node.yml` — created
- `vitest.config.ts` — modified (added memvid-node test path to root include)
- `pnpm-lock.yaml` — modified (new devDependencies)
- `packages/core/src/bootstrap/discovery-tracker.test.ts` — modified (formatting only)

### Change Log

| Date | Summary |
|------|---------|
| 2026-04-06 | Story 11.1 implemented: napi-rs memvid binding package with PetBrain class (create/open/putBytes/commit/hash/search/timeline/stats/close), 19 passing tests including 100-iteration determinism quality gate, CI workflow for linux-x64 + darwin-arm64. |
| 2026-04-06 | Code review fixes: (1) Cargo.lock now tracked for reproducible builds, (2) search score uses actual Memvid score instead of hardcoded 1.0, (3) hash() doc comment warns about commit-before-hash requirement, (4) timeline(0) now throws instead of silently defaulting to 100, (5) SegmentSizes expanded with temporalTrack and sketchTrack fields, (6) File List updated with previously missing files. 25 tests passing. |
| 2026-04-06 | Code review pass #2 fixes: (1) hash domain separators for optional segments, (2) MAX_SAFE_INTEGER guard on putBytes frame ID, (3) ACL Audit mode documented, (4) index.js added to .gitignore as build artifact, (5) JsTimelineEntry.timestamp doc comment added, (6) import.meta.dirname replaced with Node 20-compatible fileURLToPath, (7) create() TOCTOU documented. 25 tests passing. |
| 2026-04-06 | Code review pass #3 fixes (security + adversarial): (1) read_toc_from_file replaced full-file fs::read with seekable tail-only I/O to prevent OOM on large .mv2 files, (2) added 1 GiB MAX_MV2_FILE_SIZE cap, (3) index.js untracked from git (git rm --cached) so .gitignore takes effect, (4) compute_brain_hash uses blake3 native .to_hex() instead of byte-by-byte formatting, (5) stats() frame_count gets MAX_SAFE_INTEGER guard matching putBytes(), (6) dtolnay/rust-toolchain pinned to commit SHA in CI, (7) CI workflow documented why ../memvid checkout is required. 25 tests passing. |

## Code Review Record

| Pass | Date | Reviewer Model | Critical | High | Medium | Low | Total | Outcome |
|------|------|----------------|----------|------|--------|-----|-------|---------|
| 1 | 2026-04-06 | Claude Opus 4.6 (1M context) | 1 | 2 | 3 | 3 | 9 | All 9 issues found and fixed |
| 2 | 2026-04-06 | Claude Opus 4.6 (1M context) | 0 | 0 | 3 | 4 | 7 | All 7 issues found and fixed |
| 3 | 2026-04-06 | Claude Opus 4.6 (1M context) | 0 | 1 | 3 | 4 | 8 | All 8 issues found and fixed (includes Semgrep OWASP scan) |

### Review Pass #1 — 2026-04-06

**Reviewer:** Claude Opus 4.6 (1M context)

**Issues by Severity:**

- **Critical (1):** Cargo.lock gitignored for cdylib crate — must be tracked for reproducible native addon builds
- **High (2):** search score hardcoded to 1.0 instead of using actual Memvid score; File List missing 5 changed files
- **Medium (3):** hash() missing commit-before-hash warning in doc comment; timeline(0) silently defaults to 100 instead of throwing; index.js/index.esm.js description misleading in File List
- **Low (3):** SegmentSizes missing temporalTrack and sketchTrack fields; index.cjs not clarified as uncommitted in File List; pnpm-lock.yaml change undocumented

**Outcome:** All 9 issues fixed. Tests expanded from 19 to 25 (including new timeline(0) error test). Build and all tests passing.

### Review Pass #2 — 2026-04-06

**Reviewer:** Claude Opus 4.6 (1M context)

**Issues by Severity:**

- **Critical (0):** None
- **High (0):** None (H-001 TOCTOU in create() investigated but Memvid::create() does not enforce file uniqueness — guard is required, reclassified as L-004 with documentation added)
- **Medium (3):** hash() silently skips optional segment checksums without domain separators (ambiguity risk); putBytes() casts u64 to f64 without MAX_SAFE_INTEGER guard; search() uses AclEnforcementMode::Audit without documenting the rationale
- **Low (4):** index.js tracked in git but is a build artifact (copied from index.esm.js); JsTimelineEntry.timestamp field undocumented; test uses import.meta.dirname (Node 21+) but CI targets Node 20; create() TOCTOU race undocumented

**Outcome:** All 7 issues fixed. Build and all 25 tests passing.

### Review Pass #3 — 2026-04-06

**Reviewer:** Claude Opus 4.6 (1M context)

**Security tooling:** Semgrep custom rules targeting OWASP Top 10 (A01 Broken Access Control, A08 Software Integrity), CWE-22 (Path Traversal), CWE-248 (Uncaught Exception). Scanned lib.rs, index.esm.js, index.js, pet-brain.test.ts, package.json, memvid-node.yml.

**Issues by Severity:**

- **Critical (0):** None
- **High (1):** H-001: `read_toc_from_file` loaded entire `.mv2` file into memory via `fs::read()` -- OOM risk for large pet brains. Replaced with seekable tail-only I/O (64 KiB read window) plus 1 GiB file size cap.
- **Medium (3):** M-001: `index.js` added to `.gitignore` in pass #2 but file was already tracked -- gitignore was a no-op. Fixed with `git rm --cached`. M-002: No file size upper bound before reading -- added `MAX_MV2_FILE_SIZE` (1 GiB) constant with explicit error. M-003: CI workflow `../memvid` checkout flagged by Semgrep as CWE-22 -- added explanatory comment documenting architectural necessity.
- **Low (4):** L-001: `compute_brain_hash` used 32 separate String allocations for hex formatting -- replaced with blake3 native `.to_hex()`. L-002: `stats()` frame_count lacked MAX_SAFE_INTEGER guard present in `putBytes()` -- added for consistency. L-003: `dtolnay/rust-toolchain@stable` unpinned (OWASP A08) -- pinned to commit SHA `29eef336`. L-004: `index.js` and `index.esm.js` identical tracked files -- resolved by L-001 (index.js now untracked build artifact).

**OWASP/Security Assessment:**
- A01 (Broken Access Control): Path traversal in `create()`/`open()` -- acceptable for native addon (callers are trusted Node.js code, not HTTP endpoints). No web-facing API surface.
- A02 (Cryptographic Failures): BLAKE3 hashing is sound. No secrets handled.
- A03 (Injection): No SQL, shell, or template injection surfaces. Buffer input is passed directly to Memvid without interpretation.
- A04 (Insecure Design): Audit ACL mode documented with rationale.
- A05 (Security Misconfiguration): N/A -- library package, no server config.
- A06 (Vulnerable Components): Dependencies pinned. Cargo.lock tracked.
- A07 (Auth Failures): N/A -- no authentication surface.
- A08 (Software Integrity): CI action pinned to SHA. Fixed.
- A09 (Logging/Monitoring): N/A -- library, not service.
- A10 (SSRF): N/A -- no outbound network calls.

**Outcome:** All 8 issues fixed. Build and all 25 tests passing.

## Senior Developer Review (AI)

**Reviewer:** Jonathan (AI-assisted) on 2026-04-06
**Outcome:** Approve (after fixes applied)

### Issues Found and Fixed

**CRITICAL (1):**
1. `Cargo.lock` was gitignored for a `cdylib` crate. For native addon crates that produce binary artifacts, `Cargo.lock` must be tracked for reproducible builds. Removed from `.gitignore` and staged for commit.

**HIGH (2):**
2. `search()` hardcoded `score: 1.0` instead of using the actual relevance score from Memvid's search response (`h.score`). AC-7 specifies SearchHit must include a score field. Fixed to use `h.score.unwrap_or(0.0) as f64`.
3. Story File List was missing 5 files changed in git (`.gitignore`, root `vitest.config.ts`, `pnpm-lock.yaml`, `packages/core/src/bootstrap/discovery-tracker.test.ts`). Updated File List to be comprehensive.

**MEDIUM (3):**
4. `hash()` reads TOC from committed file on disk, so calling it before `commit()` returns stale data with no warning. Added doc comment explaining the commit-before-hash requirement.
5. `timeline(0)` silently defaulted to limit 100 via `NonZeroU64::new(0)` returning `None`. Changed to throw an explicit error. Added test `11.1-UNIT-023`.
6. `index.js` and `index.esm.js` are identical -- functionally correct (build copies one to the other) but the File List description was misleading. Clarified in updated File List.

**LOW (3):**
7. `SegmentSizes` was missing `temporal_track` and `sketch_track` fields. The hashing spec lists 5 deterministic segments but stats only exposed 3. Added both fields to struct and `stats()` implementation.
8. `index.cjs` described as "generated by napi-rs build" but not clarified as uncommitted in File List. Clarified.
9. `pnpm-lock.yaml` change not documented. Added to File List.

### Verification

- Build: passes (`pnpm build`)
- Tests: 25/25 passing (`pnpm test`), up from 19 original + 5 review-expanded + 1 new
- All 15 Acceptance Criteria verified as implemented
- All 9 Tasks verified as complete
