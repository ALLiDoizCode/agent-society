# Traceability Matrix — Story 11-10: Ditto Proof Status UI

**Date:** 2026-04-09
**Package:** @toon-protocol/rig
**Test files:** 4 (pet-utils.test.ts, proof-status-badge.test.tsx, pet-interaction-card.test.tsx, use-proof-status.test.ts)
**Total tests:** 52

## AC → Test Mapping

| AC | Description | Covering Tests | File | Count |
|----|-------------|---------------|------|-------|
| AC-1 | ProofStatusBadge component | renders Optimistic text for optimistic status | proof-status-badge.test.tsx | 1 |
| AC-1 | ProofStatusBadge component | renders ZK Proven text for proven status | proof-status-badge.test.tsx | 1 |
| AC-1 | ProofStatusBadge component | applies custom className to optimistic badge | proof-status-badge.test.tsx | 1 |
| AC-1 | ProofStatusBadge component | applies custom className to proven badge | proof-status-badge.test.tsx | 1 |
| AC-1 | ProofStatusBadge component | passes aria-label to optimistic badge | proof-status-badge.test.tsx | 1 |
| AC-1 | ProofStatusBadge component | passes aria-label to proven badge | proof-status-badge.test.tsx | 1 |
| AC-1 | ProofStatusBadge component | optimistic badge has amber border styling | proof-status-badge.test.tsx | 1 |
| AC-1 | ProofStatusBadge component | proven badge has green background styling | proof-status-badge.test.tsx | 1 |
| **AC-1 Total** | | | | **8** |
| AC-2 | PetInteractionCard component | renders the action name for actionType 0 (Feed) | pet-interaction-card.test.tsx | 1 |
| AC-2 | PetInteractionCard component | renders the action name for actionType 10 (PlayMusic) | pet-interaction-card.test.tsx | 1 |
| AC-2 | PetInteractionCard component | renders stage name Baby for stage 1 | pet-interaction-card.test.tsx | 1 |
| AC-2 | PetInteractionCard component | renders stage name Adult for stage 2 | pet-interaction-card.test.tsx | 1 |
| AC-2 | PetInteractionCard component | renders cycle number | pet-interaction-card.test.tsx | 1 |
| AC-2 | PetInteractionCard component | renders optimistic proof status badge | pet-interaction-card.test.tsx | 1 |
| AC-2 | PetInteractionCard component | renders proven proof status badge | pet-interaction-card.test.tsx | 1 |
| AC-2 | PetInteractionCard component | renders truncated brain hash | pet-interaction-card.test.tsx | 1 |
| AC-2 | PetInteractionCard component | renders final stat values when content present | pet-interaction-card.test.tsx | 1 |
| AC-2 | PetInteractionCard component | does not crash when content is null | pet-interaction-card.test.tsx | 1 |
| AC-2 | PetInteractionCard component | does not render stat labels when content is null | pet-interaction-card.test.tsx | 1 |
| AC-2 | PetInteractionCard component | renders Mina TX when minaTx is present | pet-interaction-card.test.tsx | 1 |
| AC-2 | PetInteractionCard component | does not render Mina section when minaTx absent | pet-interaction-card.test.tsx | 1 |
| AC-2 | PetInteractionCard component | applies custom className | pet-interaction-card.test.tsx | 1 |
| **AC-2 Total** | | | | **14** |
| AC-3 | useProofStatus hook | returns zero counts for empty array | use-proof-status.test.ts | 1 |
| AC-3 | useProofStatus hook | counts a single optimistic event | use-proof-status.test.ts | 1 |
| AC-3 | useProofStatus hook | counts a single proven event | use-proof-status.test.ts | 1 |
| AC-3 | useProofStatus hook | counts mixed optimistic and proven events | use-proof-status.test.ts | 1 |
| AC-3 | useProofStatus hook | counts all proven events | use-proof-status.test.ts | 1 |
| AC-3 | useProofStatus hook | counts all optimistic events | use-proof-status.test.ts | 1 |
| AC-3 | useProofStatus hook | total = optimisticCount + provenCount invariant | use-proof-status.test.ts | 1 |
| **AC-3 Total** | | | | **7** |
| AC-4 | pet-utils utility functions | getActionName 0-10 (11 tests) | pet-utils.test.ts | 11 |
| AC-4 | pet-utils utility functions | getActionName out-of-range (2 tests) | pet-utils.test.ts | 2 |
| AC-4 | pet-utils utility functions | getStageName 0-2 (3 tests) | pet-utils.test.ts | 3 |
| AC-4 | pet-utils utility functions | getStageName out-of-range (2 tests) | pet-utils.test.ts | 2 |
| AC-4 | pet-utils utility functions | truncateBrainHash normal/boundary/short (5 tests) | pet-utils.test.ts | 5 |
| **AC-4 Total** | | | | **23** |
| AC-5 | Unit tests >= 12 | 52 total tests delivered | all 4 test files | **52** |
| AC-6 | Build verification | pnpm build — 0 errors | process verification | — |
| AC-6 | Build verification | pnpm lint — 0 errors | process verification | — |
| AC-6 | Build verification | pnpm --filter @toon-protocol/rig test — 395 pass | process verification | — |

## Summary

| AC | Status | Tests |
|----|--------|-------|
| AC-1 | COVERED | 8 |
| AC-2 | COVERED | 14 |
| AC-3 | COVERED | 7 |
| AC-4 | COVERED | 23 |
| AC-5 | COVERED | 52 ≥ 12 minimum |
| AC-6 | COVERED | build/lint/test all pass |
| **Total** | **ALL COVERED** | **52** |
