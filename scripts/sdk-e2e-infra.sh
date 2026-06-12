#!/usr/bin/env bash
# SDK E2E Infrastructure — Start/Stop (Multi-Chain)
#
# Starts EVM (Anvil) + Solana (test-validator) + Mina (lightnet) devnets,
# two TOON peers with NIP-59 privacy wrapping enabled.
#
# Usage:
#   ./scripts/sdk-e2e-infra.sh up         # Build, start LOCAL chains + peers, wait for health
#   ./scripts/sdk-e2e-infra.sh --public   # PUBLIC mode: skip local chains; point peers
#                                          #   at live testnets (Base Sepolia / Solana
#                                          #   devnet / Mina devnet) from e2e/testnets.json,
#                                          #   with per-peer keys derived from E2E_DEV_MNEMONIC.
#   ./scripts/sdk-e2e-infra.sh --public --fund   # ...also fund idx0/idx1 from treasury (#182/#187)
#   ./scripts/sdk-e2e-infra.sh down        # Stop containers
#   ./scripts/sdk-e2e-infra.sh down-v      # Stop and remove volumes
#
# PUBLIC-mode prerequisites (offline gate cannot run these):
#   • E2E_DEV_MNEMONIC set (env in CI, .env.e2e.local locally).
#   • e2e/testnets.json fully populated (no null addresses) — the harness refuses
#     to start otherwise.
#   • Peers (idx0/idx1) funded on all three testnets — either pass --fund (calls
#     scripts/fund-e2e-peers.mjs, #182/#187) or fund manually beforehand.
#   • The pinned Mina zkApp MUST be the BARE-deployed one (MINA_SKIP_INIT=1) and
#     client-opened (#185/#186). Public mode NEVER re-deploys Mina — it only
#     consumes mina.zkAppAddress from testnets.json.

set -e

COMPOSE_FILE="docker-compose-sdk-e2e.yml"
COMPOSE_PUBLIC_OVERRIDE="docker-compose-sdk-e2e.public.yml"
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
  log_info "Building toon:sdk-e2e image..."
  DOCKER_BUILDKIT=1 docker build \
    -f "$REPO_ROOT/docker/Dockerfile.sdk-e2e" \
    -t toon:sdk-e2e \
    "$REPO_ROOT"
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

  # Wait for Mina lightnet accounts manager only (connector-style — no sync wait)
  log_info "Waiting for Mina lightnet accounts manager..."
  local mina_accounts_ready=false
  local mina_zkapp_address=""
  for i in $(seq 1 30); do
    if curl -sf http://localhost:19181/list-acquired-accounts > /dev/null 2>&1; then
      mina_accounts_ready=true
      break
    fi
    sleep 2
  done
  if $mina_accounts_ready; then
    log_success "Mina lightnet accounts manager is ready"
    # Deploy the zkApp. The deploy script (scripts/deploy-mina-zkapp.ts) now
    # gates on the deployer account being funded/queryable on-chain before it
    # builds the tx (issue #173) — so we no longer need a separate sync wait
    # here. Only STDOUT carries the zkApp address; STDERR (diagnostics + any
    # failure) is intentionally NOT swallowed (was `2>/dev/null`, which hid the
    # real "Could not find account" cause) so the operator/CI can diagnose a
    # failed deploy. The step stays NON-FATAL: if it fails, MINA_ZKAPP_ADDRESS
    # is empty and the Mina settlement E2E skips rather than aborting bring-up.
    log_info "Deploying Mina Payment Channel zkApp..."
    mina_zkapp_address=$(cd "$REPO_ROOT" && \
      MINA_GRAPHQL_URL="http://localhost:19085/graphql" \
      MINA_ACCOUNTS_URL="http://localhost:19181" \
      npx tsx scripts/deploy-mina-zkapp.ts) || true
    if [ -n "$mina_zkapp_address" ]; then
      log_success "Mina zkApp deployed: $mina_zkapp_address"
    else
      log_warning "Mina zkApp deployment failed (non-fatal — Mina tests may skip; see stderr above)"
    fi
  else
    log_warning "Mina lightnet accounts manager not ready (non-fatal — Mina tests may fail)"
  fi
  export MINA_ZKAPP_ADDRESS="${mina_zkapp_address}"

  # Persist discovered env vars for host-side test consumption
  cat > "$REPO_ROOT/.env.sdk-e2e" <<EOF
SOLANA_PROGRAM_ID=${solana_program_id}
MINA_ZKAPP_ADDRESS=${mina_zkapp_address}
EOF

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

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# PUBLIC mode — point peers at live public testnets (no local chains).
# Additive to local mode; local `up` behaviour is untouched.
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
cmd_up_public() {
  local do_fund="${1:-false}"
  log_info "Starting SDK E2E infrastructure (PUBLIC testnet mode)..."

  # ----- Preconditions -----
  if [ -z "${E2E_DEV_MNEMONIC:-}" ] && ! grep -q '^[[:space:]]*E2E_DEV_MNEMONIC[[:space:]]*=' "$REPO_ROOT/.env.e2e.local" 2>/dev/null; then
    log_error "E2E_DEV_MNEMONIC not set (env) and not found in .env.e2e.local."
    log_error "See docs/e2e-testnets.md to bootstrap the dev wallet."
    exit 1
  fi
  if [ ! -f "$REPO_ROOT/packages/sdk/dist/index.js" ]; then
    log_error "SDK not built. Run: pnpm --filter @toon-protocol/sdk build"
    exit 1
  fi

  # Guard against chain-id drift: public mode is pinned to Base Sepolia (84532),
  # which the compose override hardcodes in its *_EVM_BASE_84532 env keys.
  local evm_chain_id
  evm_chain_id=$(node -e "console.log(require('$REPO_ROOT/e2e/testnets.json').evm.chainId)" 2>/dev/null || true)
  if [ "$evm_chain_id" != "eip155:84532" ]; then
    log_error "e2e/testnets.json evm.chainId is '$evm_chain_id', expected 'eip155:84532'."
    log_error "The public compose override hardcodes the 84532 chain-id suffix; update both together."
    exit 1
  fi

  # ----- Derive per-peer config from the seed + testnets.json -----
  # e2e-derive-peer-config.mjs validates testnets.json has no null addresses and
  # REFUSES (non-zero) otherwise. Keys live in env only — never written to disk.
  log_info "Deriving per-peer settlement config (idx0=peer1, idx1=peer2)..."
  local derived_env
  if ! derived_env=$(cd "$REPO_ROOT" && node scripts/e2e-derive-peer-config.mjs 2>/tmp/e2e-derive.err); then
    cat /tmp/e2e-derive.err >&2 || true
    log_error "Failed to derive peer config (see error above)."
    exit 1
  fi
  # Export every derived KEY=value line into the environment for compose + tests.
  set -a
  eval "$derived_env"
  # The BASE compose still references the bare (local-mode) substitution names
  # SOLANA_PROGRAM_ID / SOLANA_TOKEN_MINT / MINA_ZKAPP_ADDRESS for the chain
  # services and any non-overridden peer keys. The public override wins for the
  # peers (it uses the E2E_* names), but exporting these bare aliases too keeps
  # the rendered config free of "variable is not set" warnings.
  SOLANA_PROGRAM_ID="$E2E_SOLANA_PROGRAM_ID"
  SOLANA_TOKEN_MINT="$E2E_SOLANA_TOKEN_MINT"
  MINA_ZKAPP_ADDRESS="$E2E_MINA_ZKAPP_ADDRESS"
  set +a
  log_success "Derived peer config (EVM suffix: ${E2E_EVM_CHAIN_SUFFIX})"
  log_info "  peer1 EVM: ${PEER1_EVM_ADDRESS} | Solana ATA: ${PEER1_SOLANA_TOKEN_ACCOUNT}"
  log_info "  peer2 EVM: ${PEER2_EVM_ADDRESS} | Solana ATA: ${PEER2_SOLANA_TOKEN_ACCOUNT}"

  # ----- Optional: fund the peers (idx0/idx1) from the treasury (idx2) -----
  if [ "$do_fund" = "true" ]; then
    if [ -f "$REPO_ROOT/scripts/fund-e2e-peers.mjs" ]; then
      log_info "Funding peers (idx0/idx1) from treasury (idx2) via fund-e2e-peers.mjs..."
      (cd "$REPO_ROOT" && node scripts/fund-e2e-peers.mjs --chains evm,solana,mina) \
        || log_warning "Funding step failed (non-fatal) — peers may be underfunded."
    else
      log_warning "--fund requested but scripts/fund-e2e-peers.mjs not present yet (#182/#187)."
      log_warning "Fund idx0/idx1 manually before running paid flows. Continuing."
    fi
  else
    log_warning "Skipping funding. Peers MUST already be funded on all testnets (#182/#187)."
  fi

  # ----- NIP-59 / bootstrap pubkey exchange (same as local mode) -----
  local peer1_pubkey peer2_pubkey
  peer1_pubkey=$(derive_nostr_pubkey "$PEER1_SECRET_KEY")
  peer2_pubkey=$(derive_nostr_pubkey "$PEER2_SECRET_KEY")
  if [ -n "$peer1_pubkey" ]; then
    export PEER2_BOOTSTRAP_PEERS="[{\"pubkey\":\"$peer1_pubkey\",\"relayUrl\":\"ws://peer1:7100\",\"btpEndpoint\":\"ws://peer1:3000\"}]"
    export PEER2_NIP59_PEER_PUBKEYS="$peer1_pubkey"
  else
    export PEER2_BOOTSTRAP_PEERS="[]"
  fi
  if [ -n "$peer2_pubkey" ]; then
    export PEER1_NIP59_PEER_PUBKEYS="$peer2_pubkey"
  fi

  # ----- Persist endpoints/addresses for host-side test consumption -----
  # The SDK e2e helper (packages/sdk/tests/e2e/helpers/docker-e2e-setup.ts) reads
  # these from .env.sdk-e2e (process.env wins). The EVM_* values override its
  # Anvil defaults so the host-side client points at Base Sepolia, mirroring the
  # SOLANA_PROGRAM_ID / MINA_ZKAPP_ADDRESS path. EVM_CLIENT_*/EVM_SETTLEMENT_* are
  # the funded idx3/idx4/idx5 test-actor keys — ephemeral testnet keys derived
  # from E2E_DEV_MNEMONIC. .env.sdk-e2e is gitignored and removed on `down`.
  cat > "$REPO_ROOT/.env.sdk-e2e" <<EOF
SOLANA_PROGRAM_ID=${E2E_SOLANA_PROGRAM_ID}
MINA_ZKAPP_ADDRESS=${E2E_MINA_ZKAPP_ADDRESS}
SOLANA_RPC_URL=${E2E_SOLANA_RPC_URL}
MINA_GRAPHQL_URL=${E2E_MINA_GRAPHQL_URL}
EVM_RPC_URL=${E2E_EVM_RPC_URL}
EVM_CHAIN_ID=84532
EVM_REGISTRY_ADDRESS=${E2E_EVM_REGISTRY_ADDRESS}
EVM_TOKEN_ADDRESS=${E2E_EVM_TOKEN_ADDRESS}
EVM_TOKEN_NETWORK_ADDRESS=${E2E_EVM_TOKEN_NETWORK_ADDRESS}
EVM_CLIENT_PRIVATE_KEY=${E2E_EVM_CLIENT_PRIVATE_KEY}
EVM_CLIENT_ADDRESS=${E2E_EVM_CLIENT_ADDRESS}
EVM_SETTLEMENT_PRIVATE_KEY_A=${E2E_EVM_SETTLEMENT_PRIVATE_KEY_A}
EVM_SETTLEMENT_PRIVATE_KEY_B=${E2E_EVM_SETTLEMENT_PRIVATE_KEY_B}
EOF

  # ----- Build image (same as local mode) -----
  log_info "Building toon:sdk-e2e image..."
  DOCKER_BUILDKIT=1 docker build \
    -f "$REPO_ROOT/docker/Dockerfile.sdk-e2e" \
    -t toon:sdk-e2e \
    "$REPO_ROOT"
  log_success "Docker image built"

  # ----- Start ONLY the peers (no chain services) with the override layered on -----
  # --no-deps is REQUIRED: a compose override cannot delete the base file's
  # `depends_on` map (it merges), so without --no-deps `up peer1 peer2` would
  # still try to boot anvil/solana-validator/mina-lightnet. --no-deps skips them.
  log_info "Starting TOON peers against public testnets (no local chain deps)..."
  docker compose -p "$PROJECT_NAME" \
    -f "$REPO_ROOT/$COMPOSE_FILE" \
    -f "$REPO_ROOT/$COMPOSE_PUBLIC_OVERRIDE" \
    up -d --no-deps peer1 peer2
  log_success "Peer containers started"

  log_info "Waiting for TOON peers..."
  wait_for_health "http://localhost:19100/health" "Peer1 BLS" 60
  wait_for_health "http://localhost:19110/health" "Peer2 BLS" 60

  echo ""
  echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${GREEN}  TOON PUBLIC-TESTNET E2E Ready (Base Sepolia + Solana devnet + Mina devnet)${NC}"
  echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo ""
  echo "  EVM RPC:           ${E2E_EVM_RPC_URL} (eip155:84532)"
  echo "  Solana RPC:        ${E2E_SOLANA_RPC_URL}"
  echo "  Mina GraphQL:      ${E2E_MINA_GRAPHQL_URL}"
  echo ""
  echo "  Peer1 BLS:         http://localhost:19100   EVM ${PEER1_EVM_ADDRESS}"
  echo "  Peer2 BLS:         http://localhost:19110   EVM ${PEER2_EVM_ADDRESS}"
  echo ""
  echo "  Tests:   cd packages/sdk && pnpm test:e2e:docker"
  echo "           cd packages/mill && pnpm test:e2e:docker"
  echo ""
}

cmd_down() {
  log_info "Stopping SDK E2E infrastructure..."
  docker compose -p "$PROJECT_NAME" -f "$REPO_ROOT/$COMPOSE_FILE" down
  rm -f "$REPO_ROOT/.env.sdk-e2e"
  log_success "Stopped"
}

cmd_down_v() {
  log_info "Stopping SDK E2E infrastructure and removing volumes..."
  docker compose -p "$PROJECT_NAME" -f "$REPO_ROOT/$COMPOSE_FILE" down -v
  rm -f "$REPO_ROOT/.env.sdk-e2e"
  log_success "Stopped and volumes removed"
}

case "${1:-}" in
  up)
    cmd_up
    ;;
  --public|public)
    # Optional --fund flag (any position after the mode token).
    do_fund=false
    for arg in "${@:2}"; do
      [ "$arg" = "--fund" ] && do_fund=true
    done
    cmd_up_public "$do_fund"
    ;;
  down)
    cmd_down
    ;;
  down-v)
    cmd_down_v
    ;;
  *)
    echo "Usage: $0 {up|--public [--fund]|down|down-v}"
    exit 1
    ;;
esac
