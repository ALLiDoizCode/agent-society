# Story {{epic_num}}.{{story_num}}: {{story_title}}

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a {{role}},
I want {{action}},
so that {{benefit}}.

## Acceptance Criteria

1. [Add acceptance criteria from epics/PRD]

## Tasks / Subtasks

- [ ] Task 1 (AC: #)
  - [ ] Subtask 1.1
- [ ] Task 2 (AC: #)
  - [ ] Subtask 2.1

## Dev Notes

- Relevant architecture patterns and constraints
- Source tree components to touch
- Testing standards summary

### Standard Guards (Epic 11 Retro)

- **CI workflow SHAs:** If this story creates or modifies GitHub Actions workflows, pin ALL action references to full commit SHAs (not tags). Unpinned SHAs are an OWASP A08 supply-chain risk. Example: `uses: actions/checkout@<full-sha>` not `uses: actions/checkout@v4`.
- **MAX_SAFE_INTEGER guard:** If this story bridges Rust u64 (or any 64-bit integer) values into JavaScript, guard against exceeding `Number.MAX_SAFE_INTEGER` (2^53 - 1) before assigning to a JS `number`. Use `BigInt` for values that may exceed this limit. Pattern: `if (value > Number.MAX_SAFE_INTEGER) throw new RangeError(...)`.
- **Golden test vectors (ZK story pairs):** If this story is part of a ZK circuit + game engine pair where two systems must produce identical outputs, a shared `golden-vectors.json` file is a **P0 required deliverable**, not optional. Both sides must validate against the same vectors.

### Project Structure Notes

- Alignment with unified project structure (paths, modules, naming)
- Detected conflicts or variances (with rationale)

### References

- Cite all technical details with source paths and sections, e.g. [Source: docs/<file>.md#Section]

## Dev Agent Record

### Agent Model Used

{{agent_model_name_version}}

### Debug Log References

### Completion Notes List

### File List
