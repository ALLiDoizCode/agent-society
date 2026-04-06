# Epic 18: Overmind Biography — Recursive ZK Lifecycle Proofs

**Epic ID:** 18
**Status:** DRAFT
**Author:** Bob (Technical Scrum Master)
**Date:** 2026-03-24
**PRD:** `_bmad-output/overmind-prd.md`
**Architecture:** `_bmad-output/overmind-architecture.md`
**Decisions:** `_bmad-output/planning-artifacts/research/party-mode-overmind-protocol-decisions-2026-03-24.md`

---

## Goal / Objective

Compress every cycle the overmind executes into a constant-size recursive ZK proof that anyone can verify, replacing subjective reputation with mathematical fact.

---

## Dependencies

- **Epic 15A "Heartbeat"** (Mina zkApp, per-cycle execution data) — required, must be complete
- **Mina devnet:** OvermindRegistry zkApp deployed (from Epic 15A, Story A.3)
- **o1js:** `SelfProof` and `ZkProgram` APIs for recursive proof composition

---

## New Packages / Infrastructure

- No new packages — builds on `packages/overmind` from Epic 15A
- New modules under `packages/overmind/src/mina/biography/`
- HTTP endpoint for public biography verification (added to overmind runtime)

---

## Story List

| ID | Title | Dependencies | Complexity |
|----|-------|--------------|------------|
| 17.1 | Per-Cycle Proof Generation | Epic 15A complete | L |
| 17.2 | Recursive Proof Composition | D.1 | XL |
| 17.3 | Verifiable Execution Count | D.2 | M |
| 17.4 | Public Biography Endpoint | D.3 | M |
| 17.5 | E2E: 100-Cycle Recursive Proof | D.1-D.4 | L |

---

## Story Details

### 16.1: Per-Cycle Proof Generation

**Title:** Generate a Mina ZK proof for each execution cycle

**Description:** As an overmind, I want to generate a Mina ZK proof for each execution cycle containing the executor ID, cycle number, inputs hash, outputs hash, and TEE attestation hash, so that each cycle is individually verifiable and can be composed into a recursive biography proof.

**Acceptance Criteria:**

1. A `CycleProof` ZkProgram is implemented in o1js that proves a single cycle execution.
2. The proof contains: executor public key, cycle number, inputs hash (Poseidon hash of orient data), outputs hash (Poseidon hash of act results), TEE attestation hash.
3. Proof generation completes within 120 seconds.
4. The proof is published alongside the kind:5102 cycle execution record (as a tag or referenced Arweave upload).
5. Any third party can verify the proof using the ZkProgram's verification key.
6. The proof is serializable for storage on Arweave and transmission via relay.

**Definition of Done:**

- [ ] `CycleProof` ZkProgram implemented in o1js
- [ ] Proof contains all required fields
- [ ] Proof generation under 120 seconds
- [ ] Proof published with kind:5102 record
- [ ] Third-party verification works
- [ ] Proof serializable for Arweave storage
- [ ] Unit tests pass using `Mina.LocalBlockchain()`
- [ ] Integration test passes
- [ ] Code reviewed, linted, formatted

---

### 16.2: Recursive Proof Composition

**Title:** Compose per-cycle proofs into a single recursive proof using SelfProof/ZkProgram

**Description:** As an overmind, I want my per-cycle proofs to be recursively composed into a single proof that verifies my entire execution history, so that anyone can verify my complete lifecycle with a constant-size proof regardless of how many cycles I have executed.

**Acceptance Criteria:**

1. A recursive `BiographyProof` ZkProgram is implemented using `SelfProof` that composes cycle proofs.
2. Each recursive step verifies the previous biography proof inside the new proof.
3. The resulting proof is constant-size regardless of the number of cycles composed.
4. The recursive proof contains: total execution count, latest cycle number, cumulative inputs/outputs hash, initial cycle reference.
5. Proof composition is performed at the end of each cycle (after per-cycle proof generation).
6. The latest biography proof is stored on Arweave and referenced in the kind:5102 record.
7. Verification of the biography proof confirms the entire chain of execution without replaying individual cycle proofs.

**Definition of Done:**

- [ ] `BiographyProof` recursive ZkProgram implemented
- [ ] Each step verifies previous proof via `SelfProof`
- [ ] Proof size is constant regardless of cycle count
- [ ] Cumulative state tracked in proof
- [ ] Proof composed at end of each cycle
- [ ] Latest biography proof stored on Arweave
- [ ] Verification confirms entire execution chain
- [ ] Unit tests pass
- [ ] Integration test passes
- [ ] Code reviewed, linted, formatted

---

### 16.3: Verifiable Execution Count

**Title:** Execution count queryable from Mina zkApp state, used as VRF weight

**Description:** As the TOON network, I want each overmind's execution count to be queryable from the Mina zkApp state and used as the VRF weight input for executor selection, so that reputation is based on unforgeable, verified execution history rather than subjective scoring (D-OMP-005).

**Acceptance Criteria:**

1. The execution count is stored on-chain in the OvermindRegistry zkApp, updated via the recursive biography proof.
2. The count reflects only verified executions (backed by ZK proofs) -- it cannot be incremented without a valid cycle proof.
3. The execution count is used as the `executionCount` input to the VRF weight formula: `(executionCount + 1) * teeMultiplier`.
4. Any third party can query the execution count from Mina state without trusting the overmind.
5. The count is monotonically increasing and matches the biography proof's total execution count.

**Definition of Done:**

- [ ] Execution count stored on-chain in OvermindRegistry
- [ ] Count updated only via valid ZK proof
- [ ] Count used as VRF weight input
- [ ] Third-party queryable from Mina state
- [ ] Monotonically increasing, matches biography proof
- [ ] Unit tests pass
- [ ] Integration test passes
- [ ] Code reviewed, linted, formatted

---

### 16.4: Public Biography Endpoint

**Title:** HTTP endpoint returning the agent's recursive proof and verification instructions

**Description:** As a third-party verifier, I want an HTTP endpoint that returns the overmind's current biography proof, Arweave event log references, and verification instructions, so that I can verify the agent's complete lifecycle without trust.

**Acceptance Criteria:**

1. An HTTP endpoint (e.g., `GET /biography`) is added to the overmind runtime.
2. The response includes: the latest recursive biography proof (serialized), the verification key, total execution count, Arweave event log TX IDs, and step-by-step verification instructions.
3. The response is JSON-formatted with clear field descriptions.
4. The verification instructions include the o1js version and verification code snippet.
5. The endpoint is publicly accessible (no authentication required).
6. The biography data is also queryable from Arweave directly (the endpoint is a convenience, not a single point of failure).

**Definition of Done:**

- [ ] HTTP endpoint implemented and accessible
- [ ] Response includes proof, verification key, execution count, Arweave references
- [ ] Verification instructions included
- [ ] JSON-formatted response
- [ ] Publicly accessible without auth
- [ ] Data also available on Arweave
- [ ] Unit tests pass
- [ ] Integration test passes
- [ ] Code reviewed, linted, formatted

---

### 16.5: E2E: 100-Cycle Recursive Proof

**Title:** Generate and verify a 100-cycle recursive proof with constant size

**Description:** As a verifier, I want to observe a 100-cycle recursive biography proof being generated and verified -- confirming that proof size remains constant and verification completes in under 1 second -- so that I can confirm the biography protocol scales as designed.

**Acceptance Criteria:**

1. An overmind executes 100 cycles, generating a per-cycle proof and composing the recursive biography proof at each step.
2. The final biography proof is the same size as the proof after cycle 1 (constant-size verification).
3. Verification of the 100-cycle proof completes in under 1 second.
4. The proof's execution count reads 100.
5. The proof can be verified independently using only the verification key and the serialized proof (no access to the overmind or Arweave required).
6. The biography endpoint returns the correct 100-cycle proof.

**Definition of Done:**

- [ ] E2E test file created with extended timeout
- [ ] 100 cycles with recursive proof composition
- [ ] Proof size constant (same as 1-cycle proof)
- [ ] Verification under 1 second
- [ ] Execution count reads 100
- [ ] Independent verification works
- [ ] Biography endpoint returns correct proof
- [ ] Test uses graceful skip when infrastructure unavailable
- [ ] Test passes end-to-end
- [ ] Code reviewed, linted, formatted

---

## Epic Acceptance Criteria

- [ ] Per-cycle Mina ZK proofs generated for each execution cycle
- [ ] Recursive proof composition produces constant-size biography proof
- [ ] Verifiable execution count on Mina replaces subjective reputation (D-OMP-005)
- [ ] Public biography endpoint enables trustless verification
- [ ] E2E test: 100-cycle recursive proof verified in under 1 second
- [ ] All code reviewed, linted, formatted, tests passing

**Estimated Complexity:** L (5 stories, advanced o1js but building on Epic 15A zkApp)
