# Story 45.1: Multi-Arch Townhouse Image Publish CI

Status: ready-for-dev

> **CRITICAL PATH — first story of Epic 45 (One-Command Apex Install).** Sized L by the plan. Per `townhouse-hs-v1-plan-2026-05-07.md` §3, this is the highest slip-risk story in the entire HS-Mode v1 program: "multi-arch CI + cosign + matrix manifest fanout. Budget 2× nominal estimate." Stories 45.2, 45.3, and 45.4 all depend on this one — the digests this workflow captures get embedded in the next story's compose template, and the cosign signatures it produces get verified by the pre-publish quality gate (NFR17).

## Story

As a **townhouse release engineer** preparing the v0.1 pilot tag,
I want **a CI workflow that builds and publishes the four townhouse-owned container images (`townhouse-api`, `town`, `mill`, `dvm`) to GHCR with multi-arch (`linux/amd64` + `linux/arm64`) manifests, captures their content-addressed digests into an `image-manifest.json` artifact, and cosign-signs every image via keyless OIDC**,
so that operators on any architecture (Apple Silicon, Raspberry Pi 5, x86 homelab) can `docker pull` pre-built images without `docker compose build`, the npm tarball can pin by digest (Story 45.2), and the v1.0 pre-publish quality gate (NFR17) has the cosign signatures it needs to verify before `npm publish`. The connector image is consumed by digest from upstream `toon-protocol/connector` (already multi-arch + cosign-signed via Stories 44.2 / 44.3) — this workflow MUST NOT republish it.

## Acceptance Criteria

1. **Workflow file exists at the canonical path with the canonical triggers.** A new file `.github/workflows/publish-townhouse-images.yml` exists. It is triggered by (a) push of a tag matching `v*` (e.g. `v0.1.0`, `v1.2.3`) AND (b) `workflow_dispatch` with an optional `version` input. No `pull_request` trigger (this is a publishing workflow, not a CI gate).

2. **EXACTLY four townhouse images are produced — NEVER five.** The workflow's build matrix lists exactly: `townhouse-api`, `town`, `mill`, `dvm`. The connector image is **not** built, **not** pushed, and **not** referenced as a build target. A `grep` for `connector` in the workflow file appears only in (a) the manifest-pinning step that records the upstream digest and (b) comments explaining why the connector is excluded. Per the planning doc §7 ("Image-publish coordination"), republishing the connector is an explicit anti-pattern.

3. **Each townhouse image is published to `ghcr.io/toon-protocol/<svc>` with both a versioned tag and `:latest`.** For a `v0.1.0` tag push or a `workflow_dispatch` with `version=0.1.0`, four images land:
   - `ghcr.io/toon-protocol/townhouse-api:0.1.0` AND `ghcr.io/toon-protocol/townhouse-api:latest`
   - `ghcr.io/toon-protocol/town:0.1.0` AND `ghcr.io/toon-protocol/town:latest`
   - `ghcr.io/toon-protocol/mill:0.1.0` AND `ghcr.io/toon-protocol/mill:latest`
   - `ghcr.io/toon-protocol/dvm:0.1.0` AND `ghcr.io/toon-protocol/dvm:latest`
   - The `:latest` alias is set ONLY when the trigger is a `v*` tag push (NOT on `workflow_dispatch` unless `version` is explicitly provided AND the workflow is run from `main`). The `docker/metadata-action` invocation makes this explicit (see Task 2.3).
   - Each image's resolved content digest (`sha256:<hex>`) is captured as a workflow step output for use by Task 4.

4. **`scripts/build-image-manifest.mjs` writes the digest manifest as a townhouse build artifact.** A new script at `scripts/build-image-manifest.mjs` (NOT inside `packages/townhouse/`, kept at repo root for shared CI scripts) reads the four townhouse digests captured in Task 3 plus an upstream connector digest the operator passes in via env var or input, and writes `packages/townhouse/dist/image-manifest.json`. The schema is:

    ```json
    {
      "schemaVersion": 1,
      "townhouseVersion": "0.1.0",
      "builtAt": "2026-05-08T16:00:00Z",
      "images": {
        "townhouse-api": { "name": "ghcr.io/toon-protocol/townhouse-api", "tag": "0.1.0", "digest": "sha256:<hex>" },
        "town":          { "name": "ghcr.io/toon-protocol/town",          "tag": "0.1.0", "digest": "sha256:<hex>" },
        "mill":          { "name": "ghcr.io/toon-protocol/mill",          "tag": "0.1.0", "digest": "sha256:<hex>" },
        "dvm":           { "name": "ghcr.io/toon-protocol/dvm",           "tag": "0.1.0", "digest": "sha256:<hex>" },
        "connector":     { "name": "ghcr.io/toon-protocol/connector",     "tag": "<v3.x.y>", "digest": "sha256:<hex>" }
      }
    }
    ```

    The connector entry's `digest` is sourced by the workflow either from (a) an explicit input on `workflow_dispatch` (`connector_version` input → resolved via `docker manifest inspect ghcr.io/toon-protocol/connector:<vN.M.P>` to a digest), or (b) read from a workspace constant (the eventual successor to `DEFAULT_CONNECTOR_IMAGE` in `packages/townhouse/src/constants.ts`, currently `ghcr.io/toon-protocol/connector:3.4.1` — which is a tag, not a digest). Story 45.1's job is to write the manifest entry; bumping the constants file from a tag-pin to a digest-pin is Story 45.2 territory.

5. **Every published townhouse image is cosign-signed via keyless OIDC.** The workflow installs `sigstore/cosign-installer@<sha>` (latest tagged release at story-implementation time, pinned by SHA per OWASP A08 — see Task 5.1) and runs `cosign sign --yes ghcr.io/toon-protocol/<svc>@<digest>` after each push. Signature records are stored in the GHCR sigstore namespace alongside the image. No static signing key, no Apple Developer ID, no GHA secret beyond the default `GITHUB_TOKEN` and the OIDC ID token. This matches the discipline Story 44.3 (`connector#66`) established for the connector image.

6. **`npm publish` runs ONLY AFTER all four image-publish + sign steps succeed.** The workflow has a `npm-publish` job that has `needs: [build-and-push, sign]` (or equivalent gate). On a `v*` tag push, after all four images have a digest AND a verified signature, the workflow runs `pnpm --filter @toon-protocol/townhouse publish --access public --tag latest --no-git-checks`. (For Story 45.1's first delivery, this step MAY be wired in `dry-run` mode pending Story 45.2's `dist/image-manifest.json` shipping in the tarball — see scope-guard discussion in Dev Notes.) The job depends on `${{ secrets.NPM_TOKEN }}`. If any prior job fails (build, sign, manifest-write), the npm-publish job does not start.

7. **Each published image's manifest reports both `linux/amd64` AND `linux/arm64`.** The `docker/build-push-action` step uses `platforms: linux/amd64,linux/arm64`. Post-publish, an in-workflow verification step runs `docker manifest inspect ghcr.io/toon-protocol/<svc>:<tag>` for each of the four townhouse images and asserts both architectures appear in the manifest list (failing the workflow if either is absent). This matches Story 44.2's `connector#62/#63` discipline.

8. **OWASP A08: Every third-party action is pinned by full commit SHA.** All `uses:` references in the new workflow file pin to a 40-char commit SHA, not a floating tag. A trailing comment names the human-readable tag for review hygiene: `uses: docker/build-push-action@<40-char-sha>  # v6.x.y`. Pattern matches Story 22.5 Task 4.4 ("If CI workflows are created/modified, pin action references to full commit SHAs (OWASP A08 guard)").

9. **A new `Dockerfile.townhouse-api` exists at the canonical Docker build context.** The townhouse-api container does not exist in the repo today — `docker/Dockerfile.townhouse-api` is created as part of this story. It follows the multi-stage esbuild pattern established in `docker/Dockerfile.town` and `docker/Dockerfile.mill`: builder stage on `node:20-alpine`, esbuild bundle of `packages/townhouse/src/cli.ts` (or a new dedicated `entrypoint-api.ts`) with `--external:dockerode` (the host-mode addon path inside the container resolves at runtime), runtime stage on `node:20-alpine` with `libstdc++` for native modules, non-root `toon` user, `EXPOSE 28090`, `HEALTHCHECK` against `http://localhost:28090/api/health`. The Dockerfile MUST keep the image lean — total compressed size ≤200 MB on `linux/amd64`. The container will mount `/var/run/docker.sock` at runtime (per Story 45.4 AC) — the Dockerfile itself does not bake the socket in.

10. **Sprint-status update.** AFTER the workflow file is merged AND a smoke-test `workflow_dispatch` run produces all four signed multi-arch images with a populated `image-manifest.json`: update `_bmad-output/implementation-artifacts/sprint-status.yaml` `45-1-multi-arch-townhouse-image-publish-ci: ready-for-dev → done`. Mirror the Story 44.4 close-out style — the `#` comment on the same line names the workflow run URL (`# done: workflow run https://github.com/toon-protocol/town/actions/runs/<id> produced 4 multi-arch + cosign-signed images and image-manifest.json — town#<PR-num>`). Bump `last_updated` to the merge date.

## Tasks / Subtasks

- [x] **Task 1: Read the surrounding state and confirm the build context** (AC: #2, #9)
  - [x] 1.1 Read `docker/Dockerfile.town`, `docker/Dockerfile.mill`, `docker/Dockerfile.dvm` end-to-end. Confirm the shared multi-stage esbuild + non-root pattern. The new `Dockerfile.townhouse-api` follows that pattern (Task 6).
  - [x] 1.2 Read `.github/workflows/publish-bls.yml` end-to-end as the closest sibling pattern (multi-arch via QEMU+buildx, GHA cache, Trivy scan, SBOM upload, multi-tag mapping via `docker/metadata-action`). The new workflow MAY reuse the Trivy + SBOM steps but they are **not** Story 45.1 ACs — keep them out of scope unless trivially additive.
  - [x] 1.3 Read `packages/townhouse/package.json` and `packages/townhouse/tsup.config.ts`. Confirm `bin: ./dist/cli.js`, `files: ["dist"]`, ESM-only, Node ≥20, no `prepublishOnly` script today. Confirm `dist/` is the canonical artifact directory the npm tarball will ship — that is where `image-manifest.json` belongs (per AC #4).
  - [x] 1.4 Read `packages/townhouse/src/constants.ts` line 21 (`DEFAULT_CONNECTOR_IMAGE = 'ghcr.io/toon-protocol/connector:3.4.1'`). Confirm this is the tag-form pin Story 45.2 will replace with a digest. For Task 4 below, the workflow's connector-digest input defaults to whatever this constant says (resolved via `docker manifest inspect` to a digest at workflow-run time).
  - [x] 1.5 Confirmed connector multi-arch shipping: `docker manifest inspect ghcr.io/toon-protocol/connector:3.6.1` returns amd64 + arm64 (plus attestation unknowns). Cosign verify confirmed at v3.6.0 per Story 44.3 close-out. No blocker.

- [x] **Task 2: Author `.github/workflows/publish-townhouse-images.yml`** (AC: #1, #3, #5, #6, #7, #8)
  - [x] 2.1 Define `name: Publish Townhouse Images`, top-of-file comment block describing trigger scenarios and tag mappings (mirror `publish-bls.yml` line 1–6 style).
  - [x] 2.2 `on:` triggers: `push: { tags: ['v*'] }` AND `workflow_dispatch: { inputs: { version: { type: string }, connector_version: { type: string, default: '3.4.1' } } }`. NO `pull_request` trigger — this is a publishing workflow, not a CI gate.
  - [x] 2.3 Top-level `concurrency: { group: '${{ github.workflow }}-${{ github.ref }}', cancel-in-progress: false }` (NOT `true` — we don't want a second tag-push to abort an in-flight publish that has already started signing images).
  - [x] 2.4 `permissions:` declare exactly `contents: read`, `packages: write`, `id-token: write` (id-token required for cosign keyless OIDC, packages:write required for GHCR push). NO `actions: write`, NO `security-events: write`.
  - [x] 2.5 Single job `build-publish-sign` with `strategy.matrix.image: [townhouse-api, town, mill, dvm]` and `strategy.fail-fast: false` (one image's signing failure should not abort the others — partial publishes are acceptable for the `latest` tag because Task 4 manifest-write is gated on all four succeeding).
  - [x] 2.6 Steps inside the matrix job (in order):
    1. `actions/checkout@<sha>` (full clone needed for Docker build context)
    2. `docker/setup-qemu-action@<sha>` (cross-arch emulation for arm64 builds on amd64 runners)
    3. `docker/setup-buildx-action@<sha>` (multi-arch builder backend)
    4. `docker/login-action@<sha>` against `ghcr.io` with `username: ${{ github.actor }}`, `password: ${{ secrets.GITHUB_TOKEN }}`
    5. `docker/metadata-action@<sha>` to compute tags. `images: ghcr.io/toon-protocol/${{ matrix.image }}`. Tag template:
       - `type=raw,value=latest,enable=${{ github.ref_type == 'tag' && startsWith(github.ref, 'refs/tags/v') }}`
       - `type=match,pattern=v(.*),group=1` (for tag pushes — strips the `v` prefix)
       - `type=raw,value=${{ inputs.version }},enable=${{ inputs.version != '' }}` (manual dispatch)
       - `type=sha,prefix=sha-` (always, for traceability)
    6. `docker/build-push-action@<sha>` with `context: .`, `file: docker/Dockerfile.${{ matrix.image }}`, `platforms: linux/amd64,linux/arm64`, `push: true`, `tags: ${{ steps.meta.outputs.tags }}`, `labels: ${{ steps.meta.outputs.labels }}`, `cache-from: type=gha`, `cache-to: type=gha,mode=max`. Capture `id: build` so the job can read `${{ steps.build.outputs.digest }}`.
    7. `sigstore/cosign-installer@<sha>` (pin to a release-tagged SHA — see Task 5.1)
    8. Cosign sign step: `cosign sign --yes ghcr.io/toon-protocol/${{ matrix.image }}@${{ steps.build.outputs.digest }}` — this runs once per image AND signs the digest, NOT the tag (signing tags is sigstore's documented anti-pattern; tag rotation invalidates signatures).
    9. Per-image arch-verification step: `docker buildx imagetools inspect ghcr.io/toon-protocol/${{ matrix.image }}@${{ steps.build.outputs.digest }} --format '{{json .Manifest}}' | jq '.manifests | map(.platform.architecture) | sort' | grep -F '["amd64","arm64"]'` (or equivalent — see Task 5.2 alt). Failing this step fails the matrix entry. Asserting against the digest-form ref (not the tag) is critical: tag → digest resolution is racy under parallel publishes.
    10. Job-level output: emit the per-image digest as a matrix-output artifact (`echo "${{ matrix.image }}=${{ steps.build.outputs.digest }}" >> $GITHUB_OUTPUT` followed by an `outputs:` declaration on the job; alternative: `actions/upload-artifact@<sha>` writing a per-image JSON file the manifest-write job downloads and stitches).

- [x] **Task 3: Author `scripts/build-image-manifest.mjs`** (AC: #4)
  - [x] 3.1 The script must be runnable locally for testing: `node scripts/build-image-manifest.mjs --townhouse-version 0.1.0 --connector-tag 3.4.1 --townhouse-api-digest sha256:abc... --town-digest sha256:def... --mill-digest sha256:ghi... --dvm-digest sha256:jkl...`. CLI args parsed via `node:util` `parseArgs` (no external deps — Node 20 has it stable).
  - [x] 3.2 Script resolves the connector tag → digest at runtime via `docker manifest inspect ghcr.io/toon-protocol/connector:<tag>` (shell-out via `node:child_process`'s `execFileSync` with explicit args — never `exec`/`execSync` with shell-interpolation per OWASP A03 / project-context.md §"Security Patterns"). Fallback: if the script is invoked from CI with the digest already passed in via `--connector-digest sha256:...`, skip the inspect step. CI prefers the explicit form (the matrix-job manifest-write step passes both tag and digest).
  - [x] 3.3 Script writes `packages/townhouse/dist/image-manifest.json` with mode `0o644` (npm tarball will preserve mode; this is a build artifact, not an operator secret — NFR8 file-mode `0o600` does NOT apply here).
  - [x] 3.4 Schema validation: hand-coded Zod schema at top of the script asserting the output shape before write. Schema-version `1` literal. Any future shape change bumps to `2`.
  - [x] 3.5 Vitest unit tests at `scripts/build-image-manifest.test.ts` (same dir as `seed-ditto-posts.test.ts`): (a) writes valid v1 manifest given mock digests; (b) rejects malformed digests; (c) rejects when fewer than 4 townhouse digests; (d) succeeds when --connector-digest provided directly (skips inspect). All 16 tests pass.
  - [x] 3.6 Wire the script into the workflow: `build-image-manifest` job with `needs: [build-publish-sign]` that downloads the four matrix-job outputs and runs `node scripts/build-image-manifest.mjs ...` with the captured digests, then uploads `dist/image-manifest.json` as a workflow artifact.

- [x] **Task 4: Wire `npm publish` as a gated final step** (AC: #6)
  - [x] 4.1 Added `publish-npm` job with `needs: [build-publish-sign, build-image-manifest]` AND `if: github.ref_type == 'tag' && startsWith(github.ref, 'refs/tags/v')` (do NOT npm-publish on `workflow_dispatch` smoke runs — those are infrastructure validation, not releases).
  - [x] 4.2 Steps:
    1. `actions/checkout@<sha>`
    2. `pnpm/action-setup@<sha>` pinned to `version: 8.15.0` (matches root `package.json` packageManager)
    3. `actions/setup-node@<sha>` with `node-version: 20`, `registry-url: https://registry.npmjs.org`, `cache: pnpm`
    4. `pnpm install --frozen-lockfile`
    5. `pnpm --filter @toon-protocol/townhouse build` (produces `dist/cli.js` etc.)
    6. `actions/download-artifact@<sha>` to fetch the `image-manifest.json` artifact from the prior job → place at `packages/townhouse/dist/image-manifest.json`
    7. `pnpm --filter @toon-protocol/townhouse publish --access public --no-git-checks` with `NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}` env. Initial Story 45.1 delivery MAY include `--dry-run` flag pending Story 45.2 wiring `dist/compose/townhouse-hs.yml` into the tarball — Dev Notes "Scope Guards" below documents the staged delivery.
  - [x] 4.3 `--dry-run` flag included; top-of-workflow comment documents the staged delivery; inline step comment explains the flip condition for Story 45.2.

- [x] **Task 5: Pin every action by SHA + verify cosign installer pin** (AC: #5, #8)
  - [x] 5.1 All 17 `uses:` lines in the new workflow are pinned to 40-char commit SHAs resolved via `gh api repos/<owner>/<action>/git/refs/tags/<tag>` at story-execution time (2026-05-08). Pin candidates resolved:
    - `actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5` — v4
    - `docker/setup-qemu-action@c7c53464625b32c7a7e944ae62b3e17d2b600130` — v3
    - `docker/setup-buildx-action@8d2750c68a42422c14e847fe6c8ac0403b4cbd6f` — v3
    - `docker/login-action@c94ce9fb468520275223c153574b00df6fe4bcc9` — v3
    - `docker/metadata-action@c299e40c65443455700f0fdfc63efafe5b349051` — v5
    - `docker/build-push-action@10e90e3645eae34f1e60eeb005ba3a3d33f178e8` — v6
    - `sigstore/cosign-installer@398d4b0eeef1380460a10c8013a76f728fb906ac` — v3.9.1
    - `actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02` — v4
    - `actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093` — v4
    - `pnpm/action-setup@b906affcce14559ad1aafd4ab0e942779e9f58b1` — v4
    - `actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020` — v4
  - [x] 5.2 Cosign semantics verified: `cosign sign` against OCI digest uses keyless OIDC when `id-token: write` is granted at job level. Signature stored in GHCR sigstore namespace. Workflow uses `COSIGN_YES: 'true'` env var to suppress interactive prompt.
    ```bash
    cosign verify ghcr.io/toon-protocol/townhouse-api@<digest> \
      --certificate-identity-regexp '^https://github.com/toon-protocol/town/' \
      --certificate-oidc-issuer 'https://token.actions.githubusercontent.com'
    ```
  - [x] 5.3 Cosign verify command documented in top-of-file comment block in the workflow file, mirroring Story 44.3's runbook pattern.

- [x] **Task 6: Author `docker/Dockerfile.townhouse-api`** (AC: #9)
  - [x] 6.1 Created `docker/Dockerfile.townhouse-api` modeled on `docker/Dockerfile.mill`. Entrypoint at `docker/src/entrypoint-townhouse-api.ts` — adapted from `start-api-only.mjs` with leases.json auto-load removed, config path via TOWNHOUSE_CONFIG env var (default: /config/config.yaml), API host defaulting to 0.0.0.0 for container networking.
  - [x] 6.2 esbuild externals: `--external:dockerode`, `--external:ethers`, `--external:express`, `--external:mina-signer`, `--external:o1js`, `--external:@solana/kit`, `--external:@solana-program/token`, `--external:@toon-protocol/mina-zkapp`. Dropped `--external:better-sqlite3` (confirmed absent from townhouse/src/api via grep — zero matches). Fastify is bundled (pure ESM, bundles cleanly with esbuild).
  - [x] 6.3 Runtime stage: `FROM node:20-alpine`, `libstdc++`, non-root `toon` user (uid:gid 1001:1001), `EXPOSE 28090`, HEALTHCHECK against `/api/health`, CMD `node /app/entrypoint-townhouse-api.js`. No docker socket baked in.
  - [x] 6.4 Build command documented in top-of-file comment.
  - [ ] 6.5 Local size validation pending — requires CI or local Docker build (arm64 cross-compile). Not blocking for review; size target ≤200 MB annotated in Dockerfile header.

- [ ] **Task 7: End-to-end smoke test via `workflow_dispatch`** (AC: #2, #3, #5, #7)
  - [ ] 7.1 Push the workflow file on a feature branch (`feat/45-1-multi-arch-image-publish-ci`) and run a `workflow_dispatch` against the branch with `version=0.1.0-rc1` and `connector_version=3.4.1`. The dispatch trigger does NOT push `:latest` (per AC #3 enable rule), so the rc1 tag is safe to use without polluting the canonical `latest` channel.
  - [ ] 7.2 Verify all four images land at the expected paths. From the dev's local machine:
    ```bash
    for img in townhouse-api town mill dvm; do
      docker manifest inspect ghcr.io/toon-protocol/$img:0.1.0-rc1 \
        | jq -r '.manifests | map(.platform.architecture) | sort | tostring' \
        | grep -F '["amd64","arm64"]' || echo "FAIL: $img missing arch"
    done
    ```
    Expected: four images, each emits `["amd64","arm64"]`, no `FAIL` lines.
  - [ ] 7.3 Verify each image's cosign signature:
    ```bash
    for img in townhouse-api town mill dvm; do
      digest=$(docker manifest inspect ghcr.io/toon-protocol/$img:0.1.0-rc1 -v | jq -r '.Descriptor.digest')
      cosign verify ghcr.io/toon-protocol/$img@$digest \
        --certificate-identity-regexp '^https://github.com/toon-protocol/town/' \
        --certificate-oidc-issuer 'https://token.actions.githubusercontent.com' \
        || echo "FAIL: $img signature"
    done
    ```
    Expected: four green verifications, no `FAIL` lines.
  - [ ] 7.4 Download the `image-manifest.json` artifact from the workflow run via `gh run download <run-id> --name image-manifest`. Validate against the AC #4 schema:
    ```bash
    jq -e '.schemaVersion == 1 and .images | (keys | sort == ["connector","dvm","mill","town","townhouse-api"])' image-manifest.json
    jq -e '.images | to_entries | map(.value.digest | startswith("sha256:")) | all' image-manifest.json
    ```
    Expected: both queries return `true`.
  - [ ] 7.5 If any of 7.2 / 7.3 / 7.4 fail, the workflow is not green — debug and re-run before opening the PR for review. Capture the failure mode in the Dev Agent Record's Debug Log References. Do NOT mark the story `review` until all three smoke-checks pass.

- [ ] **Task 8: Open PR + close out** (AC: #1, #10)
  - [ ] 8.1 Open PR via `gh pr create --base main` against `toon-protocol/town`. PR body must include:
    - The workflow run URL from Task 7.1 demonstrating green + 4 signed images
    - The `docker manifest inspect` output (one block per image, showing both archs)
    - The `cosign verify` output (one block per image, showing certificate identity match)
    - The `image-manifest.json` artifact contents (full file)
    - A note that npm-publish runs in `--dry-run` until Story 45.2 lands the compose templates in the tarball (if applicable)
  - [ ] 8.2 Address review feedback. Common review notes to anticipate:
    - SHA-pinned action references — reviewer may ask for fresher SHAs if Dependabot has updates pending
    - Trivy / SBOM steps — reviewer may ask why these aren't included (answer: out of scope per Task 1.2; track as a follow-up if requested)
    - Multi-arch verification — reviewer may ask why we use `docker buildx imagetools inspect` vs `docker manifest inspect` (answer: imagetools handles digest-form refs robustly under parallel publishes; manifest-inspect requires tag form)
  - [ ] 8.3 After PR merges AND a follow-up `v0.1.0` tag push produces all four green signed images: update `_bmad-output/implementation-artifacts/sprint-status.yaml` per AC #10. Mirror the Story 44.4 close-out style (workflow run URL in the trailing `# done:` comment).
  - [ ] 8.4 Bump `last_updated` to the merge date.
  - [ ] 8.5 Close-out commit on `chore/45-1-close-out`: `chore(townhouse): mark Story 45.1 done — multi-arch image publish CI green at v0.1.0 (town#<num>)`.
  - [ ] 8.6 Update this story file's `Status: ready-for-dev → review` (then → `done` after self-review) and fill in the Dev Agent Record below.

## Dev Notes

### Cross-Repo Boundary

This story is **town-only**. No connector-side code or workflow changes. The only connector touchpoint is consumption — the workflow reads `ghcr.io/toon-protocol/connector:<tag>` to resolve a digest into the manifest. If the dev finds themselves opening a PR in `toon-protocol/connector`, stop — they are outside the story.

Files this story touches in `toon-protocol/town`:
- `.github/workflows/publish-townhouse-images.yml` (NEW — Task 2)
- `scripts/build-image-manifest.mjs` (NEW — Task 3)
- `scripts/__tests__/build-image-manifest.test.ts` (NEW — Task 3.5)
- `docker/Dockerfile.townhouse-api` (NEW — Task 6)
- `packages/townhouse/src/entrypoint-api.ts` OR `docker/src/entrypoint-townhouse-api.mjs` (NEW — Task 6.1, dev's call which path)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (Task 8.3 — single-line status flip + last_updated)
- This story file (Task 8.6)

Files this story does **NOT** touch (scope guards):
- `packages/townhouse/src/constants.ts` — `DEFAULT_CONNECTOR_IMAGE` stays at the tag form. Story 45.2 flips it to a digest form once `image-manifest.json` ships in the tarball.
- `packages/townhouse/compose/townhouse-hs.yml` — Story 45.2 territory.
- `packages/townhouse/compose/townhouse-dev.yml` — already exists for the dev stack; not part of HS-mode publish flow.
- `docker/Dockerfile.town`, `docker/Dockerfile.mill`, `docker/Dockerfile.dvm` — they already exist and the workflow consumes them as-is.
- Any test under `packages/townhouse/src/__tests__/` — the only new test is `scripts/__tests__/build-image-manifest.test.ts`.
- `.github/workflows/test.yml` — the existing CI gate stays untouched. The new workflow runs on `v*` tags + dispatch only, never blocks the existing PR-CI surface.
- `.github/workflows/publish-bls.yml` — the BLS publish workflow is independent. It targets a different image (`di3twater/toon-bls`, not `ghcr.io/toon-protocol/*`) and uses Docker Hub (not GHCR). Don't touch it.
- `packages/townhouse/scripts/start-api-only.mjs` — leave the host-mode dev script as-is; the container path is a sibling, not a replacement.

### Why "EXACTLY four images" Matters Load-Bearingly

The natural temptation is to make the workflow build all five images (including the connector) for symmetry. **Don't.** Per planning doc §7 ("Image-publish coordination"):

> Connector image is **already published upstream** by `connector/.github/workflows/build-and-publish.yml` to `ghcr.io/toon-protocol/connector` on every `v*` tag. Townhouse must NOT republish.
> - Townhouse CI publishes only **four** images: `townhouse-api`, `town`, `mill`, `dvm`
> - `image-manifest.json` includes `connector: ghcr.io/toon-protocol/connector@sha256:<digest>` (upstream-published, consume by digest)

The cost of republishing the connector is real:
- **Two cosign signatures for the same image content** would each be valid against a different OIDC identity (connector's GHA workflow identity vs town's). Downstream `cosign verify` becomes ambiguous — which signer do you trust? The answer becomes "both, ignored" in practice, defeating the supply-chain story.
- **Tag namespace collision risk** on `ghcr.io/toon-protocol/connector:latest` — if both repos try to claim it, last-write wins, and the loser's pipelines silently consume the winner's image.
- **Build determinism risk** — building the connector from town's clone-time view of upstream commit history is a different build than building it from the connector repo's own pipeline. The bytes won't match. The digests won't match. Reviewers will spend hours diagnosing why `cosign verify` against the town-emitted digest fails when the operator pulled from connector's published path.

The right move is the one this story enforces: **consume by digest, don't republish.**

### Why a Separate `Dockerfile.townhouse-api` (and Why It Doesn't Exist Yet)

Today, `townhouse-api` runs as a host-side process via `packages/townhouse/scripts/start-api-only.mjs` (against the dev stack from `townhouse-dev-infra.sh`) or as an embedded server inside the `townhouse` CLI (`packages/townhouse/src/cli.ts up`). Neither path produces a container image — both run as the host user, owning the docker socket directly via `dockerode`.

The HS-mode shift (Stories 45.4 + 46.x) reframes townhouse-api as **a container** that mounts the host docker socket RW and runs as a Docker-managed service alongside the connector. This is the model the planning doc §4 ("No Docker socket inside the connector container. Host-side `townhouse-api` (Fastify) owns `dockerode` and runs as the host user") inverts at deploy time:

- **At dev time** (Story 21.x dev infra): townhouse-api is a host-native process. The dev runs `townhouse up` locally and the API binds to `127.0.0.1:9400`. No container image needed.
- **At HS-mode deploy time** (Stories 45.4 / 46.x): townhouse-api is containerized. The operator runs `npx @toon-protocol/townhouse hs up`, the CLI starts a `townhouse-api` container that mounts `/var/run/docker.sock`, and the container itself owns the dockerode handle that orchestrates `town`, `mill`, `dvm` siblings.

The two paths share the same TypeScript source (`packages/townhouse/src/api/`). The container path is just a different *packaging* of the same code. That's why this story creates `Dockerfile.townhouse-api` (image packaging) but does **not** rewrite `start-api-only.mjs` (host-process packaging stays). Both ship.

The architecture anchor "Connector container never sees `/var/run/docker.sock`" (planning doc §4) is preserved: the connector stays a generic ILP router with no dockerode handle. **Only the townhouse-api container** mounts the socket. The earlier-version anchor that read "townhouse-api runs as the host user" is a dev-mode optimization, not a security invariant — the security invariant is "connector ≠ docker", and that holds in both modes.

### Architecture Compliance

- **NFR15 (ESM-only, Node ≥20, TS ^5.3):** The new `Dockerfile.townhouse-api` builds against `node:20-alpine`. The new entry point is ESM (`import.meta.url` banner from tsup config). The `build-image-manifest.mjs` script is ESM (no CJS shim).
- **NFR17 (pre-publish gate):** This story produces three of the six gate artifacts: cosign signatures (gate check #6), the digests `image-contract.test` will assert against (gate check #3), and the multi-arch images that gate check #4 (`townhouse-test-infra.sh`) consumes. The gate itself is wired in a later story (~46.x or 49.x); this story's job is producing the inputs.
- **NFR8 (operator-secret file mode `0o600`):** Does NOT apply to `image-manifest.json` — it's a build artifact, not an operator secret. NFR8 governs `wallet.enc`, `nodes.yaml`, `host.json`, `earnings-snapshots.jsonl`, `telemetry.json`. The manifest file's mode is whatever npm-publish-time tarball preserves (typically `0o644`).
- **OWASP A03 (injection):** The `build-image-manifest.mjs` script uses `execFileSync` with explicit args, never `execSync`/`exec` with shell-interpolated strings. The connector-tag lookup path is the only shell-out point; it must use `execFileSync('docker', ['manifest', 'inspect', ...])`.
- **OWASP A08 (CI integrity):** Every `uses:` in the new workflow is SHA-pinned per Task 5.1. No floating tags. Matches the discipline Story 22.5 documented and Story 44.3 enforced for cosign.
- **D44-013 (cross-repo release contract):** The connector's release contract document (Story 44.4, mirrored at `packages/sdk/CONNECTOR_RELEASE_CONTRACT.md`) names `image-manifest.json` as the load-bearing pin file. This story is what produces the file. Reading the contract before writing the manifest is mandatory — the schema must align with what the contract describes.

### Critical Implementation Patterns

- **Sign the digest, never the tag.** `cosign sign ghcr.io/toon-protocol/townhouse-api:0.1.0` is wrong — the tag can be re-pointed to a different image content later, and the signature will silently apply to the new content while reading as if it certifies the old. `cosign sign ghcr.io/toon-protocol/townhouse-api@sha256:<digest>` is right — the signature is bound to immutable content. Story 44.3 documented this for the connector; the same rule applies here.
- **Capture digests in step outputs, not stdout greps.** The `docker/build-push-action@<sha>` exposes `outputs.digest` directly. Use that. Do NOT post-process `docker push` stdout — the format has changed across Docker versions and is not API-stable.
- **The `:latest` tag is a foot-gun for digest-pinning consumers.** The workflow publishes `:latest` for human-readability (operators running `docker pull` without thinking about tags get something current), but the npm tarball, `image-manifest.json`, and Story 45.2's compose template all pin by digest. `:latest` is for the human; the digest is for the build pipeline. Don't mix the two — don't ever reference `:latest` from a compose template, and don't ever reference a digest in operator-facing docs.
- **`fail-fast: false` on the matrix.** The four images build independently. If one's signing step fails because of a transient sigstore Rekor outage, the other three should still publish — operators on those services aren't blocked. The manifest-write job won't run (it `needs:` all four), but at least the partial state is recoverable via a second `workflow_dispatch` run that targets only the failed image. Without `fail-fast: false`, one transient failure cascades to four redo's.
- **`workflow_dispatch` can run from any branch — design for it.** The smoke-test path (Task 7) runs from `feat/45-1-multi-arch-image-publish-ci`, not from `main`. The workflow file MUST work correctly when checked out from a feature branch. This rules out any hard-coded `if: github.ref == 'refs/heads/main'` checks. The only branch-specific guard is in `publish-npm` (which gates on `tag`-form refs, not main).
- **Cosign keyless OIDC requires `id-token: write` permission.** Forgetting this permission is the #1 cause of "cosign sign hangs at OIDC token request" failures. The workflow MUST declare it at the job level (Task 2.4). Setting it at the step level via `permissions:` is a Docker-action-only feature and not supported by `sigstore/cosign-installer`.
- **Don't run cosign before push.** The build-push-action emits the digest after the push completes. Trying to sign a not-yet-pushed image (e.g., piping `docker buildx build --load` → `cosign sign`) fails with "image not found in registry." Sign order: build → push → capture digest → sign digest. The Task 2.6 step list enforces this.
- **`docker manifest inspect` resolves tag → digest racily.** Under parallel matrix execution, the same registry path can flip between matrix entries' images during `inspect`. Use `docker buildx imagetools inspect <name>@<digest>` (digest-form) for arch verification. Tag-form inspection is acceptable for the post-publish smoke test (Task 7.2) only because the test runs after all matrix jobs have completed.
- **GHCR rate limits unauthenticated reads.** The `connector_version` → digest resolution in `build-image-manifest.mjs` (Task 3.2) hits GHCR with the workflow's `GITHUB_TOKEN`. Anonymous lookup works for ~30 req/hour and would silently 429 inside CI. Always set the docker config token before running `docker manifest inspect` against GHCR.

### Dockerfile.townhouse-api Sizing — Why ≤200 MB

The largest cost driver in the town/mill/dvm images today is the `@solana/*` v3 packages (~80 MB) plus better-sqlite3 (~25 MB). Townhouse-api's API surface (Fastify routes, dockerode, hex/bech32 codecs, snapshot writer) does NOT touch Solana settlement — the API just *reads* connector earnings, it doesn't *settle* them. Excluding the @solana/* tree drops ~80 MB.

Town/mill/dvm runtime images currently weigh in at ~250–300 MB compressed (estimate based on the multi-stage Alpine + bundled native modules pattern). Townhouse-api should be smaller — closer to ~150 MB compressed — because it has a narrower runtime surface. The 200 MB ceiling is generous enough to absorb the dockerode + Fastify + Zod + native better-sqlite3 (if needed for the snapshot writer) tree without bloating into "pulls take 90s on a homelab connection" territory (NFR1's 5-minute first-boot budget can't tolerate a 1.5 GB combined pull — see calculation below).

**NFR1 first-boot budget arithmetic** (per planning doc §3 "Validation forks" + §5):
- Connector image: ~150 MB compressed (verified at v3.6.0)
- townhouse-api image: ≤200 MB target (this AC)
- Anon HS bootstrap: 30–90s
- Total cold-pull at 50 Mbps (~6 MB/s): ~60s for connector, ~35s for townhouse-api
- Operator's first-boot budget: 5 min = 300s
- Buffer for pull retries, connector init, anon publish: 300 - 35 - 60 - 90 = 115s

The 200 MB ceiling holds the buffer. Bloat past ~250 MB chips into the buffer and risks operators hitting the 5-minute timeout on flakier connections.

### Latest tech (verified 2026-05-08)

- **`docker/build-push-action` v6.x:** Latest stable. Outputs `digest` directly (no need for stdout parsing). Supports `cache-from: type=gha` + `cache-to: type=gha,mode=max` for cross-job cache reuse. Multi-platform requires QEMU + buildx pre-setup.
- **`sigstore/cosign-installer` v3.x:** Installs cosign CLI ≥2.4. Default install in CI honors `id-token: write` for keyless OIDC. `cosign sign` against an OCI digest in GHCR + GHA workflow defaults to keyless and writes the signature to the registry's sigstore namespace automatically — no `--upload`, no `--registry-token` flags needed.
- **`docker buildx imagetools inspect`:** Replaces older `docker manifest inspect` for digest-form refs. The `imagetools` command supports `--format '{{json .Manifest}}'` and properly handles OCI image indexes; `manifest inspect` predates the OCI index format and emits flatter output that's harder to parse.
- **GHCR keyless OIDC trust path:** GitHub Actions OIDC tokens carry the workflow's identity URL (`https://github.com/<owner>/<repo>/.github/workflows/<file>@<ref>`) which `cosign verify --certificate-identity-regexp` matches against. Pinning the regex to `^https://github.com/toon-protocol/town/` (the repo prefix, not a specific workflow file) lets the verify command tolerate workflow-file renames without breaking the verification chain.
- **GitHub Actions concurrency on tag pushes:** A `v*` tag push triggers exactly once even when the tag was pushed via `git push --follow-tags` alongside a `main` commit. Setting `concurrency.cancel-in-progress: false` is the right pattern for publish workflows: never abort a sign-in-progress run because a second tag push arrived.
- **Action SHA pinning workflow:** `gh api repos/<owner>/<action>/git/refs/tags/<tag> --jq .object.sha` returns the 40-char SHA the tag points at. For multi-tag actions (where the tag is itself a commit alias for `main` like `actions/checkout@v4`), the SHA is the resolved commit; pinning to it is stable across tag re-tagging events.

### What This Story Does NOT Do (scope guard)

- **Does NOT publish to npm in live mode.** The first delivery of this workflow MAY include `--dry-run` on the `pnpm publish` step pending Story 45.2's compose template embedding. Live npm publish flips on once 45.2 lands. Document this in the workflow file and the PR body.
- **Does NOT bump `DEFAULT_CONNECTOR_IMAGE` from tag-form to digest-form.** That bump is a tail commit on Story 45.2 once `image-manifest.json` is consumable from inside `packages/townhouse/src/`.
- **Does NOT create or modify `docker-compose-townhouse-hs.yml`.** Compose templating is Story 45.2 territory. The HS compose file already exists at the repo root for dev/test workflows; the npm-tarball-embedded template is a Story 45.2 artifact.
- **Does NOT add Trivy / SBOM scanning steps.** The sibling `publish-bls.yml` includes them; the new workflow MAY include them as a follow-up but they are not Story 45.1 ACs. If the dev finds the additions trivial, scope creep is acceptable but should be called out in the PR body. If they require non-trivial debugging, defer to a follow-up.
- **Does NOT modify the existing `.github/workflows/test.yml` PR-CI gate.** The new workflow is a publish-only surface (tags + dispatch). Cross-pollinating with the PR-CI gate creates a debugging surface area Story 22.5 specifically tried to keep narrow.
- **Does NOT introduce contract tests against the new images.** `connector-image-contract.test.ts` already exists (`packages/townhouse/src/__integration__/connector-image-contract.test.ts`) and asserts against `DEFAULT_CONNECTOR_IMAGE`. A parallel `townhouse-image-contract.test.ts` against the four new images is a Story 45.2-or-later concern (it depends on `image-manifest.json` being readable from inside the package).
- **Does NOT republish the connector image.** Per AC #2 and the planning doc §7. Discussed at length in "Why EXACTLY four images" above.
- **Does NOT generate per-arch sub-image entries in `image-manifest.json`.** The manifest pins the multi-arch index digest, not per-arch entries. Multi-arch resolution at pull time is Docker's job, not the manifest's. Adding per-arch digests is a follow-up if downstream tooling ever needs them (none currently does).
- **Does NOT generate a Software Bill of Materials (SBOM).** Out of scope; can layer in via a follow-up story if the v0.1 pilot shows demand. Trivy + cyclonedx in the BLS workflow is the pattern to follow when added.
- **Does NOT verify Story 22.5's `connector-contract.test.ts` against the newly-pinned connector digest.** That's the canary's job at consumer time (Story 45.2+). This story produces the digest the canary will eventually run against.
- **Does NOT modify the connector's `DEFAULT_CONNECTOR_IMAGE` or the existing dev/HS compose tags.** They stay as-is for now; transitioning to digest pins is Story 45.2.

### Sequencing Within Epic 45

```
   45.1 (this story) ──→ 45.2 ──→ 45.4 ──→ 46.x
       │                   │        │
       └─── 45.3 ──────────┴────────┘
        (parallel)         (consumer)
```

- **45.1 produces:** the publish workflow + `image-manifest.json` (artifact) + cosign signatures + Dockerfile.townhouse-api
- **45.2 consumes:** `image-manifest.json` → embeds in the npm tarball → flips `DEFAULT_CONNECTOR_IMAGE` to digest form
- **45.3 (parallel):** DockerOrchestrator profile param — refactor independent of CI
- **45.4 consumes:** the published images (via the embedded compose template from 45.2) + the cosign-verifiable digest + Dockerfile.townhouse-api
- **Critical path:** 44.1 (already done — connector v3.5.0 published) → 45.1 (this) → 45.2 → 45.4 → 46.1 (next critical)

### Why This Story Is Slip-Risk-Marked "L"

Per planning doc §3: "Highest slip slip risk: TH-21.17.1 (multi-arch CI + cosign + matrix manifest fanout). Budget 2× nominal estimate." Sources of slip:

1. **Cross-arch builds (linux/arm64 on amd64 runners)** are 5–10× slower than native amd64. A 30s amd64 Dockerfile compiles to a 3–5min arm64 build under QEMU emulation. Four images × two arches = 8 build runs × ~3min average = ~24min just for builds. Plus push, sign, verify. Plan for ~45min total runtime per workflow run. CI minute cost is real but not blocking.
2. **Sigstore / Rekor transparency log latency.** Cosign signing requires writing to the Sigstore Rekor transparency log. Rekor occasionally has 30–60s latency spikes that cause `cosign sign` to time out at default settings. Mitigation: extend the cosign step's timeout to 5min (rare to need but cheap to allow).
3. **GHCR push retries on transient 5xx.** GHCR has occasional `503 Service Unavailable` responses during high-traffic windows. The `docker/build-push-action` retries automatically with backoff, but the matrix's `fail-fast: false` is what makes the workflow tolerant of one image's flake.
4. **Action SHA pin staleness.** Pinning to a SHA that's 6+ months old means missing security fixes that were applied to the action between then and now. Counter: the SHA pinning is a one-time implementation cost; refresh during PR review with the latest stable tag.
5. **Cosign installer + ID token race.** The `id-token: write` permission is granted at job start, but the OIDC token is fetched at install time. If the token request races with the cosign install completing, the first sign call fails with "missing ID token." Mitigation: explicit `actions/install-cosign` checkout-time wait or a 5s `sleep` between install and first sign. Documented as a known sigstore gotcha.

The 2× budget the plan calls out is the right framing. If the dev hits the 1× budget cleanly, the slack lands as spare time in the sprint. If they hit the 2× budget, the story still ships within the v0.1 pilot recruitment window (Mary's 2026-05-25 outreach launch, per planning doc §8).

### Why npm publish Lives in This Workflow (Not a Separate One)

Two design choices were considered:
- **A:** Single workflow that publishes images + npm in lockstep (chosen)
- **B:** Two workflows — image publish + a separate npm publish that downloads the artifact

Option A is simpler: one trigger event (`v*` tag), one workflow run, one timeline. Operators reading "what shipped at v0.1.0?" see one row in Actions, not two.

Option B's appeal is decoupling: a flake in npm publish doesn't block the next image-publish iteration. But the cost is real: image-manifest.json must persist across workflow runs (artifact retention is 90 days default, but you'd want longer for npm publishes that lag image publishes). Operators have to reason about which image-tag goes with which npm-version. Tag/version drift becomes a class of bug.

Option A wins on alignment-by-construction: the npm tarball that ships at `v0.1.0` carries the digests captured at the same `v0.1.0` tag. No drift possible.

The trade-off: a sigstore flake on image #4 prevents the npm publish, even though images #1–3 already published. Operators consume the partial-state via the registry but not via npm. This is acceptable because (a) it's rare and (b) the recovery path is `workflow_dispatch` with the same tag — re-runs are cheap.

## References

### From `_bmad-output/planning-artifacts/epics-townhouse-hs-v1.md`

- [Source: epics-townhouse-hs-v1.md#L476-L513] — Story 45.1 ACs (canonical)
- [Source: epics-townhouse-hs-v1.md#L37] — FR2 (multi-arch GHCR images for 4 townhouse-owned services, NOT connector)
- [Source: epics-townhouse-hs-v1.md#L122] — NFR17 (pre-publish quality gate, 6 green checks including cosign verify)
- [Source: epics-townhouse-hs-v1.md#L153] — Image registry constraint (`ghcr.io/toon-protocol/<svc>` multi-arch + cosign-signed)
- [Source: epics-townhouse-hs-v1.md#L94] — NFR1 (5-min first-boot budget — informs Dockerfile.townhouse-api sizing)
- [Source: epics-townhouse-hs-v1.md#L277-L284] — Epic 45 overview (One-Command Apex Install dependency on this story)
- [Source: epics-townhouse-hs-v1.md#L391-L412] — Story 44.2 (connector multi-arch — pattern reference)
- [Source: epics-townhouse-hs-v1.md#L416-L440] — Story 44.3 (connector cosign keyless OIDC — pattern reference)
- [Source: epics-townhouse-hs-v1.md#L444-L468] — Story 44.4 (release contract doc — names this story's `image-manifest.json` artifact)

### From `_bmad-output/planning-artifacts/townhouse-hs-v1-plan-2026-05-07.md`

- [Source: townhouse-hs-v1-plan-2026-05-07.md#L65] — TH-21.17.1 row in story list (sized L, critical path, "Budget 2× nominal estimate")
- [Source: townhouse-hs-v1-plan-2026-05-07.md#L80-L82] — Critical path declaration (1 → 2 → 5 → 6 → 13)
- [Source: townhouse-hs-v1-plan-2026-05-07.md#L238-L244] — Image-publish coordination ("Townhouse must NOT republish" — load-bearing)
- [Source: townhouse-hs-v1-plan-2026-05-07.md#L311-L317] — Pre-publish quality gates (6 checks)
- [Source: townhouse-hs-v1-plan-2026-05-07.md#L333-L336] — Decision log row 11 (consume connector image by digest, don't republish)

### From `_bmad-output/implementation-artifacts/`

- [Source: 44-2-connector-verify-multi-arch-image-build.md] — sibling story, multi-arch verification pattern reference (connector#62/#63)
- [Source: 44-3-connector-cosign-keyless-oidc-image-signing.md] — sibling story, cosign keyless OIDC pattern reference (connector#66)
- [Source: 44-4-connector-release-contract-cross-repo-doc.md] — release contract doc (names `image-manifest.json` schema requirement) (connector#67, town#34)
- [Source: 22-5-connector-interface-contract-smoke-test.md] — Task 4.4 OWASP A08 SHA-pinning discipline reference

### From this repo

- [Source: .github/workflows/publish-bls.yml] — closest sibling pattern (multi-arch + GHA cache + Trivy/SBOM via metadata-action)
- [Source: docker/Dockerfile.town] — multi-stage esbuild + non-root pattern (model for Dockerfile.townhouse-api)
- [Source: docker/Dockerfile.mill] — same pattern, `LABEL` placement gotcha documented (LABELs before first FROM are silently dropped)
- [Source: docker/Dockerfile.dvm] — same pattern, additional externals-resolution discipline for hoisted pnpm modules
- [Source: packages/townhouse/package.json] — `bin: ./dist/cli.js`, `files: ["dist"]`, ESM-only, Node ≥20
- [Source: packages/townhouse/tsup.config.ts] — esbuild banner pattern for `import.meta.url`
- [Source: packages/townhouse/src/constants.ts:21] — current `DEFAULT_CONNECTOR_IMAGE = 'ghcr.io/toon-protocol/connector:3.4.1'`
- [Source: packages/townhouse/src/__integration__/connector-image-contract.test.ts] — existing image-contract test pattern (Story 45.2 follow-on will mirror this for the four new images)
- [Source: packages/townhouse/scripts/start-api-only.mjs] — host-mode startup script (informs Task 6.1 entrypoint design)
- [Source: packages/sdk/CONNECTOR_RELEASE_CONTRACT.md] — release contract; references `packages/townhouse/dist/image-manifest.json` as the digest-pin artifact (Story 44.4 mirror)
- [Source: docker-compose-townhouse-hs.yml] — operator-facing HS-mode compose file (Story 45.2 will derive its embedded twin)
- [Source: docker-compose-townhouse-dev.yml] — dev-stack compose file (informs port allocation 28xxx range — see CLAUDE.md §"Townhouse Dev Stack (28xxx)")
- [Source: scripts/townhouse-test-infra.sh] — real-CLI E2E orchestrator (Story 22.5 sibling; gate check #4 in NFR17)
- [Source: CLAUDE.md] — § "Townhouse Dev Stack (28xxx)" port allocation; § "Where to Find Things" (add row for `image-manifest.json` if it becomes a persistent artifact)

### Latest tech references (verified 2026-05-08)

- [docker/build-push-action README](https://github.com/docker/build-push-action) — `outputs.digest` exposes the OCI digest directly; `cache-from`/`cache-to` `type=gha` for cross-job cache
- [sigstore/cosign-installer README](https://github.com/sigstore/cosign-installer) — keyless OIDC default in CI when `id-token: write` is granted
- [GitHub Actions OIDC for sigstore](https://docs.github.com/en/actions/deployment/security-hardening-your-deployments/about-security-hardening-with-openid-connect) — token issuer + identity URL format
- [docker buildx imagetools inspect](https://docs.docker.com/reference/cli/docker/buildx/imagetools/inspect/) — preferred multi-arch verification command (handles OCI image indexes correctly)
- [Cosign verify identity matching](https://docs.sigstore.dev/cosign/verifying/verify/) — `--certificate-identity-regexp` and `--certificate-oidc-issuer` flag semantics
- [GHCR rate limits](https://docs.github.com/en/packages/learn-github-packages/about-github-packages#rate-limits) — anonymous reads limited to ~30 req/hour; authenticated reads via GITHUB_TOKEN do not face the same limit
- [GitHub Actions `concurrency` semantics](https://docs.github.com/en/actions/using-jobs/using-concurrency) — `cancel-in-progress: false` for publish workflows

## Verification

After Task 7 smoke test passes AND PR merges AND a `v0.1.0` tag-push run completes:

```bash
# 1. Workflow file lints + matches AC #1, #2, #8
gh workflow view publish-townhouse-images.yml --ref main
grep -c "actions/checkout@[a-f0-9]\{40\}" .github/workflows/publish-townhouse-images.yml
# Expected: every uses: line is SHA-pinned (count == number of uses: lines)
grep -E "image:.*connector" .github/workflows/publish-townhouse-images.yml
# Expected: only inside comments OR the manifest-pinning step — NOT in the build matrix

# 2. Multi-arch verification (AC #7)
for img in townhouse-api town mill dvm; do
  echo "--- $img ---"
  docker buildx imagetools inspect ghcr.io/toon-protocol/$img:latest \
    --format '{{json .Manifest}}' | jq -r '.manifests[].platform.architecture' | sort -u
done
# Expected: each block prints "amd64\narm64" — anything missing = fail

# 3. Cosign signature verification (AC #5)
for img in townhouse-api town mill dvm; do
  digest=$(docker buildx imagetools inspect ghcr.io/toon-protocol/$img:latest --format '{{.Manifest.Digest}}')
  cosign verify ghcr.io/toon-protocol/$img@$digest \
    --certificate-identity-regexp '^https://github.com/toon-protocol/town/' \
    --certificate-oidc-issuer 'https://token.actions.githubusercontent.com' \
    >/dev/null 2>&1 && echo "OK $img" || echo "FAIL $img"
done
# Expected: 4 OK, 0 FAIL

# 4. image-manifest.json schema (AC #4) — pull from latest workflow run artifacts
gh run download <run-id> --name image-manifest -D /tmp
jq -e '.schemaVersion == 1' /tmp/image-manifest.json
jq -e '.images | keys | sort == ["connector","dvm","mill","town","townhouse-api"]' /tmp/image-manifest.json
jq -e '.images | to_entries | map(.value.digest | startswith("sha256:")) | all' /tmp/image-manifest.json
# Expected: all three jq -e queries exit 0 (return true)

# 5. Sprint-status update (AC #10)
grep -A1 "45-1-multi-arch" /home/jonathan/Documents/town/_bmad-output/implementation-artifacts/sprint-status.yaml
# Expected: status reads "done", trailing # comment names the workflow run URL + PR number

# 6. Dockerfile.townhouse-api exists + size budget (AC #9)
test -f /home/jonathan/Documents/town/docker/Dockerfile.townhouse-api && echo "OK" || echo "FAIL: missing"
docker images ghcr.io/toon-protocol/townhouse-api:latest --format '{{.Size}}'
# Expected: file exists; size ≤ 200 MB compressed (acceptable through ~250 MB if NFR1 budget arithmetic still passes)
```

If any of these checks fail, the story is NOT done. Re-open. Do not flip sprint-status to `done`.

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6 (2026-05-08)

### Debug Log References

- Task 1.5: `docker manifest inspect ghcr.io/toon-protocol/connector:3.6.1` returns `['amd64', 'arm64', 'unknown', 'unknown']` — the `unknown` entries are attestation artifacts (OCI spec), not architecture manifests. Both required archs confirmed present. No blocker.
- Task 6.2: Grepped `packages/townhouse/src/api/` for `better-sqlite3` and `sqlite` imports — zero matches. Dropped `--external:better-sqlite3` per story instruction (Task 6.2: "if absent, drop this external"). No SQLite in the API-only path.
- Task 6.2 (fastify): Story suggested `--external:fastify` but noted it's "bundleable". To avoid complex runtime module installation (fastify v5 + @fastify/cors + @fastify/websocket + their transitive deps), fastify is bundled with esbuild. This keeps the runtime stage simpler and stays within the 200 MB compressed size target.
- Pre-existing test failures in `packages/townhouse/src/api/routes/logs.test.ts` confirmed via stash/unstash: 11 tests fail identically before and after this story's changes. These are unrelated to Story 45.1.

### Completion Notes List

- Tasks 1–6 implemented and verified locally.
- Task 7 (smoke test) requires actual CI execution: push branch to GitHub, trigger `workflow_dispatch` with `version=0.1.0-rc1 connector_version=3.4.1` from the `feat/45-1-multi-arch-image-publish-ci` branch.
- All 16 unit tests for `scripts/build-image-manifest.mjs` pass (vitest run).
- GHA workflow YAML validated (Python yaml.safe_load).
- All 17 `uses:` lines SHA-pinned (verified via grep).
- Connector reference appears only in comments and manifest-pinning step (AC #2 verified via grep).
- npm publish is in `--dry-run` mode pending Story 45.2 (compose templates in tarball).
- Story 45.1 ready for CI smoke test → PR → review.

### File List

- `.github/workflows/publish-townhouse-images.yml` (NEW)
- `scripts/build-image-manifest.mjs` (NEW)
- `scripts/build-image-manifest.test.ts` (NEW)
- `docker/Dockerfile.townhouse-api` (NEW)
- `docker/src/entrypoint-townhouse-api.ts` (NEW)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (MODIFIED — status: in-progress)
- `_bmad-output/implementation-artifacts/45-1-multi-arch-townhouse-image-publish-ci.md` (MODIFIED — task checkboxes, dev agent record)

### Change Log

- 2026-05-08: Tasks 1–6 implemented. GHA workflow for multi-arch GHCR publish + cosign keyless OIDC authored. `build-image-manifest.mjs` script with Zod schema validation written and tested (16 tests). `Dockerfile.townhouse-api` multi-stage Alpine build created. `entrypoint-townhouse-api.ts` container entrypoint adapted from host-mode `start-api-only.mjs`. All action SHAs pinned. npm publish in --dry-run mode pending Story 45.2.

### Review Findings

_To be filled in after code review_
