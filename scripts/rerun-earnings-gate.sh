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

# ── Step 1: build the townhouse package (BEFORE the manifest is written) ───
# tsup cleans dist/ on build, so the manifest must land AFTER the build.
# Otherwise step 2's `gh run download` writes the file and step 3's
# `pnpm build` silently deletes it.
log "Building @toon-protocol/townhouse (must run before manifest is dropped)"
pnpm --filter @toon-protocol/townhouse build

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
if command -v jq >/dev/null 2>&1; then
  jq -r '
    if has("tag") then "  tag: \(.tag)\n" else "" end +
    "  images:\n" +
    (.images // [] | map("    - \(.name)@\(.digest[:19])") | join("\n"))
  ' "$MANIFEST_PATH" 2>/dev/null || cat "$MANIFEST_PATH"
else
  head -40 "$MANIFEST_PATH"
fi

# ── Step 3: warm Docker image cache ─────────────────────────────────────────
log "Warming Docker image cache (townhouse-test-infra.sh up)"
bash "$REPO_ROOT/scripts/townhouse-test-infra.sh" up

cleanup() {
  if [[ $KEEP_STACK -eq 0 ]]; then
    log "Tearing down warmed stack (townhouse-test-infra.sh down)"
    bash "$REPO_ROOT/scripts/townhouse-test-infra.sh" down || true
  else
    log "--keep-stack was set; leaving Docker stack warm for the next rerun."
  fi
}
trap cleanup EXIT

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
