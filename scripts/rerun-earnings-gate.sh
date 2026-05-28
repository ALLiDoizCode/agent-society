#!/usr/bin/env bash
# Townhouse Story 47.5 — Earnings Data Plane Live E2E Gate Rerun
#
# PURPOSE: Push-button rerun of the Epic 47 close-out gate against the
# latest (or operator-specified) published townhouse image set. Handles the
# four steps the manual runbook used to require:
#
#   1. fetch latest publish-townhouse-images.yml run + download its
#      image-manifest artifact into packages/townhouse/dist/
#   2. pnpm --filter @toon-protocol/townhouse build (so dist/cli.js is fresh)
#   3. bash scripts/townhouse-test-infra.sh up (warm Docker image cache)
#   4. RUN_DOCKER_INTEGRATION=1 vitest run on the gate spec
#
# Usage:
#   bash scripts/rerun-earnings-gate.sh                  # latest successful publish run
#   bash scripts/rerun-earnings-gate.sh --run-id 123456  # specific GitHub Actions run
#   bash scripts/rerun-earnings-gate.sh --keep-stack     # leave Docker images warm after
#   bash scripts/rerun-earnings-gate.sh --skip-fetch     # use whatever dist/image-manifest.json is on disk
#
# Decision D4 (Story 47.5): this script is the rerun harness referenced as
# "rc7 publish + Docker rerun." After rc7 lands and the publish workflow
# completes, run this script to validate the gate against the rc7 tarball.
#
# Exit codes:
#   0 — gate passed
#   1 — gate failed
#   2 — pre-flight failure (manifest fetch, build, infra)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PKG_DIR="$REPO_ROOT/packages/townhouse"
DIST_DIR="$PKG_DIR/dist"
MANIFEST_PATH="$DIST_DIR/image-manifest.json"

WORKFLOW_NAME="publish-townhouse-images.yml"
ARTIFACT_NAME="image-manifest"
GATE_SPEC="src/__integration__/townhouse-earnings-e2e.test.ts"

RUN_ID=""
SKIP_FETCH=0
KEEP_STACK=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --run-id)
      RUN_ID="$2"; shift 2 ;;
    --skip-fetch)
      SKIP_FETCH=1; shift ;;
    --keep-stack)
      KEEP_STACK=1; shift ;;
    -h|--help)
      sed -n '1,30p' "$0" ; exit 0 ;;
    *)
      echo "Unknown option: $1" >&2 ; exit 2 ;;
  esac
done

log() { printf "\n\033[1;34m[gate-rerun]\033[0m %s\n" "$*"; }
die() { printf "\n\033[1;31m[gate-rerun:FATAL]\033[0m %s\n" "$*" >&2; exit 2; }

# ── Unified cleanup trap ────────────────────────────────────────────────────
# Registered BEFORE any tmpfile or warmed-stack work so a failure between
# stash/build/restore (Story 50.0 review #3 — manifest backup tmpfile leak)
# cleans up reliably. KEEP_STACK is respected; the backup tmpfile is always
# removed.
SKIP_FETCH_MANIFEST_BACKUP=""
INFRA_WARMED=0
cleanup_all() {
  if [[ -n "$SKIP_FETCH_MANIFEST_BACKUP" && -f "$SKIP_FETCH_MANIFEST_BACKUP" ]]; then
    printf "\n\033[1;33m[gate-rerun:WARN]\033[0m --skip-fetch was set but the build failed before the manifest could be restored. Your original manifest has been lost (tsup clean wiped dist/). Recover it manually or rerun without --skip-fetch.\n" >&2
    rm -f "$SKIP_FETCH_MANIFEST_BACKUP" || true
  fi
  if [[ $INFRA_WARMED -eq 1 ]]; then
    if [[ $KEEP_STACK -eq 0 ]]; then
      log "Tearing down warmed stack (townhouse-test-infra.sh down)"
      bash "$REPO_ROOT/scripts/townhouse-test-infra.sh" down || true
    else
      log "--keep-stack was set; leaving Docker stack warm for the next rerun."
    fi
  fi
}
trap cleanup_all EXIT

# ── Prerequisites ───────────────────────────────────────────────────────────
# jq is hard-required by Step 2b's drift guard (Story 50.0 review F5). Check
# here at the top so an operator without jq doesn't get partial dist/
# curation (build artifacts + downloaded manifest) before discovering the
# missing dependency. The gh check stays inside the fetch branch — it is
# only needed when --skip-fetch is NOT set.
if ! command -v jq >/dev/null 2>&1; then
  die "jq required for Step 2b drift guard. Install: https://stedolan.github.io/jq/"
fi

# ── Step 1: build the townhouse package (BEFORE the manifest is written) ───
# tsup cleans dist/ on build, so the manifest must land AFTER the build.
# Otherwise step 2's `gh run download` writes the file and step 3's
# `pnpm build` silently deletes it.
#
# Story 50.0 review F8 — we always rebuild here so dist/cli.js stays fresh
# (Step 4's gate spec spawns the CLI from dist/cli.js; a stale or missing
# binary would silently make the gate run against the wrong version).
# When --skip-fetch is set AND the operator has a pre-curated manifest on
# disk, stash it across the build so tsup's `clean: true` doesn't wipe it.
# The backup is removed by cleanup_all (trap EXIT) above on any abort path.
if [[ $SKIP_FETCH -eq 1 && -f "$MANIFEST_PATH" ]]; then
  SKIP_FETCH_MANIFEST_BACKUP="$(mktemp)"
  cp "$MANIFEST_PATH" "$SKIP_FETCH_MANIFEST_BACKUP"
  log "Stashing image-manifest.json before build (--skip-fetch); will restore after tsup clean"
fi

log "Building @toon-protocol/townhouse (must run before manifest is dropped)"
pnpm --filter @toon-protocol/townhouse build

if [[ -n "$SKIP_FETCH_MANIFEST_BACKUP" ]]; then
  mkdir -p "$DIST_DIR"
  cp "$SKIP_FETCH_MANIFEST_BACKUP" "$MANIFEST_PATH"
  rm "$SKIP_FETCH_MANIFEST_BACKUP"
  SKIP_FETCH_MANIFEST_BACKUP=""
  log "Restored stashed image-manifest.json into $DIST_DIR"
fi

# ── Step 2: fetch image-manifest from latest publish run ────────────────────
if [[ $SKIP_FETCH -eq 0 ]]; then
  log "Fetching image-manifest artifact (workflow=$WORKFLOW_NAME)"
  if ! command -v gh >/dev/null 2>&1; then
    die "gh CLI not installed. Install: https://cli.github.com or rerun with --skip-fetch."
  fi
  if [[ -z "$RUN_ID" ]]; then
    RUN_ID="$(gh run list \
      --workflow "$WORKFLOW_NAME" \
      --status success \
      --limit 1 \
      --json databaseId \
      --jq '.[0].databaseId' || true)"
    if [[ -z "$RUN_ID" || "$RUN_ID" == "null" ]]; then
      die "No successful run of $WORKFLOW_NAME found. Confirm the workflow has published at least once."
    fi
    log "Latest successful run: $RUN_ID"
  fi
  mkdir -p "$DIST_DIR"
  # gh run download replaces existing files; remove stale ones first.
  rm -f "$MANIFEST_PATH"
  if ! gh run download "$RUN_ID" --name "$ARTIFACT_NAME" -D "$DIST_DIR" 2>&1; then
    die "gh run download failed for run $RUN_ID artifact $ARTIFACT_NAME."
  fi
  if [[ ! -f "$MANIFEST_PATH" ]]; then
    die "Artifact downloaded but $MANIFEST_PATH is missing. Inspect $DIST_DIR contents."
  fi
  log "image-manifest.json present at $MANIFEST_PATH"
else
  if [[ ! -f "$MANIFEST_PATH" ]]; then
    die "--skip-fetch was passed but $MANIFEST_PATH is missing. Drop it manually or rerun without --skip-fetch."
  fi
  log "Using existing $MANIFEST_PATH"
fi

# Quick sanity check — surface the SHA range so the gate run's
# A1' Tarball-SHA Gate Guard documentation is one grep away.
log "image-manifest summary:"
jq -r '
  if has("tag") then "  tag: \(.tag)\n" else "" end +
  "  images:\n" +
  (.images // [] | map("    - \(.name)@\(.digest[:19])") | join("\n"))
' "$MANIFEST_PATH" 2>/dev/null || cat "$MANIFEST_PATH"

# ── Step 2b: connector-image drift guard (Story 50.0 AC #1, closes A9') ────
# Verify the connector digest the manifest pins matches DEFAULT_CONNECTOR_IMAGE
# in packages/townhouse/src/constants.ts. This catches the Epic 49.1 finding
# where the manifest pinned connector v3.6.2 while constants.ts already pinned
# v3.6.3 — invisible drift that made the gate run against the wrong connector.
#
# SCOPE (Story 50.0 review F4) — this guard ONLY validates the connector
# entry. The other four images (townhouse-api, town, mill, dvm) are NOT
# compared anywhere in the gate-rerun path because townhouse-test-infra.sh
# builds town/mill/dvm locally as `toon:<name>` (not from a ghcr.io tag) and
# never pulls townhouse-api at all. Per-image drift in those four entries
# is caught at publish-time by the tarball-verify gate in
# .github/workflows/publish-townhouse-images.yml. The success log line and
# function name reflect the connector-only scope so the operator isn't
# misled into believing all five images were validated here.
#
# Exit code 2 on fatal drift.
# Keep in sync with SYNTHETIC_DIGEST_SENTINEL in
# packages/townhouse/src/state/image-manifest.ts. A test in that package
# enforces the sync.
SYNTHETIC_DIGEST_SENTINEL="sha256:dead000000000000000000000000000000000000000000000000000000000000"

verify_connector_digest_alignment() {
  local constants_path="$PKG_DIR/src/constants.ts"
  if [[ ! -f "$constants_path" ]]; then
    die "constants.ts not found at $constants_path; cannot verify alignment."
  fi

  # Round 2 review #5 — three combined guards against shadow attacks:
  #   1. sed-range narrows to the `DEFAULT_CONNECTOR_IMAGE` export body only,
  #      so other quoted refs elsewhere in the file are out of scope.
  #   2. comment-strip inside the range drops `//` and `* `/`/*`-prefixed
  #      lines, so intra-export JSDoc/inline comments can't shadow the live
  #      string literal.
  #   3. quoted-form anchor requires the digest to appear inside single quotes,
  #      so a trailing inline-comment URL on the assignment line (rare but
  #      possible) won't match.
  # Strip comment lines BEFORE applying the sed range so a semicolon inside
  # a JSDoc comment (e.g. "gate); without") does not prematurely terminate
  # the range and exclude the actual digest line from the extraction output.
  local constants_digest
  constants_digest="$(
    grep -v -E '^\s*(//|\*|/\*)' "$constants_path" \
      | sed -nE "/export[[:space:]]+const[[:space:]]+DEFAULT_CONNECTOR_IMAGE[[:space:]]*=/,/;/p" \
      | grep -oE "'ghcr\\.io/toon-protocol/connector@sha256:[a-f0-9]{64}'" \
      | head -1 \
      | sed -E "s|.*@||; s|'||g" \
      || true
  )"
  if [[ -z "$constants_digest" ]]; then
    die "Could not parse \"'ghcr.io/toon-protocol/connector@sha256:<64hex>'\" inside the DEFAULT_CONNECTOR_IMAGE export in $constants_path — export may be in tag form, renamed, or quoted differently."
  fi

  local manifest_connector_digest
  manifest_connector_digest="$(jq -r '.images.connector.digest // ""' "$MANIFEST_PATH")"
  if [[ -z "$manifest_connector_digest" || "$manifest_connector_digest" == "null" ]]; then
    die "image-manifest.json missing .images.connector.digest"
  fi

  # Sentinel detection (review #10) — a synthetic manifest produced by
  # .github/workflows/connector-publish-smoke.yml should never reach the gate.
  # Emit a specific error pointing at the source instead of a generic drift
  # message that sends the operator hunting for a real digest mismatch.
  if [[ "$manifest_connector_digest" == "$SYNTHETIC_DIGEST_SENTINEL" ]]; then
    printf "\n\033[1;31m[gate-rerun:FATAL]\033[0m manifest .images.connector.digest is the SYNTHETIC sentinel %s. This is a placeholder written by .github/workflows/connector-publish-smoke.yml and is NOT a real registry digest. Remove %s and rerun without --skip-fetch (or fetch a real manifest with 'gh run download').\n" \
      "$SYNTHETIC_DIGEST_SENTINEL" "$MANIFEST_PATH" >&2
    exit 2
  fi

  if [[ "$constants_digest" != "$manifest_connector_digest" ]]; then
    printf "\n\033[1;31m[gate-rerun:FATAL]\033[0m connector-digest drift: constants.ts pins %s but manifest pins %s. Bump constants.ts OR re-trigger publish-townhouse-images.yml with the matching connector_version.\n" \
      "$constants_digest" "$manifest_connector_digest" >&2
    exit 2
  fi
  log "drift guard: constants.ts ↔ manifest CONNECTOR digest aligned ($constants_digest)"
  log "drift guard: NOT checked — townhouse-api/town/mill/dvm digests (validated at publish-time only; see scripts/rerun-earnings-gate.sh:Step 2b SCOPE comment)"
}

log "Verifying connector-digest alignment (Story 50.0 AC #1 — connector only)"
verify_connector_digest_alignment

# ── Step 3: warm Docker image cache ─────────────────────────────────────────
log "Warming Docker image cache (townhouse-test-infra.sh up)"
bash "$REPO_ROOT/scripts/townhouse-test-infra.sh" up
INFRA_WARMED=1
# Teardown (and the SKIP_FETCH backup cleanup) are handled by cleanup_all
# (trap EXIT registered at the top of the script).

# ── Step 4: run the gate ────────────────────────────────────────────────────
log "Running the Story 47.5 gate"
log "Gate spec: $GATE_SPEC"
log "Env: RUN_DOCKER_INTEGRATION=1"
log "Wall-clock budget: ~10-14 min (cold pull on first hs up)"

set +e
RUN_DOCKER_INTEGRATION=1 pnpm --filter @toon-protocol/townhouse test:integration "$GATE_SPEC"
GATE_EXIT=$?
set -e

if [[ $GATE_EXIT -ne 0 ]]; then
  log "Gate FAILED (vitest exit $GATE_EXIT). Inspect output above; capture findings in story 47.5 ### Review Findings."
  exit 1
fi

log "Gate PASSED. Update sprint-status.yaml + story 47.5 Review Findings with the dated entry."
exit 0
