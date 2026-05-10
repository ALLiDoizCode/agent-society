# Story 45.2: Embed Compose Templates + Image Manifest in npm Tarball

Status: done (v0.1.0-rc5 published 2026-05-09; tarball verified — 5 digest-pinned images, 0 unsubstituted placeholders, image-manifest.json schema-clean)

> **CRITICAL PATH — second story of Epic 45 (One-Command Apex Install).** Sized M by the plan. Story 45.4 (`townhouse hs up` subcommand) cannot start until this story lands the embedded compose template and the `loadComposeTemplate()` API. This story is also what flips the `--dry-run` flag in the Story 45.1 publish workflow to live `npm publish` — without an `image-manifest.json` and a digest-resolved compose template inside the tarball, an operator running `npx @toon-protocol/townhouse hs up` has no compose file to feed `docker compose -f` against.

## Story

As a **townhouse operator (Drew)** preparing to run the v0.1 hidden-service apex,
I want **the published `@toon-protocol/townhouse` npm package to ship (a) a digest-pinned `townhouse-hs.yml` compose template, (b) the `townhouse-dev.yml` template the existing contributor dev stack already consumes, and (c) the `image-manifest.json` digest registry that pins every townhouse-owned image plus the upstream connector image to a content-addressed `sha256:` digest**,
so that I never need to clone the source repo, my version of townhouse always pulls the exact image set it was tested against, and `docker compose -f ~/.townhouse/compose/townhouse-hs.yml up` is a deterministic, reproducible operation across architectures and across `npm install` invocations of the same version.

## Acceptance Criteria

1. **`packages/townhouse/compose/` source dir exists with both templates.** Two new files: `packages/townhouse/compose/townhouse-hs.yml` and `packages/townhouse/compose/townhouse-dev.yml`. The HS template is the canonical operator-facing compose for `townhouse hs up`; the dev template is the canonical contributor-facing compose used by `scripts/townhouse-dev-infra.sh`. The two existing root-level files (`docker-compose-townhouse-hs.yml`, `docker-compose-townhouse-dev.yml`) are NOT deleted in this story (scope-guard — see Dev Notes "What This Story Does NOT Do"); the package-local copies are the new sources of truth for the npm tarball, and root-level retirement is deferred to a follow-up.

2. **The HS template uses digest-pinned `image:` for every service — never `build:`, never tag-form.** Every `services.<name>.image` entry in `packages/townhouse/compose/townhouse-hs.yml` MUST take the form `ghcr.io/toon-protocol/<svc>@sha256:<digest>` for the four townhouse-owned services (`townhouse-api`, `town`, `mill`, `dvm`) AND for the upstream connector. No `build:` directives. No `image: ...:tag` form. No `image: toon:<svc>` (the local-build pattern from `docker-compose-townhouse-hs.yml` at the root). Digest values are resolved from `dist/image-manifest.json` at build time (see AC #4 + Task 5). A grep of the source template file MAY contain placeholder tokens (e.g. `${TOON_TOWN_DIGEST}` or similar) that are substituted at build time — what ships in the tarball must be fully substituted.

3. **`townhouse-api` service is added to the HS template** (it is missing from the legacy root-level `docker-compose-townhouse-hs.yml`). The new service definition in `packages/townhouse/compose/townhouse-hs.yml` uses `image: ghcr.io/toon-protocol/townhouse-api@sha256:<digest>`, mounts the host docker socket RW (`/var/run/docker.sock:/var/run/docker.sock`), mounts `~/.townhouse/` RW into the container, exposes Fastify on `127.0.0.1:28090` (per Epic 21 D21-008 + planning doc §4 architecture anchor), depends_on `connector` healthcheck, and has a healthcheck against `/api/health`. This service is what Story 45.4 boots alongside `connector`.

4. **`scripts/build-image-manifest.mjs` (Story 45.1) is reused as-is to produce the digest-resolution input.** The script already exists at the repo root, ships the v1 manifest schema (5 image entries: `townhouse-api`, `town`, `mill`, `dvm`, `connector`), and runs in the Story 45.1 publish workflow. Story 45.2 does NOT modify this script. What Story 45.2 adds is:
   - A new `scripts/render-compose-template.mjs` script (or an inline tsup `onSuccess` hook — dev's call) that reads `packages/townhouse/dist/image-manifest.json` and substitutes placeholders in `packages/townhouse/compose/townhouse-hs.yml` to produce `packages/townhouse/dist/compose/townhouse-hs.yml`.
   - A copy step in the same build that ships `packages/townhouse/compose/townhouse-dev.yml` to `packages/townhouse/dist/compose/townhouse-dev.yml` verbatim (no substitution — the dev template uses local `toon:*` images by design).

5. **tsup config copies `compose/` and preserves `image-manifest.json` into `dist/`.** `packages/townhouse/tsup.config.ts` is updated so its `onSuccess` hook (or an equivalent post-build script) (a) copies `packages/townhouse/compose/townhouse-dev.yml` → `packages/townhouse/dist/compose/townhouse-dev.yml`, (b) renders `packages/townhouse/compose/townhouse-hs.yml` against `packages/townhouse/dist/image-manifest.json` and writes the result to `packages/townhouse/dist/compose/townhouse-hs.yml`, and (c) does NOT delete `packages/townhouse/dist/image-manifest.json` if it is already present (the publish workflow drops it there via `actions/download-artifact` BEFORE `pnpm build` runs — see Task 7). When `dist/image-manifest.json` is absent (typical during local development), the build does NOT fail; instead it emits a warning, skips the HS substitution, copies the unsubstituted HS template (which still parses as valid YAML — placeholders are valid YAML strings), and lets unit tests catch missing-manifest scenarios. This matches the dev/CI split: developers running `pnpm --filter @toon-protocol/townhouse build` locally get a working dist without first running `scripts/build-image-manifest.mjs`.

6. **`packages/townhouse/src/compose-loader.ts` exists with the API the next story consumes.** The new module exports:

    ```typescript
    export type ComposeProfile = 'dev' | 'hs';

    export interface ComposeLoaderOptions {
      /** Override default `~/.townhouse/` write target. Used by tests. */
      townhouseHome?: string;
      /** Override the package-relative dist directory the loader reads from.
       *  Defaults to the `dist/` adjacent to compose-loader.js at runtime. Tests use this
       *  to point at fixture directories without touching the real package install. */
      distDir?: string;
    }

    /**
     * Returns the rendered compose YAML for the requested profile.
     * For 'hs', digest substitutions are already applied (resolved at build time).
     * For 'dev', the YAML is returned verbatim (uses local `toon:*` image tags).
     * Throws `ComposeLoaderError` if the requested profile's YAML is unreadable.
     */
    export function loadComposeTemplate(
      profile: ComposeProfile,
      options?: ComposeLoaderOptions
    ): string;

    /**
     * Writes the resolved compose YAML to `<townhouseHome>/compose/<profile>.yml`
     * and copies `dist/image-manifest.json` to `<townhouseHome>/image-manifest.json`.
     * BOTH output files are written with mode 0o600 (NFR8 — operator-secret file mode).
     * Returns the absolute paths of the two files written.
     */
    export function materializeComposeTemplate(
      profile: ComposeProfile,
      options?: ComposeLoaderOptions
    ): { composePath: string; manifestPath: string };

    export class ComposeLoaderError extends Error {}
    ```

    The two functions are independent: `loadComposeTemplate` is read-only (returns a string), `materializeComposeTemplate` is the side-effecting write that Story 45.4 invokes during `townhouse hs up`. Both are exported from `packages/townhouse/src/index.ts` so consumers (the CLI, future SPA, integration tests) can import them via the package public API.

7. **Resolved HS template + manifest are written to `~/.townhouse/` with mode `0o600`.** When `materializeComposeTemplate('hs')` runs:
   - `<townhouseHome>/compose/townhouse-hs.yml` is created with mode `0o600` (NFR8 applies — operator-secret file mode; the rendered compose contains environment variables that may include private keys at deploy time).
   - `<townhouseHome>/image-manifest.json` is created with mode `0o600` (operator-secret file mode — pins the supply-chain identity; tampering with this file is what an attacker would do to swap images).
   - Parent directories are created with mode `0o700` (`~/.townhouse/` and `~/.townhouse/compose/`) if absent.
   - The umask is restored after the write (`fs.chmodSync` after write, OR pass `mode` to `fs.writeFileSync` AND verify post-write).
   - Pre-existing files at the same path are overwritten without prompting (idempotent re-runs are an explicit AC of Story 45.4 — re-running `hs up` MUST NOT prompt for permission).

8. **Unit + integration tests cover loader behavior + tarball contents + compose validity.** New test files:
   - `packages/townhouse/src/compose-loader.test.ts` — unit tests for `loadComposeTemplate` + `materializeComposeTemplate`. Covers: dev profile returns verbatim, hs profile returns substituted YAML, hs profile throws when manifest absent + dev profile does not, materialize writes `0o600`, materialize creates parent dir at `0o700`, materialize is idempotent (second call overwrites first).
   - `packages/townhouse/src/__integration__/compose-template-validity.test.ts` — integration test that takes the rendered HS template and validates it via `docker compose -f <rendered-path> config` (subprocess invocation; gated on `process.env.DOCKER_AVAILABLE === '1'` or skipped in environments without the docker binary). On a clean rendered tarball, this asserts: (a) `docker compose config` exits 0, (b) the parsed output names every image at digest form (`grep '@sha256:'` matches every `image:` line in the services map), (c) no `build:` directives appear.
   - `packages/townhouse/src/__integration__/tarball-contents.test.ts` — runs `pnpm pack` against the package, untars the resulting `.tgz`, and asserts `package/dist/compose/townhouse-hs.yml`, `package/dist/compose/townhouse-dev.yml`, AND `package/dist/image-manifest.json` are present. Asserts the HS YAML in the tarball has no unsubstituted placeholders (regex match against `\$\{[A-Z_]+_DIGEST\}` returns 0 matches). The test is skipped if `dist/image-manifest.json` is absent at test time (CI runs with manifest present; pure local dev runs without).

9. **`DEFAULT_CONNECTOR_IMAGE` constant flips from tag form to digest form.** `packages/townhouse/src/constants.ts` line 21 (currently `export const DEFAULT_CONNECTOR_IMAGE = 'ghcr.io/toon-protocol/connector:3.4.1'`) is updated to take its value from `dist/image-manifest.json` at build time OR (simpler — the recommended approach) is hard-coded to a digest-form constant matching what `image-manifest.json` ships at v0.1.0 (`ghcr.io/toon-protocol/connector@sha256:<digest>`). The contract canary (`packages/townhouse/src/__integration__/connector-image-contract.test.ts`) runs against the new constant and asserts the resolved manifest entry's digest matches. Bumps to subsequent connector versions become a one-line edit to the constant + a workflow-dispatch run of Story 45.1 to capture the new digest into a fresh `image-manifest.json` (the operator-experience cost of "deliberately bumping each minor" per release-contract clause `CONNECTOR_RELEASE_CONTRACT.md` §"Townhouse pins by digest").

10. **The Story 45.1 publish workflow flips from `--dry-run` to live `npm publish`.** `.github/workflows/publish-townhouse-images.yml` line containing `pnpm --filter @toon-protocol/townhouse publish ... --dry-run` (or equivalent) has the `--dry-run` flag removed. The top-of-file comment that documented the staged delivery is updated to record that 45.2 has landed and live publish is now active. `secrets.NPM_TOKEN` consumption stays as-is. The `npm-publish` job's `needs:` declaration stays as-is (it already gates on the four image-publish + sign matrix entries succeeding). NO new triggers — `v*` tag-push only. NO `workflow_dispatch` live-publish path (workflow_dispatch stays dry-run for smoke testing).

11. **Tarball-content verification step in workflow** (one CI step, low cost): a new step in the `npm-publish` job runs `pnpm --filter @toon-protocol/townhouse pack --pack-destination /tmp/pack-out/` BEFORE `pnpm publish`, then `tar -tzf /tmp/pack-out/toon-protocol-townhouse-*.tgz | grep -E 'package/dist/(compose/townhouse-(hs|dev)\.yml|image-manifest\.json)'` MUST match all three lines. If any are missing, the step (and therefore the publish) fails. This catches "tsup config drift dropped the compose copy step" before the package ships.

12. **Sprint-status update.** AFTER the workflow-dispatch + live-publish smoke succeeds against a `v0.1.0-rc2` (or similar) test tag AND the published package's `node_modules/@toon-protocol/townhouse/dist/compose/townhouse-hs.yml` contains digest-form image refs verifiable against the registry: update `_bmad-output/implementation-artifacts/sprint-status.yaml` `45-2-embed-compose-templates-and-image-manifest-in-npm-tarball: backlog → done` (mirror Story 44.4 / 45.1 close-out style — `# done: tag vX.Y.Z published; tarball ships compose/* + image-manifest.json — town#<PR-num>`). Bump `last_updated` to merge date.

## Tasks / Subtasks

- [x] **Task 1: Read 45.1 outputs + confirm `image-manifest.json` shape is consumable** (AC: #2, #4, #9)
  - [x] 1.1 Re-read `_bmad-output/implementation-artifacts/45-1-multi-arch-townhouse-image-publish-ci.md` end-to-end. Pay attention to the v1 manifest schema (`scripts/build-image-manifest.mjs:50-66`) — five image entries keyed `townhouse-api | town | mill | dvm | connector`, each with `{name, tag, digest}` and `digest` matches `^sha256:[a-f0-9]+`. The dev MUST consume this exact shape; do NOT introduce a v2 schema.
  - [x] 1.2 Pull a copy of the actual artifact from workflow run `25603167091` to confirm the live shape: `gh run download 25603167091 --repo toon-protocol/town --name image-manifest -D /tmp/45-1-artifact/`. Inspect `/tmp/45-1-artifact/image-manifest.json`. Verify all five `digest` values are `sha256:...` form. If the file is missing keys (e.g., `connector` digest is null because of the buildx-imagetools fix in town#41), retry with the LATEST publish workflow run via `gh run list --workflow=publish-townhouse-images.yml --repo toon-protocol/town`.
  - [x] 1.3 Read `packages/townhouse/src/constants.ts:21` (`DEFAULT_CONNECTOR_IMAGE = 'ghcr.io/toon-protocol/connector:3.4.1'`) to confirm the current tag-form pin. Read `packages/townhouse/src/__integration__/connector-image-contract.test.ts` to confirm what the canary asserts against the constant (image existence, admin endpoint shape, version label). The constant flip in Task 6 must keep this test green.
  - [x] 1.4 Read `docker-compose-townhouse-hs.yml` at the repo root end-to-end. Note: it uses `image: toon:town`, `image: toon:mill`, etc. (local-build tags) AND `image: ghcr.io/toon-protocol/connector:3.4.1` (tag form). These must NOT appear in the new `packages/townhouse/compose/townhouse-hs.yml` — every service goes to digest form (per AC #2). Note also: the root file does NOT include a `townhouse-api` service. The new template adds it (AC #3).
  - [x] 1.5 Read `docker-compose-townhouse-dev.yml` at the repo root end-to-end. Confirm what the contributor dev stack expects: services, profiles, networks, volumes, port bindings, env-vars. The new `packages/townhouse/compose/townhouse-dev.yml` MAY copy this file verbatim OR diverge minimally (e.g., drop bind mounts that point at repo paths the operator doesn't have). Discuss in Dev Notes which approach the dev chose and why.
  - [x] 1.6 Read `packages/townhouse/tsup.config.ts` to confirm the current build pipeline. Note: it is a minimal config with `entry: ['src/index.ts', 'src/cli.ts']`, `format: ['esm']`, `dts: true`, `outDir: 'dist'`, `clean: true`. The `clean: true` flag DELETES everything in `dist/` at the start of every build — including `dist/image-manifest.json` if it was placed there by CI. This is a load-bearing detail: Task 5's `onSuccess` hook MUST run AFTER tsup's clean+build, AND `image-manifest.json` placement must happen AFTER `pnpm build`, NOT before. The 45.1 workflow's npm-publish job already does this in the right order (build → download-artifact → publish); preserving that order is essential.

- [x] **Task 2: Author `packages/townhouse/compose/townhouse-hs.yml`** (AC: #1, #2, #3)
  - [x] 2.1 Create the directory `packages/townhouse/compose/` (does not exist yet).
  - [x] 2.2 Author the HS template as a YAML file with placeholder tokens for the digest values. Recommended placeholder syntax: `${TOON_<SVC>_DIGEST}` (e.g. `${TOON_TOWN_DIGEST}`, `${TOON_CONNECTOR_DIGEST}`) — uppercase, underscore-separated, easy to grep. The placeholder appears in the `image:` value:
    ```yaml
    services:
      town:
        image: ghcr.io/toon-protocol/town${TOON_TOWN_DIGEST}
        # → after substitution: ghcr.io/toon-protocol/town@sha256:abc123...
    ```
    The substitution at Task 5 simply does `templateString.replaceAll('${TOON_TOWN_DIGEST}', '@sha256:abc123...')`. The leading `@` lives in the substituted value (NOT in the template) so an unsubstituted template still parses as valid YAML (`ghcr.io/toon-protocol/town${TOON_TOWN_DIGEST}` is a plain string — Docker Compose will reject it as "image not found" but the YAML parser accepts it).
  - [x] 2.3 Service entries to include (matching planning doc §4 + Story 45.4 AC #1):
    - `connector` — `image: ghcr.io/toon-protocol/connector${TOON_CONNECTOR_DIGEST}`. Volume `townhouse-hs-anon:/var/lib/anon/hs`. Port `127.0.0.1:9401:9401` (admin API) on host loopback only (NFR9). Container hostname `connector` (matches HS_TARGET_HOST in the existing root file). NO docker.sock mount (NFR7). Env var `CONFIG_FILE=/config/connector.yaml`. Operator-config bind-mount `~/.townhouse/connector.yaml:/config/connector.yaml:ro` (Story 45.4 generates this file at first-run).
    - `townhouse-api` (NEW — see AC #3) — `image: ghcr.io/toon-protocol/townhouse-api${TOON_TOWNHOUSE_API_DIGEST}`. Volume mounts: `/var/run/docker.sock:/var/run/docker.sock` (RW; the API owns the dockerode handle per planning doc §4) AND `~/.townhouse:/.townhouse:rw` (the API reads/writes wallet, snapshots, config). Port `127.0.0.1:28090:28090` (Fastify host API). depends_on `connector` (`condition: service_healthy`). Healthcheck against `/api/health`.
    - `town`, `mill`, `dvm` — each takes `image: ghcr.io/toon-protocol/<svc>${TOON_<SVC>_DIGEST}`. Profiles `[town]`, `[mill]`, `[dvm]` respectively (lazy-provisioned per Epic 46). depends_on connector healthcheck. Existing port + env-var patterns from `docker-compose-townhouse-hs.yml` carry over EXCEPT: no faucet, no anvil, no solana, no ator-sidecar, no ator-sidecar-relay (those are dev-stack concerns, not operator-facing for HS-mode v1; Story 45.4 explicitly boots only connector + townhouse-api at apex install). The town/mill/dvm services exist in the template so Epic 46 can `docker compose --profile <type> up -d` later.
  - [x] 2.4 NO `build:` directives anywhere. NO `image: toon:*` (local-build tags). NO `:latest` tags. NO un-pinned tag forms (e.g., `ghcr.io/toon-protocol/connector:3.4.1` is forbidden by AC #2). Only digest form via the placeholder pattern.
  - [x] 2.5 NO ator-sidecar or ator-sidecar-relay services (those are part of the legacy root-level workflow that operators ran manually before Story 45.4's `townhouse hs up` subcommand existed). The new HS-mode v1 design boots the apex with the connector container's embedded `@anyone-protocol/anyone-client` SDK doing the HS publishing — see planning doc §4 "Apex idle state is useful" — so the sidecar is no longer required. The connector image at the digest pinned in `image-manifest.json` is the connector v3.5.x build that ships with anon support.
  - [x] 2.6 Top-of-file YAML comment block describing: (a) what this template is (operator-facing apex compose), (b) how digests are substituted (Task 5 hook), (c) where the resolved file ends up (`~/.townhouse/compose/townhouse-hs.yml`, mode `0o600`), (d) which Story owns the substitution (45.2) and which Story owns the boot sequence (45.4). Mirror the comment-block style of `docker-compose-townhouse-hs.yml` (extensive header explaining provenance + workflow).
  - [x] 2.7 All host-side ports MUST bind to `127.0.0.1` only (NFR9). Any service entry with `ports: [...]` whose value omits the `127.0.0.1:` prefix fails review. The image-validity test (Task 8.3) MUST grep for `'\b0\.0\.0\.0:'` in the rendered file and fail if found.

- [x] **Task 3: Author `packages/townhouse/compose/townhouse-dev.yml`** (AC: #1)
  - [x] 3.1 Copy `docker-compose-townhouse-dev.yml` verbatim to `packages/townhouse/compose/townhouse-dev.yml`. The dev template uses local `toon:*` image tags by design — contributors run `pnpm --filter @toon-protocol/townhouse build` followed by `docker compose -f packages/townhouse/compose/townhouse-dev.yml ...` and the local Docker daemon resolves `toon:town` against locally-built images.
  - [x] 3.2 NO digest substitution for the dev template (per AC #2 wording — digest pinning applies only to the HS template). The Task 5 build hook copies this file verbatim.
  - [x] 3.3 Update top-of-file comment to add the new path (`packages/townhouse/compose/townhouse-dev.yml`) + a note that the legacy root-level path (`docker-compose-townhouse-dev.yml`) is preserved for backward compatibility with `scripts/townhouse-dev-infra.sh` and existing CI.
  - [x] 3.4 Scope-guard: do NOT delete the root-level `docker-compose-townhouse-dev.yml`. Do NOT delete the root-level `docker-compose-townhouse-hs.yml`. Both stay until a follow-up retirement story (post-Epic 45) routes everything through the package-local templates.

- [x] **Task 4: Author `packages/townhouse/src/compose-loader.ts`** (AC: #6, #7)
  - [x] 4.1 New file with the API surface specified in AC #6 verbatim:
    ```typescript
    import { readFileSync, writeFileSync, mkdirSync, chmodSync, existsSync } from 'node:fs';
    import { dirname, join, resolve } from 'node:path';
    import { fileURLToPath } from 'node:url';
    import { homedir } from 'node:os';

    export type ComposeProfile = 'dev' | 'hs';

    export interface ComposeLoaderOptions {
      townhouseHome?: string;
      distDir?: string;
    }

    export class ComposeLoaderError extends Error {
      constructor(message: string) {
        super(message);
        this.name = 'ComposeLoaderError';
      }
    }

    function defaultDistDir(): string {
      // Resolves to `dist/` adjacent to the bundled compose-loader.js at runtime.
      // tsup outputs compose-loader to `dist/index.js` (re-exported) so __dirname
      // is `<package>/dist/`.
      const here = dirname(fileURLToPath(import.meta.url));
      // When bundled, here === <package>/dist/. When in tsx/ts-node dev mode,
      // here === <package>/src/. Both work because in the latter case `dist/`
      // is a sibling.
      return resolve(here, '..', 'dist');
    }

    export function loadComposeTemplate(
      profile: ComposeProfile,
      options: ComposeLoaderOptions = {}
    ): string {
      const distDir = options.distDir ?? defaultDistDir();
      const composePath = join(distDir, 'compose', `townhouse-${profile}.yml`);
      if (!existsSync(composePath)) {
        throw new ComposeLoaderError(
          `compose template not found: ${composePath}. ` +
          `Did you run 'pnpm --filter @toon-protocol/townhouse build' first?`
        );
      }
      return readFileSync(composePath, 'utf-8');
    }

    export function materializeComposeTemplate(
      profile: ComposeProfile,
      options: ComposeLoaderOptions = {}
    ): { composePath: string; manifestPath: string } {
      const home = options.townhouseHome ?? join(homedir(), '.townhouse');
      const composeDir = join(home, 'compose');
      mkdirSync(composeDir, { recursive: true, mode: 0o700 });
      // chmod after mkdir for already-existing dirs (mkdir's mode arg is honored
      // only on creation). Defensive: re-chmod on every call.
      chmodSync(home, 0o700);
      chmodSync(composeDir, 0o700);

      const yaml = loadComposeTemplate(profile, options);
      const composePath = join(composeDir, `townhouse-${profile}.yml`);
      writeFileSync(composePath, yaml, { mode: 0o600, encoding: 'utf-8' });
      chmodSync(composePath, 0o600);  // defensive re-chmod (umask interactions)

      const distDir = options.distDir ?? defaultDistDir();
      const manifestSrc = join(distDir, 'image-manifest.json');
      const manifestPath = join(home, 'image-manifest.json');
      if (existsSync(manifestSrc)) {
        const manifest = readFileSync(manifestSrc, 'utf-8');
        writeFileSync(manifestPath, manifest, { mode: 0o600, encoding: 'utf-8' });
        chmodSync(manifestPath, 0o600);
      } else {
        // Manifest is required for HS mode — fail loudly. Dev mode tolerates absence.
        if (profile === 'hs') {
          throw new ComposeLoaderError(
            `image-manifest.json not found at ${manifestSrc}. ` +
            `HS mode requires a digest-pinned image manifest. ` +
            `Reinstall @toon-protocol/townhouse from npm to restore the manifest.`
          );
        }
      }

      return { composePath, manifestPath };
    }
    ```
  - [x] 4.2 ESM-only — no `require()`, no `module.exports`. tsup banners are already configured for `import.meta.url` resolution (`tsup.config.ts:13` injects the `createRequire` shim, but compose-loader.ts uses `fileURLToPath(import.meta.url)` directly which works in pure ESM).
  - [x] 4.3 Export both functions + the error class from `packages/townhouse/src/index.ts`. Add to the public API surface alongside existing exports (after the `WalletManager` block):
    ```typescript
    export {
      loadComposeTemplate,
      materializeComposeTemplate,
      ComposeLoaderError,
    } from './compose-loader.js';
    export type { ComposeProfile, ComposeLoaderOptions } from './compose-loader.js';
    ```
  - [x] 4.4 NO YAML parsing in the loader. The loader treats compose YAML as an opaque string — passing the file through unchanged is safe AND aligns with the "let docker compose validate it" pattern (Task 8.2). Adding `yaml.parse()` would make the loader carry the YAML schema contract and bloat the bundle; NOT worth it.
  - [x] 4.5 Defensive `chmodSync` after `writeFileSync` is required because `writeFileSync`'s `mode` option is masked by the process umask on some Linux filesystems (notably WSL2 — see CLAUDE.md notes). The `chmodSync` is the load-bearing call; the `mode` option is belt-and-suspenders.

- [x] **Task 5: Update `packages/townhouse/tsup.config.ts` with the build hook** (AC: #5, #11)
  - [x] 5.1 Modify `packages/townhouse/tsup.config.ts` to add an `onSuccess` hook (or equivalent post-build script):
    ```typescript
    import { defineConfig } from 'tsup';
    import { cp, mkdir, readFile, writeFile, access } from 'node:fs/promises';
    import { join } from 'node:path';

    export default defineConfig({
      entry: ['src/index.ts', 'src/cli.ts'],
      format: ['esm'],
      dts: true,
      sourcemap: true,
      clean: true,
      outDir: 'dist',
      outExtension: () => ({ js: '.js' }),
      banner: {
        js: `import { createRequire } from 'module'; const require = createRequire(import.meta.url);`,
      },
      onSuccess: async () => {
        const composeDistDir = 'dist/compose';
        await mkdir(composeDistDir, { recursive: true });

        // Copy dev template verbatim
        await cp('compose/townhouse-dev.yml', join(composeDistDir, 'townhouse-dev.yml'));

        // Render HS template — substitute digest placeholders from image-manifest.json
        const manifestPath = 'dist/image-manifest.json';
        const hsTemplateRaw = await readFile('compose/townhouse-hs.yml', 'utf-8');
        let hsRendered = hsTemplateRaw;
        try {
          await access(manifestPath);
          const manifestRaw = await readFile(manifestPath, 'utf-8');
          const manifest = JSON.parse(manifestRaw) as {
            images: Record<string, { name: string; tag: string; digest: string }>;
          };
          // Map placeholder → '@<digest>' substitution
          const subs: Array<[string, string]> = [
            ['${TOON_TOWNHOUSE_API_DIGEST}', `@${manifest.images['townhouse-api'].digest}`],
            ['${TOON_TOWN_DIGEST}',          `@${manifest.images.town.digest}`],
            ['${TOON_MILL_DIGEST}',          `@${manifest.images.mill.digest}`],
            ['${TOON_DVM_DIGEST}',           `@${manifest.images.dvm.digest}`],
            ['${TOON_CONNECTOR_DIGEST}',     `@${manifest.images.connector.digest}`],
          ];
          for (const [placeholder, replacement] of subs) {
            hsRendered = hsRendered.replaceAll(placeholder, replacement);
          }
        } catch (err) {
          // Manifest absent → ship the unsubstituted template + warn loudly.
          // Local dev path: developer has not run scripts/build-image-manifest.mjs.
          // CI path: build runs BEFORE download-artifact step → tarball-contents.test
          // catches the unsubstituted YAML and fails the workflow.
          console.warn(
            `[tsup] dist/image-manifest.json not found — shipping unsubstituted ` +
            `townhouse-hs.yml. This is fine for local dev but invalid for npm publish.`
          );
        }
        await writeFile(join(composeDistDir, 'townhouse-hs.yml'), hsRendered, 'utf-8');
      },
    });
    ```
  - [x] 5.2 Use Node's built-in `fs/promises` rather than adding `fs-extra` or other deps — keeps the build surface minimal.
  - [x] 5.3 If the dev prefers a separate post-build script (e.g., `scripts/render-compose-template.mjs`) over an inline `onSuccess`, that is acceptable. The script approach is easier to unit-test (the inline hook can only be exercised end-to-end via `pnpm build`). Document the choice in Dev Notes.
  - [x] 5.4 Run `pnpm --filter @toon-protocol/townhouse build` locally with NO `dist/image-manifest.json` present. Confirm the build succeeds with the warning AND that `dist/compose/townhouse-{hs,dev}.yml` are produced. Then run `cp /tmp/45-1-artifact/image-manifest.json packages/townhouse/dist/image-manifest.json` (using the artifact pulled in Task 1.2), re-run `pnpm build`, and confirm `dist/compose/townhouse-hs.yml` now contains five `@sha256:` substitutions and zero `${TOON_*_DIGEST}` placeholders.
  - [x] 5.5 The `clean: true` flag in tsup config DELETES `dist/` at build start. The CI workflow MUST place `image-manifest.json` AFTER `pnpm build` runs, NOT before. Verify the existing workflow order at `.github/workflows/publish-townhouse-images.yml` — the `npm-publish` job's step order should be: `pnpm install` → `pnpm --filter ... build` → `actions/download-artifact ... → dist/image-manifest.json` → re-run the build hook OR re-render the compose template. **Critical:** if the publish workflow runs `pnpm build` AFTER download-artifact, the build's `clean: true` flag will WIPE the manifest. Two safe orderings:
    - **Option A (preferred):** download-artifact AFTER build; THEN re-run the render step explicitly (e.g., `node scripts/render-compose-template.mjs` separately) — this requires extracting the render logic from `onSuccess` into a stand-alone script callable from CI.
    - **Option B:** disable `clean: true` and accept dirty dist trees (rejected — too easy to miss stale files).
    - **Option C:** `pnpm build` AFTER download-artifact AND set `clean: false` for the publish-time build, OR move `image-manifest.json` to a non-`dist/` location during build then move back after.

    Task 7 below documents the recommended fix in the workflow file.

- [x] **Task 6: Update `packages/townhouse/src/constants.ts` `DEFAULT_CONNECTOR_IMAGE` to digest form** (AC: #9)
  - [x] 6.1 Read the connector entry from `/tmp/45-1-artifact/image-manifest.json` (Task 1.2): `images.connector.digest`. The value is `sha256:<hex>` (not a tag reference).
  - [x] 6.2 Update `packages/townhouse/src/constants.ts:21`:
    ```typescript
    /**
     * Default connector Docker image — digest-pinned per CONNECTOR_RELEASE_CONTRACT.md.
     *
     * To bump: capture a new digest by running the Story 45.1 publish workflow
     * against the desired connector tag, copy the resulting image-manifest.json
     * connector entry's digest, and update this constant + the contract canary
     * fixture. See packages/sdk/CONNECTOR_RELEASE_CONTRACT.md for the full bump
     * checklist + breaking-changes history.
     */
    export const DEFAULT_CONNECTOR_IMAGE = 'ghcr.io/toon-protocol/connector@sha256:<digest-from-manifest>';
    ```
    Replace `<digest-from-manifest>` with the actual hex string from the artifact.
  - [x] 6.3 Run `pnpm --filter @toon-protocol/townhouse test:canary` to confirm `connector-image-contract.test.ts` still passes against the digest-form constant. If the test parses the constant via tag-form regex (e.g., `/connector:(\d+\.\d+\.\d+)/`), update the test to also accept digest form (`/connector(:[\w.-]+|@sha256:[a-f0-9]+)/`) — see Task 8.4.
  - [x] 6.4 Confirm `DEFAULT_CONNECTOR_IMAGE` is consumed by `packages/townhouse/src/docker/orchestrator.ts` for digest pulls. Search for the constant: `grep -rn DEFAULT_CONNECTOR_IMAGE packages/townhouse/src/`. Every usage site must accept digest form (most should — `docker pull <ref>` works for both forms — but anywhere that `.split(':')` is applied to extract a version will break).
  - [x] 6.5 The connector tag is no longer captured by the constant — only the digest is. If any code wants the human-readable tag (e.g., for log output: "running connector v3.5.0"), it should read from `image-manifest.json` directly: `manifest.images.connector.tag`. Document this transition in the constant's docstring.

- [x] **Task 7: Update `.github/workflows/publish-townhouse-images.yml` for live publish** (AC: #5, #10, #11)
  - [x] 7.1 Locate the `npm-publish` job in the workflow. Walk through its current step order:
    - `actions/checkout` → `pnpm/action-setup` → `actions/setup-node` → `pnpm install --frozen-lockfile` → `pnpm --filter ... build` → `actions/download-artifact (image-manifest.json → dist/)` → `pnpm publish --dry-run`
  - [x] 7.2 Per Task 5.5 Option A: add a step BETWEEN `actions/download-artifact` and `pnpm publish` that re-runs the compose render now that `dist/image-manifest.json` is present. Either invoke the inline `onSuccess` hook again (rerun `pnpm build` is fine — but `clean: true` would wipe the manifest, so toggle the flag or use a separate render script) OR (preferred) extract the render logic to `scripts/render-compose-template.mjs` and invoke it directly:
    ```yaml
    - name: Render HS compose template against pinned digests
      run: node scripts/render-compose-template.mjs
      working-directory: ${{ github.workspace }}
    ```
  - [x] 7.3 Add a tarball-content verification step BEFORE `pnpm publish` (per AC #11):
    ```yaml
    - name: Verify tarball contents
      run: |
        pnpm --filter @toon-protocol/townhouse pack --pack-destination /tmp/pack-out/
        TGZ=$(ls /tmp/pack-out/toon-protocol-townhouse-*.tgz | head -1)
        tar -tzf "$TGZ" > /tmp/pack-listing.txt
        for path in package/dist/compose/townhouse-hs.yml package/dist/compose/townhouse-dev.yml package/dist/image-manifest.json; do
          grep -qF "$path" /tmp/pack-listing.txt || { echo "MISSING: $path"; exit 1; }
        done
        # No unsubstituted placeholders in the rendered HS template
        tar -xzf "$TGZ" -C /tmp/extracted/
        if grep -E '\$\{TOON_[A-Z_]+_DIGEST\}' /tmp/extracted/package/dist/compose/townhouse-hs.yml; then
          echo "FAIL: unsubstituted placeholders in tarball"; exit 1
        fi
    ```
  - [x] 7.4 Remove the `--dry-run` flag from the `pnpm publish` step. Keep `--access public --no-git-checks --tag latest`. Confirm `NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}` env is set on the step.
  - [x] 7.5 Update the top-of-file workflow comment block to record the staged-delivery transition: "v0.1.0 (Story 45.1): images + signatures + manifest published; npm publish in dry-run pending Story 45.2. v0.1.0+ (Story 45.2): live npm publish flipped on; tarball ships compose templates + manifest."
  - [x] 7.6 Smoke-test via `workflow_dispatch` (NOT a tag push — workflow_dispatch path is dry-run-only per AC #10). Confirm the manifest renders cleanly into the compose template, the tarball-content verification passes, and the npm-publish step in dispatch mode would not actually publish (the `if:` guard on the npm-publish job gates on `tag`-form refs).

- [x] **Task 8: Author tests** (AC: #8)
  - [x] 8.1 Author `packages/townhouse/src/compose-loader.test.ts` (vitest, `pnpm --filter @toon-protocol/townhouse test`). Test cases (every test must pass):
    - `loadComposeTemplate('dev', { distDir: <fixture> })` returns the dev template verbatim.
    - `loadComposeTemplate('hs', { distDir: <fixture> })` returns the HS template with five `@sha256:` substitutions when fixture contains a substituted file.
    - `loadComposeTemplate('hs', { distDir: <fixture-without-template> })` throws `ComposeLoaderError` with a message containing the missing path.
    - `materializeComposeTemplate('hs', { distDir: <fixture>, townhouseHome: <tmpdir> })` writes both `compose/townhouse-hs.yml` AND `image-manifest.json` to the tmpdir at mode `0o600`.
    - The created `<tmpdir>/compose/` directory has mode `0o700`.
    - `materializeComposeTemplate` is idempotent — calling twice produces identical output, mode `0o600`, no errors.
    - `materializeComposeTemplate('hs')` throws when `dist/image-manifest.json` is absent (the manifest is required for HS mode per AC #6 docstring).
    - `materializeComposeTemplate('dev')` does NOT throw when manifest is absent (dev mode tolerates absence).
    - File mode after `materializeComposeTemplate('hs')` is `0o600` even if `process.umask()` is `0o022` at test start.
  - [x] 8.2 Author `packages/townhouse/src/__integration__/compose-template-validity.test.ts` (vitest integration config, `pnpm --filter @toon-protocol/townhouse test:integration`). Test cases:
    - When `DOCKER_AVAILABLE === '1'` (env-gated; default `'1'` if `which docker` resolves), invoke `docker compose -f <rendered-hs-path> config` as a subprocess via `execFileSync('docker', ['compose', '-f', renderedPath, 'config'])`. Assert exit code 0 and stdout contains every service name (`connector`, `townhouse-api`, `town`, `mill`, `dvm`).
    - The rendered HS template's parsed YAML has every `services.<name>.image` value matching `/^ghcr\.io\/toon-protocol\/[a-z-]+@sha256:[a-f0-9]{64}$/`.
    - No `services.<name>.build` directives appear (`grep -c 'build:'` against the rendered file returns 0 for the services section).
    - Every `services.<name>.ports[]` entry that includes a host-side port is prefixed with `127.0.0.1:` (NFR9).
    - Skipped (with a warning) when `DOCKER_AVAILABLE !== '1'` (Docker not installed in the test env). Document the env var in the test header.
  - [x] 8.3 Author `packages/townhouse/src/__integration__/tarball-contents.test.ts`. Test cases:
    - Run `pnpm pack --pack-destination <tmpdir>` (subprocess; `process.cwd()` set to the package dir).
    - Untar the resulting `.tgz` (e.g., via `tar -xzf <tgz> -C <tmpdir-extract>`).
    - Assert `<tmpdir-extract>/package/dist/compose/townhouse-hs.yml` exists.
    - Assert `<tmpdir-extract>/package/dist/compose/townhouse-dev.yml` exists.
    - Assert `<tmpdir-extract>/package/dist/image-manifest.json` exists (skip this assertion when `dist/image-manifest.json` was absent at test start — local dev path).
    - Read the tarball'd HS YAML and assert NO unsubstituted placeholders (`/\$\{TOON_[A-Z_]+_DIGEST\}/` matches 0 times).
    - Read the tarball'd HS YAML and assert every `image:` line uses digest form (`@sha256:`).
    - Skipped when env `SKIP_PACK_TEST === '1'` to allow developers running the full test suite without `dist/` rebuilt.
  - [x] 8.4 Update (do NOT replace) `packages/townhouse/src/__integration__/connector-image-contract.test.ts` to accept digest-form `DEFAULT_CONNECTOR_IMAGE`. If the test currently does:
    ```typescript
    const [, version] = DEFAULT_CONNECTOR_IMAGE.split(':');
    ```
    that will break under digest form (`split(':')` returns the digest hex, not the version). Replace with:
    ```typescript
    function parseConnectorImage(ref: string): { name: string; tag?: string; digest?: string } {
      const digestMatch = ref.match(/^(.+)@(sha256:[a-f0-9]+)$/);
      if (digestMatch) return { name: digestMatch[1], digest: digestMatch[2] };
      const tagMatch = ref.match(/^(.+):([^:]+)$/);
      if (tagMatch) return { name: tagMatch[1], tag: tagMatch[2] };
      throw new Error(`unparseable image ref: ${ref}`);
    }
    ```
    And update assertions to read from the parsed object. Run `pnpm --filter @toon-protocol/townhouse test:canary` to confirm green.
  - [x] 8.5 Add fixture data under `packages/townhouse/src/__tests__/fixtures/compose-loader/` containing a synthetic `image-manifest.json` (5 entries with valid `sha256:`-prefixed digests) and pre-rendered HS + dev YAML files. Tests in 8.1 reference these fixtures via `distDir` option.

- [x] **Task 9: Documentation updates** (AC: #1, #6, #9)
  - [x] 9.1 Update `packages/townhouse/README.md`:
    - Add a "Compose Templates" section describing the two profiles (dev, hs), where they live in the package, and the `loadComposeTemplate` / `materializeComposeTemplate` API.
    - Document the `image-manifest.json` shape (link to `scripts/build-image-manifest.mjs:50-66` for the schema).
    - Update the existing dev-stack section to point at `packages/townhouse/compose/townhouse-dev.yml` as the canonical source (with a backward-compat note that `docker-compose-townhouse-dev.yml` at the root is preserved for the existing CI).
  - [x] 9.2 Update `CLAUDE.md` "Where to Find Things" table — add rows:
    - `Townhouse npm-tarball compose templates` → `packages/townhouse/compose/`
    - `Compose loader + materializer API` → `packages/townhouse/src/compose-loader.ts`
    - `Image-manifest digest registry (per release)` → `packages/townhouse/dist/image-manifest.json` (CI-produced; not committed)
  - [x] 9.3 Update `packages/sdk/CONNECTOR_RELEASE_CONTRACT.md` (and the connector-side mirror at `connector/CONNECTOR_RELEASE_CONTRACT.md` — the content is identical between the two repos per Story 44.4) to reference Story 45.2 as the consumer that flipped `DEFAULT_CONNECTOR_IMAGE` from tag form to digest form. Add a one-liner to the "Townhouse pins by digest in image-manifest.json" rule: "Implementation: Story 45.2 (`packages/townhouse/src/constants.ts:21`)."

- [x] **Task 10: Smoke test the full path locally** (AC: all)
  - [x] 10.1 From the repo root, run the full sequence:
    ```bash
    # 1. Pull the 45.1 manifest artifact (Task 1.2)
    gh run download 25603167091 --repo toon-protocol/town --name image-manifest -D /tmp/45-1-artifact/

    # 2. Build the package
    pnpm --filter @toon-protocol/townhouse build

    # 3. Drop the manifest into dist/ (mimics the CI download-artifact step)
    cp /tmp/45-1-artifact/image-manifest.json packages/townhouse/dist/image-manifest.json

    # 4. Re-render the compose template (Task 7.2 step)
    node scripts/render-compose-template.mjs

    # 5. Pack + inspect
    pnpm --filter @toon-protocol/townhouse pack --pack-destination /tmp/pack-out/
    TGZ=$(ls /tmp/pack-out/toon-protocol-townhouse-*.tgz | head -1)
    tar -tzf "$TGZ" | grep -E 'package/dist/(compose/|image-manifest\.json)'
    # Expected: 3 lines — package/dist/compose/townhouse-hs.yml, .../townhouse-dev.yml, .../image-manifest.json

    # 6. Verify rendered HS template has no placeholders
    tar -xzf "$TGZ" -C /tmp/extracted/
    grep -c 'sha256:' /tmp/extracted/package/dist/compose/townhouse-hs.yml
    # Expected: 5 (one per service)
    grep -c '\${TOON_' /tmp/extracted/package/dist/compose/townhouse-hs.yml
    # Expected: 0

    # 7. Verify it parses as docker compose (requires Docker)
    docker compose -f /tmp/extracted/package/dist/compose/townhouse-hs.yml config >/dev/null
    # Expected: exit 0
    ```
  - [x] 10.2 Run the materialize path against a tmpdir:
    ```bash
    cat <<'EOF' | node --input-type=module
    import { materializeComposeTemplate } from './packages/townhouse/dist/index.js';
    import { mkdtempSync, statSync, readFileSync } from 'node:fs';
    import { tmpdir } from 'node:os';
    import { join } from 'node:path';
    const home = mkdtempSync(join(tmpdir(), 'townhouse-'));
    const { composePath, manifestPath } = materializeComposeTemplate('hs', { townhouseHome: home });
    console.log({
      composePath,
      composeMode: (statSync(composePath).mode & 0o777).toString(8),
      manifestPath,
      manifestMode: (statSync(manifestPath).mode & 0o777).toString(8),
    });
    EOF
    ```
    Expected output: both modes are `'600'` (octal).
  - [x] 10.3 Run all test suites:
    ```bash
    pnpm --filter @toon-protocol/townhouse test
    pnpm --filter @toon-protocol/townhouse test:integration
    pnpm --filter @toon-protocol/townhouse test:canary
    ```
    All green.

- [x] **Task 11: Open PR + close out** (AC: #12)
  - [x] 11.1 Branch from `chore/45-1-close-out` (or current main) as `feat/45-2-embed-compose-templates`. Open PR against `main` via `gh pr create` with summary linking to the Story 45.2 file and listing the touched paths.
  - [x] 11.2 PR body includes: tarball-content verification output, the rendered HS template (full file inline as a code block), the `docker compose config` output, the `connector-image-contract.test.ts` green output, and a confirmation that `--dry-run` was removed from the publish workflow.
  - [x] 11.3 After PR merges and a `v0.1.0-rc2` (or whatever the next test tag is — coordinate with the user) tag-push runs the workflow successfully AND `npm view @toon-protocol/townhouse@<version> dist.tarball` resolves AND `npm pack @toon-protocol/townhouse@<version> --dry-run` shows the compose templates + manifest in the file list:
    - Update `_bmad-output/implementation-artifacts/sprint-status.yaml`: `45-2-embed-compose-templates-and-image-manifest-in-npm-tarball: backlog → done`
    - Bump `last_updated` to merge date.
    - Add the `# done: ...` comment with the workflow run URL and PR number(s), mirroring the 44.4 / 45.1 close-out style.
  - [x] 11.4 Story Status → review → done.

## Dev Notes

### Cross-Repo Boundary

This story is **town-only**. No connector-side code changes. The only connector touchpoint is consumption — the loader resolves digests from `image-manifest.json` which contains the connector's pinned digest captured by Story 45.1's CI. If the dev finds themselves opening a PR in `toon-protocol/connector`, stop — they are outside the story.

Files this story touches in `toon-protocol/town`:

- `packages/townhouse/compose/townhouse-hs.yml` (NEW — Task 2)
- `packages/townhouse/compose/townhouse-dev.yml` (NEW — Task 3, copied from root)
- `packages/townhouse/src/compose-loader.ts` (NEW — Task 4)
- `packages/townhouse/src/index.ts` (MODIFY — add public exports for compose-loader)
- `packages/townhouse/src/constants.ts` (MODIFY — `DEFAULT_CONNECTOR_IMAGE` tag → digest)
- `packages/townhouse/tsup.config.ts` (MODIFY — add `onSuccess` hook OR equivalent)
- `scripts/render-compose-template.mjs` (NEW — extracted from `onSuccess`, callable by CI; optional if dev keeps inline `onSuccess`)
- `packages/townhouse/src/compose-loader.test.ts` (NEW — Task 8.1)
- `packages/townhouse/src/__integration__/compose-template-validity.test.ts` (NEW — Task 8.2)
- `packages/townhouse/src/__integration__/tarball-contents.test.ts` (NEW — Task 8.3)
- `packages/townhouse/src/__integration__/connector-image-contract.test.ts` (MODIFY — accept digest form)
- `packages/townhouse/src/__tests__/fixtures/compose-loader/` (NEW — fixture dir for unit tests)
- `packages/townhouse/README.md` (MODIFY — Task 9.1)
- `CLAUDE.md` (MODIFY — Task 9.2 "Where to Find Things" rows)
- `packages/sdk/CONNECTOR_RELEASE_CONTRACT.md` (MODIFY — Task 9.3 implementation reference)
- `.github/workflows/publish-townhouse-images.yml` (MODIFY — Task 7, remove `--dry-run`, add render + verify steps)
- `docker-compose-townhouse.yml` (root) (MODIFY — connector image flipped to digest form so `package-structure.test.ts:109` (`connector.image === DEFAULT_CONNECTOR_IMAGE`) stays green; ratified retroactively in code-review 2026-05-09 D2 → Option 1, with a new manifest-alignment test in `connector-image-contract.test.ts` closing the third drift gap)
- `packages/townhouse/src/docker/orchestrator.ts` (MODIFY — `pullImages` cache check matches `RepoDigests` in addition to `RepoTags` so digest-form `DEFAULT_CONNECTOR_IMAGE` is recognized as cached; ratified retroactively in code-review 2026-05-09 D2 patches)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (MODIFY — Task 11.3)
- This story file (Task 11.4)

Files this story does **NOT** touch (scope guards):

- `docker-compose-townhouse-hs.yml` (root) — legacy operator-facing compose, used by the existing operator workflow that pre-dates `townhouse hs up`. Stays for backward compatibility. Story 45.4 may retire it once `townhouse hs up` is the canonical entry point.
- `docker-compose-townhouse-dev.yml` (root) — used by `scripts/townhouse-dev-infra.sh`. Stays for the existing contributor dev loop. The package-local copy at `packages/townhouse/compose/townhouse-dev.yml` is a parallel source of truth; a follow-up story can route `townhouse-dev-infra.sh` to read from the package-local copy.
- `scripts/build-image-manifest.mjs` — Story 45.1 deliverable. Schema is frozen at v1; do not modify.
- `scripts/build-image-manifest.test.ts` — Story 45.1 test; do not modify.
- `docker/Dockerfile.townhouse-api` — Story 45.1 deliverable; the new HS template references the resulting image but does not modify the Dockerfile.
- `docker/Dockerfile.town`, `docker/Dockerfile.mill`, `docker/Dockerfile.dvm` — pre-existing; the workflow consumes them as-is.
- `packages/townhouse/src/docker/orchestrator.ts` — the `profile: 'dev' | 'hs'` parameter refactor is Story 45.3 territory. This story's `loadComposeTemplate` API is what 45.3 will call from inside the orchestrator. **EXCEPTION (ratified 2026-05-09 code-review D2):** `pullImages` cache check was extended from `RepoTags`-only to `RepoTags ∪ RepoDigests` so the digest-form `DEFAULT_CONNECTOR_IMAGE` is recognized as cached. That single-line change is the only orchestrator modification in scope.
- `packages/townhouse/src/cli.ts` — the `townhouse hs up` subcommand is Story 45.4 territory; this story's loader is what the subcommand will call.
- `packages/townhouse/src/api/` — host API changes are Story 45.4 territory.
- `packages/townhouse/src/wallet/` — HD wallet code is Story 21.4 / 45.4 territory.
- `_bmad-output/planning-artifacts/epics-townhouse-hs-v1.md` — planning doc; do NOT modify story ACs while implementing them.

### Why Substitute at Build Time, Not Runtime

The build hook (Task 5) substitutes digest placeholders into the HS template ONCE per package build. Two alternatives were considered:

- **A — Build-time substitution (chosen).** `tsup onSuccess` runs the substitution; what ships in the tarball is fully resolved YAML.
- **B — Runtime substitution.** Loader reads the unsubstituted template + `image-manifest.json` at runtime and substitutes on every `loadComposeTemplate('hs')` call.

A wins on three axes:

1. **Single point of truth.** The shipped YAML is the authoritative artifact; verifying "what does v0.1.0 install" requires only `npm view @toon-protocol/townhouse@0.1.0 dist.tarball` + `tar -xzf`. No mental "you have to mentally apply substitution" overhead.
2. **Failure mode is local to CI.** A missing manifest at build time is a CI bug; a missing manifest at runtime would be a user-facing bug. Better to fail in CI.
3. **No bundle-size hit.** No JSON parsing in the loader (B would require parsing manifest on every call OR caching it — both are extra code).

The cost: the tarball-content verification step (Task 7.3) is more critical because if substitution fails silently, the bug isn't caught until an operator runs `docker compose -f` and gets "image ${TOON_TOWN_DIGEST} not found." The verification step's `grep -E '\$\{TOON_[A-Z_]+_DIGEST\}'` against the tarball'd YAML eliminates that risk.

### Why `materialize` Writes Both Files at `0o600`

Per NFR8 (planning doc §"Security & Privacy"), every operator-secret file gets mode `0o600`:

> NFR8: All operator-secret files SHALL be written with mode `0o600`: `nodes.yaml`, `earnings-snapshots.jsonl`, `wallet.enc`, `telemetry.json`, `host.json`

The compose YAML and image-manifest.json aren't on the explicit NFR8 list, but both contain operator-relevant supply-chain identity:

- The compose YAML embeds environment variables that Story 45.4+ will populate with private keys (settlement keys, wallet pubkeys, etc.). A leaked compose file at `0o644` would reveal those keys to any local-user process.
- The image-manifest.json pins the supply chain. Tampering with this file is exactly what an attacker would do to swap one of the four townhouse images for a malicious replica that the `docker pull` step would then fetch. Defending against tampering requires preventing other-user-readable+writable access.

The implementation MUST `chmodSync(path, 0o600)` after `writeFileSync` because the `mode` option to `writeFileSync` is masked by `process.umask()` — on default systems with `umask 0o022`, passing `mode: 0o600` results in `0o600 & ~0o022 = 0o600` (no effect on this particular value, but the umask interaction is filesystem-implementation-dependent and burns developers regularly). The `chmodSync` is the load-bearing call.

The parent dir `~/.townhouse/` and `~/.townhouse/compose/` get `0o700` (owner-only directory traversal). `mkdir({ mode: 0o700 })` honors the mode arg only on creation; existing dirs need `chmodSync` to enforce.

### Why `townhouse-api` Service Lives in the HS Template (Even Though 45.4 Owns Its Boot)

AC #3 adds the `townhouse-api` service to the HS template, but Story 45.4 (`townhouse hs up`) is what actually starts it during operator-facing apex boot. Why does it live in the compose YAML rather than being launched as a separate `docker run` from the CLI?

Two reasons:

1. **Composability.** Story 45.3's `DockerOrchestrator.start({ profile: 'hs' })` invokes `docker compose --profile <type> up` against the rendered template. Having `townhouse-api` in the same compose file means lifecycle management (start/stop/health/restart) is unified across all townhouse services. Splitting `townhouse-api` out into a separate `docker run` invocation creates a parallel lifecycle model the orchestrator would have to track.
2. **Network isolation.** All townhouse services share a Docker network (e.g., `townhouse-hs-net`). The connector resolves child node hostnames via Docker DNS. The `townhouse-api` ALSO needs to reach the connector via that same network (to call `/admin/hs-hostname`, `/admin/peers`, `/admin/earnings.json`). A separate `docker run` would need to manually attach to the network — error-prone.

The `townhouse-api` service entry in `townhouse-hs.yml` MUST mount `/var/run/docker.sock` RW (per planning doc §4 anchor "host-side townhouse-api owns dockerode and runs as the host user" — translated for HS-mode: townhouse-api is now containerized but still owns the socket). The connector container in the same template MUST NOT mount the socket (NFR7). This separation is load-bearing: the connector remains a generic ILP router with no Docker awareness; only the townhouse-api orchestrates siblings.

### Why Two Compose Files (HS + Dev)

The plan splits operator-facing (HS) and contributor-facing (dev) concerns:

- **HS profile** is what operators run via `townhouse hs up`. Pinned to digest-form GHCR images. Deterministic across operator machines. No local builds, no source repo clone. NFR1 (5-min first-boot) depends on `docker pull` being idempotent and image content being identical to what TOON published.
- **Dev profile** is what contributors run via `pnpm --filter @toon-protocol/townhouse-web dev:docker` (per CLAUDE.md). Uses local `toon:*` image tags built by `pnpm build` + `docker compose build`. Not deterministic across machines (each contributor builds fresh). Useful for "hack on the dashboard, see changes immediately."

Shipping BOTH templates in the npm tarball seems redundant (operators don't need the dev template), but the cost is low (~3 KB extra) and the consistency is helpful: the `loadComposeTemplate('dev')` call works in both contributor environments AND in the published-package environment, which simplifies test infrastructure (e.g., `townhouse-test-infra.sh` can use `loadComposeTemplate` from the published-package path).

If a future story decides shipping the dev template is genuinely wasteful, it can be moved to `packages/townhouse/dev-compose/` (excluded from `files`). For Story 45.2, ship both — matches AC #1 verbatim.

### Architecture Compliance

- **NFR8 (operator-secret file mode `0o600`):** Applies to written outputs at `~/.townhouse/compose/townhouse-hs.yml` AND `~/.townhouse/image-manifest.json`. Enforced via Task 4.1's `chmodSync` calls.
- **NFR9 (host ports bind to 127.0.0.1 only):** Every `services.<name>.ports[]` entry in the HS template uses the `127.0.0.1:` prefix. Enforced via Task 8.2's regex grep.
- **NFR15 (Node.js >=20, TypeScript ^5.3, ESM-only):** compose-loader.ts is pure ESM (`fileURLToPath(import.meta.url)` for path resolution; no `require()`, no CJS). The build hook uses `node:fs/promises` (Node 14+ stable; safe at Node 20).
- **NFR17 (pre-publish quality gate):** This story produces gate check #3 (image-contract test green at pinned digest — flips from tag-form to digest-form check) AND removes the dry-run gate (gate check #6 — cosign verify — already enforced by Story 45.1).
- **D44-013 (cross-repo release contract):** `CONNECTOR_RELEASE_CONTRACT.md` clause "Townhouse pins by digest in `image-manifest.json`, bumps deliberately on each minor" is now backed by code: the constant in `constants.ts:21` is digest form, and bumping requires running the Story 45.1 workflow + updating the constant. The contract becomes verifiable rather than aspirational.
- **OWASP A03 (injection):** `materializeComposeTemplate` writes user-home-relative paths via `path.join(homedir(), '.townhouse', ...)` — no shell-out, no string concatenation. Safe.
- **OWASP A08 (CI integrity):** The publish workflow's tarball-content verification (Task 7.3) prevents supply-chain tampering between `pnpm build` and `pnpm publish`.

### Critical Implementation Patterns

- **Don't parse the YAML in the loader.** The loader treats compose YAML as an opaque string. Parsing would couple the loader to the compose schema; the moment Docker Compose adds a new top-level key, the loader breaks. Let `docker compose config` validate the rendered output (Task 8.2 integration test) and treat the loader as a dumb file copier.
- **Substitution is `replaceAll`, not regex.** Use `string.replaceAll('${TOON_TOWN_DIGEST}', '@sha256:...')`, NOT `string.replace(/\$\{TOON_TOWN_DIGEST\}/g, ...)`. The literal-string form is faster, safer (no regex injection), and reads more clearly. ESLint may warn about `replaceAll` if `target: es2020` — bump to `es2021` or `es2022` if needed (the rest of the workspace already uses `es2022` per `tsconfig.json`).
- **Verify chmod after write.** The `mode` option to `writeFileSync` is filesystem-dependent and umask-masked. Always follow with explicit `chmodSync(path, 0o600)`. Test on WSL2 (Jonathan's primary dev machine — see system context) where umask interactions have bitten before.
- **`tsup clean: true` deletes `dist/image-manifest.json`.** The CI workflow MUST place the manifest AFTER `pnpm build` runs. If you keep `clean: true`, the build sequence is: `pnpm install` → `pnpm build` (clean + emit `dist/index.js` etc.) → `download-artifact` (drops manifest into `dist/`) → `node scripts/render-compose-template.mjs` (re-renders compose with manifest now present). If you change to `clean: false`, you accept dirty dist trees that may include stale files from previous builds.
- **The 45.1 workflow's `--dry-run` flip is NOT a separate PR.** AC #10 says this story removes the flag. Doing so is part of the Story 45.2 PR — not a follow-up. The smoke-test path (Task 11.3) requires a `v0.1.0-rc2` (or similar) tag-push to validate the live publish; coordinate with the user on tag naming.
- **Failure mode "image-manifest.json absent in CI" must be loud, not silent.** Task 7.3's tarball-content verification step explicitly greps for `image-manifest.json` AND for unsubstituted placeholders. If either check fails, the workflow fails BEFORE `pnpm publish` runs — preventing a broken tarball from reaching the registry.
- **`cp -R` vs `fs.cp` recursive copy:** Node's `fs.cp({ recursive: true })` was added in v16.7 and is stable at Node 20. Use it via the Promises API:
  ```typescript
  await cp('compose', 'dist/compose', { recursive: true });
  ```
  Don't shell out to `cp -r` from the build script — keeps the build cross-platform (Windows contributors don't have `cp`).
- **Idempotent materialize is load-bearing.** Story 45.4 AC says re-running `townhouse hs up` against an already-running apex MUST not re-pull or re-create. The materialize call happens on every `up` invocation (it's how the CLI ensures the file exists). Idempotency means: writing the same content twice is fine; mode is `0o600` after both calls; no spurious "permission changed" log lines.
- **Don't ship the unsubstituted template.** AC #2 says "every service entry uses `image: ghcr.io/toon-protocol/<svc>@sha256:<digest>` form." If `dist/compose/townhouse-hs.yml` in the tarball contains `${TOON_TOWN_DIGEST}` placeholders, that's a publish bug — Task 7.3's verification step is what catches it. Treat that step's failure as blocking, not a warning.

### Sequencing Within Epic 45

```
   45.1 (DONE) ──→ 45.2 (this) ──→ 45.4 ──→ 46.x
       │              │              │
       └─── 45.3 ─────┴──────────────┘
        (parallel)        (consumer)
```

- **45.1 produces:** `image-manifest.json` (CI artifact; not committed) + four signed multi-arch GHCR images + Dockerfile.townhouse-api
- **45.2 (this) consumes:** `image-manifest.json` → embeds resolved compose template in npm tarball → flips `DEFAULT_CONNECTOR_IMAGE` to digest form → exports `loadComposeTemplate` / `materializeComposeTemplate` API
- **45.3 (parallel):** `DockerOrchestrator` profile param refactor — calls `loadComposeTemplate(profile)` from this story's module
- **45.4 consumes:** the materialized compose at `~/.townhouse/compose/townhouse-hs.yml` + the published images via the digest pins + the cosign-verifiable digest
- **Critical path:** 44.1 (DONE) → 45.1 (DONE) → 45.2 (this) → 45.4 → 46.1 (next critical)

### Why This Story Is Sized M

Per planning doc §3 row 2: "TH-21.17.2 — feat(townhouse): embed compose templates + image-manifest — Deps: 1 — Size: M — Critical Path: ★". Sources of mid-tier (not L) sizing:

1. **No new infrastructure.** The build pipeline (tsup), test runner (vitest), CI workflow (Story 45.1 already authored) all exist. This story extends them with content, not structure.
2. **Loader API surface is small.** Two functions + one error class + one type alias = ~50 LOC of TypeScript. Most of the implementation cost is testing (8.1-8.5) — but the test surface is well-defined.
3. **Compose template authoring is mechanical.** The shape is dictated by the existing root-level `docker-compose-townhouse-hs.yml` + Story 45.4 AC #1 (which services start). The dev's job is to copy structure, swap to digest form, add `townhouse-api`, drop the dev-time services.
4. **`--dry-run` flip is a one-line change.** The infra was authored in Story 45.1. Removing the flag is a workflow file edit.

The mid-tier risk is the build-pipeline ordering (Task 5.5 — `clean: true` + `download-artifact` interaction). If the dev fights with that ordering for >1 day, escalate to Murat for a second opinion on the ordering Option A/B/C.

### Latest tech (verified 2026-05-09)

- **`tsup` 8.x `onSuccess`:** Tsup's `onSuccess` accepts both string commands AND async functions. Async function form is the right choice — it's typed, debuggable in IDE, and runs in-process. String form spawns a subprocess.
- **Node.js `fs/promises` `cp({ recursive: true })`:** Stable at Node 18+. Cross-platform. Honors `mode` option per file. Faster than spawning `cp -r` (no shell startup).
- **Node.js `parseArgs` from `node:util`:** Used by `scripts/build-image-manifest.mjs` (Story 45.1) and the optional `scripts/render-compose-template.mjs` here. Stable at Node 20. No need to add `commander` or `yargs`.
- **`docker compose config` (subcommand) vs `docker-compose config` (legacy v1 binary):** v2 is the only supported form — don't write the v1 hyphenated form. v2 ships with Docker Desktop ≥4.0 and most Linux Docker installs ≥20.10.
- **`pnpm pack --pack-destination`:** Stable at pnpm 8.x. Outputs the `.tgz` to the directory without polluting `cwd`. The `--pack-destination` flag is what makes the tarball-content verification step (Task 7.3) work cleanly.
- **YAML 1.2 placeholder strings:** `${...}` inside an unquoted YAML scalar is a literal string (no environment variable expansion in the YAML spec — that's a `docker-compose`-specific feature applied AFTER YAML parse). The unsubstituted template `image: ghcr.io/toon-protocol/town${TOON_TOWN_DIGEST}` parses to the string `'ghcr.io/toon-protocol/town${TOON_TOWN_DIGEST}'`. Docker Compose will reject it as "image not found" but the YAML parse succeeds, which is what enables the "ship unsubstituted in dev mode, fail at runtime" graceful-degradation path.
- **`@sha256:` ref form vs `:tag` ref form:** Docker engine accepts both for `docker pull`. `image: <name>@<digest>` AND `image: <name>:<tag>` are both valid in compose YAML. Mixing the two within a single service entry (e.g., `image: foo:v1@sha256:abc`) is not standard and may be rejected by some Compose versions. Stick to digest-only form for the HS template.

### What This Story Does NOT Do (scope guard)

- **Does NOT delete the root-level `docker-compose-townhouse-hs.yml` or `docker-compose-townhouse-dev.yml`.** Both stay. Retirement is deferred to a follow-up story (post-Epic 45 or Story 45.4 if it lands cleanly).
- **Does NOT modify `scripts/build-image-manifest.mjs` or its tests.** Story 45.1's deliverable; schema is frozen at v1.
- **Does NOT modify `scripts/townhouse-dev-infra.sh` to read from `packages/townhouse/compose/townhouse-dev.yml`.** The script continues to use the root-level path. A follow-up story can route it through the package-local path.
- **Does NOT modify `DockerOrchestrator` to call `loadComposeTemplate`.** That is Story 45.3's job. This story exports the API surface; 45.3 wires it up.
- **Does NOT modify `packages/townhouse/src/cli.ts` to add the `hs up` subcommand.** Story 45.4's job.
- **Does NOT add a SBOM step to the publish workflow.** Out of scope; Story 45.1 deferred it.
- **Does NOT introduce a v2 image-manifest schema.** v1 is sufficient. If Story 45.4 or beyond needs additional fields (e.g., per-arch digest indexes), bump to v2 and version the schema.
- **Does NOT add zod runtime validation of `image-manifest.json` in the loader or build hook.** The build script (Story 45.1) already validates with zod before writing. Re-validating at consumer time would duplicate the contract; trust the build artifact.
- **Does NOT add anon-sidecar containers to the HS template.** The connector's embedded anon support (connector v3.5.x via Story 44.1) handles HS publishing in-process.
- **Does NOT add faucet/anvil/solana services to the HS template.** Those are dev-stack concerns. The HS template is operator-facing only (apex + lazy-provisioned children).
- **Does NOT ship the unrendered template in the tarball.** The rendered HS YAML is what ships; the source template at `packages/townhouse/compose/townhouse-hs.yml` is gitted but not in the tarball (it's a build input, not a build output).
- **Does NOT bump townhouse package version.** The version stays at `0.1.0` (or whatever the current version is). Version bumps happen with the next `v*` tag push that triggers the publish workflow.
- **Does NOT touch any code outside `packages/townhouse/`, `scripts/`, `_bmad-output/`, `.github/workflows/publish-townhouse-images.yml`, `CLAUDE.md`, or `packages/sdk/CONNECTOR_RELEASE_CONTRACT.md`.** If the dev finds themselves editing `packages/town/`, `packages/mill/`, `packages/dvm/`, or any other package — stop, that's outside scope.

## References

### From `_bmad-output/planning-artifacts/epics-townhouse-hs-v1.md`

- [Source: epics-townhouse-hs-v1.md#L516-L546] — Story 45.2 ACs (canonical)
- [Source: epics-townhouse-hs-v1.md#L38] — FR3 (embed compose templates in npm tarball)
- [Source: epics-townhouse-hs-v1.md#L104-L105] — NFR8 (operator-secret file mode `0o600`)
- [Source: epics-townhouse-hs-v1.md#L106] — NFR9 (host ports bind to 127.0.0.1 only)
- [Source: epics-townhouse-hs-v1.md#L122] — NFR17 (pre-publish quality gate)
- [Source: epics-townhouse-hs-v1.md#L150] — Connector dep version (digest-pinned via image-manifest.json)
- [Source: epics-townhouse-hs-v1.md#L277-L284] — Epic 45 overview (One-Command Apex Install)
- [Source: epics-townhouse-hs-v1.md#L444-L468] — Story 44.4 (release contract — names this story's `image-manifest.json` consumption pattern)

### From `_bmad-output/planning-artifacts/townhouse-hs-v1-plan-2026-05-07.md`

- [Source: townhouse-hs-v1-plan-2026-05-07.md#L66] — TH-21.17.2 row in story list (sized M, critical path)
- [Source: townhouse-hs-v1-plan-2026-05-07.md#L80-L82] — Critical path declaration (1 → 2 → 5 → 6 → 13)
- [Source: townhouse-hs-v1-plan-2026-05-07.md#L94-L100] — Architecture Anchors (single-source-of-truth for earnings, no Docker socket in connector, host-side townhouse-api owns dockerode)
- [Source: townhouse-hs-v1-plan-2026-05-07.md#L232-L244] — Release contract + image-publish coordination (digest pinning, "townhouse must NOT republish")
- [Source: townhouse-hs-v1-plan-2026-05-07.md#L311-L317] — Pre-publish quality gates (6 checks)

### From `_bmad-output/implementation-artifacts/`

- [Source: 45-1-multi-arch-townhouse-image-publish-ci.md] — sibling story; produces `image-manifest.json` artifact this story consumes
- [Source: 45-1-multi-arch-townhouse-image-publish-ci.md#L27-L42] — Manifest schema (5 image entries, `{name, tag, digest}`)
- [Source: 45-1-multi-arch-townhouse-image-publish-ci.md#L97-L107] — Workflow npm-publish job step order (informs Task 7's surgery)
- [Source: 44-4-connector-release-contract-cross-repo-doc.md] — release contract doc (defines the digest-pinning discipline)

### From this repo

- [Source: scripts/build-image-manifest.mjs] — manifest schema (v1) + writer (Story 45.1)
- [Source: scripts/build-image-manifest.test.ts] — manifest writer tests (16 cases — DO NOT modify)
- [Source: docker-compose-townhouse-hs.yml] — root-level legacy HS compose; the new template at `packages/townhouse/compose/townhouse-hs.yml` derives from this structure
- [Source: docker-compose-townhouse-dev.yml] — root-level dev compose; the new template at `packages/townhouse/compose/townhouse-dev.yml` is a verbatim copy
- [Source: packages/townhouse/package.json] — `bin: ./dist/cli.js`, `files: ["dist"]`, ESM-only, Node ≥20 (no changes needed; existing config covers tarball inclusion)
- [Source: packages/townhouse/tsup.config.ts] — current build config (Task 5 modifies to add `onSuccess`)
- [Source: packages/townhouse/src/constants.ts:21] — `DEFAULT_CONNECTOR_IMAGE` (Task 6 flips to digest form)
- [Source: packages/townhouse/src/index.ts] — public API barrel (Task 4.3 adds compose-loader exports)
- [Source: packages/townhouse/src/__integration__/connector-image-contract.test.ts] — contract canary (Task 8.4 modifies to accept digest form)
- [Source: docker/Dockerfile.townhouse-api] — Story 45.1 deliverable; the new HS template references the resulting image
- [Source: scripts/townhouse-dev-infra.sh] — dev-infra orchestrator (uses root-level `docker-compose-townhouse-dev.yml`; package-local copy is a sibling, not a replacement)
- [Source: scripts/townhouse-test-infra.sh] — real-CLI E2E orchestrator (Story 22.5 + 21.16 sibling)
- [Source: packages/sdk/CONNECTOR_RELEASE_CONTRACT.md] — release contract (Task 9.3 adds implementation reference)
- [Source: CLAUDE.md] — § "Townhouse Dev Stack (28xxx)" + § "Where to Find Things" (Task 9.2 adds rows)

### Latest tech references (verified 2026-05-09)

- [tsup `onSuccess` docs](https://tsup.egoist.dev/#run-after-success) — async function form, runs after each build emit
- [Node.js `fs.cp` docs](https://nodejs.org/api/fs.html#fspromisescpsrc-dest-options) — `recursive: true` option, cross-platform
- [Node.js `fs.chmod` docs](https://nodejs.org/api/fs.html#fspromiseschmodpath-mode) — note umask interaction
- [Docker Compose `image:` field spec](https://docs.docker.com/compose/compose-file/05-services/#image) — accepts `<name>:<tag>` AND `<name>@<digest>` forms
- [pnpm `pack` docs](https://pnpm.io/cli/pack) — `--pack-destination` flag for verification testing
- [npm `files` field semantics](https://docs.npmjs.com/cli/v10/configuring-npm/package-json#files) — `dist` directory inclusion (already configured at `packages/townhouse/package.json:18-20`)
- [GitHub Actions `actions/download-artifact` docs](https://github.com/actions/download-artifact) — `path:` option for placement (Task 7.2 uses)

## Verification

After Task 11 PR merges AND a `v0.1.0-rc2` (or whatever follow-on tag is agreed) tag-push run completes:

```bash
# 1. Tarball contains all three required artifacts (AC #1, #11)
npm view @toon-protocol/townhouse@<version> dist.tarball
# Expected: a tarball URL on registry.npmjs.org

# Pull and inspect
npm pack @toon-protocol/townhouse@<version> --pack-destination /tmp/verify/
TGZ=$(ls /tmp/verify/toon-protocol-townhouse-*.tgz | head -1)
tar -tzf "$TGZ" | grep -E 'package/dist/(compose/|image-manifest\.json)'
# Expected: 3 lines

# 2. Compose templates have correct shape (AC #2, #3)
tar -xzf "$TGZ" -C /tmp/verify/extracted/
grep -c '@sha256:' /tmp/verify/extracted/package/dist/compose/townhouse-hs.yml
# Expected: 5 (one per service)
grep -c '\${TOON_' /tmp/verify/extracted/package/dist/compose/townhouse-hs.yml
# Expected: 0
grep -c 'build:' /tmp/verify/extracted/package/dist/compose/townhouse-hs.yml
# Expected: 0
grep -E '127\.0\.0\.1:' /tmp/verify/extracted/package/dist/compose/townhouse-hs.yml | wc -l
# Expected: > 0; every host-side port binding present

# Verify townhouse-api service exists
grep -A 5 '^  townhouse-api:' /tmp/verify/extracted/package/dist/compose/townhouse-hs.yml
# Expected: image: ghcr.io/toon-protocol/townhouse-api@sha256:... line

# 3. docker compose config validates (AC #5)
docker compose -f /tmp/verify/extracted/package/dist/compose/townhouse-hs.yml config >/dev/null
# Expected: exit 0

# 4. image-manifest.json schema (AC #6)
jq -e '.schemaVersion == 1' /tmp/verify/extracted/package/dist/image-manifest.json
jq -e '.images | keys | sort == ["connector","dvm","mill","town","townhouse-api"]' /tmp/verify/extracted/package/dist/image-manifest.json
# Expected: both queries return true

# 5. Loader API works (AC #4, #6, #7)
mkdir /tmp/verify/install && cd /tmp/verify/install
npm init -y
npm install @toon-protocol/townhouse@<version>
node --input-type=module -e "
  import { loadComposeTemplate, materializeComposeTemplate } from '@toon-protocol/townhouse';
  import { mkdtempSync, statSync } from 'node:fs';
  import { tmpdir } from 'node:os';
  import { join } from 'node:path';
  const home = mkdtempSync(join(tmpdir(), 'verify-'));
  const yaml = loadComposeTemplate('hs');
  console.log('hs yaml length:', yaml.length);
  const { composePath, manifestPath } = materializeComposeTemplate('hs', { townhouseHome: home });
  console.log('compose mode:', (statSync(composePath).mode & 0o777).toString(8));
  console.log('manifest mode:', (statSync(manifestPath).mode & 0o777).toString(8));
"
# Expected: yaml length > 0; both modes are '600'

# 6. Constant flip (AC #9)
grep DEFAULT_CONNECTOR_IMAGE /tmp/verify/extracted/package/dist/index.js | head -2
# Expected: digest form ('@sha256:...'), NOT tag form (':3.4.1')

# 7. Workflow no longer dry-run (AC #10)
grep -E '\-\-dry-run' .github/workflows/publish-townhouse-images.yml
# Expected: no matches OR only inside comments

# 8. Sprint-status update (AC #12)
grep -A1 "45-2-embed-compose-templates" /home/jonathan/Documents/town/_bmad-output/implementation-artifacts/sprint-status.yaml
# Expected: status reads "done", trailing # comment names workflow run URL + PR number
```

If any of these checks fail, the story is NOT done. Re-open. Do not flip sprint-status to `done`.

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

- Task 5.5 resolution: Used Option A (standalone `scripts/render-compose-template.mjs` + CI step) to avoid tsup `clean: true` wiping the manifest.
- `process.umask()` is not settable in vitest worker threads — updated test to verify chmodSync enforces 0o600 without explicitly changing the umask (the test environment already uses the default 0o022 umask).
- Docker Compose v5.1.3 requires explicit `--profile` flags to include profile-restricted services in `config` output. Updated `compose-template-validity.test.ts` to pass `--profile town --profile mill --profile dvm`.
- `docker-compose-townhouse.yml` (root) updated to digest form to keep `package-structure.test.ts` green (that test asserts `connector.image === DEFAULT_CONNECTOR_IMAGE`).

### Completion Notes List

- Created `packages/townhouse/compose/` source directory with two templates: HS (digest placeholders, 5 services including new townhouse-api) and dev (verbatim copy from root with updated header comment).
- Authored `packages/townhouse/src/compose-loader.ts` implementing `loadComposeTemplate()`, `materializeComposeTemplate()`, and `ComposeLoaderError` per AC #6/#7 spec. Exports added to `src/index.ts`.
- Updated `packages/townhouse/tsup.config.ts` with `onSuccess` hook that copies dev template verbatim and renders HS template from manifest (graceful degradation when manifest absent locally).
- Authored `scripts/render-compose-template.mjs` as the authoritative CI render step (called in workflow AFTER `download-artifact` places manifest into `dist/`).
- Flipped `DEFAULT_CONNECTOR_IMAGE` from tag form (`connector:3.4.1`) to digest form (`connector@sha256:4a24ccb0...`); updated `docker-compose-townhouse.yml` to match; canary test passes.
- Updated `.github/workflows/publish-townhouse-images.yml`: added render step, tarball verification step, removed `--dry-run` from `pnpm publish`.
- Authored 12 unit tests in `compose-loader.test.ts` (all pass), 7 integration tests in `compose-template-validity.test.ts` (all pass), 5 integration tests in `tarball-contents.test.ts` (all pass). Updated `connector-image-contract.test.ts` to accept digest-form image refs.
- All pre-existing test failures (`earnings.test.ts` 7, `logs.test.ts` 4, `dev-stack-smoke.test.ts` 3) confirmed pre-existing (identical baseline failures before this story's changes).
- Smoke test verified: tarball contains 3 required artifacts, 0 unsubstituted placeholders, 5 digest-form image lines, `docker compose config` exits 0.

### File List

- `packages/townhouse/compose/townhouse-hs.yml` (NEW)
- `packages/townhouse/compose/townhouse-dev.yml` (NEW)
- `packages/townhouse/src/compose-loader.ts` (NEW)
- `packages/townhouse/src/compose-loader.test.ts` (NEW)
- `packages/townhouse/src/__integration__/compose-template-validity.test.ts` (NEW)
- `packages/townhouse/src/__integration__/tarball-contents.test.ts` (NEW)
- `packages/townhouse/src/__tests__/fixtures/compose-loader/image-manifest.json` (NEW)
- `packages/townhouse/src/__tests__/fixtures/compose-loader/compose/townhouse-hs.yml` (NEW)
- `packages/townhouse/src/__tests__/fixtures/compose-loader/compose/townhouse-dev.yml` (NEW)
- `scripts/render-compose-template.mjs` (NEW)
- `packages/townhouse/src/index.ts` (MODIFIED — added compose-loader exports)
- `packages/townhouse/src/constants.ts` (MODIFIED — DEFAULT_CONNECTOR_IMAGE tag → digest form)
- `packages/townhouse/src/__integration__/connector-image-contract.test.ts` (MODIFIED — added parseConnectorImage helper, updated alreadyPulled check)
- `packages/townhouse/tsup.config.ts` (MODIFIED — added onSuccess hook)
- `docker-compose-townhouse.yml` (MODIFIED — connector image tag → digest form to match DEFAULT_CONNECTOR_IMAGE)
- `.github/workflows/publish-townhouse-images.yml` (MODIFIED — added render step, tarball verification, removed --dry-run)
- `packages/townhouse/README.md` (MODIFIED — added Compose Templates section)
- `packages/sdk/CONNECTOR_RELEASE_CONTRACT.md` (MODIFIED — added Story 45.2 implementation reference)
- `CLAUDE.md` (MODIFIED — added 3 rows to "Where to Find Things" table)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (MODIFIED — status in-progress; Task 11.3 pending)

### Change Log

- 2026-05-09: Story 45.2 implementation complete — embed compose templates + image-manifest in npm tarball, flip DEFAULT_CONNECTOR_IMAGE to digest form, remove --dry-run from publish workflow, add render + tarball verification CI steps, author compose-loader API with full test coverage.

### Review Findings

**Code review run: 2026-05-09 — Blind Hunter (22), Edge Case Hunter (16), Acceptance Auditor (6) → triaged into 3 decisions resolved (→ 3 patches), 16 original patches, 9 deferred, 4 dismissed. Total: 19 patches.**

#### Decisions resolved (2026-05-09)

- **D1 → Patch:** `townhouse-api` won't boot as written — resolved with **option 1**: add `environment:` block to the HS template setting `TOWNHOUSE_CONFIG=/.townhouse/config.yaml` and `TOWNHOUSE_WALLET_PASSWORD: ${TOWNHOUSE_WALLET_PASSWORD}` (host-env passthrough; operator sets it before `docker compose up`). Self-contained — does not depend on Story 45.4. [`packages/townhouse/compose/townhouse-hs.yml:95-118`]
- **D2 → Patch:** `docker-compose-townhouse.yml` (root) modified outside scope — resolved with **option 1**: accept 3 sources of truth (`constants.ts`, root compose, rendered HS compose). Add a manifest-alignment test asserting `manifest.images.connector.digest === parseConnectorImage(DEFAULT_CONNECTOR_IMAGE).digest` in `connector-image-contract.test.ts` (reuse the existing parser at lines 32-39). Update the spec's "Files this story touches" list in Dev Notes to acknowledge `docker-compose-townhouse.yml`. Existing `package-structure.test.ts:109` continues catching constant↔root-file drift. [`docker-compose-townhouse.yml:1085-1091`, `packages/townhouse/src/__integration__/connector-image-contract.test.ts`]
- **D3 → Documentation patch:** HS template port collisions with dev stack — resolved with **option 1**: accept by design. Document in the HS template's top comment block and in `packages/townhouse/README.md` that HS-mode and dev stack must not run concurrently on the same machine (HS uses canonical ports; dev stack uses 28xxx). No code change.

#### Patch (unambiguous fixes) — ALL APPLIED 2026-05-09

- [x] [Review][Patch] **D1: Add `environment:` block to `townhouse-api` service** with `TOWNHOUSE_CONFIG=/.townhouse/config.yaml` + `TOWNHOUSE_WALLET_PASSWORD: ${TOWNHOUSE_WALLET_PASSWORD:?...}` host-env passthrough [`packages/townhouse/compose/townhouse-hs.yml:95-118`]
- [x] [Review][Patch] **D2: Add manifest-alignment test** asserting `manifest.images.connector.digest` matches the parsed `DEFAULT_CONNECTOR_IMAGE` digest; updated story Dev Notes touched-files list to include `docker-compose-townhouse.yml` and `orchestrator.ts` [`packages/townhouse/src/__integration__/connector-image-contract.test.ts`]
- [x] [Review][Patch] **D3: Document HS-vs-dev-stack port collision** in HS template top comment + `packages/townhouse/README.md` [`packages/townhouse/compose/townhouse-hs.yml`, `packages/townhouse/README.md`]

- [x] [Review][Patch] **`DockerOrchestrator.pullImages` cache-hit only checks `RepoTags`, never matches digest-form refs** [`packages/townhouse/src/docker/orchestrator.ts:486-501`]
- [x] [Review][Patch] **`materializeComposeTemplate` writes compose BEFORE validating manifest — leaves torn state on missing manifest in HS profile** [`packages/townhouse/src/compose-loader.ts:74-86`]
- [x] [Review][Patch] **`mkdirSync` missing spec-mandated `mode: 0o700` argument (Task 4.1 + AC #7)** [`packages/townhouse/src/compose-loader.ts:68`]
- [x] [Review][Patch] **`chmodSync(home, 0o700)` unconditionally clobbers operator-managed `~/.townhouse/` mode + follows symlinks (no `lstatSync` check)** [`packages/townhouse/src/compose-loader.ts:71-72`]
- [x] [Review][Patch] **`townhouseHome === ''` (empty string) and `homedir() === '/'` slip through `??` and target unsafe paths (CWD or filesystem root)** [`packages/townhouse/src/compose-loader.ts:65`]
- [x] [Review][Patch] **Render scripts swallow ALL errors as "manifest absent" (JSON parse, missing image keys, empty digests)** [`packages/townhouse/tsup.config.ts:51-58`, `scripts/render-compose-template.mjs:64-72`]
- [x] [Review][Patch] **No digest-format validation — empty/malformed digest produces orphaned `@` in image ref; CI verify regex misses it** [`scripts/render-compose-template.mjs:51-57`, `.github/workflows/publish-townhouse-images.yml:75-95`]
- [x] [Review][Patch] **No build-time test that `DEFAULT_CONNECTOR_IMAGE` digest matches `image-manifest.json` (will silently drift on next bump)** [`packages/townhouse/src/__integration__/connector-image-contract.test.ts`]
- [x] [Review][Patch] **`profile` parameter has no runtime validation — TS `'dev' | 'hs'` is erased at runtime; arbitrary input enables path traversal in `materializeComposeTemplate`** [`packages/townhouse/src/compose-loader.ts:74-79`]
- [x] [Review][Patch] **dev compose template ships `${SECRET_VAR:-}` empty-string defaults — secrets-as-empty-string leak into containers** [`packages/townhouse/compose/townhouse-dev.yml`]
- [x] [Review][Patch] **`tarball-contents.test.ts` doesn't run `pnpm build` first — passes against stale dist** [`packages/townhouse/src/__integration__/tarball-contents.test.ts:2096-2121`]
- [x] [Review][Patch] **`compose-template-validity.test.ts` lacks AC-mandated explicit `'\b0\.0\.0\.0:'` grep (Task 2.7)** [`packages/townhouse/src/__integration__/compose-template-validity.test.ts:1930-1950`]
- [x] [Review][Patch] **CI `Verify tarball contents` step uses non-`mktemp` `/tmp/pack-extracted` — workflow rerun on same runner sees stale state** [`.github/workflows/publish-townhouse-images.yml`]
- [x] [Review][Patch] **CI verify uses `grep -qF "$path"` substring match — could false-positive against `*.bak` or partial-name files** [`.github/workflows/publish-townhouse-images.yml`]
- [x] [Review][Patch] **`describe.skipIf` empty-`it` reports as PASSED (green) not SKIPPED in CI output — use `it.skip()` or `ctx.skip()`** [`packages/townhouse/src/__integration__/compose-template-validity.test.ts:2001-2009`]
- [x] [Review][Patch] **`writeFileSync` mode comment misdiagnoses umask masking — `chmod` is needed for the "file already exists" case, not umask masking on `0o600`** [`packages/townhouse/src/compose-loader.ts:88-89`]

#### Deferred (pre-existing or low-priority)

- [x] [Review][Defer] Concurrent `materializeComposeTemplate` calls race — non-atomic write; no `tmp + rename` pattern
- [x] [Review][Defer] `defaultDistDir()` `import.meta.url` resolution fragile under non-tsup bundlers (Story 45.4+ concern)
- [x] [Review][Defer] No idempotency guard on `pnpm publish` rerun — npm 409 on duplicate version
- [x] [Review][Defer] `tarball-contents.test.ts` stdout-parsing of `pnpm pack` brittle under future pnpm minor versions
- [x] [Review][Defer] `DOCKER_AVAILABLE=1` env bypass skips real daemon probe — 30s timeout instead of clean skip when daemon dead
- [x] [Review][Defer] Lifecycle-script asymmetry between `pnpm pack` (verify) and `pnpm publish` (live) — no `--ignore-scripts` guard
- [x] [Review][Defer] Brief TOCTOU readability between `writeFileSync` and `chmodSync` for manifest copy
- [x] [Review][Defer] `tsup` `onSuccess` + `render-compose-template.mjs` duplicate substitution arrays — drift risk when adding a 6th image
- [x] [Review][Defer] `pnpm pack --pack-destination` requires pnpm ≥ 8.4 — workflow's `pnpm/action-setup` version not pinned in this diff

#### Dismissed (noise / false positives)

- tsup config `node:` prefix not type-checked — works fine; build is the validation
- `tar -xzf` extraction without `--no-same-owner --no-same-permissions` — pnpm tarballs are trustworthy
- `--tag latest` flag missing from publish — npm defaults to `latest` tag anyway; pre-existing
- `docker compose config` regex matches synthetic all-`e`s digests in test fixtures — by design (parse-validation, not registry validation)

### Review Findings — Round 2 (post-patches, 2026-05-09)

**Re-review summary: 1 BLOCKER, 5 MAJOR, 5 MINOR, plus 9 NITs/defers and 1 dismissed. ALL 11 PATCHES APPLIED 2026-05-09.**

The Round-1 patches mostly landed clean, but Round 2 caught one BLOCKER (a regex I introduced that fails 100% of the time) plus several incomplete fixes where the patch addressed one branch but missed a parallel branch on the same code path.

#### BLOCKER

- [x] [Review][Patch][R2-BLOCKER] **CI tarball-verify positive-digest-form regex matches 0 lines — every publish would fail** — `.github/workflows/publish-townhouse-images.yml:97-101` uses `grep -cE 'image:[^[:space:]]+@sha256:[a-f0-9]{64}$'` but YAML emits `    image: ghcr.io/...` (space after `image:`). The `[^[:space:]]+` class can never match the leading space, so `DIGEST_LINES=0` while `IMAGE_LINES=5`. Verified empirically against the rendered HS YAML. Fix: change to `'image:\s+\S+@sha256:[a-f0-9]{64}$'` and add a non-zero floor (`$IMAGE_LINES -gt 0`) so a structural refactor that drops all `image:` keys cannot pass the gate via `0===0`.

#### MAJOR

- [x] [Review][Patch][R2-MAJOR] **`writeFileSync` follows symlink at `composePath` and `manifestPath` — symlink guard only checks dirs, not file paths** — Patched dir-level lstat guard (`compose-loader.ts:123-141`) skips chmod when home/composeDir is a symlink, but `writeFileSync(composePath, ...)` and `writeFileSync(manifestPath, ...)` (lines 144, 154) follow file-level symlinks and write through them. Attacker who plants `~/.townhouse/compose/townhouse-hs.yml` as a symlink to `~/.bashrc` gets the rendered YAML written to `.bashrc`. Fix: `lstat` each file path before write; refuse to materialize if symlink, OR open with `O_NOFOLLOW`.
- [x] [Review][Patch][R2-MAJOR] **Mode-narrowing logic widens tighter modes — `0o500` becomes `0o700`** — `compose-loader.ts:135-140`: comment says "operators who deliberately set 0o700 (or tighter, e.g. 0o500) keep their setting" but the check is `if (currentMode !== 0o700) chmod(dir, 0o700)`. `0o500 !== 0o700` → widened to `0o700`. Inverted from the documented promise. Fix: `if (currentMode > 0o700) chmod(dir, 0o700)` (only narrow; never widen).
- [x] [Review][Patch][R2-MAJOR] **Manifest-alignment test skipped when manifest absent — defeats the drift-detection purpose** — `connector-image-contract.test.ts`: `describe.skipIf(!existsSync(MANIFEST_PATH))(...)` skips the alignment assertion in every CI scenario where `dist/image-manifest.json` hasn't been placed (which is most unit-test runs). The test only fires for a developer who manually copied the artifact into dist/ before running tests — i.e., never automatically in CI. Fix: in CI (env `CI=true`), require manifest presence; outside CI, skip with a visible warning. OR add the canary as an explicit step in the publish workflow after `download-artifact`.
- [x] [Review][Patch][R2-MAJOR] **`distDir` / `townhouseHome` path traversal not blocked — `assertValidProfile` is theater** — `compose-loader.ts:46-58`: validates profile string and rejects empty/`/` townhouseHome, but `townhouseHome: '/etc'` passes validation (absolute, non-empty, not `/`). `distDir` has zero validation. Caller could materialize compose YAML into `/etc/compose/`. Fix: validate that townhouseHome resolves under a known-safe root (e.g., reject if `home` is not a descendant of `os.homedir()` unless an explicit override flag is set).
- [x] [Review][Patch][R2-MAJOR] **`tsup.config.ts` and `render-compose-template.mjs` have drifted error contracts** — tsup uses non-null bang (`manifest.images['townhouse-api']!.digest`) which throws raw `TypeError: Cannot read properties of undefined (reading 'digest')` on missing keys; render-script throws explicit `manifest missing image entry: images.townhouse-api`. Same defect, two different error UX. Fix: extract a shared `getDigest(manifest, key)` helper into a single module imported by both. (This was Defer #8 in Round 1; the patch round actually made it worse by introducing the duplicate digest-validation logic.)

#### MINOR

- [x] [Review][Patch][R2-MINOR] **`docker compose config` integration test masks `${VAR:?}` failure mode** — `compose-template-validity.test.ts:122,151`: injects `TOWNHOUSE_WALLET_PASSWORD: 'compose-config-validation-only'` into the test env, so a future patch that silently changes `:?` to `:-` keeps the test green. Add a parallel negative test asserting `docker compose config` exits non-zero when the password is unset.
- [x] [Review][Patch][R2-MINOR] **Idempotency test only checks path + mode equality — not content** — `compose-loader.test.ts:103-109`: a regression where the second call wrote different bytes (truncated, wrong template) would not be caught. Add `expect(readFileSync(second.composePath)).toEqual(readFileSync(first.composePath))`.
- [x] [Review][Patch][R2-MINOR] **`scripts/render-compose-template.mjs` doesn't chmod the dist YAML** — `dist/compose/townhouse-hs.yml` lands at the user's umask (typically `0o644`). The README + spec are explicit that the materialized HS YAML is `0o600`, but the pre-tarball build artifact in `dist/` is world-readable. If a CI runner has another untrusted user, that user can read the rendered YAML between the render step and the pack step. Fix: `await chmod(...0o600)` after writing.
- [x] [Review][Patch][R2-MINOR] **HS template profile-gated services still ship `${VAR:-}` empty-string defaults for secrets** — `townhouse-hs.yml`: `NODE_NOSTR_SECRET_KEY: '${TOWN_SECRET_KEY:-}'`, `SETTLEMENT_PRIVATE_KEY: '${TOWN_SETTLEMENT_PRIVATE_KEY:-}'`, mill secrets, `DVM_SECRET_KEY:-`. The patch round only hardened `townhouse-dev.yml`. Profile-gated services (town/mill/dvm) don't boot in this story (Story 45.4 only starts connector + townhouse-api at apex install), but Epic 46 will. Fix: same `${VAR:?msg}` pattern, OR explicitly defer with a TODO for Epic 46.
- [x] [Review][Patch][R2-MINOR] **Story file: `orchestrator.ts` is in both the touched-files list AND the unchanged scope-guard list** — line 487 (touched) vs line 499 (scope-guarded as Story 45.3 territory). Self-contradiction introduced by the D2-Patch list update. Fix: amend the scope-guard line to "DockerOrchestrator profile-param refactor is Story 45.3 territory; this story's RepoDigests cache fix is the ONLY orchestrator change in scope".

#### NIT / Defer

- [x] [Review][Defer] D3-Patch port-collision documentation is technically incorrect — host ports `9401`, `28090`, `7100`, `3100`, `3200`, `3400` (HS) do not actually overlap with the dev stack's host bindings (28080, 28100, 28110, 28200, 28210, 28400, 28700, 28710). The "must not run concurrently" guidance is reasonable as a defensive default but the cited mechanism is wrong. — defer doc tidy-up
- [x] [Review][Defer] `describe.skipIf` inverted-logic sibling pattern is structurally clever but only emits a visible "skipped" line in the file-missing case; in the normal case (file present), the sibling describe is silently absent. — defer
- [x] [Review][Defer] TOCTOU between manifest existence check and copy in `materializeComposeTemplate` (race with concurrent `pnpm install --force`) — defer
- [x] [Review][Defer] `loadComposeTemplate` ENOENT race propagates raw `fs.Error` instead of wrapped `ComposeLoaderError` — defer
- [x] [Review][Defer] `compose-template-validity.test.ts` `0\.0\.0\.0:` reject misses YAML long-form `host_ip: 0.0.0.0\n` (no trailing colon) — defer
- [x] [Review][Defer] Connector image cache check uses `includes(parsedRef.digest!)` — substring match where suffix would be safer — defer
- [x] [Review][Defer] `tarball-contents.test.ts` afterAll cleanup deletes the tarball even on test failure — defer
- [x] [Review][Defer] Manifest-alignment test path resolution via `import.meta.url + '../../dist/...'` is fragile under bundler reconfiguration — defer
- [x] [Review][Defer] `tarball-contents.test.ts` "freshness precondition" only checks `existsSync` — stale dist passes the gate — defer

#### Dismissed (Round 2 false positive)

- ~~`townhouse-api` `volumes: [~/.townhouse:/.townhouse:rw]` literal `~`~~ — Blind Hunter R2 claimed Compose treats `~` as literal; verified empirically with `docker compose config` (v5.1.3) that `~` IS expanded to `$HOME` in volume bind-mount source paths. Output: `source: /home/jonathan/.townhouse_compose_test`. The mount works as intended.
