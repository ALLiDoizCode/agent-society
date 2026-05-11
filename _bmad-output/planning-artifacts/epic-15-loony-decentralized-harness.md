# Epic 15: Loony — Decentralized Agent Harness

**Status:** BACKLOG
**Decision source:** Party Mode 2026-03-23 (original autonomous agent scope); **Rescoped Party Mode 2026-05-11** — Decentralized Agent Harness
**Package:** `packages/loony` (planned — leaf node, imports `@toon-protocol/sdk` only)

---

## Summary

Loony is a decentralized agent harness — the first harness where no single party controls the execution loop. It proves the TOON Protocol thesis: an agent whose loop is provably ungoverned, whose workspace is permanently auditable, and whose tool execution is certified by ZK proof.

The OS model that Loony implements:

| Harness Component | OS Analogy | TOON Implementation |
|---|---|---|
| LLM | CPU — raw compute, inert alone | Sourced from kind:5250 Compute DVM marketplace |
| Nostr Relay | RAM — fast ephemeral working memory | Session events, DVM job/result pairs, kind:30000 file pointers |
| Arweave | DISK — permanent content-addressed storage | File blobs, raw execution traces (never summarized), checkpoints |
| DVMs | DRIVERS — abstraction over services | read_file/edit_file/run_bash/grep via kind:5094 + kind:5250 |
| Mina zkApp | KERNEL — enforces state, cannot be bypassed | `SessionRegistry` SmartContract: workspace_hash, lock, VRF election |
| VRF (Mina) | SCHEDULER — selects who runs next, provably fair | Poseidon-hash VRF; selection unpredictable + on-chain verifiable |
| ILP | METERING — economic incentive layer | Every relay write, DVM job, Arweave upload is micropayment-gated |

**Key insight:** VRF is the **scheduler**, not the loop. The loop is the OODA cycle. VRF certifies which DVM runs each iteration and proves no single party rigged the selection.

---

## Strategic Position

- Loony is the **harness substrate** that Overmind (Epic 16+) runs on. Overmind adds TEE sovereignty, Shamir backup, and ZK biography on top.
- Loony co-develops with **Epic 13 (Chain Bridge Primitive)**. Story 15.8 submitting Mina txns via kind:5260 IS Epic 13's first Mina adapter reference implementation. Epic 13 story 13.5 reclassifies from "build" to "ratify."
- Loony is the first TOON entity whose execution loop produces a **court-admissible, independently reconstructible audit trail** — every state transition is an Arweave transaction, every loop iteration is a VRF proof.

---

## Epic Sequencing

```
PARALLEL NOW (no Mina dep, no Epic 14 dep):
  Epic 13 Track A: kind:5260 schema → ChainAdapter interface → EVM/Solana/AO adapters
  Epic 15 Phase 0: 15.1 (scaffold), 15.2 (service discovery), 15.5 (workspace), 15.6 (trace events)

GATE 1 — Epic 14 (kind:5250 consumer SDK) complete:
  Epic 15.3 (LLM inference), 15.4 (harness primitive action layer)

GATE 2 — Epic 16 story 16.3 (OvermindRegistry zkApp) merges:
  Epic 15.7 (SessionRegistry zkApp) — copies VRF pattern from 16.3, adds session lifecycle
  ⚠️ Do NOT start 15.7 before 16.3 — the VRF o1js pattern must be established first

GATE 3 — Epic 16 story 16.4 (Chain Bridge Mina adapter) merges:
  Epic 13 Track B: 13.5 (Mina adapter ratification) → 13.9 (Consumer SDK) → 13.8 (handler registry)

GATE 4 — Epic 13.9 Consumer SDK + 15.7 complete:
  Epic 15.8 (Session Lifecycle Manager) — submits Mina txns via kind:5260, runs full OODA loop

GATE 5 — Epic 16 fully complete:
  Epic 15.9 (CAS locking), 15.10 (DVM earnings), 15.11 (capability extension), 15.12 (E2E)
  Epic 15.13 (session affinity) can run alongside 15.4
```

**Critical path:** `15.1 → 15.2 → 15.5 → 15.7 → 15.8 → 15.12`
Mina zkApp (15.7) is the long pole — start in parallel with 15.3/15.4 once 15.5 lands and 16.3 merges.

---

## Phase 0: Pre-Mina MVP

Stories 15.1, 15.2, 15.5, 15.6 are fully buildable without Mina, without Epic 14, and without Epic 16. Phase 0 proves:
- An autonomous loop can run without a central server
- Every tool call persists to Arweave and is independently reconstructible
- The loop recovers from crash via Arweave state replay

Phase 0 does NOT prove trustless VRF election — that requires 15.7. Phase 0 is a real milestone, shippable as a standalone demo.

---

## Stories

### Story 15.1 — Package Scaffold + Identity Bootstrap *(S)*

**Builds:** `packages/loony`. Entry: `createLoonyAgent(config: LoonyConfig): Promise<LoonyAgent>`.

```ts
interface LoonyConfig {
  mnemonic: string
  relayUrls: string[]
  chainConfig: ChainConfig
  budgetReserve: bigint
  fundingAmount?: bigint
}

interface LoonyAgent {
  start(): Promise<void>
  stop(): Promise<void>
  getIdentity(): AgentIdentity
  getBalance(): Promise<bigint>
}

interface AgentIdentity {
  nostrPubkey: string   // x-only Schnorr
  evmAddress: string    // 0x-prefixed
  ilpAddress: string
}
```

Identity from NIP-06 path `m/44'/1237'/0'/0/0`. Dev-mode faucet funding via SDK `fundFromFaucet()`.

**AC:**
- AC-15.1-1: `createLoonyAgent()` returns agent with valid Nostr pubkey, EVM address, ILP address derived from mnemonic
- AC-15.1-2: Agent connects to relay, sends and receives a kind:1 event round-trip
- AC-15.1-3: Dev-mode `getBalance()` returns non-zero after faucet funding
- AC-15.1-4: `stop()` tears down gracefully, no dangling timers or open sockets

**Dependencies:** Epic 1 (`@toon-protocol/sdk`), Epic 2 (relay)

---

### Story 15.2 — Service Discovery + Perception Layer *(S)*

**Builds:** `src/service-registry.ts` — `ServiceRegistry` subscribing to kind:10035 SkillDescriptor events.

```ts
class ServiceRegistry {
  discoverProviders(kind: number, features?: string[]): SkillDescriptor[]
  getProvider(pubkey: string): SkillDescriptor | null
  getBestProvider(kind: number, features?: string[], rankBy?: 'price' | 'reputation'): SkillDescriptor | null
}
```

Real-time update via relay subscription. Stale TTL (default 5 min): deprioritize but don't delete.

**AC:**
- AC-15.2-1: Discovers kind:5094, kind:5250, kind:5260 providers from relay events
- AC-15.2-2: `getBestProvider('price')` returns lowest `['bid', amount]` from SkillDescriptor
- AC-15.2-3: Provider not seen for TTL is deprioritized; test with mocked time
- AC-15.2-4: New kind:10035 arriving on relay updates registry within 500ms

**Dependencies:** 15.1, Epic 5 (kind:10035)

---

### Story 15.3 — Decoupled LLM Inference via Compute Marketplace *(M)*

**Builds:** `src/reasoning-engine.ts` — `ReasoningEngine`.

```ts
class ReasoningEngine {
  reason(prompt: string, context?: string): Promise<string>
  reasonStructured<T>(prompt: string, schema: JSONSchema): Promise<T>
  selectInferenceProvider(): SkillDescriptor
}
```

Discovers `features: ['inference']` providers from `ServiceRegistry`, submits kind:5250, polls kind:6250. Provider failover: on timeout or kind:7000 negative feedback, retry next-best (max 3 attempts). Uses reference Docker provider from Epic 14 in CI — no live LLM.

**AC:**
- AC-15.3-1: `reason()` submits kind:5250, polls for kind:6250 terminal status, returns text
- AC-15.3-2: Failover test: mock primary returns `status: 'failed'`; secondary receives retry
- AC-15.3-3: `reasonStructured<T>()` returns `T` parsed from JSON; throws `ReasoningError` on schema mismatch
- AC-15.3-4: Reference Docker provider from Epic 14 used in test env; no live LLM in CI

**Dependencies:** 15.2, **Epic 14** (kind:5250/6250 consumer SDK helpers)

---

### Story 15.4 — Harness Primitive Action Layer *(M)*

**Builds:** `src/action-dispatcher.ts` — `ActionDispatcher`. Extends the four TOON network primitives with four harness tool calls.

```ts
type HarnessAction =
  | { type: 'message';    content: string }
  | { type: 'store';      data: Uint8Array; contentType: string }
  | { type: 'compute';    wasmRef: string; input: unknown }
  | { type: 'bridge';     chains: string[]; signedTx: string }
  | { type: 'read_file';  path: string }
  | { type: 'edit_file';  path: string; oldStr: string; newStr: string }
  | { type: 'run_bash';   cmd: string; sessionId: string }
  | { type: 'grep';       pattern: string; path: string }

interface HarnessResult {
  receipt: unknown
  costUsdc: bigint
  providerPubkey: string
  arweaveTxId?: string
  status?: 'ok' | 'conflict'
}
```

- `read_file`: resolves kind:30000 pointer → fetches Arweave blob via tx ID
- `edit_file`: reads current blob → applies old→new patch → uploads new blob via kind:5094 → updates pointer (throws `PatchError` if `oldStr` not found)
- `run_bash`: dispatches kind:5250 with `['param','cmd',cmd]` and `['param','session-id',sessionId]`
- `grep`: dispatches kind:5250 with `['param','cmd','grep']`, `['param','pattern',pattern]`, `['param','path',path]`

Cost ledger: every `act()` appends to in-memory `CostEntry[]`.

**AC:**
- AC-15.4-1: `read_file` returns correct `Uint8Array` for a known Arweave fixture tx via pointer
- AC-15.4-2: `edit_file` uploads new blob and publishes updated kind:30000 pointer with matching sha256
- AC-15.4-3: `run_bash` kind:5250 event contains `['param','session-id',sessionId]` tag
- AC-15.4-4: `grep` kind:5250 event contains grep param tags
- AC-15.4-5: `edit_file` throws `PatchError` when `oldStr` not found in current blob content

**Dependencies:** 15.2, 15.5, **Epic 14** (kind:5250 helpers), Epic 8 (kind:5094 upload helpers)

---

### Story 15.5 — Workspace State: Arweave Blob + kind:30000 Pointer Protocol *(M)*

**Builds:** `src/workspace.ts` — `WorkspaceManager`.

```ts
interface WorkspacePointer {
  path: string
  arweaveTxId: string
  sha256: string
  updatedAt: number
}

class WorkspaceManager {
  readPointer(path: string): Promise<WorkspacePointer | null>
  writePointer(path: string, arweaveTxId: string, sha256: string): Promise<void>
  fetchBlob(txId: string): Promise<Uint8Array>
  snapshotHash(paths: string[]): Promise<string>  // Poseidon hash of sorted [path, txId] pairs
}
```

kind:30000 event schema: `tags: [['d', path], ['r', arweaveTxId], ['x', sha256], ['s', sessionId]]`.
`snapshotHash` result IS the `workspace_hash` Field input for the Mina zkApp in story 15.7.

**AC:**
- AC-15.5-1: `writePointer` then `readPointer` for same path returns matching `arweaveTxId`
- AC-15.5-2: `snapshotHash(paths)` is deterministic and order-invariant (sorted internally)
- AC-15.5-3: `fetchBlob()` returns correct bytes for a known Arweave test fixture tx
- AC-15.5-4: kind:30000 event has all four tags: `d`, `r`, `x`, `s`

**Dependencies:** 15.1, Epic 8 (Arweave upload), o1js Poseidon (for `snapshotHash`)

---

### Story 15.6 — Session Trace Events (kind:5252) *(M)*

**Builds:** `src/session-trace.ts` — `SessionTrace`. New event kind: `SESSION_TRACE_KIND = 5252`.

```ts
interface ToolCallRecord {
  type: HarnessAction['type']
  input: unknown
  output: unknown
  costUsdc: bigint
  ts: number
  arweaveTxId?: string
}

class SessionTrace {
  recordToolCall(call: ToolCallRecord): Promise<void>
  queryCalls(sessionId: string, since?: number): Promise<ToolCallRecord[]>
  drainToArweave(sessionId: string): Promise<string>  // returns Arweave tx ID
}
```

kind:5252 tags: `['s', sessionId], ['tool', type], ['i', JSON.stringify(input)], ['o', JSON.stringify(output)], ['cost', costUsdc.toString()]`.

**Raw traces only — NEVER summarize.** `drainToArweave` serializes to NDJSON, uploads via kind:5094.

**AC:**
- AC-15.6-1: Every `ActionDispatcher.act()` call publishes a kind:5252 trace event
- AC-15.6-2: `queryCalls(sessionId)` returns only that session's records (cross-session isolation)
- AC-15.6-3: `drainToArweave()` returns non-empty tx ID; NDJSON roundtrips to original `ToolCallRecord[]`
- AC-15.6-4: Raw input/output fields present verbatim after drain and re-fetch from Arweave

**Dependencies:** 15.4, 15.5

---

### Story 15.7 — Mina zkApp: SessionRegistry + VRF Lock Election *(L)*

**Builds:** `src/mina/session-registry.ts` — o1js `SmartContract`.

**On-chain state (8 fields):**
```
workspace_hash        Field  // Poseidon hash from WorkspaceManager.snapshotHash()
session_id            Field  // unique harness run identifier
iteration_count       Field  // monotonic, prevents replay
lock_holder_key       Field  // pubkey of DVM currently holding write token
lock_expires_slot     Field  // Mina slot — dead-man's switch
task_hash             Field  // Poseidon hash of current task spec
vrf_seed              Field  // input to next VRF election round
trusted_worker_set_root Field // IndexedMerkleMap root (height 8, max 256 workers)
```

**VRF mechanism** (no native VRF in o1js — uses structured entropy commitment):
```ts
// Inside @method openSession():
const vrfSeed = Poseidon.hash([iteration_count, blockHash, session_id])
// blockHash passed as Provable.witness Field, constrained to current slot:
this.network.globalSlotSinceGenesis.getAndRequireEquals()
// Winner = worker at index (vrfSeed % workerCount) in IndexedMerkleMap
```

**Methods:**
- `openSession(workspaceHash, taskHash, workerRoot)` — VRF election, sets all 8 fields, emits `SessionOpened`
- `checkpoint(newWorkspaceHash, iterationCount)` — caller must be `lock_holder_key`; updates hash + count; emits `Checkpoint`
- `closeSession(finalWorkspaceHash)` — caller must be `lock_holder_key`; zeroes lock; emits `SessionClosed`
- `reclaimLock()` — any caller after `currentSlot > lock_expires_slot`; re-runs VRF; emits `LockReclaimed`

⚠️ **Do NOT start this story before Epic 16 story 16.3 (OvermindRegistry zkApp) merges.** Copy the VRF Poseidon pattern directly from 16.3 — do not rediscover o1js constraints from scratch.

⚠️ **Memory footprint comparable to pet-circuit (~2-4 GB).** Never run tests from sub-agents. Only run from main conversation with explicit approval.

**AC:**
- AC-15.7-1: `openSession()` sets all 8 fields; `lock_holder_key` matches VRF winner; test with `Mina.LocalBlockchain()`
- AC-15.7-2: `checkpoint()` rejects caller not matching `lock_holder_key` (constraint fails)
- AC-15.7-3: `reclaimLock()` succeeds only when `currentSlot > lock_expires_slot`; re-elects via VRF
- AC-15.7-4: VRF is deterministic: same `(blockHash, session_id, workerRoot)` → same winner over 50 rounds
- AC-15.7-5: Contract compiles and deploys to Mina devnet; test skips gracefully if devnet offline
- AC-15.7-6: `trusted_worker_set_root` is an `IndexedMerkleMap` root (height 8)

**Dependencies:** o1js ^2.2.0, 15.5 (`snapshotHash` produces the `workspace_hash` Field), **Epic 16 story 16.3** (VRF pattern — must ship first)

---

### Story 15.8 — Session Lifecycle Manager *(L)*

**Builds:** `src/session-manager.ts` — `SessionManager`.

```ts
interface Session {
  sessionId: string
  lockHolderKey: string
  lockExpiresSlot: number
  taskHash: string
  iterationCount: number
  spentThisCycle: bigint
}

interface SessionConfig {
  maxIterations: number
  checkpointInterval: number   // default: 50
  budgetPerCycleUsdc: bigint
  lockExtensionSlots: number
}

class SessionManager {
  startSession(task: string, config: SessionConfig): Promise<Session>
  runCycle(session: Session): Promise<CycleResult>
  closeSession(session: Session): Promise<void>
}
```

`startSession`: submits Mina tx via kind:5260 chain bridge → waits for kind:5261 confirmation → stores session handle.

`runCycle`: full OODA cycle:
1. **Observe** — read relay events since last cycle, check `WorkspaceManager` for file state, check `ServiceRegistry`
2. **Orient + Decide** — `ReasoningEngine.reasonStructured<HarnessAction[]>()` with system prompt + workspace context
3. **Act** — execute approved actions via `ActionDispatcher`; signs all relay events with `lockHolderKey`
4. Auto-checkpoint: when `session.iterationCount % checkpointInterval === 0`, submit `SessionRegistry.checkpoint()` via kind:5260; verify on-chain `workspace_hash` matches `WorkspaceManager.snapshotHash()`
5. Publish kind:5252 trace via `SessionTrace.recordToolCall()` for every action

`closeSession`: `SessionTrace.drainToArweave()` → submit `SessionRegistry.closeSession()` via kind:5260 → publish kind:5103 with Arweave tx ID.

**Budget governor:** if `session.spentThisCycle >= budgetPerCycleUsdc`, `runCycle()` returns `{ status: 'budget_exceeded' }` — not a throw.

**Dead-man's switch:** if process dies mid-session, another `SessionManager` can call `reclaimLock()` after `lock_expires_slot` (integration test: kill process, advance mock slot, new agent reclaims).

**AC:**
- AC-15.8-1: `startSession()` elects non-zero `lockHolderKey` via Mina VRF and non-zero `lockExpiresSlot`
- AC-15.8-2: Relay events signed by `lockHolderKey`; verifiable against on-chain `lock_holder_key` field
- AC-15.8-3: After 50 iterations, `checkpoint()` auto-fires; on-chain `workspace_hash` matches `snapshotHash()`
- AC-15.8-4: `closeSession()` emits kind:5103 with Arweave tx ID; on-chain `lock_holder_key` zeroed
- AC-15.8-5: Budget governor returns `{ status: 'budget_exceeded' }` not a throw when limit reached
- AC-15.8-6: Dead-man's switch: kill process, advance mock Mina slot, new agent reclaims lock

**Dependencies:** 15.3, 15.4, 15.5, 15.6, 15.7, **Epic 13 story 13.9** (kind:5260 consumer SDK), **Epic 16 story 16.4** (Chain Bridge Mina adapter must exist as provider)

---

### Story 15.9 — Multi-Agent CAS Pointer Locking *(M)*

**Builds:** `src/cas-lock.ts` — `CASPointerLock`.

```ts
class CASPointerLock {
  compareAndSwap(
    path: string,
    expectedTxId: string | null,
    newTxId: string,
    sessionId: string
  ): Promise<'ok' | 'conflict'>

  resolveConflict(path: string): Promise<ConflictState>
}
```

If current pointer's `arweaveTxId !== expectedTxId` → `'conflict'`. `null` expectedTxId = first write, always succeeds. Integrated into `ActionDispatcher.act({ type: 'edit_file' })` — surfaces as `HarnessResult.status: 'conflict'`, not a thrown exception.

**AC:**
- AC-15.9-1: Two concurrent agents with same `expectedTxId` — exactly one `'ok'`, one `'conflict'`
- AC-15.9-2: `null` expectedTxId always succeeds (first write)
- AC-15.9-3: `edit_file` conflict is `HarnessResult.status: 'conflict'` not a throw; caller decides to retry
- AC-15.9-4: `resolveConflict()` returns both tx IDs when in conflict; `{ status: 'clean' }` when in sync

**Dependencies:** 15.5, 15.4

---

### Story 15.10 — DVM Provider Registration + Earning *(M)*

**Builds:** `src/composite-service-manager.ts` — `CompositeServiceManager`.

```ts
type CompositeHandler = (job: IncomingJob) => Promise<CompositeResult>

interface IncomingJob { jobId: string; input: unknown; paymentAmountUsdc: bigint }
interface CompositeResult { output: unknown; subJobCosts: bigint; margin: bigint }

class CompositeServiceManager {
  registerService(descriptor: SkillDescriptor, handler: CompositeHandler): void
  deregisterService(name: string): void
  getRevenueReport(): RevenueReport
}
```

Revenue tracker per service: `{ name, totalRevenue, totalCost, margin, executionCount }`.

**AC:**
- AC-15.10-1: `registerService()` publishes kind:10035; discoverable via `ServiceRegistry`
- AC-15.10-2: Incoming job dispatched to handler; result returned as kind:6250; ILP payment received
- AC-15.10-3: `getRevenueReport()` shows `margin > 0` for service where `earned > spentOnSubJobs`
- AC-15.10-4: Handler throw returns kind:7000 negative feedback; agent does not crash

**Dependencies:** 15.4, 15.2, Epic 14

---

### Story 15.11 — Runtime Capability Extension *(M)*

**Builds:** `src/capability-extender.ts` — `CapabilityExtender`.

```ts
interface CompositionProposal {
  name: string
  steps: Array<{ providerKind: number; features: string[] }>
  estimatedMargin: bigint
  rationale: string
}

class CapabilityExtender {
  watch(
    registry: ServiceRegistry,
    engine: ReasoningEngine,
    manager: CompositeServiceManager
  ): void
}
```

On new kind:10035 event: calls `engine.reasonStructured<CompositionProposal[]>()` with prompt describing existing services + new descriptor. Auto-registers proposals where `estimatedMargin > 0n`.

**AC:**
- AC-15.11-1: New kind:10035 on relay triggers `proposeComposition`; output is valid `CompositionProposal[]`
- AC-15.11-2: Profitable proposal auto-registers and appears on relay within 2s
- AC-15.11-3: Unprofitable proposal (`estimatedMargin <= 0n`) does NOT trigger registration
- AC-15.11-4: Malformed SkillDescriptor logs warning, no throw

**Dependencies:** 15.2, 15.3, 15.10

---

### Story 15.12 — Self-Sustaining Economics + E2E Validation *(L)*

**Builds:** `src/economics.ts` — `LoonyEconomics`.

```ts
interface LoonyEconomics {
  totalEarned: bigint
  totalSpent: bigint
  currentBalance: bigint
  cycleCount: number
  services: Array<{ name: string; revenue: bigint; cost: bigint; margin: bigint; executions: number }>
}
```

Self-pruning: after 5 consecutive negative-margin executions, `CompositeServiceManager.deregisterService()` + kind:5 deletion request. Budget governor: `willExceedReserve(proposedCost)`. Periodic kind:1 economics report every 5 cycles (transparent operation).

**Full E2E test scenario (10 cycles):**
1. Bootstrap from mnemonic on test network (townhouse dev stack, 28xxx ports)
2. Discover primitive providers (kind:5094, kind:5250, kind:5260) from relay
3. Run 10 autonomous OODA cycles via `SessionManager.runCycle()`
4. At least one composite service registered and executed
5. At least one runtime capability extension performed (new SkillDescriptor published mid-test)
6. Balance trending non-negative after all cycles
7. All cycle traces independently reconstructible from Arweave (drain + re-fetch)
8. On-chain `workspace_hash` at session close matches `WorkspaceManager.snapshotHash()`

**AC:**
- AC-15.12-1: 10 OODA cycles complete without human intervention
- AC-15.12-2: Self-pruning fires after 5 consecutive negative-margin executions; kind:5 published
- AC-15.12-3: `willExceedReserve()` blocks action when threshold would be breached
- AC-15.12-4: kind:1 economics event every 5 cycles; parseable as JSON from event content
- AC-15.12-5: Full E2E passes against townhouse dev stack; balance non-negative after 10 cycles
- AC-15.12-6: Arweave reconstruction: re-fetch all kind:5252 events for session → matches live trace

**Dependencies:** 15.8, 15.9, 15.10, 15.11, 15.6

---

### Story 15.13 — Compute DVM Session Affinity Extension *(S)*

**Builds:** Optional `['param', 'session-id', sessionId]` tag added to kind:5250 event builder/parser in `@toon-protocol/core`. `run_bash` in `ActionDispatcher` includes it from active session.

Provider handoff doc: `docs/provider-handoffs/compute-session-affinity.md` — affinity is best-effort (provider SHOULD route sequential calls with same `session-id` to the same worker), not cryptographically enforced.

**AC:**
- AC-15.13-1: kind:5250 from `run_bash` contains `['param','session-id',sessionId]`
- AC-15.13-2: Tag is optional — absent is valid; parser handles gracefully
- AC-15.13-3: Roundtrip: build → serialize → parse → `sessionId` extracted correctly
- AC-15.13-4: Provider handoff doc written explaining best-effort semantics

**Dependencies:** 15.4, 15.8, Epic 14

---

## Dependency Summary

| Dependency | Blocks | Why |
|---|---|---|
| Epic 8 (kind:5094) | 15.5, 15.6 | Arweave blob upload for workspace + trace drain |
| Epic 13 Track A | 15.8 | kind:5260 schema + consumer SDK |
| **Epic 14 (kind:5250)** | 15.3, 15.4, 15.8, 15.13 | Compute DVM consumer SDK — CRITICAL PATH |
| **Epic 16 story 16.3** | 15.7 | OvermindRegistry VRF pattern — do NOT start 15.7 before this |
| **Epic 16 story 16.4** | 15.8 | Chain Bridge Mina adapter must exist as provider |
| Epic 16 complete | 15.9–15.12 | Full harness substrate available |

## Story Complexity

| Story | Title | Size |
|---|---|---|
| 15.1 | Package Scaffold + Identity | S |
| 15.2 | Service Discovery | S |
| 15.3 | Decoupled LLM Inference | M |
| 15.4 | Harness Primitive Action Layer | M |
| 15.5 | Workspace State / kind:30000 | M |
| 15.6 | Session Trace Events / kind:5252 | M |
| **15.7** | **Mina zkApp SessionRegistry** | **L** |
| **15.8** | **Session Lifecycle Manager** | **L** |
| 15.9 | Multi-Agent CAS Locking | M |
| 15.10 | DVM Provider + Earning | M |
| 15.11 | Runtime Capability Extension | M |
| **15.12** | **Economics + E2E Validation** | **L** |
| 15.13 | Compute Session Affinity | S |

**Total: 2S + 7M + 3L = 13 stories**
