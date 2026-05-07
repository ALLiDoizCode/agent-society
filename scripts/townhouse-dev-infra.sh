#!/usr/bin/env bash
# Townhouse Dev Infrastructure — Start/Stop (Story 21.8.0, D21-009)
#
# Boots the full contributor dev topology: 1 standalone connector + 2 Town +
# 2 Mill + 1 DVM + 3 chain devnets (Anvil, Solana, Mina) + SOCKS5 proxy.
#
# Usage:
#   ./scripts/townhouse-dev-infra.sh up       # Build images, start, wait for health
#   ./scripts/townhouse-dev-infra.sh down     # Stop containers, remove .env.townhouse-dev
#   ./scripts/townhouse-dev-infra.sh down-v   # Same + remove volumes
#   ./scripts/townhouse-dev-infra.sh status   # Show container state + health summary
#
# Port allocation: 28xxx range — see CLAUDE.md "Townhouse Dev Stack (28xxx)".
# Env file: .env.townhouse-dev written at workspace root on `up`, removed on `down`.
#
# DEV ONLY — deterministic keys below are NOT for production use.

set -e

COMPOSE_FILE="docker-compose-townhouse-dev.yml"
PROJECT_NAME="toon-townhouse-dev"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# ── Logging helpers (mirrored from sdk-e2e-infra.sh) ─────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info()    { echo -e "${BLUE}[info]${NC} $1"; }
log_success() { echo -e "${GREEN}[ok]${NC} $1"; }
log_warning() { echo -e "${YELLOW}[warn]${NC} $1"; }
log_error()   { echo -e "${RED}[error]${NC} $1"; }

# ── Derive Nostr pubkey from secret key hex (lifted from sdk-e2e-infra.sh) ───
derive_nostr_pubkey() {
  local secret_key="$1"
  local pubkey
  pubkey=$(cd "$REPO_ROOT" && node -e "
    const { getPublicKey } = require('nostr-tools/pure');
    const sk = Uint8Array.from(Buffer.from('${secret_key}', 'hex'));
    console.log(getPublicKey(sk));
  " 2>/dev/null) || true

  if [ -z "$pubkey" ]; then
    pubkey=$(cd "$REPO_ROOT" && node --input-type=module -e "
      import { getPublicKey } from 'nostr-tools/pure';
      const sk = Uint8Array.from(Buffer.from('${secret_key}', 'hex'));
      console.log(getPublicKey(sk));
    " 2>/dev/null) || true
  fi

  echo "$pubkey"
}

# ── Health poller (lifted from sdk-e2e-infra.sh) ─────────────────────────────
wait_for_health() {
  local url=$1
  local name=$2
  local max_attempts=${3:-30}
  local attempt=0

  while [ $attempt -lt $max_attempts ]; do
    if curl -sf "$url" > /dev/null 2>&1; then
      log_success "$name is healthy"
      return 0
    fi
    attempt=$((attempt + 1))
    sleep 2
  done

  log_error "$name failed health check after $((max_attempts * 2))s"
  return 1
}

# ── Deterministic Nostr secret keys — DEV ONLY, NOT FOR PRODUCTION ───────────
# 64-char (32-byte) hex per Mill/DVM entrypoint validation. Easy-to-scan
# patterns so pubkey prefixes are recognizable in relay logs.
# Exported so docker compose can interpolate them into NODE_NOSTR_SECRET_KEY
# in the per-service env blocks of docker-compose-townhouse-dev.yml.
export TOWN_01_SECRET_KEY="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa01"
export TOWN_02_SECRET_KEY="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa02"
export MILL_01_SECRET_KEY="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa03"
export MILL_02_SECRET_KEY="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa04"
export DVM_01_SECRET_KEY="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa05"

# ── Dev BIP-39 mnemonics for Mill nodes — DEV ONLY, NOT FOR PRODUCTION ────────
# Mill containers require a mnemonic for BIP-32 swap key derivation (AC-1/21.11).
# Using BIP-39 test vectors 0 and 1 respectively; known derivation paths give
# deterministic pubkeys that match the connector peer config.
export MILL_01_MNEMONIC="abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"
export MILL_02_MNEMONIC="legal winner thank year wave sausage worth useful legal winner thank yellow"

# ── cmd_up ────────────────────────────────────────────────────────────────────
cmd_up() {
  log_info "Starting Townhouse dev infrastructure..."

  # TURBO_TOKEN warning (non-fatal)
  if [ -z "${TURBO_TOKEN:-}" ]; then
    log_warning "TURBO_TOKEN unset — DVM will boot in disabled-upload mode"
    log_warning "  Set TURBO_TOKEN in your shell if developing DVM-related views (story 21.12)"
  fi

  # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  # Stage 1: Build local images
  # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  log_info "Stage 1: Building local images (Docker cache applies)..."

  log_info "Building toon:town..."
  DOCKER_BUILDKIT=1 docker build \
    -f "$REPO_ROOT/docker/Dockerfile.town" \
    -t toon:town \
    "$REPO_ROOT"
  log_success "toon:town built"

  log_info "Building toon:mill..."
  DOCKER_BUILDKIT=1 docker build \
    -f "$REPO_ROOT/docker/Dockerfile.mill" \
    -t toon:mill \
    "$REPO_ROOT"
  log_success "toon:mill built"

  log_info "Building toon:dvm..."
  DOCKER_BUILDKIT=1 docker build \
    -f "$REPO_ROOT/docker/Dockerfile.dvm" \
    -t toon:dvm \
    "$REPO_ROOT"
  log_success "toon:dvm built"

  # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  # Stage 2: Chain devnets + contract deploys
  # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  log_info "Stage 2: Starting chain devnets..."
  docker compose -p "$PROJECT_NAME" -f "$REPO_ROOT/$COMPOSE_FILE" \
    up -d townhouse-dev-anvil townhouse-dev-solana townhouse-dev-mina townhouse-dev-socks5
  log_success "Chain devnet containers started"

  # Wait for Anvil
  log_info "Waiting for Anvil JSON-RPC..."
  local anvil_ready=false
  for i in $(seq 1 30); do
    if curl -sf -X POST http://localhost:28545 \
      -H 'Content-Type: application/json' \
      -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' > /dev/null 2>&1; then
      anvil_ready=true
      break
    fi
    sleep 2
  done
  if $anvil_ready; then
    log_success "Anvil JSON-RPC is ready"
  else
    log_error "Anvil JSON-RPC not responding after 60s"
  fi

  # Deploy Mock USDC (reuse existing script)
  # NOTE: The Anvil compose entrypoint also deploys USDC via DeployLocal.s.sol.
  # This call is a redundant fallback; deploy-mock-usdc.sh reads RPC_URL.
  local usdc_address=""
  if [ -f "$REPO_ROOT/scripts/deploy-mock-usdc.sh" ]; then
    log_info "Deploying Mock USDC to Anvil..."
    local usdc_output
    usdc_output=$(RPC_URL="http://localhost:28545" \
      bash "$REPO_ROOT/scripts/deploy-mock-usdc.sh" 2>/dev/null) || true
    # Last line printed by deploy-mock-usdc.sh is: "  TOON_USDC_ADDRESS=0x..."
    local captured
    captured=$(echo "$usdc_output" | grep 'TOON_USDC_ADDRESS=' | tail -n1 | sed 's/.*TOON_USDC_ADDRESS=//' | tr -d '[:space:]')
    if echo "$captured" | grep -qE '^0x[0-9a-fA-F]{40}$'; then
      usdc_address="$captured"
      log_success "Mock USDC deployed at $usdc_address"
    else
      log_warning "Mock USDC address capture failed (non-fatal — wallet USDC balance will show unavailable)"
    fi
  else
    log_warning "scripts/deploy-mock-usdc.sh not found — skipping Mock USDC deploy"
  fi
  export TOON_USDC_ADDRESS="${usdc_address}"

  # Wait for Solana
  wait_for_health "http://localhost:28899/health" "Solana validator" 30

  # Derive Solana program ID from vendored keypair
  local solana_program_id=""
  if [ -f "$REPO_ROOT/contracts/solana/payment_channel-keypair.json" ]; then
    solana_program_id=$(cd "$REPO_ROOT" && node --input-type=module -e "
      import { readFileSync } from 'fs';
      const kp = JSON.parse(readFileSync('contracts/solana/payment_channel-keypair.json', 'utf8'));
      const pubkey = Uint8Array.from(kp.slice(32, 64));
      const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
      function toBase58(bytes) {
        let num = BigInt(0);
        for (const b of bytes) num = num * 256n + BigInt(b);
        let result = '';
        while (num > 0n) { result = ALPHABET[Number(num % 58n)] + result; num = num / 58n; }
        for (const b of bytes) { if (b === 0) result = '1' + result; else break; }
        return result;
      }
      console.log(toBase58(pubkey));
    " 2>/dev/null) || true
    if [ -n "$solana_program_id" ]; then
      log_success "Solana program ID: $solana_program_id"
    else
      log_warning "Could not derive Solana program ID from keypair"
    fi
  fi
  export SOLANA_PROGRAM_ID="${solana_program_id}"

  # Mina lightnet — wait for accounts manager (non-fatal if unavailable)
  log_info "Waiting for Mina lightnet accounts manager..."
  local mina_accounts_ready=false
  local mina_zkapp_address=""
  for i in $(seq 1 30); do
    if curl -sf http://localhost:28181/list-acquired-accounts > /dev/null 2>&1; then
      mina_accounts_ready=true
      break
    fi
    sleep 2
  done
  if $mina_accounts_ready; then
    log_success "Mina lightnet accounts manager is ready"
    log_info "Deploying Mina Payment Channel zkApp..."
    # Pipe through `tail -n1` so any progress log / dotenv banner / npx warning
    # emitted before the address line cannot end up in .env.townhouse-dev.
    mina_zkapp_address=$(cd "$REPO_ROOT" && \
      MINA_GRAPHQL_URL="http://localhost:28085/graphql" \
      MINA_ACCOUNTS_URL="http://localhost:28181" \
      npx tsx scripts/deploy-mina-zkapp.ts 2>/dev/null | tail -n1) || true
    if [ -n "$mina_zkapp_address" ]; then
      log_success "Mina zkApp deployed: $mina_zkapp_address"
    else
      log_warning "Mina zkApp deployment failed (non-fatal — Mina tests may fail)"
    fi
  else
    log_warning "Mina lightnet accounts manager not ready (non-fatal)"
  fi
  export MINA_ZKAPP_ADDRESS="${mina_zkapp_address}"

  # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  # Stage 3: Connector
  # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  log_info "Stage 3: Starting connector..."

  # CONNECTOR_PEERS is hard-coded in docker-compose-townhouse-dev.yml's
  # connector service env block (see line ~55). Both files must list the same
  # 5 child peers; bump them together when the topology changes.

  docker compose -p "$PROJECT_NAME" -f "$REPO_ROOT/$COMPOSE_FILE" \
    up -d townhouse-dev-connector
  log_success "Connector started"

  wait_for_health "http://localhost:28080/health" "Connector" 30

  # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  # Stage 4: Child nodes (5 nodes with deterministic Nostr keys)
  # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  log_info "Stage 4: Deriving Nostr pubkeys for child nodes..."

  local town01_pubkey town02_pubkey mill01_pubkey mill02_pubkey dvm01_pubkey
  town01_pubkey=$(derive_nostr_pubkey "$TOWN_01_SECRET_KEY")
  town02_pubkey=$(derive_nostr_pubkey "$TOWN_02_SECRET_KEY")
  mill01_pubkey=$(derive_nostr_pubkey "$MILL_01_SECRET_KEY")
  mill02_pubkey=$(derive_nostr_pubkey "$MILL_02_SECRET_KEY")
  dvm01_pubkey=$(derive_nostr_pubkey "$DVM_01_SECRET_KEY")

  [ -n "$town01_pubkey" ] && log_info "town-01 pubkey: ${town01_pubkey:0:16}..."
  [ -n "$town02_pubkey" ] && log_info "town-02 pubkey: ${town02_pubkey:0:16}..."
  [ -n "$mill01_pubkey" ] && log_info "mill-01 pubkey: ${mill01_pubkey:0:16}..."
  [ -n "$mill02_pubkey" ] && log_info "mill-02 pubkey: ${mill02_pubkey:0:16}..."
  [ -n "$dvm01_pubkey"  ] && log_info "dvm-01  pubkey: ${dvm01_pubkey:0:16}..."

  log_info "Starting child nodes..."
  # Per-service NODE_NOSTR_SECRET_KEY is interpolated by compose from the
  # exported TOWN_01_SECRET_KEY / TOWN_02_SECRET_KEY / MILL_01_SECRET_KEY /
  # MILL_02_SECRET_KEY / DVM_01_SECRET_KEY env vars (see top of file).
  docker compose -p "$PROJECT_NAME" -f "$REPO_ROOT/$COMPOSE_FILE" \
    up -d \
      townhouse-dev-town-01 \
      townhouse-dev-town-02 \
      townhouse-dev-mill-01 \
      townhouse-dev-mill-02 \
      townhouse-dev-dvm-01

  log_success "Child node containers started"

  # Poll each child health endpoint (30 attempts × 2s = 60s timeout per node)
  log_info "Waiting for child nodes to become healthy..."
  wait_for_health "http://localhost:28100/health" "town-01" 30 || exit 1
  wait_for_health "http://localhost:28110/health" "town-02" 30 || exit 1
  wait_for_health "http://localhost:28200/health" "mill-01" 30 || exit 1
  wait_for_health "http://localhost:28210/health" "mill-02" 30 || exit 1
  wait_for_health "http://localhost:28400/health" "dvm-01"  30 || exit 1

  # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  # Write .env.townhouse-dev for host-side consumption
  # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  cat > "$REPO_ROOT/.env.townhouse-dev" <<EOF
# Townhouse Dev Stack — host-side env (generated by townhouse-dev-infra.sh up)
# Read by Fastify API on `pnpm dev:docker` (story 21.8.5). DO NOT commit.

# Connector
TOWNHOUSE_CONNECTOR_ADMIN_URL=http://127.0.0.1:28080

# Town nodes
TOWNHOUSE_DEV_TOWN_01_RELAY=ws://127.0.0.1:28700
TOWNHOUSE_DEV_TOWN_01_HEALTH=http://127.0.0.1:28100
TOWNHOUSE_DEV_TOWN_02_RELAY=ws://127.0.0.1:28710
TOWNHOUSE_DEV_TOWN_02_HEALTH=http://127.0.0.1:28110

# Mill nodes
TOWNHOUSE_DEV_MILL_01_HEALTH=http://127.0.0.1:28200
TOWNHOUSE_DEV_MILL_02_HEALTH=http://127.0.0.1:28210

# DVM nodes
TOWNHOUSE_DEV_DVM_01_HEALTH=http://127.0.0.1:28400

# Chain devnets
TOWNHOUSE_DEV_ANVIL_RPC=http://127.0.0.1:28545
TOWNHOUSE_DEV_SOLANA_RPC=http://127.0.0.1:28899
TOWNHOUSE_DEV_MINA_GRAPHQL=http://127.0.0.1:28085/graphql
TOWNHOUSE_DEV_MINA_ACCOUNTS=http://127.0.0.1:28181

# SOCKS5 proxy (for ATOR transport testing, story 21.15)
TOWNHOUSE_DEV_SOCKS5=socks5://127.0.0.1:28050

# Chain contract addresses
SOLANA_PROGRAM_ID=${solana_program_id}
MINA_ZKAPP_ADDRESS=${mina_zkapp_address}
TOON_USDC_ADDRESS=${usdc_address}

# Dev wallet — BIP-39 test-vector-zero phrase; PUBLICLY KNOWN — DEV ONLY
# Used by the dev API loop (api-server.mjs) to auto-initialize WalletManager
# without requiring `townhouse init`. NEVER set this in production.
TOWNHOUSE_DEV_WALLET_MNEMONIC='abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

# Node pubkeys (derived from deterministic dev keys — DEV ONLY)
TOWNHOUSE_DEV_TOWN_01_PUBKEY=${town01_pubkey}
TOWNHOUSE_DEV_TOWN_02_PUBKEY=${town02_pubkey}
TOWNHOUSE_DEV_MILL_01_PUBKEY=${mill01_pubkey}
TOWNHOUSE_DEV_MILL_02_PUBKEY=${mill02_pubkey}
TOWNHOUSE_DEV_DVM_01_PUBKEY=${dvm01_pubkey}
EOF
  log_success ".env.townhouse-dev written"

  # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  # Success banner
  # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  echo ""
  echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${GREEN}  Townhouse Dev Stack Ready${NC}"
  echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo ""
  echo "  Connector"
  echo "    Admin:           http://127.0.0.1:28080"
  echo ""
  echo "  Town nodes"
  echo "    town-01 relay:   ws://127.0.0.1:28700"
  echo "    town-01 health:  http://127.0.0.1:28100"
  echo "    town-02 relay:   ws://127.0.0.1:28710"
  echo "    town-02 health:  http://127.0.0.1:28110"
  echo ""
  echo "  Mill nodes"
  echo "    mill-01 health:  http://127.0.0.1:28200  (EVM↔Solana)"
  echo "    mill-02 health:  http://127.0.0.1:28210  (EVM↔Mina)"
  echo ""
  echo "  DVM nodes"
  echo "    dvm-01 health:   http://127.0.0.1:28400"
  echo ""
  echo "  Chain devnets"
  echo "    Anvil (EVM):     http://127.0.0.1:28545"
  echo "    Solana RPC:      http://127.0.0.1:28899"
  echo "    Mina GraphQL:    http://127.0.0.1:28085"
  echo "    Mina Accounts:   http://127.0.0.1:28181"
  echo ""
  echo "  SOCKS5 proxy:      socks5://127.0.0.1:28050"
  echo ""
  if [ -n "$solana_program_id" ]; then
    echo "  Solana Program ID: $solana_program_id"
  fi
  if [ -n "$mina_zkapp_address" ]; then
    echo "  Mina zkApp:        $mina_zkapp_address"
  fi
  if [ -n "$usdc_address" ]; then
    echo "  Mock USDC:         $usdc_address"
  fi
  echo ""
  echo "  Smoke test: pnpm --filter @toon-protocol/townhouse test:integration -- dev-stack-smoke"
  echo "  Dashboard:  pnpm --filter @toon-protocol/townhouse-web dev:docker  (story 21.8.5)"
  echo ""
}

# ── cmd_down ──────────────────────────────────────────────────────────────────
cmd_down() {
  log_info "Stopping Townhouse dev infrastructure..."
  docker compose -p "$PROJECT_NAME" -f "$REPO_ROOT/$COMPOSE_FILE" down
  rm -f "$REPO_ROOT/.env.townhouse-dev"
  log_success "Stopped"
}

# ── cmd_down_v ────────────────────────────────────────────────────────────────
cmd_down_v() {
  log_info "Stopping Townhouse dev infrastructure and removing volumes..."
  docker compose -p "$PROJECT_NAME" -f "$REPO_ROOT/$COMPOSE_FILE" down -v
  rm -f "$REPO_ROOT/.env.townhouse-dev"
  log_success "Stopped and volumes removed"
}

# ── cmd_status ────────────────────────────────────────────────────────────────
cmd_status() {
  log_info "Townhouse dev stack status:"
  docker compose -p "$PROJECT_NAME" -f "$REPO_ROOT/$COMPOSE_FILE" ps

  echo ""
  log_info "Health summary:"
  for name_port in \
    "connector:28080" \
    "town-01:28100" \
    "town-02:28110" \
    "mill-01:28200" \
    "mill-02:28210" \
    "dvm-01:28400"; do
    local name="${name_port%%:*}"
    local port="${name_port##*:}"
    if curl -sf "http://127.0.0.1:${port}/health" > /dev/null 2>&1; then
      echo -e "  ${GREEN}✓${NC} $name (port $port)"
    else
      echo -e "  ${RED}✗${NC} $name (port $port) — not responding"
    fi
  done
}

# ── Dispatch ──────────────────────────────────────────────────────────────────
case "${1:-}" in
  up)
    cmd_up
    ;;
  down)
    cmd_down
    ;;
  down-v)
    cmd_down_v
    ;;
  status)
    cmd_status
    ;;
  *)
    echo "Usage: $0 {up|down|down-v|status}"
    exit 1
    ;;
esac
