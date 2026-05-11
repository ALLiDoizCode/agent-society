#!/usr/bin/env bash
# Townhouse Test Infrastructure — Image cache warm-up for real-CLI E2E (Story 21.16)
#
# PURPOSE: Different from townhouse-dev-infra.sh (contributor dev stack with
# multi-peer fixtures, deterministic keys, SOCKS5, chain devnets). This script
# has one mission: warm the Docker image cache so integration tests can run
# `townhouse init` + `townhouse up` against the real CLI without spending
# 5 minutes pulling images.
#
# Usage:
#   ./scripts/townhouse-test-infra.sh up       # Pre-pull connector + pre-build toon images; NO containers started
#   ./scripts/townhouse-test-infra.sh down     # Defensive cleanup of orphan townhouse-* containers + network
#   ./scripts/townhouse-test-infra.sh status   # List townhouse-* container state + network
#
# Preset support (Story D10):
#   This script is preset-agnostic — it warms the same image cache for every
#   downstream `townhouse init` flow (default config, --preset=demo, or any
#   future preset). The `--preset` flag is `init`-only; `townhouse up` reads
#   whatever YAML init wrote. To run the D10 demo composition gate:
#     1. bash scripts/townhouse-test-infra.sh up
#     2. townhouse init --preset=demo --config-dir <dir> --yes
#     3. townhouse up --config-dir <dir>
#     4. TOWNHOUSE_E2E_REAL_STACK=1 pnpm --filter @toon-protocol/townhouse-web e2e:real
#
# Port allocation: NONE — this script does NOT start any containers.
#   The real CLI (townhouse init + townhouse up) binds:
#     127.0.0.1:9400 — Townhouse Fastify API
#     127.0.0.1:9401 — Connector admin (bound by orchestrator PortBindings)
#   Ensure these ports are free before running the integration test suite.
#
# DEV/TEST ONLY — do not use in production.
#
# ── Diagnostic runbook ────────────────────────────────────────────────────────
#
# "Container townhouse-connector already exists"
#   A prior test run crashed before cleanup. Fix:
#     bash scripts/townhouse-test-infra.sh down
#   Then re-run the test suite.
#
# "Image pull timed out"
#   Docker daemon is unavailable or the network is unreachable.
#   Warm the cache manually:
#     docker pull ghcr.io/toon-protocol/connector:3.3.3
#   Then re-run: bash scripts/townhouse-test-infra.sh up
#
# "Port 9400 / 9401 is already in use"
#   Find the offending process:
#     lsof -i :9400   # Fastify API port
#     lsof -i :9401   # Connector admin port
#   Kill it, then re-run.  A prior crashed `townhouse up` subprocess or the
#   dev-infra API server (28080) map may still hold the port.
#
# "toon:town / toon:mill / toon:dvm build failed"
#   Inspect the Docker build output above the error line.
#   Common causes: Dockerfile changed, base image unavailable, workspace files
#   missing.  Try: docker build --no-cache -f docker/Dockerfile.town -t toon:town .
#
# "RUN_DOCKER_INTEGRATION=1 but tests still skipped"
#   Also check SKIP_DOCKER is not set (truthy SKIP_DOCKER overrides RUN_DOCKER_INTEGRATION).
#   Verify Docker is reachable: docker ps > /dev/null && echo "Docker OK"
#
# ─────────────────────────────────────────────────────────────────────────────

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# ── Logging helpers (mirrored from sdk-e2e-infra.sh + townhouse-dev-infra.sh) ─
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info()    { echo -e "${BLUE}[info]${NC} $1"; }
log_success() { echo -e "${GREEN}[ok]${NC} $1"; }
log_warning() { echo -e "${YELLOW}[warn]${NC} $1"; }
log_error()   { echo -e "${RED}[error]${NC} $1"; }

# ── Docker availability guard ─────────────────────────────────────────────────
require_docker() {
  if ! command -v docker > /dev/null 2>&1; then
    log_error "Docker not found — install Docker or set SKIP_DOCKER=1 to bypass"
    exit 1
  fi
  if ! docker ps > /dev/null 2>&1; then
    log_error "Docker daemon not reachable — install Docker or set SKIP_DOCKER=1 to bypass"
    exit 1
  fi
}

# ── Read DEFAULT_CONNECTOR_IMAGE from source (image-bump-robust) ──────────────
# Primary: grep the source file (works before pnpm build, no Node required).
# Fallback: node eval from compiled dist/ (requires pnpm build to have run).
read_connector_image() {
  local image
  image=$(grep -oE "ghcr\.io/[^'\"]+" \
    "$REPO_ROOT/packages/townhouse/src/constants.ts" 2>/dev/null | head -1) || true

  if [ -z "$image" ]; then
    image=$(node --input-type=module -e "
      import { DEFAULT_CONNECTOR_IMAGE } from '$REPO_ROOT/packages/townhouse/dist/constants.js';
      console.log(DEFAULT_CONNECTOR_IMAGE);
    " 2>/dev/null) || true
  fi

  if [ -z "$image" ]; then
    log_error "Could not resolve DEFAULT_CONNECTOR_IMAGE from constants.ts or dist/. Run pnpm build first."
    exit 1
  fi

  echo "$image"
}

# ── cmd_up ────────────────────────────────────────────────────────────────────
# Pre-warms the Docker image cache: pull the connector image + build toon node images.
# Does NOT start any containers. Tests run the real CLI against the warmed cache.
cmd_up() {
  require_docker

  log_info "Warming Townhouse test image cache..."

  local connector_image
  connector_image=$(read_connector_image)
  log_info "Connector image: $connector_image"

  # ── Pull connector image ────────────────────────────────────────────────────
  log_info "Pulling connector image (Docker layer cache applies on subsequent runs)..."
  docker pull "$connector_image"
  log_success "Connector image ready: $connector_image"

  # ── Build local node images ──────────────────────────────────────────────────
  log_info "Building toon:town (Docker build cache applies)..."
  DOCKER_BUILDKIT=1 docker build \
    -f "$REPO_ROOT/docker/Dockerfile.town" \
    -t toon:town \
    "$REPO_ROOT"
  log_success "toon:town built"

  log_info "Building toon:mill (Docker build cache applies)..."
  DOCKER_BUILDKIT=1 docker build \
    -f "$REPO_ROOT/docker/Dockerfile.mill" \
    -t toon:mill \
    "$REPO_ROOT"
  log_success "toon:mill built"

  log_info "Building toon:dvm (Docker build cache applies)..."
  DOCKER_BUILDKIT=1 docker build \
    -f "$REPO_ROOT/docker/Dockerfile.dvm" \
    -t toon:dvm \
    "$REPO_ROOT"
  log_success "toon:dvm built"

  echo ""
  echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${GREEN}  Townhouse Test Image Cache Ready${NC}"
  echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo ""
  echo "  Connector: $connector_image"
  echo "  Nodes:     toon:town, toon:mill, toon:dvm"
  echo ""
  echo "  No containers started — integration tests run the real CLI against this cache."
  echo ""
  echo "  Run integration tests (requires RUN_DOCKER_INTEGRATION=1):"
  echo "    pnpm --filter @toon-protocol/townhouse test:integration"
  echo ""
  echo "  Or use the combined e2e:docker script (includes up/down):"
  echo "    pnpm --filter @toon-protocol/townhouse test:e2e:docker"
  echo ""
}

# ── cmd_down ──────────────────────────────────────────────────────────────────
# Defensive cleanup: removes orphan townhouse-* containers and the townhouse-net
# network left behind by a crashed test run. All removals are || true — this
# script never fails when the containers don't exist.
cmd_down() {
  require_docker

  log_info "Cleaning up orphan Townhouse test containers and network..."

  docker rm -f townhouse-connector || true
  docker rm -f townhouse-town      || true
  docker rm -f townhouse-mill      || true
  docker rm -f townhouse-dvm       || true
  docker network rm townhouse-net  || true

  log_success "Cleanup complete (missing containers/networks are not errors)"
}

# ── cmd_status ────────────────────────────────────────────────────────────────
cmd_status() {
  require_docker

  log_info "Townhouse test container state:"
  echo ""

  local running=0
  for name in townhouse-connector townhouse-town townhouse-mill townhouse-dvm; do
    local state
    state=$(docker inspect "$name" --format '{{.State.Status}}' 2>/dev/null) || state="absent"
    if [ "$state" = "running" ]; then
      echo -e "  ${GREEN}✓${NC} $name ($state)"
      running=$((running + 1))
    elif [ "$state" = "absent" ]; then
      echo -e "  ${BLUE}-${NC} $name (not created)"
    else
      echo -e "  ${YELLOW}!${NC} $name ($state)"
    fi
  done

  echo ""
  local net_name
  net_name=$(docker network ls --filter name=townhouse-net --format '{{.Name}}' 2>/dev/null | head -1) || net_name=""
  if [ -n "$net_name" ]; then
    echo -e "  ${GREEN}✓${NC} townhouse-net (present)"
  else
    echo -e "  ${BLUE}-${NC} townhouse-net (not created)"
  fi
  echo ""
  echo "  $running / 4 townhouse-* containers running"
  echo ""
  echo "  Ports used by a live stack:"
  echo "    127.0.0.1:9400  Townhouse Fastify API"
  echo "    127.0.0.1:9401  Connector admin (bound by Docker orchestrator)"
}

# ── Dispatch ──────────────────────────────────────────────────────────────────
case "${1:-}" in
  up)
    cmd_up
    ;;
  down)
    cmd_down
    ;;
  status)
    cmd_status
    ;;
  *)
    echo "Usage: $0 {up|down|status}"
    echo ""
    echo "  up     Pre-pull connector image + pre-build toon:{town,mill,dvm} images"
    echo "  down   Defensive cleanup of orphan townhouse-* containers + network"
    echo "  status List townhouse-* container state + network"
    exit 1
    ;;
esac
