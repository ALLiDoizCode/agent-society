# NFR Assessment — Story 11-12: Arweave Checkpoint Automation

**Date:** 2026-04-09
**Package:** @toon-protocol/pet-dvm
**Assessor:** Claude Sonnet 4.6

---

## Performance

**P-1: Hot path impact — PASS**
`CheckpointManager.recordInteraction()` is a Map.get + Map.set operation — O(1), < 1µs. The `checkpoint()` call is fire-and-forget (never awaited in the hot path). The handler returns its ILP FULFILL response immediately; the Arweave upload happens asynchronously. Zero impact on ILP packet processing latency.

**P-2: Memory — PASS**
The counter Map grows by one entry per unique blobbiId. A DVM serving 10,000 unique pets holds 10,000 small integer entries — well within Node.js heap limits. No unbounded growth beyond the existing `PetStateManager` (already capped at 10,000 entries).

**P-3: File I/O — PASS**
`fs.readFile` reads the entire `.mv2` into memory once per checkpoint. A typical `.mv2` for a pet with ~100 interactions is < 1MB. The read happens asynchronously and does not block the event loop. No streaming needed for files of this size.

---

## Reliability

**R-1: Non-fatal errors — PASS**
`CheckpointManager.checkpoint()` never throws. All errors (missing file, upload failure) are emitted as `'error'` events. The DVM handler ignores checkpoint errors via `.catch(() => {})`. Pet interaction processing is never aborted by a checkpoint failure.

**R-2: No data loss on upload failure — PASS**
If Arweave upload fails, the `.mv2` file is untouched on disk. The next checkpoint attempt (after N more interactions) will re-read and re-upload. No checkpoint state is lost.

**R-3: Backward compatibility — PASS**
`checkpointConfig` is optional in `PetDvmConfig`. All existing callers without this field continue to work unchanged. The `CheckpointManager` is only instantiated when `checkpointConfig` is present. Zero regression risk to existing 200 tests (all still pass, now 215 total).

---

## Security

**S-1: Tag injection — PASS**
Mandatory Arweave tags (`Pet-Brain-Id`, `Brain-Hash`, `Content-Type`, `Checkpoint-Timestamp`) are applied after caller-supplied `arweaveTags`, so callers cannot override them. The `blobbiId` used in tags comes from the already-sanitised request (path traversal already blocked in `createPetDvmHandler` — the same `blobbiId` that reached `stateManager.save()` is guaranteed safe).

**S-2: Path traversal — PASS**
The `blobbiId` passed to `checkpoint()` has already been validated by the handler's sanitisation guard (no `/`, `\`, `\0`, or `..`). `CheckpointManager.checkpoint()` does not re-validate — it trusts the caller (handler) to have sanitised. This is correct given the integration point.

**S-3: Error message leakage — PASS**
`CheckpointError` messages are emitted as internal events, not returned to ILP clients. The handler swallows checkpoint errors silently from the client's perspective.

---

## Operability

**O-1: Observability — PASS**
The `'checkpoint'` event exposes `{ blobbiId, txId, brainHash, timestamp }` for DVM operators to monitor. The `'error'` event exposes `{ code, blobbiId, message }` for alerting. DVM operators can attach listeners at startup.

**O-2: Configurability — PASS**
`checkpointThreshold` is injected at construction time. Operators can tune frequency without code changes. Default recommendation of 10 interactions matches the architecture spec.

---

## Risks

**LOW: Upload latency variability** — Arweave/Turbo uploads may take 1–30 seconds. Since checkpoint is fire-and-forget this doesn't affect the DVM, but the operator's Node.js process will have open async operations during these uploads. No mitigation needed for MVP.

**LOW: .mv2 snapshot consistency** — The checkpoint reads the `.mv2` file AFTER `brain.close()`. If another process writes to the same `.mv2` between `close()` and `readFile()` (unlikely in single-process DVM), the uploaded snapshot may differ from `brainHash`. Acceptable for MVP; a file locking mechanism would address this in production if needed.

---

## Overall Assessment: PASS

No blocking NFR issues. All critical paths (hot path performance, backward compatibility, error non-fatality, security) meet requirements.
