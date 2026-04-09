# Epic 17: Overmind Treasury — Self-Funding Agent

**Epic ID:** 17
**Status:** DRAFT
**Author:** Bob (Technical Scrum Master)
**Date:** 2026-03-24
**PRD:** `_bmad-output/overmind-prd.md`
**Architecture:** `_bmad-output/overmind-architecture.md`
**Decisions:** `_bmad-output/planning-artifacts/research/party-mode-overmind-protocol-decisions-2026-03-24.md`

---

## Goal / Objective

Enable the overmind to earn its own keep by providing DVM services, track all income and expenses, and adapt behavior based on treasury balance.

---

## Dependencies

- **Epic 16A "Heartbeat"** (complete wake cycle, OODA engine, Arweave persistence) — required, must be complete
- **Existing TOON infrastructure:** DVM lifecycle (kind:5090-5095), ILP payment channels, relay, service discovery (kind:10035 SkillDescriptor)

---

## New Packages / Infrastructure

- No new packages — builds on `packages/overmind` from Epic 16A
- New modules under `packages/overmind/src/treasury/` and `packages/overmind/src/dvm-provider/`

---

## Story List

| ID | Title | Dependencies | Complexity |
|----|-------|--------------|------------|
| 15.1 | DVM Provider Registration | Epic 16A complete | M |
| 15.2 | DVM Job Execution and Payment | B.1 | L |
| 15.3 | Treasury Accounting | B.2 | M |
| 15.4 | Adaptive Behavior Engine | B.3 | L |
| 15.5 | E2E: 100 Self-Funded Cycles | B.1-B.4 | L |

---

## Story Details

### 14.1: DVM Provider Registration

**Title:** Overmind registers as a DVM provider on the TOON relay

**Description:** As an overmind, I want to register as a DVM provider by publishing kind:31990 and kind:10035 SkillDescriptor events advertising my available skills and pricing on the TOON relay, so that other agents and users can discover and request my services.

**Acceptance Criteria:**

1. The overmind publishes a kind:31990 DVM provider profile event with its npub, supported job kinds, and pricing information.
2. A kind:10035 SkillDescriptor event is published for each skill the overmind offers, following the existing DVM skill discovery pattern.
3. Pricing information includes per-byte and per-job rates denominated in the protocol's ILP unit.
4. Registration occurs during the OODA Act phase as a standard action.
5. Provider registration is re-published periodically (configurable interval) to maintain freshness on the relay.
6. Registration events are signed with the overmind's signing key.

**Definition of Done:**

- [ ] kind:31990 provider profile published to relay
- [ ] kind:10035 SkillDescriptor published for each skill
- [ ] Pricing information included and correctly formatted
- [ ] Registration integrated into OODA Act phase
- [ ] Re-registration on configurable interval
- [ ] Unit tests pass
- [ ] Integration test passes against genesis relay
- [ ] Code reviewed, linted, formatted

---

### 14.2: DVM Job Execution and Payment

**Title:** Overmind accepts, executes, and delivers DVM jobs for ILP payment

**Description:** As an overmind, I want to accept incoming DVM job requests during wake cycles, execute them, deliver results, and receive ILP payment, so that I can earn revenue to sustain my autonomous operations.

**Acceptance Criteria:**

1. The overmind monitors the relay for incoming DVM job requests (kind:5090) targeting its npub during the Orient phase.
2. Job acceptance criteria are evaluated in the Decide phase (skill match, pricing acceptable, treasury capacity).
3. Accepted jobs are executed in the Act phase with results delivered via kind:5091 job result events.
4. ILP payment is received after successful delivery (pay-after-delivery model).
5. Failed or rejected jobs produce a kind:5092 rejection event with reason.
6. Job execution respects the signing policy (rate limits, value caps).

**Definition of Done:**

- [ ] Incoming DVM jobs detected during Orient phase
- [ ] Job acceptance logic in Decide phase
- [ ] Job execution and result delivery in Act phase
- [ ] ILP payment receipt confirmed
- [ ] Rejection events published for declined jobs
- [ ] Unit tests pass
- [ ] Integration test passes with DVM job flow
- [ ] Code reviewed, linted, formatted

---

### 14.3: Treasury Accounting

**Title:** Track all income and expenses with live balance queries

**Description:** As an overmind, I want to track all income (DVM fees, direct payments) and expenses (wake fees, execution fees, relay writes, Arweave storage, Mina TX fees) in agent-state.json, with the Orient phase querying LIVE balances (D-OMP-010), so that I always have an accurate picture of my financial state.

**Acceptance Criteria:**

1. A `TreasuryLedger` tracks all income and expense events with timestamps, amounts, categories, and transaction references.
2. Income categories: DVM job fees, direct ILP payments, subsidies.
3. Expense categories: wake cycle fees (provider payment), relay write fees, Arweave storage fees, Mina transaction fees, Chain Bridge crank fees.
4. The Orient phase queries live ILP channel balances and reconciles against the ledger (D-OMP-010: never trust cached financial state).
5. Treasury state is persisted to Arweave as part of agent-state.json on each cycle.
6. A `getTreasuryBalance()` method returns the current balance (income minus expenses).
7. Historical treasury data is queryable from the Arweave event log for auditing.

**Definition of Done:**

- [ ] `TreasuryLedger` implemented with income/expense tracking
- [ ] All income and expense categories covered
- [ ] Live balance query in Orient phase
- [ ] Treasury state persisted to Arweave each cycle
- [ ] Historical data auditable from event log
- [ ] Unit tests pass
- [ ] Integration test passes
- [ ] Code reviewed, linted, formatted

---

### 14.4: Adaptive Behavior Engine

**Title:** Adjust pricing, job acceptance, and wake frequency based on treasury level

**Description:** As an overmind, I want to adapt my pricing, job acceptance thresholds, and wake frequency based on my treasury level (critical/low/healthy/surplus), so that I can sustain operations during lean periods and maximize throughput during prosperous ones.

**Acceptance Criteria:**

1. Four treasury tiers are defined with configurable thresholds: `critical`, `low`, `healthy`, `surplus`.
2. **Critical:** Minimum wake frequency, accept all paying jobs regardless of margin, raise prices to maximum.
3. **Low:** Reduced wake frequency, accept jobs above minimum margin, moderate price increase.
4. **Healthy:** Normal wake frequency and pricing, standard job acceptance.
5. **Surplus:** Increased wake frequency, competitive pricing (lower margins acceptable), proactive job seeking.
6. Pricing changes trigger an updated kind:31990 publication.
7. Tier transitions are logged in the event log with reason and new parameter values.
8. Thresholds are configurable via `config/treasury-params.json` on Arweave.

**Definition of Done:**

- [ ] Four treasury tiers implemented with configurable thresholds
- [ ] Behavior adaptation for each tier (pricing, wake frequency, job acceptance)
- [ ] Updated kind:31990 published on pricing changes
- [ ] Tier transitions logged in event log
- [ ] Configuration stored on Arweave
- [ ] Unit tests pass for each tier
- [ ] Integration test passes
- [ ] Code reviewed, linted, formatted

---

### 14.5: E2E: 100 Self-Funded Cycles

**Title:** End-to-end test: overmind earns enough from DVM jobs to cover 100 cycles

**Description:** As a verifier, I want to observe an overmind completing 100 autonomous wake cycles funded entirely by DVM job revenue -- without external subsidy -- so that I can confirm the self-funding economic model works as designed.

**Acceptance Criteria:**

1. A test overmind is created and registered as a DVM provider.
2. A test client submits DVM jobs at a rate sufficient to fund the overmind's operations.
3. The overmind completes 100 consecutive wake cycles without external subsidy after an initial seed treasury.
4. Treasury balance remains above the critical threshold throughout all 100 cycles.
5. The adaptive behavior engine adjusts parameters at least once during the test (triggered by treasury fluctuations).
6. Treasury ledger accurately reflects all income and expenses across all 100 cycles.
7. The test completes without manual intervention after initial setup.

**Definition of Done:**

- [ ] E2E test file created with extended timeout
- [ ] 100 autonomous cycles complete without external subsidy
- [ ] Treasury balance stays above critical threshold
- [ ] Adaptive behavior triggers at least once
- [ ] Treasury ledger accurate across all cycles
- [ ] Test uses graceful skip when infrastructure unavailable
- [ ] Test passes end-to-end
- [ ] Code reviewed, linted, formatted

---

## Epic Acceptance Criteria

- [ ] Overmind registers as a DVM provider with discoverable skills and pricing
- [ ] Overmind accepts, executes, and delivers DVM jobs for ILP payment
- [ ] Treasury accounting tracks all income and expenses with live balance queries
- [ ] Adaptive behavior engine adjusts operations based on treasury tier
- [ ] E2E test: 100 self-funded cycles complete without external subsidy
- [ ] All code reviewed, linted, formatted, tests passing

**Estimated Complexity:** L (5 stories, builds on Epic 16A infrastructure)
