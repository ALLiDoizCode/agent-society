# Epic 20: Overmind Swarm — Agent Spawning + Coordination

**Epic ID:** 20
**Status:** DRAFT
**Author:** Bob (Technical Scrum Master)
**Date:** 2026-03-24
**PRD:** `_bmad-output/overmind-prd.md`
**Architecture:** `_bmad-output/overmind-architecture.md`
**Decisions:** `_bmad-output/planning-artifacts/research/party-mode-overmind-protocol-decisions-2026-03-24.md`

---

## Goal / Objective

Enable a sovereign overmind to create, fund, and coordinate sub-agents, forming hierarchical swarms with delegated tasks and managed treasuries.

---

## Dependencies

- **Epic 17B "Treasury"** (treasury management for sub-agent funding) — required, must be complete
- **Epic 18C "Sovereign"** (TEE key management for sub-agent key generation) — required, must be complete
- **Existing TOON infrastructure:** DVM lifecycle, ILP payment channels, NIP-44 encryption, relay

---

## New Packages / Infrastructure

- No new packages — builds on `packages/overmind` from Epic 16A
- New modules under `packages/overmind/src/swarm/`
- Multiple concurrent overmind instances required for testing (parent + children)

---

## Story List

| ID | Title | Dependencies | Complexity |
|----|-------|--------------|------------|
| 18.1 | Sub-Agent Spawning | Epics 14B + 14C complete | L |
| 18.2 | Parent-Child Encrypted Communication | E.1 | M |
| 18.3 | Task Delegation | E.1, E.2 | L |
| 18.4 | Swarm Treasury Management | E.1, E.3 | L |
| 18.5 | E2E: Overmind Spawns 3 Sub-Agents | E.1-E.4 | L |

---

## Story Details

### 17.1: Sub-Agent Spawning

**Title:** Parent overmind spawns a new sub-agent with keypair, funding, and registration

**Description:** As a parent overmind, I want to spawn a new sub-agent by generating a keypair inside my TEE enclave, funding its treasury via ILP, registering it on the Mina zkApp, and publishing its docker-compose.yml to Arweave, so that I can delegate tasks to purpose-built child agents.

**Acceptance Criteria:**

1. The parent overmind generates a new secp256k1 keypair for the sub-agent inside the TEE enclave.
2. The sub-agent's keypair is derived from the parent's master seed using a child derivation path (e.g., `m/44'/1237'/1'/0/N` where N is the child index).
3. The sub-agent is funded via ILP transfer from the parent's treasury with a configurable initial budget.
4. The sub-agent is registered on the OvermindRegistry zkApp with its public key.
5. A docker-compose.yml for the sub-agent is generated and uploaded to Arweave.
6. A kind:0 profile event is published for the sub-agent with a tag referencing the parent's npub.
7. The parent records the spawning in its event log with the child's npub, initial budget, and purpose.
8. The sub-agent's first kind:5099 wake request is published by the parent.

**Definition of Done:**

- [ ] Sub-agent keypair generated inside TEE
- [ ] Key derived from parent's master seed
- [ ] Sub-agent funded via ILP
- [ ] Registered on OvermindRegistry zkApp
- [ ] docker-compose.yml uploaded to Arweave
- [ ] kind:0 profile published with parent reference
- [ ] Spawning recorded in parent event log
- [ ] First kind:5099 published for sub-agent
- [ ] Unit tests pass
- [ ] Integration test passes
- [ ] Code reviewed, linted, formatted

---

### 17.2: Parent-Child Encrypted Communication

**Title:** Encrypted bidirectional communication between parent and child overmind

**Description:** As a parent overmind, I want encrypted bidirectional communication with my child agents via NIP-44 DMs using our respective encryption subkeys, so that task instructions and results can be exchanged securely without third-party visibility.

**Acceptance Criteria:**

1. Parent and child communicate via NIP-44 encrypted DMs using their encryption subkeys (from Epic 18C HD key hierarchy).
2. Messages are published to the TOON relay as encrypted kind:4 (or NIP-44 kind:1059 gift-wrapped) events.
3. The parent can send structured task instructions (JSON-encoded) to specific children.
4. Children can send structured results and status updates back to the parent.
5. Message ordering is maintained via timestamps and sequence numbers.
6. Messages are end-to-end encrypted -- the relay cannot read message contents.
7. The communication protocol supports broadcast from parent to all children and unicast to a specific child.

**Definition of Done:**

- [ ] NIP-44 encrypted communication between parent and child
- [ ] Structured task instructions and results
- [ ] Message ordering maintained
- [ ] End-to-end encryption (relay cannot read)
- [ ] Broadcast and unicast supported
- [ ] Unit tests pass
- [ ] Integration test passes
- [ ] Code reviewed, linted, formatted

---

### 17.3: Task Delegation

**Title:** Parent delegates tasks to children via DVM job requests

**Description:** As a parent overmind, I want to delegate tasks to specific child agents by publishing DVM job requests targeting them, have the children execute and report results, with payment flowing from parent to child via ILP, so that I can distribute work across my swarm.

**Acceptance Criteria:**

1. The parent publishes DVM job requests (kind:5090) with a `p` tag targeting a specific child's npub.
2. The child detects the job request during its Orient phase and accepts it in the Decide phase.
3. The child executes the job and delivers results via kind:5091.
4. ILP payment flows from parent to child after successful delivery.
5. The parent collects results from multiple children and aggregates them in its OODA cycle.
6. Failed delegations are retried or reassigned to a different child.
7. Task delegation and results are recorded in both parent and child event logs.

**Definition of Done:**

- [ ] Parent publishes targeted DVM jobs to children
- [ ] Children detect, accept, and execute jobs
- [ ] Results delivered via kind:5091
- [ ] ILP payment from parent to child
- [ ] Parent aggregates results from multiple children
- [ ] Failed delegations retried/reassigned
- [ ] Task flow recorded in event logs
- [ ] Unit tests pass
- [ ] Integration test passes
- [ ] Code reviewed, linted, formatted

---

### 17.4: Swarm Treasury Management

**Title:** Parent allocates budgets to children with reconciliation

**Description:** As a parent overmind, I want to allocate budgets to my child agents, have children track spend against their budgets, recall surplus from children, and perform full swarm treasury reconciliation on each wake cycle, so that the swarm's finances are managed coherently.

**Acceptance Criteria:**

1. The parent allocates a budget to each child during spawning or via a budget update message.
2. Children track their spending against their allocated budget.
3. Children report their treasury balance to the parent on each cycle (via encrypted message or kind:5102 tags).
4. The parent performs swarm treasury reconciliation during its Orient phase: sum of child balances + parent balance = total swarm treasury.
5. The parent can recall surplus funds from a child via ILP (child sends payment back to parent).
6. Budget reallocation (move funds between children) is supported.
7. If a child's balance drops below a critical threshold, the parent tops it up automatically.
8. Full swarm treasury state is persisted to Arweave in the parent's event log.

**Definition of Done:**

- [ ] Budget allocation to children
- [ ] Children track spend against budget
- [ ] Children report balance to parent
- [ ] Swarm treasury reconciliation in parent Orient phase
- [ ] Surplus recall from children via ILP
- [ ] Budget reallocation between children
- [ ] Auto top-up for low-balance children
- [ ] Swarm treasury state on Arweave
- [ ] Unit tests pass
- [ ] Integration test passes
- [ ] Code reviewed, linted, formatted

---

### 17.5: E2E: Overmind Spawns 3 Sub-Agents

**Title:** End-to-end test: parent spawns 3 sub-agents, delegates tasks, collects results

**Description:** As a verifier, I want to observe a parent overmind spawning 3 sub-agents, delegating distinct tasks to each, collecting results, and managing the combined treasury -- with all agents operational simultaneously -- so that I can confirm the swarm protocol works as designed.

**Acceptance Criteria:**

1. A parent overmind spawns 3 sub-agents, each with a distinct purpose/skill.
2. Each sub-agent is funded, registered on Mina, and boots autonomously via the wake cycle.
3. The parent delegates a unique task to each child via DVM job requests.
4. All 3 children execute their tasks and deliver results.
5. The parent collects and aggregates results from all 3 children.
6. Swarm treasury reconciliation shows correct balances across all 4 agents (parent + 3 children).
7. At least one budget reallocation or surplus recall occurs during the test.
8. All communication between parent and children is NIP-44 encrypted.
9. The test completes without manual intervention after initial parent setup.

**Definition of Done:**

- [ ] E2E test file created
- [ ] 3 sub-agents spawned and operational
- [ ] Distinct tasks delegated to each child
- [ ] All children execute and deliver results
- [ ] Parent aggregates results
- [ ] Swarm treasury reconciliation correct
- [ ] Budget reallocation occurs
- [ ] All communication encrypted
- [ ] Test uses graceful skip when infrastructure unavailable
- [ ] Test passes end-to-end
- [ ] Code reviewed, linted, formatted

---

## Epic Acceptance Criteria

- [ ] Sub-agent spawning with TEE key generation, funding, and Mina registration
- [ ] Parent-child encrypted communication via NIP-44
- [ ] Task delegation via DVM job requests with ILP payment
- [ ] Swarm treasury management with budget allocation, reconciliation, and surplus recall
- [ ] E2E test: parent spawns 3 sub-agents, delegates tasks, collects results, manages treasury
- [ ] All code reviewed, linted, formatted, tests passing

**Estimated Complexity:** L (5 stories, integrates Epics 14B + 14C capabilities)
