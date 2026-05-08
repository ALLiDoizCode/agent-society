# Story 44.4: Connector — `CONNECTOR_RELEASE_CONTRACT.md` Cross-Repo Doc

Status: review

> **CROSS-REPO STORY (UPSTREAM + LOCAL).** This is the only Epic 44 story that touches BOTH repos. The doc body must be byte-identical at `connector/CONNECTOR_RELEASE_CONTRACT.md` AND `packages/sdk/CONNECTOR_RELEASE_CONTRACT.md`. The connector-side file already exists (Story 44.3 created the `## Supply-chain signing` section); this story EXTENDS it with the API stability discipline (the load-bearing piece Epic 44 was waiting on) and CREATES the town-side mirror. Two PRs land in lock-step: one in `toon-protocol/connector`, one in `toon-protocol/town`.

## Story

As a **townhouse maintainer** about to consume `@toon-protocol/connector` by digest in `image-manifest.json`,
I want a written contract that pins how connector versions map to admin-API stability guarantees,
so that the team doesn't accidentally consume a breaking-change release between digest-pin time and pilot ship — and so that downstream operators can read one canonical document explaining what `vX.Y.Z → vX.Y'.Z'` means for the `/admin/*` surface they depend on.

## Acceptance Criteria

1. **Doc exists at both paths with byte-identical body.** `connector/CONNECTOR_RELEASE_CONTRACT.md` is updated and `packages/sdk/CONNECTOR_RELEASE_CONTRACT.md` is created with the same content. A `diff -q` between them after both PRs merge returns no differences in body content (the only allowed divergence is path-specific front-matter / sync-source notes outside the body, see Task 3.1).

2. **API stability rules are stated explicitly.** The doc contains a top-level `## API stability` (or equivalent name) section that codifies:
   - `/admin/*` field **additions** = MINOR bump (e.g., `v3.3.x → v3.4.0`).
   - `/admin/*` field **renames or removals** = MAJOR bump (e.g., `v3.x → v4.0`).
   - `/admin/*` endpoint **additions** = MINOR bump.
   - `/admin/*` endpoint **renames or removals** = MAJOR bump.
   - **ILP packet wire-format changes** = MAJOR bump.
   - **Townhouse pin discipline:** townhouse pins by digest in `packages/townhouse/dist/image-manifest.json` (Story 45.1 territory) and bumps deliberately on each MINOR connector release after running the contract canary (`packages/sdk/tests/integration/connector-contract.test.ts`).

3. **Cross-references existing supply-chain sections.** The doc retains and references the existing `## Supply-chain signing` (Story 44.3) and `## Recommended pinning strategy` content. The new `## API stability` section sits between `## Stability guarantees` and `## Supply-chain signing` so the read order is: artifact stability → API stability → supply-chain signing → pinning advice.

4. **Multi-arch capability is documented as a producer commitment.** A short paragraph in `## Stability guarantees` (or in the artifacts table) states the `linux/amd64,linux/arm64` commitment from Story 44.2 and notes that adding architectures is a build-only change (no semver bump required); removing an architecture is a breaking change requiring a MAJOR bump.

5. **Subscription mechanism is documented, not automated.** A short `## Staying current` (or equivalent name) section names the canonical mechanism townhouse maintainers use to learn about new connector releases:
   - GitHub UI: `Watch → Custom → Releases` on `toon-protocol/connector`.
   - Equivalent gh CLI: `gh api -X PUT /repos/toon-protocol/connector/subscription -f subscribed=true -f ignored=false` (note: the API does not expose a releases-only filter — UI subscription is preferred for the precise filter).
   - The doc explicitly notes that automated subscription (e.g., a GitHub Actions cron polling `gh release view`) is OUT OF SCOPE for v1 and tracked as Open Thread #2 in the Townhouse HS-Mode v1 epic.

6. **CHANGELOG entries point to the new doc.** The connector repo's `CHANGELOG.md` `[Unreleased] ### Documentation` (or `### Build` if `### Documentation` is excluded by the semantic-release config) section gains an entry: `Codify /admin/* semver discipline in CONNECTOR_RELEASE_CONTRACT.md (Story 44.4 / PR #<num>)`. Town has no `CHANGELOG.md` at any level (verified 2026-05-08); the equivalent town-side pointer lands as a new "See also" cross-link from `packages/sdk/CONNECTOR_MIGRATION.md` to the new `packages/sdk/CONNECTOR_RELEASE_CONTRACT.md` plus a `## Where to Find Things` row in `CLAUDE.md`. A standalone `CHANGELOG.md` is NOT created in town for this single entry — the cross-link discipline is town's "changelog equivalent" (verified by reading the existing `packages/sdk/CONNECTOR_MIGRATION.md` which already serves this role for connector-version bumps).

7. **Drive-by fix from Story 44.3.** Lines 39 and 153 of `connector/CONNECTOR_RELEASE_CONTRACT.md` currently carry an unresolved `https://github.com/toon-protocol/connector/pull/<num>` placeholder (verified on `origin/main` 2026-05-08). Replace `pull/<num>` with `pull/66` on both lines as part of the connector PR. This is a small follow-up to a 44.3 task that did not complete its own placeholder substitution; including it here avoids a third connector PR.

8. **Sprint-status update.** Update `_bmad-output/implementation-artifacts/sprint-status.yaml` ONLY AFTER both PRs merge: `44-4-connector-release-contract-cross-repo-doc: backlog → done`. Mirror Story 44.3's status comment style: name both PR numbers (connector PR + town PR). Bump `last_updated` to the merge date.

## Tasks / Subtasks

- [x] **Task 1: Read both repos' current state** (AC: #1, #3, #7)
  - [x] 1.1 `cd /home/jonathan/Documents/connector && git checkout main && git pull` — start from connector tip (currently `2407cec chore(release): 3.6.0 [skip ci]`)
  - [x] 1.2 Read `connector/CONNECTOR_RELEASE_CONTRACT.md` end-to-end. Confirm sections present: `## Artifacts`, `## Stability guarantees`, `## Supply-chain signing` (added by 44.3), `## Recommended pinning strategy`, `## Historical tag corruption`, `## Verification`, `## References`. Confirm placeholders on lines 39 + 153.
  - [x] 1.3 Read `packages/sdk/CONNECTOR_MIGRATION.md` (town) end-to-end. Confirm it is a runtime API canary contract — scope is distinct from the release contract this story creates. The two docs will coexist as siblings; one is "what the SDK imports" (canary), the other is "what the connector promises to versioned consumers" (this story).
  - [x] 1.4 Confirm town has no `CHANGELOG.md` at root, `packages/townhouse/`, or `packages/sdk/` (verified empty 2026-05-08; document this in the connector PR body so reviewers understand the asymmetric CHANGELOG treatment).

- [x] **Task 2: Write the canonical doc body** (AC: #2, #3, #4, #5, #7)
  - [x] 2.1 In a scratch buffer (or directly on the connector-side file), draft the new `## API stability` section between the existing `## Stability guarantees` and `## Supply-chain signing` sections. Keep the prose terse; the table format works well for the rule list:
    ```markdown
    ## API stability

    The connector's HTTP admin API surface (everything under `/admin/*`) follows
    strict semver discipline. The rules below tell consumers what kind of
    version bump to expect for any change.

    | Change                                      | Bump   | Example                |
    | ------------------------------------------- | ------ | ---------------------- |
    | `/admin/*` field addition                   | MINOR  | `v3.3.x → v3.4.0`      |
    | `/admin/*` field rename or removal          | MAJOR  | `v3.x → v4.0`          |
    | `/admin/*` endpoint addition                | MINOR  | `v3.3.x → v3.4.0`      |
    | `/admin/*` endpoint rename or removal       | MAJOR  | `v3.x → v4.0`          |
    | ILP packet wire-format change               | MAJOR  | `v3.x → v4.0`          |
    | Image architecture addition (e.g. `arm64`)  | none   | build-only change      |
    | Image architecture removal                  | MAJOR  | breaks pinning consumers |

    ### Townhouse pin discipline

    Townhouse pins the connector image **by digest** in
    `packages/townhouse/dist/image-manifest.json` (built by the publish
    workflow — Story 45.1). Each MINOR connector release triggers a manual
    digest-pin bump in townhouse, gated on the contract canary
    (`pnpm --filter @toon-protocol/sdk test:integration -- tests/integration/connector-contract.test.ts`)
    passing at the new digest. Patch releases (`vX.Y.z → vX.Y.z+1`) do not
    require a townhouse bump unless the patch fixes a behavior townhouse
    actively relied on being broken. Major bumps require a deliberate
    townhouse migration cycle and a CONNECTOR_MIGRATION.md row.
    ```
  - [x] 2.2 Add a single sentence to the `## Artifacts` table or the prose surrounding it: `Multi-arch images (linux/amd64 + linux/arm64) ship from the first release after PR #63; adding architectures is a build-only change (no semver bump). Removing an architecture is a breaking change requiring a MAJOR bump.` (this satisfies AC #4).
  - [x] 2.3 Add a new `## Staying current` section (placed between `## Recommended pinning strategy` and `## Historical tag corruption`):
    ```markdown
    ## Staying current

    Downstream consumers (notably `toon-protocol/town`'s townhouse package)
    learn about new connector releases via:

    1. **GitHub UI subscription** — *preferred*: `Watch → Custom → Releases`
       on `toon-protocol/connector`. Releases-only is a UI-side filter the
       REST API does not expose.
    2. **`gh` CLI subscription** — *fallback*: `gh api -X PUT
       /repos/toon-protocol/connector/subscription -f subscribed=true -f
       ignored=false` subscribes to all repository events, not just releases.

    Automated subscription (e.g. a GitHub Actions cron polling `gh release
    view` and opening a digest-bump PR into townhouse) is OUT OF SCOPE for
    v1 and tracked as Open Thread #2 in the Townhouse HS-Mode v1 epic.
    ```
  - [x] 2.4 Replace `pull/<num>` with `pull/66` on lines 39 and 153 of `connector/CONNECTOR_RELEASE_CONTRACT.md` (drive-by fix per AC #7).
  - [x] 2.5 Sanity-read the assembled doc top-to-bottom: section order should read artifacts → stability guarantees → API stability → supply-chain signing → pinning strategy → staying current → historical tag corruption → verification → references.

- [ ] **Task 3: Land the connector-side PR** (AC: #1, #6)
  - [x] 3.1 New branch in connector repo: `git checkout -b docs/release-contract-api-stability` (from `main`).
  - [x] 3.2 Apply the edits from Task 2 to `connector/CONNECTOR_RELEASE_CONTRACT.md`. The doc body should now be the canonical content the town-side file will mirror.
  - [x] 3.3 Update `connector/CHANGELOG.md` `[Unreleased]` block with a `### Documentation` (or `### Build` — match whatever section already exists in `[Unreleased]` to avoid creating a singleton heading) entry: `Codify /admin/* semver discipline in CONNECTOR_RELEASE_CONTRACT.md (Story 44.4 / PR #<num>)`.
  - [x] 3.4 Conventional-commit message: `docs(release): codify /admin/* semver discipline in release contract`. Semantic-release maps `docs(...)` to no version bump — this PR alone does not cut a release; that's intentional (the contract is forward-applying, not retroactive).
  - [x] 3.5 Open PR via `gh pr create` against `toon-protocol/connector:main`. The PR body must include:
    - Inventory of doc edits (one bullet per added section + the line 39/153 placeholder fix)
    - Note that town has no CHANGELOG.md and the asymmetric CHANGELOG treatment is intentional (cross-link from CONNECTOR_MIGRATION.md substitutes)
    - The exact body content that will land in the town-side mirror PR (so reviewers can verify byte-equivalence at review time, not after both PRs merge)
  - [x] 3.6 Capture the assigned PR number; update the placeholder `PR #<num>` in the CHANGELOG entry to the real number with a follow-up commit before requesting review (matches the workflow Story 44.3 documented and partially executed).

- [ ] **Task 4: Land the town-side PR** (AC: #1, #6)
  - [x] 4.1 New branch in town repo: `git checkout -b docs/connector-release-contract-mirror` (from `main`).
  - [x] 4.2 Create `packages/sdk/CONNECTOR_RELEASE_CONTRACT.md` with body content **byte-identical** to the connector-side file produced in Task 3. The only allowed divergence is the file's TOP, which gets a 3-line front-matter comment block:
    ```markdown
    <!-- This file is mirrored from `connector/CONNECTOR_RELEASE_CONTRACT.md` in toon-protocol/connector. -->
    <!-- Edits should land in both repos in the same review cycle. -->
    <!-- Drift detection: `diff connector/CONNECTOR_RELEASE_CONTRACT.md packages/sdk/CONNECTOR_RELEASE_CONTRACT.md` (after stripping these 3 comment lines) returns empty. -->
    ```
    Place the same 3-line block at the top of the connector-side file too (Task 2.5 amendment), so the comment header itself is identical and `diff` is byte-clean. (If you prefer to keep the connector file unchanged, the alternative discipline is "diff body-only" — pick the simplest one and document the chosen rule in the Verification section of the doc.)
  - [x] 4.3 Add a "See also" cross-link at the top of `packages/sdk/CONNECTOR_MIGRATION.md`, just under the H1 and the existing intro paragraph:
    ```markdown
    > **See also:** [`CONNECTOR_RELEASE_CONTRACT.md`](./CONNECTOR_RELEASE_CONTRACT.md) — the upstream `@toon-protocol/connector` release contract describing semver discipline for the `/admin/*` API surface, supply-chain signing, and digest-pinning strategy. This file (CONNECTOR_MIGRATION.md) is the runtime canary contract the SDK enforces; the contract file is the producer-side promise. Read both when bumping `@toon-protocol/connector` minor or major versions.
    ```
    This cross-link is town's "changelog equivalent" per AC #6.
  - [x] 4.4 Update root `CLAUDE.md` `## Where to Find Things` table: add a row `| Connector release contract (semver discipline) | packages/sdk/CONNECTOR_RELEASE_CONTRACT.md |` immediately above the existing `Connector API contract + migration history | packages/sdk/CONNECTOR_MIGRATION.md` row. Same edit makes `CONNECTOR_RELEASE_CONTRACT.md` discoverable from CLAUDE.md.
  - [x] 4.5 Conventional-commit message: `docs(sdk): mirror CONNECTOR_RELEASE_CONTRACT.md from connector repo (Story 44.4)`.
  - [x] 4.6 Open PR via `gh pr create` against `toon-protocol/town:main`. The PR body must include:
    - The connector PR URL (so reviewers can verify byte-equivalence)
    - Confirmation that `diff <(tail -n +N1 connector/CONNECTOR_RELEASE_CONTRACT.md) <(tail -n +N2 packages/sdk/CONNECTOR_RELEASE_CONTRACT.md)` returns empty (where N1, N2 strip the comment header — show the actual diff command in the PR body)

- [x] **Task 5: Verify byte-equivalence + close out** (AC: #1, #8)
  - [x] 5.1 After BOTH PRs merge, run from the parent directory containing both clones:
    ```bash
    diff /home/jonathan/Documents/connector/CONNECTOR_RELEASE_CONTRACT.md \
         /home/jonathan/Documents/town/packages/sdk/CONNECTOR_RELEASE_CONTRACT.md
    ```
    The only expected output is the 3-line comment header divergence (or empty, if the same header was added to both files per Task 4.2 alternative). Anything else is a drift defect — open a follow-up PR before marking the story done.
    **Pre-merge verification ran 2026-05-08 — diff returned empty. Re-run post-merge to confirm.**
  - [ ] 5.2 Update `_bmad-output/implementation-artifacts/sprint-status.yaml`: `44-4-connector-release-contract-cross-repo-doc: backlog → done`. Trailing comment style mirrors 44.3: `# done: doc mirrored at packages/sdk/CONNECTOR_RELEASE_CONTRACT.md — connector#<connector-PR>, town#<town-PR>`.
    **POST-MERGE: Sprint-status is currently `review` (connector#67, town#34 open). Flip to `done` after both PRs merge.**
  - [ ] 5.3 Bump `last_updated` field at the top of `sprint-status.yaml` to the day both PRs merged.
    **POST-MERGE: Deferred.**
  - [ ] 5.4 Town commit: `chore(townhouse): mark Story 44.4 done — release contract mirrored to packages/sdk (connector#<PR>, town#<PR>)`.
    **POST-MERGE: Deferred.**
  - [x] 5.5 Update this story file's `Status: ready-for-dev → review` (or `done` after self-review) and fill in the Dev Agent Record below.

## Dev Notes

### Cross-Repo Boundary

The two files this story touches in `toon-protocol/town`:
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (Task 5.2)
- `packages/sdk/CONNECTOR_RELEASE_CONTRACT.md` (Task 4.2 — NEW file)
- `packages/sdk/CONNECTOR_MIGRATION.md` (Task 4.3 — single "See also" cross-link added near the top)
- `CLAUDE.md` (Task 4.4 — single row added to "Where to Find Things")
- This story file itself (Task 5.5)

The four files this story touches in `toon-protocol/connector`:
- `CONNECTOR_RELEASE_CONTRACT.md` (Task 2 — extends, Task 2.4 — drive-by placeholder fix)
- `CHANGELOG.md` (Task 3.3 — `[Unreleased]` entry)
- (the rest of the repo is untouched)

Do NOT modify any TypeScript, build configs, or workflows in either repo. This is a documentation-only story. If you find yourself editing `.github/workflows/*.yml`, `packages/*/src/`, `Dockerfile`, or `docker-compose-*.yml`, stop — you're outside the story.

### Why "Identical Content" Means Body-Identical, Not File-Identical

The epic AC says "an identical-content `CONNECTOR_RELEASE_CONTRACT.md` exists at both" paths. The strictest reading is byte-identical files. The most useful reading is body-identical with a path-specific sync header — that way, a reader of either file knows the file is mirrored and where the canonical version lives, and `diff` drift detection is a single operation.

This story picks the body-identical interpretation (Task 4.2) but supports the strictly-identical interpretation as a fallback if the dev prefers (the "alternative discipline" callout in Task 4.2). Either is acceptable as long as drift detection is a single deterministic command and the choice is documented in the doc's Verification section.

The producer-side file is canonical. If the contract changes (e.g., we add a "ports" stability rule), the connector PR lands first; the town mirror PR is a stamp-and-paste follow-up that should land same-day. The reverse direction (town editor changing the doc and connector mirror following) is an anti-pattern — the producer owns the contract.

### Why Town Has No CHANGELOG and How to Compensate

Town's release model is **not** semantic-release — it's BMad-driven sprint cadence with `_bmad-output/implementation-artifacts/sprint-status.yaml` as the de facto changelog. Connector uses semantic-release with a literal `CHANGELOG.md`. The asymmetric AC for "CHANGELOG entry on both repos" is satisfied by the asymmetric mechanism each repo already uses:

- **Connector side:** literal `CHANGELOG.md [Unreleased]` entry per Task 3.3.
- **Town side:** discoverability through three existing channels:
  1. Cross-link in `packages/sdk/CONNECTOR_MIGRATION.md` (Task 4.3) — the doc engineers actually read when bumping the connector pin.
  2. Row in `CLAUDE.md` "Where to Find Things" (Task 4.4) — the doc Claude reads when grepping for connector-related context.
  3. Sprint-status comment + commit message (Task 5.2, 5.4) — the audit log for "when did this contract land".

This asymmetric treatment is deliberate. Adding a singleton `CHANGELOG.md` in town for one entry would be ceremonial (town has no semantic-release pipeline that'd consume it). Document the choice in the connector PR body so reviewers don't ask "why no town CHANGELOG.md".

### What This Story Does NOT Do (scope guard)

- **Implement automated release subscription.** A GitHub Actions cron that polls `gh release view` and opens digest-bump PRs into townhouse is the natural follow-on but is OUT OF SCOPE — tracked as Open Thread #2 in Epic 44. This story documents the manual subscription mechanism (UI Watch + gh CLI fallback) and explicitly defers automation.
- **Backfill historical version bumps against the new rules.** The contract is forward-applying. Connector versions before this PR's merge predate the contract; the contract does not retroactively label `v3.3.x → v3.4.0` as "compliant" or "non-compliant". The first release subject to the contract is the next semantic-release tag after the connector PR merges.
- **Add a `## ILP packet wire-format` section.** The doc names ILP-wire-format-changes-as-MAJOR as a rule; it does NOT enumerate which fields constitute the wire format. That's an ILPv4 concern (RFC 0027) and would inflate scope. The doc cross-links to `_bmad-output/planning-artifacts/research/connector-north-star-2026-05-01.md` for ILPv4 context.
- **Replace or rewrite `CONNECTOR_MIGRATION.md`.** That file remains the runtime canary contract — different scope. Story 44.4's doc is the producer-side promise; CONNECTOR_MIGRATION.md is the consumer-side enforcement. Both coexist.
- **Bump `DEFAULT_CONNECTOR_IMAGE` in `packages/townhouse/src/constants.ts`.** Pin lifecycle is owned by Story 44.1 / 45.2. No pin change here unless the story is closed against a tag the dev wants townhouse to consume next (in which case the bump is a tail commit, but not required).
- **Touch `packages/sdk/tests/integration/connector-contract.test.ts`.** The canary's path stays in the migration doc's territory. The release contract document references it by path but does not assert it.
- **Generate or sync any other cross-repo doc.** Other planning artifacts (`epics.md`, `epics-townhouse-hs-v1.md`, `connector-north-star-2026-05-01.md`) stay in their current repo; this story is exclusively about `CONNECTOR_RELEASE_CONTRACT.md`.

### Architecture Compliance

- **Layering rule (D44-012):** This story does not introduce any townhouse-specific concept (`town | mill | dvm`) into the connector repo. The connector-side doc speaks generically about consumers; the townhouse-specific pin discipline is described as ONE example of a consumer (the load-bearing one for Epic 44, but framed as illustrative). Future non-townhouse consumers are not excluded by the wording.
- **Cross-repo release contract (D44-013):** This IS the document the decision references. Landing it closes the loop on D44-013 and unlocks Epic 45's `image-manifest.json` design (Story 45.1) being able to cite the contract for its digest-pinning rationale.
- **OWASP A08 (CI integrity):** No CI changes. The contract describes producer-side discipline but does not codify it as a CI gate (a CI gate that auto-detects `/admin/*` field renames as a major-bump trigger is its own story; the contract's enforcement is review-time, not build-time, in v1).

### Critical Implementation Patterns

- **Connector PR first, town PR second.** Open the connector PR; capture the assigned number; insert the connector PR URL into the town PR body so reviewers can verify byte-equivalence at review time. If the town PR lands first, the comment header in `packages/sdk/CONNECTOR_RELEASE_CONTRACT.md` references a non-existent connector PR until the connector PR merges — bad reviewer experience.
- **Body-identical means body-identical.** When mirroring the doc, do NOT "improve" the connector copy in the town clone. If you find a typo or an awkward sentence in the connector source, push the fix as a third commit on the connector PR (or a follow-up PR), then mirror. The town clone is a build artifact of the connector source; treating it as an independent editable doc breaks the diff-clean invariant.
- **PR `<num>` placeholders.** Story 44.3's PR-number-placeholder pattern documented this workflow but did not fully execute it (lines 39 + 153 of the connector doc still carry `<num>` on `origin/main` per AC #7). Don't repeat the mistake. The "open with placeholder, capture number, push fix" cycle is two commits — both should land before requesting review.
- **The `## Historical tag corruption` section stays.** The current connector doc devotes ~40 lines to the GHCR tag-corruption incident from PRs #45–#60. Resist the urge to trim it for the town mirror — it is essential context for "why pin by digest, not by tag", which is the load-bearing decision townhouse consumes. Identical content means identical content; a town reader benefits from the same context the connector reader gets.
- **No editorial restructuring.** This story extends, it does not refactor. The connector doc's existing section order (Artifacts → Stability guarantees → Supply-chain signing → Recommended pinning → Historical tag corruption → Verification → References) gets two new sections inserted (`## API stability`, `## Staying current`); existing sections are NOT renamed, reordered, or rewritten. If a section feels mis-placed, file an issue, don't fix it here.
- **`docs(...)` is a no-bump commit.** Both PRs use `docs(...)` conventional-commit prefixes. Semantic-release in the connector repo will NOT cut a release on this PR — that's intentional. The contract is forward-applying; consumers learn about it through release notifications on the next organic feat/fix release, not by this PR alone triggering a bump.

### Latest tech (verified 2026-05-08)

- **GitHub Watch / Subscriptions:** The web UI offers `Watch → Custom → Releases` as a single-checkbox release-only subscription. The REST API (`PUT /repos/:owner/:repo/subscription`) does NOT expose this filter — it only toggles the binary `subscribed` flag, which subscribes to all events. The asymmetry is documented at <https://docs.github.com/en/rest/activity/watching>. The doc's `## Staying current` section names the UI mechanism as preferred and the gh CLI mechanism as a strictly inferior fallback.
- **`gh api` subscription:** `gh api -X PUT /repos/<owner>/<repo>/subscription -f subscribed=true -f ignored=false` works and is idempotent. There is no `gh repo subscribe` shorthand.
- **GitHub Actions release-trigger:** Downstream consumers can also use a workflow trigger like `on: registry_package` or `on: repository_dispatch` to react to upstream releases — but that requires the upstream repo to dispatch the event, which connector does not. Out of scope.
- **Semantic-release commit-type → bump map:** `feat` = MINOR, `fix` = PATCH, `BREAKING CHANGE` footer or `feat!`/`fix!` = MAJOR. `docs`, `ci`, `chore`, `style`, `refactor`, `test`, `perf` = no bump. Connector's `release.config.cjs` (verified at the connector repo root) follows defaults; this PR's `docs(release)` prefix maps to no bump.

## References

### From `_bmad-output/planning-artifacts/epics-townhouse-hs-v1.md`

- [Source: epics-townhouse-hs-v1.md#L444-L468] — Story 44.4 ACs (canonical)
- [Source: epics-townhouse-hs-v1.md#L88] — FR38 (`CONNECTOR_RELEASE_CONTRACT.md` cross-repo doc)
- [Source: epics-townhouse-hs-v1.md#L118] — NFR16 (connector v3.5.0 backward compatibility envelope)
- [Source: epics-townhouse-hs-v1.md#L268-L275] — Epic 44 overview (connector cross-repo surface; CR-4 = this story)

### From `_bmad-output/epics/epic-44-townhouse-hs-mode-v1.draft.md`

- [Source: epic-44-townhouse-hs-mode-v1.draft.md#L499-L515] — Story CR-4 short spec (Owner: Amelia, Size: S)
- [Source: epic-44-townhouse-hs-mode-v1.draft.md#L555-L557] — Open Thread #2 (connector release subscription mechanism — automation deliberately deferred)

### From `/home/jonathan/Documents/connector/CONNECTOR_RELEASE_CONTRACT.md` (current state on `origin/main` 2026-05-08)

- [Source: connector/CONNECTOR_RELEASE_CONTRACT.md#L7-L18] — `## Artifacts` (target for the `## Stability guarantees` arch sentence in Task 2.2)
- [Source: connector/CONNECTOR_RELEASE_CONTRACT.md#L20-L36] — `## Stability guarantees` (immediately precedes the new `## API stability` section)
- [Source: connector/CONNECTOR_RELEASE_CONTRACT.md#L37-L70] — `## Supply-chain signing` (added by Story 44.3; new section sits before this)
- [Source: connector/CONNECTOR_RELEASE_CONTRACT.md#L39] — placeholder `pull/<num>` to fix (Task 2.4)
- [Source: connector/CONNECTOR_RELEASE_CONTRACT.md#L72-L86] — `## Recommended pinning strategy` (target for the `## Staying current` insertion right after this)
- [Source: connector/CONNECTOR_RELEASE_CONTRACT.md#L88-L128] — `## Historical tag corruption` (preserve verbatim in town mirror)
- [Source: connector/CONNECTOR_RELEASE_CONTRACT.md#L153] — second `pull/<num>` placeholder to fix (Task 2.4)

### From `/home/jonathan/Documents/connector/CHANGELOG.md`

- [Source: connector/CHANGELOG.md#L14-L23] — current `[Unreleased]` block (target for Task 3.3 entry)
- [Source: connector/CHANGELOG.md#L8-L12] — `[3.5.1]` entry (most-recent shipped release; format reference)

### From this repo

- [Source: packages/sdk/CONNECTOR_MIGRATION.md] — sibling doc; gets the "See also" cross-link in Task 4.3
- [Source: packages/sdk/CONNECTOR_MIGRATION.md#L1-L23] — intro paragraph, where the cross-link inserts
- [Source: CLAUDE.md#L152] — existing `Connector API contract + migration history` row in "Where to Find Things"; new `CONNECTOR_RELEASE_CONTRACT.md` row inserts immediately above
- [Source: _bmad-output/implementation-artifacts/sprint-status.yaml#L494] — `44-4-...: backlog` entry to flip on completion
- [Source: _bmad-output/implementation-artifacts/44-3-connector-cosign-keyless-oidc-image-signing.md] — sibling cross-repo story (placeholder workflow + cross-repo boundary discipline reference)
- [Source: _bmad-output/implementation-artifacts/44-2-connector-verify-multi-arch-image-build.md] — earlier sibling cross-repo story (same shape, smaller scope)

### Latest tech references (verified 2026-05-08)

- [GitHub Activity / Watching API](https://docs.github.com/en/rest/activity/watching) — `PUT /repos/:owner/:repo/subscription` does not expose a releases-only filter
- [GitHub Watch UI documentation](https://docs.github.com/en/account-and-profile/managing-subscriptions-and-notifications-on-github/setting-up-notifications/configuring-notifications#configuring-your-watch-settings-for-an-individual-repository) — Custom → Releases checkbox is the canonical mechanism
- [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/) — `docs(...)` semantics
- [semantic-release default commit analyzer](https://github.com/semantic-release/commit-analyzer) — `docs` maps to no release

## Verification

After both PRs merge:

```bash
# 1. Byte-equivalence check (the load-bearing AC #1 verification)
diff /home/jonathan/Documents/connector/CONNECTOR_RELEASE_CONTRACT.md \
     /home/jonathan/Documents/town/packages/sdk/CONNECTOR_RELEASE_CONTRACT.md
# Expected: empty output (if same comment header used in both files)
#   OR: only the 3-line comment-header divergence (if alternative discipline chosen)
# Anything else = drift defect

# 2. Discoverability check from town side
grep -n "CONNECTOR_RELEASE_CONTRACT" /home/jonathan/Documents/town/CLAUDE.md
# Expected: matches the new "Where to Find Things" row
grep -n "CONNECTOR_RELEASE_CONTRACT" /home/jonathan/Documents/town/packages/sdk/CONNECTOR_MIGRATION.md
# Expected: matches the new "See also" cross-link

# 3. Discoverability check from connector side
grep -n "API stability\|Staying current" /home/jonathan/Documents/connector/CONNECTOR_RELEASE_CONTRACT.md
# Expected: section headings present

# 4. Placeholder fixup check (AC #7)
grep -nE "pull/<num>" /home/jonathan/Documents/connector/CONNECTOR_RELEASE_CONTRACT.md
# Expected: empty output

# 5. CHANGELOG entry check (connector side)
grep -n "Story 44.4" /home/jonathan/Documents/connector/CHANGELOG.md
# Expected: matches the [Unreleased] entry
```

If any of these checks fail, the story is NOT done. Re-open. Do not flip sprint-status to `done`.

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

- Prettier reformatted `## Staying current` gh CLI command by stripping list-item indentation; fixed by converting inline backtick to a fenced code block (follow-up commit `fix(docs): reformat Staying current gh CLI command as code block`).
- Branch switch from `epic-44` to `docs/connector-release-contract-mirror` produced a merge conflict in `sprint-status.yaml` (main branch had older version without Epic 44-49 block); resolved by taking the stash version.

### Completion Notes List

- ✅ Task 1: Confirmed connector doc structure, line 39 + 153 `pull/<num>` placeholders, town has no CHANGELOG.md.
- ✅ Task 2: Added `## API stability` section (7-rule table + Townhouse pin discipline subsection), multi-arch rule sentence in `## Artifacts`, `## Staying current` section, and town mirror drift-detection note in `## Verification`. Fixed both `pull/<num>` → `pull/66` placeholders.
- ✅ Task 3: connector branch `docs/release-contract-api-stability`, commit `docs(release): codify /admin/* semver discipline in release contract`, CHANGELOG `### Documentation` entry pinned to PR #67. PR opened as connector#67.
- ✅ Task 4: town branch `docs/connector-release-contract-mirror`, created `packages/sdk/CONNECTOR_RELEASE_CONTRACT.md` with 3-line comment header + byte-identical body, added "See also" cross-link to `CONNECTOR_MIGRATION.md`, added "Where to Find Things" row to `CLAUDE.md`. PR opened as town#34.
- ✅ Task 5.1: Body-equivalence pre-merge verified — `diff connector/CONNECTOR_RELEASE_CONTRACT.md <(tail -n +4 packages/sdk/CONNECTOR_RELEASE_CONTRACT.md)` returned empty. All 5 story verification checks passed.
- ⏳ Tasks 5.2-5.4: Post-merge — sprint-status flip to `done` + close-out commit after connector#67 and town#34 merge.

### File List

**connector repo (connector#67):**
- `CONNECTOR_RELEASE_CONTRACT.md` — extended with `## API stability`, `## Staying current`, multi-arch sentence, drift-detection note in `## Verification`; `pull/<num>` → `pull/66` on two lines
- `CHANGELOG.md` — `### Documentation` entry added to `[Unreleased]`

**town repo (town#34):**
- `packages/sdk/CONNECTOR_RELEASE_CONTRACT.md` — NEW: 3-line comment header + byte-identical mirror body
- `packages/sdk/CONNECTOR_MIGRATION.md` — "See also" cross-link added under H1
- `CLAUDE.md` — new row in "Where to Find Things" above existing `CONNECTOR_MIGRATION.md` row
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — status `ready-for-dev → review`

### Change Log

- 2026-05-08: Story 44.4 implemented — connector API stability contract codified, `## Staying current` section added, `pull/<num>` placeholders fixed, town-side mirror created at `packages/sdk/CONNECTOR_RELEASE_CONTRACT.md`, cross-links added to `CONNECTOR_MIGRATION.md` and `CLAUDE.md`. PRs: connector#67, town#34.
