#!/usr/bin/env bash
# SDK E2E Infrastructure — Start/Stop (Multi-Chain)
#
# Starts EVM (Anvil) + Solana (test-validator) + Mina (lightnet) devnets,
# two TOON peers with NIP-59 privacy wrapping enabled.
#
# Usage:
#   ./scripts/sdk-e2e-infra.sh up      # Build, start, wait for health
#   ./scripts/sdk-e2e-infra.sh down     # Stop containers
#   ./scripts/sdk-e2e-infra.sh down-v   # Stop and remove volumes

set -e

COMPOSE_FILE="docker-compose-sdk-e2e.yml"
PROJECT_NAME="toon-sdk-e2e"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info()    { echo -e "${BLUE}[info]${NC} $1"; }
log_success() { echo -e "${GREEN}[ok]${NC} $1"; }
log_warning() { echo -e "${YELLOW}[warn]${NC} $1"; }
log_error()   { echo -e "${RED}[error]${NC} $1"; }

# Derive Nostr pubkey from a secret key hex string
derive_nostr_pubkey() {
  local secret_key="$1"
  local pubkey
  pubkey=$(cd "$REPO_ROOT" && node -e "
    const { getPublicKey } = require('nostr-tools/pure');
    const sk = Uint8Array.from(Buffer.from('${secret_key}', 'hex'));
    console.log(getPublicKey(sk));
  " 2>/dev/null) || true

  if [ -z "$pubkey" ]; then
    # Fallback: try ESM import
    pubkey=$(cd "$REPO_ROOT" && node --input-type=module -e "
      import { getPublicKey } from 'nostr-tools/pure';
      const sk = Uint8Array.from(Buffer.from('${secret_key}', 'hex'));
      console.log(getPublicKey(sk));
    " 2>/dev/null) || true
  fi

  echo "$pubkey"
}

# Deterministic Nostr secret keys (must match docker-compose-sdk-e2e.yml)
PEER1_SECRET_KEY="a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2"
PEER2_SECRET_KEY="b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3"

# Legacy alias for backward compatibility
derive_peer1_pubkey() {
  derive_nostr_pubkey "$PEER1_SECRET_KEY"
}

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

cmd_up() {
  log_info "Starting SDK E2E infrastructure..."

  # Build the Docker image
  log_info "Building toon:optimized image..."
  docker build -f "$REPO_ROOT/docker/Dockerfile.oyster" -t toon:optimized "$REPO_ROOT"
  log_success "Docker image built"

  # Derive pubkeys for bootstrap and NIP-59 config
  local peer1_pubkey peer2_pubkey
  peer1_pubkey=$(derive_nostr_pubkey "$PEER1_SECRET_KEY")
  peer2_pubkey=$(derive_nostr_pubkey "$PEER2_SECRET_KEY")

  if [ -n "$peer1_pubkey" ]; then
    log_info "Peer1 pubkey: ${peer1_pubkey:0:16}..."
    export PEER2_BOOTSTRAP_PEERS="[{\"pubkey\":\"$peer1_pubkey\",\"relayUrl\":\"ws://peer1:7100\",\"btpEndpoint\":\"ws://peer1:3000\"}]"
  else
    log_warning "Could not derive peer1 pubkey — peer2 will have no bootstrap peers"
    export PEER2_BOOTSTRAP_PEERS="[]"
  fi

  if [ -n "$peer2_pubkey" ]; then
    log_info "Peer2 pubkey: ${peer2_pubkey:0:16}..."
  fi

  # NIP-59 peer pubkey exchange: each peer gets the OTHER peer's pubkey
  if [ -n "$peer2_pubkey" ]; then
    export PEER1_NIP59_PEER_PUBKEYS="$peer2_pubkey"
  fi
  if [ -n "$peer1_pubkey" ]; then
    export PEER2_NIP59_PEER_PUBKEYS="$peer1_pubkey"
  fi

  # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  # Stage 1: Start chain services only (need their outputs for peer env vars)
  # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  log_info "Stage 1: Starting chain services..."
  docker compose -p "$PROJECT_NAME" -f "$REPO_ROOT/$COMPOSE_FILE" up -d anvil solana-validator mina-lightnet
  log_success "Chain services started"

  # Wait for Anvil
  log_info "Waiting for chain devnets to become healthy..."
  wait_for_health "http://localhost:18545" "Anvil" 30 || true

  local anvil_ready=false
  for i in $(seq 1 30); do
    if curl -sf -X POST http://localhost:18545 \
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
    log_error "Anvil JSON-RPC not responding"
  fi

  # Wait for Solana and capture program ID
  wait_for_health "http://localhost:19899/health" "Solana validator" 30

  # Derive Solana program ID from vendored keypair (deterministic)
  local solana_program_id=""
  if [ -f "$REPO_ROOT/contracts/solana/payment_channel-keypair.json" ]; then
    solana_program_id=$(cd "$REPO_ROOT" && node --input-type=module -e "
      import { readFileSync } from 'fs';
      import { bs58 } from '@noble/curves/ed25519';
      // Keypair JSON is a 64-byte array: [secret(32) + public(32)]
      const kp = JSON.parse(readFileSync('contracts/solana/payment_channel-keypair.json', 'utf8'));
      const pubkey = Uint8Array.from(kp.slice(32, 64));
      // Base58 encode the public key to get program ID
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
  else
    log_warning "No Solana keypair found — program ID unknown"
  fi
  export SOLANA_PROGRAM_ID="${solana_program_id}"

  # Wait for Mina lightnet sync (takes 1-3 minutes)
  log_info "Waiting for Mina lightnet to sync (may take up to 3 minutes)..."
  local mina_ready=false
  local mina_zkapp_address=""
  for i in $(seq 1 90); do
    if curl -sf http://localhost:19181/list-acquired-accounts > /dev/null 2>&1; then
      if curl -sf -X POST -H 'Content-Type: application/json' \
        -d '{"query":"{syncStatus}"}' \
        http://localhost:19085/graphql 2>/dev/null | grep -q 'SYNCED'; then
        mina_ready=true
        break
      fi
    fi
    sleep 2
  done
  if $mina_ready; then
    log_success "Mina lightnet is synced"
    # Deploy Mina zkApp
    log_info "Deploying Mina Payment Channel zkApp..."
    mina_zkapp_address=$(cd "$REPO_ROOT" && \
      MINA_GRAPHQL_URL="http://localhost:19085/graphql" \
      MINA_ACCOUNTS_URL="http://localhost:19181" \
      npx tsx scripts/deploy-mina-zkapp.ts 2>/dev/null) || true
    if [ -n "$mina_zkapp_address" ]; then
      log_success "Mina zkApp deployed: $mina_zkapp_address"
    else
      log_warning "Mina zkApp deployment failed (non-fatal — Mina tests may fail)"
    fi
  else
    log_warning "Mina lightnet not synced after 3 minutes (non-fatal — Mina tests may fail)"
  fi
  export MINA_ZKAPP_ADDRESS="${mina_zkapp_address}"

  # Placeholder env vars for Solana/Mina settlement accounts on peers
  # Peers use their own settlement keys; these are the token/program addresses
  export SOLANA_TOKEN_MINT="${SOLANA_TOKEN_MINT:-So11111111111111111111111111111111111111112}"
  export PEER1_SOLANA_TOKEN_ACCOUNT="${PEER1_SOLANA_TOKEN_ACCOUNT:-}"
  export PEER2_SOLANA_TOKEN_ACCOUNT="${PEER2_SOLANA_TOKEN_ACCOUNT:-}"
  export PEER1_MINA_ACCOUNT="${PEER1_MINA_ACCOUNT:-}"
  export PEER2_MINA_ACCOUNT="${PEER2_MINA_ACCOUNT:-}"

  # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  # Stage 2: Start peers (env vars now resolved)
  # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  log_info "Stage 2: Starting TOON peers with multi-chain config..."
  docker compose -p "$PROJECT_NAME" -f "$REPO_ROOT/$COMPOSE_FILE" up -d peer1 peer2
  log_success "Peer containers started"

  # Wait for TOON peers
  log_info "Waiting for TOON peers..."
  wait_for_health "http://localhost:19100/health" "Peer1 BLS" 60
  wait_for_health "http://localhost:19110/health" "Peer2 BLS" 60

  # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  # Banner
  # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  echo ""
  echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${GREEN}  TOON Devnet Ready (EVM + Solana + Mina)${NC}"
  echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo ""
  echo "  EVM (Anvil):       http://localhost:18545"
  echo "  Solana RPC:        http://localhost:19899"
  echo "  Mina GraphQL:      http://localhost:19085"
  echo "  Mina Accounts:     http://localhost:19181"
  echo ""
  echo "  Peer1 Relay:       ws://localhost:19700"
  echo "  Peer1 BLS:         http://localhost:19100"
  echo "  Peer2 Relay:       ws://localhost:19710"
  echo "  Peer2 BLS:         http://localhost:19110"
  echo ""
  if [ -n "$solana_program_id" ]; then
    echo "  Solana Program ID: $solana_program_id"
  fi
  if [ -n "$mina_zkapp_address" ]; then
    echo "  Mina zkApp:        $mina_zkapp_address"
  fi
  echo "  NIP-59:            enabled (privacy wrapping)"
  echo ""
  echo "  Dogfood: cd examples/client-example && pnpm run example:03"
  echo "  Tests:   cd packages/sdk && pnpm test:e2e:docker"
  echo ""
}

cmd_down() {
  log_info "Stopping SDK E2E infrastructure..."
  docker compose -p "$PROJECT_NAME" -f "$REPO_ROOT/$COMPOSE_FILE" down
  log_success "Stopped"
}

cmd_down_v() {
  log_info "Stopping SDK E2E infrastructure and removing volumes..."
  docker compose -p "$PROJECT_NAME" -f "$REPO_ROOT/$COMPOSE_FILE" down -v
  log_success "Stopped and volumes removed"
}

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
  *)
    echo "Usage: $0 {up|down|down-v}"
    exit 1
    ;;
esac
