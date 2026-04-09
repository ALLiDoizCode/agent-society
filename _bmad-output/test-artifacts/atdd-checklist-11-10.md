# ATDD Checklist — Story 11-10: Ditto Proof Status UI

**Created:** 2026-04-09
**Story:** 11-10-ditto-proof-status-ui
**Package:** @toon-protocol/rig

## Acceptance Test Scenarios

### AC-1: ProofStatusBadge component

- [ ] **ATDD-1.1** GIVEN a `ProofStatusBadge` with `proofStatus="optimistic"`, WHEN rendered, THEN it displays text "Optimistic" and a Clock icon
- [ ] **ATDD-1.2** GIVEN a `ProofStatusBadge` with `proofStatus="proven"`, WHEN rendered, THEN it displays text "ZK Proven" and a ShieldCheck icon
- [ ] **ATDD-1.3** GIVEN a `ProofStatusBadge` with a custom `className`, WHEN rendered, THEN the className is applied to the root element
- [ ] **ATDD-1.4** GIVEN a `ProofStatusBadge` with an `aria-label`, WHEN rendered, THEN the aria-label is present on the element

### AC-2: PetInteractionCard component

- [ ] **ATDD-2.1** GIVEN a `PetInteractionCard` with `actionType=0`, WHEN rendered, THEN it displays "Feed"
- [ ] **ATDD-2.2** GIVEN a `PetInteractionCard` with `actionType=10`, WHEN rendered, THEN it displays "PlayMusic"
- [ ] **ATDD-2.3** GIVEN a `PetInteractionCard` with `proofStatus="optimistic"`, WHEN rendered, THEN a ProofStatusBadge with "Optimistic" is visible
- [ ] **ATDD-2.4** GIVEN a `PetInteractionCard` with `proofStatus="proven"`, WHEN rendered, THEN a ProofStatusBadge with "ZK Proven" is visible
- [ ] **ATDD-2.5** GIVEN a `PetInteractionCard` with a 64-char `brainHash`, WHEN rendered, THEN the hash is truncated to `xxxxxxxx...xxxx` format
- [ ] **ATDD-2.6** GIVEN a `PetInteractionCard` with non-null `content`, WHEN rendered, THEN final stat values (hunger, happiness, etc.) are displayed
- [ ] **ATDD-2.7** GIVEN a `PetInteractionCard` with `content=null`, WHEN rendered, THEN no stat crash occurs (graceful degradation)
- [ ] **ATDD-2.8** GIVEN a `PetInteractionCard` with `minaTx` present, WHEN rendered, THEN "Mina:" followed by the tx hash is shown

### AC-3: useProofStatus hook

- [ ] **ATDD-3.1** GIVEN an array of events with 2 optimistic and 1 proven, WHEN `useProofStatus` is called, THEN `{ optimisticCount: 2, provenCount: 1, total: 3 }` is returned
- [ ] **ATDD-3.2** GIVEN an empty array, WHEN `useProofStatus` is called, THEN `{ optimisticCount: 0, provenCount: 0, total: 0 }` is returned

### AC-4: pet-utils utility functions

- [ ] **ATDD-4.1** GIVEN `getActionName(0)`, THEN returns `'Feed'`
- [ ] **ATDD-4.2** GIVEN `getActionName(10)`, THEN returns `'PlayMusic'`
- [ ] **ATDD-4.3** GIVEN `getActionName(99)`, THEN returns `'Unknown'`
- [ ] **ATDD-4.4** GIVEN `getStageName(0)`, THEN returns `'Egg'`
- [ ] **ATDD-4.5** GIVEN `getStageName(2)`, THEN returns `'Adult'`
- [ ] **ATDD-4.6** GIVEN `getStageName(5)`, THEN returns `'Unknown'`
- [ ] **ATDD-4.7** GIVEN `truncateBrainHash('abcd1234ef56789012345678')`, THEN returns `'abcd1234...5678'`
- [ ] **ATDD-4.8** GIVEN `truncateBrainHash('short')`, THEN returns `'...'`

### AC-6: Build verification

- [ ] **ATDD-6.1** `pnpm build` compiles cleanly
- [ ] **ATDD-6.2** `pnpm lint` passes with 0 errors
- [ ] **ATDD-6.3** `pnpm --filter @toon-protocol/rig test` passes all tests

## Test Count — Final Delivered

| Level | Count | Location |
|-------|-------|----------|
| Unit (ProofStatusBadge) | 8 | proof-status-badge.test.tsx |
| Unit (PetInteractionCard) | 14 | pet-interaction-card.test.tsx |
| Unit (pet-utils) | 23 | pet-utils.test.ts |
| Hook (useProofStatus) | 7 | use-proof-status.test.ts |
| **Total delivered** | **52** | |
| **Minimum required** | 12 | |
