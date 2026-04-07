#!/usr/bin/env bash
# Prep and Build Ditto Docker Image
#
# Builds TOON workspace packages, installs Ditto deps, builds the SPA,
# then creates the Docker image from the static output.
#
# Usage:
#   ./scripts/prep-ditto-build.sh           # Build image
#   ./scripts/prep-ditto-build.sh --push    # Build and push to ghcr.io

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DITTO_DIR="${DITTO_DIR:-$REPO_ROOT/../ditto}"
IMAGE="ghcr.io/toon-protocol/ditto:latest"

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info()    { echo -e "${BLUE}[info]${NC} $1"; }
log_success() { echo -e "${GREEN}[ok]${NC} $1"; }
log_error()   { echo -e "${RED}[error]${NC} $1"; }

if [ ! -d "$DITTO_DIR" ]; then
  log_error "Ditto repo not found at $DITTO_DIR"
  log_error "Set DITTO_DIR env var to point to your ditto checkout"
  exit 1
fi

# Step 1: Build TOON workspace packages
log_info "Building TOON workspace packages..."
cd "$REPO_ROOT"
pnpm -r --filter @toon-protocol/core --filter @toon-protocol/client --filter @toon-protocol/relay run build
log_success "TOON packages built"

# Step 2: Install Ditto deps and build the SPA
log_info "Building Ditto SPA..."
cd "$DITTO_DIR"
npm install
npm run build
log_success "Ditto built → dist/"

# Step 3: Build Docker image from dist/
log_info "Building Docker image: $IMAGE"
docker build -t "$IMAGE" .
log_success "Docker image built: $IMAGE"

# Step 4: Push if requested
if [ "${1:-}" = "--push" ]; then
  log_info "Pushing $IMAGE..."
  docker push "$IMAGE"
  log_success "Pushed $IMAGE"
fi

echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  Ditto image ready: $IMAGE${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
