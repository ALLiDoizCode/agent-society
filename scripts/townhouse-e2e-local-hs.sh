#!/usr/bin/env bash
# Local-Docker TOON Client ↔ Townhouse HS E2E (via public ATOR, Akash devnet chains)
#
# Brings up a local `townhouse hs up` apex + an isolated local Docker container
# running the 49.3 toon-client image. The two halves live on separate
# Docker networks (townhouse-hs-net + e2e-client-net) and can only reach each
# other through the public ATOR network via the pod's in-process anon SOCKS5.
#
# Akash chains (anvil + solana + faucet) remain consumed — but the unstable
# toon-client pod that bit Story 49.4 is replaced with a local container we
# control.
#
# Usage:
#   bash scripts/townhouse-e2e-local-hs.sh up           # bring up the whole stack
#   bash scripts/townhouse-e2e-local-hs.sh smoke        # drive one publish + show earnings
#   bash scripts/townhouse-e2e-local-hs.sh status       # show container + URL health
#   bash scripts/townhouse-e2e-local-hs.sh fund         # re-drip the apex + town signers
#   bash scripts/townhouse-e2e-local-hs.sh down         # stop containers
#   bash scripts/townhouse-e2e-local-hs.sh down-v       # stop containers + remove volumes + state
#
# Pair with the gated smoke test:
#   RUN_LOCAL_HS_E2E=1 \
#     pnpm --filter @toon-protocol/townhouse test:integration -- \
#       local-docker-hs-paid-earnings-smoke

set -euo pipefail

# ───────────────────────────────────────────────────────────────────────────────
# Constants
# ───────────────────────────────────────────────────────────────────────────────

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LEASES_PATH="${REPO_ROOT}/deploy/akash/leases.json"
COMPOSE_FILE="${REPO_ROOT}/docker-compose-e2e-local-client.yml"

# Townhouse apex config home — separate from operator's normal ~/.townhouse so
# this exploratory stack does not collide with a personal install.
TOWNHOUSE_HOME="${HOME}/.townhouse-e2e"
TEST_PASSWORD="${TOWNHOUSE_WALLET_PASSWORD:-integration-test}"

# Deterministic Anvil addresses. These are documented public dev keys (same
# posture as Foundry's `anvil` defaults). NEVER use on real chains.
APEX_EVM_ADDRESS="0x90F79bf6EB2c4f870365E785982E1f101E93b906"   # acct[3]
TOWN_EVM_ADDRESS="0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65"   # acct[4]

# Local URLs
CLIENT_URL="http://127.0.0.1:29200"
CONNECTOR_ADMIN_URL="http://127.0.0.1:9401"
TOWNHOUSE_API_URL="http://127.0.0.1:28090"

# Docker network names (must match the compose files)
HS_NETWORK="townhouse-hs-net"
CLIENT_NETWORK="e2e-client-net"
CLIENT_CONTAINER="toon-client-e2e"
# Image the compose file runs. `up --local` rebuilds this tag from the working
# tree (docker/Dockerfile.toon-client) instead of pulling the published :demo.
CLIENT_IMAGE="ghcr.io/toon-protocol/toon-client:demo"
LOCAL_BUILD="${LOCAL_BUILD:-0}"
HS_CONTAINERS=(
  townhouse-hs-connector
  townhouse-hs-api
  townhouse-hs-town
)

# Required for Akash provider self-signed certs (scoped to this script only).
export NODE_TLS_REJECT_UNAUTHORIZED=0

# ───────────────────────────────────────────────────────────────────────────────
# Logging helpers
# ───────────────────────────────────────────────────────────────────────────────

log()  { printf '\033[36m[e2e-local-hs]\033[0m %s\n' "$*" >&2; }
warn() { printf '\033[33m[e2e-local-hs WARN]\033[0m %s\n' "$*" >&2; }
err()  { printf '\033[31m[e2e-local-hs ERROR]\033[0m %s\n' "$*" >&2; }
die()  { err "$*"; exit 1; }

banner() {
  printf '\n\033[1;36m%s\033[0m\n' "============================================================"
  printf '\033[1;36m%s\033[0m\n'   "  $1"
  printf '\033[1;36m%s\033[0m\n\n' "============================================================"
}

# ───────────────────────────────────────────────────────────────────────────────
# Preflight
# ───────────────────────────────────────────────────────────────────────────────

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "required command not found in PATH: $1"
}

check_prereqs() {
  require_cmd docker
  require_cmd jq
  require_cmd curl
  require_cmd nc
  require_cmd node

  # Docker server >= 20.10 needed for named networks + compose v2 host-gateway
  local server_ver
  server_ver=$(docker version --format '{{.Server.Version}}' 2>/dev/null || echo "0.0.0")
  local major minor
  major=$(echo "$server_ver" | cut -d. -f1)
  minor=$(echo "$server_ver" | cut -d. -f2)
  if [[ -z "$major" ]] || (( major < 20 )) || { (( major == 20 )) && (( minor < 10 )); }; then
    die "Docker server ${server_ver} too old. Need >= 20.10.0 for named networks + compose v2."
  fi

  # LOCAL_CHAINS mode does not read leases.json (chains are local Docker).
  if [[ "${LOCAL_CHAINS:-0}" != "1" ]]; then
    [[ -f "$LEASES_PATH" ]] || die "leases.json not found at $LEASES_PATH. Run scripts/akash-deploy.sh to bootstrap."
  fi
  [[ -f "$COMPOSE_FILE" ]] || die "compose file missing at $COMPOSE_FILE"
}

# Self-heal: build dist/image-manifest.json + render compose template if either
# is missing. The manifest pins per-image digests; the template substitution
# replaces ${TOON_*_DIGEST} placeholders with @sha256:... refs from the manifest.
# This is the 49.4 D3/D4 carry-forward — CI normally produces the manifest, but
# local-dev paths can hit a fresh checkout where it's absent.
ensure_image_manifest() {
  local manifest_path="${REPO_ROOT}/packages/townhouse/dist/image-manifest.json"
  local compose_template="${REPO_ROOT}/packages/townhouse/dist/compose/townhouse-hs.yml"

  # Resolve digest for a given local image. Echoes the sha256:... digest or
  # exits with non-zero if the image is not present locally.
  resolve_digest() {
    local ref="$1"
    local digest
    digest=$(docker inspect --format='{{index .RepoDigests 0}}' "$ref" 2>/dev/null | sed -n 's/.*@\(sha256:[a-f0-9]*\).*/\1/p')
    if [[ -z "$digest" ]]; then
      # Fallback: image was built locally and never pulled, so RepoDigests is empty.
      # Use the ImageID, which is a sha256 (works for compose @sha256:... refs IF the
      # image was tagged with a registry name + we accept the same-machine constraint).
      digest=$(docker inspect --format='{{.Id}}' "$ref" 2>/dev/null)
    fi
    echo "$digest"
  }

  if [[ -f "$manifest_path" ]] && grep -q "@sha256:" "$compose_template" 2>/dev/null \
     && ! grep -q '\${TOON_.*_DIGEST}' "$compose_template" 2>/dev/null; then
    log "image-manifest.json present + compose template rendered — OK"
    return 0
  fi

  warn "image-manifest.json missing OR compose template has unresolved placeholders — rebuilding…"

  # Pin connector to v3.9.1 — must match DEFAULT_CONNECTOR_IMAGE in
  # packages/townhouse/src/constants.ts so the gate's image-manifest + rendered
  # compose validate the SAME connector the product ships. v3.9.1 fixes inbound
  # claim validation to dispatch by blockchain type (validateSolanaClaim /
  # validateMinaClaim / validateEVMClaim) — 3.9.0 validated every claim as EVM,
  # so a Solana claim's base58 channelAccount was rejected with F06
  # "Invalid channelId format (expected 0x-prefixed 64-char hex)". Builds on
  # 3.9.0's Solana + Mina settlement wiring (#86). Pull lazily if missing locally.
  local CONNECTOR_TAG=3.9.1
  docker image inspect "ghcr.io/toon-protocol/connector:${CONNECTOR_TAG}" >/dev/null 2>&1 \
    || docker pull "ghcr.io/toon-protocol/connector:${CONNECTOR_TAG}" 2>&1 | tail -2

  # Resolve local digests
  local connector_d townhouse_api_d town_d mill_d dvm_d
  connector_d=$(resolve_digest "ghcr.io/toon-protocol/connector:${CONNECTOR_TAG}") \
    || die "connector:${CONNECTOR_TAG} not present locally. Run: docker pull ghcr.io/toon-protocol/connector:${CONNECTOR_TAG}"
  townhouse_api_d=$(resolve_digest "ghcr.io/toon-protocol/townhouse-api:epic-47-local")
  [[ -n "$townhouse_api_d" ]] || townhouse_api_d=$(resolve_digest "ghcr.io/toon-protocol/townhouse-api:latest")
  [[ -n "$townhouse_api_d" ]] || die "townhouse-api image not found locally. Build or pull a tag."
  town_d=$(resolve_digest "ghcr.io/toon-protocol/town:latest") \
    || die "town:latest not present locally. Run: docker pull ghcr.io/toon-protocol/town:latest"
  mill_d=$(resolve_digest "ghcr.io/toon-protocol/mill:latest") \
    || die "mill:latest not present locally. Run: docker pull ghcr.io/toon-protocol/mill:latest"
  dvm_d=$(resolve_digest "ghcr.io/toon-protocol/dvm:latest") \
    || die "dvm:latest not present locally. Run: docker pull ghcr.io/toon-protocol/dvm:latest"

  log "Building image-manifest.json with locally-resolved digests (connector=${CONNECTOR_TAG})…"
  node "${REPO_ROOT}/scripts/build-image-manifest.mjs" \
    --townhouse-version 0.0.1-local-hs-e2e \
    --connector-tag "${CONNECTOR_TAG}" \
    --connector-digest "$connector_d" \
    --townhouse-api-digest "$townhouse_api_d" \
    --town-digest "$town_d" \
    --mill-digest "$mill_d" \
    --dvm-digest "$dvm_d" \
    || die "build-image-manifest.mjs failed"

  log "Rendering dist/compose/townhouse-hs.yml from manifest…"
  node "${REPO_ROOT}/scripts/render-compose-template.mjs" \
    || die "render-compose-template.mjs failed"
}

read_leases() {
  # LOCAL_CHAINS=1 points the whole loop at the LOCAL Docker devnet chains
  # (scripts/townhouse-dev-infra.sh / sdk-e2e-infra.sh) instead of the Akash
  # leases. This is the standing fallback when the Akash anvil/solana/faucet
  # leases are unreachable (the loop's most common blocker). It splits the chain
  # URLs into two views:
  #   - *_RPC_URL          : HOST-side URLs (host-published ports) for the
  #                          funding helpers + preflight probes that run on the
  #                          operator machine.
  #   - *_RPC_URL_INTERNAL : DOCKER-internal URLs (compose service hostnames) the
  #                          apex connector container uses for its chainProvider
  #                          rpcUrl (the apex lives on townhouse-hs-net alongside
  #                          townhouse-dev-anvil / townhouse-dev-solana).
  # There is no Akash faucet locally; the direct_fund_* helpers talk to the chain
  # RPCs directly, so FAUCET_URL is set to the local EVM RPC purely so the
  # /health probe + compose interpolation have a non-empty value.
  if [[ "${LOCAL_CHAINS:-0}" == "1" ]]; then
    EVM_RPC_URL="${LOCAL_EVM_RPC_URL:-http://127.0.0.1:28545}"
    SOLANA_RPC_URL="${LOCAL_SOLANA_RPC_URL:-http://127.0.0.1:28899}"
    FAUCET_URL="${LOCAL_FAUCET_URL:-$EVM_RPC_URL}"
    EVM_RPC_URL_INTERNAL="${LOCAL_EVM_RPC_URL_INTERNAL:-http://townhouse-dev-anvil:8545}"
    SOLANA_RPC_URL_INTERNAL="${LOCAL_SOLANA_RPC_URL_INTERNAL:-http://townhouse-dev-solana:8899}"
    export EVM_RPC_URL SOLANA_RPC_URL FAUCET_URL EVM_RPC_URL_INTERNAL SOLANA_RPC_URL_INTERNAL
    # Mina lightnet (Phase-2 Stage 3; only consulted when E2E_MINA=1). GraphQL on
    # the dev table port 28085, accounts-manager on 28181 (docker-compose-
    # townhouse-dev.yml mina service). The apex connector reaches the lightnet
    # over the compose-internal service hostname (townhouse-dev-mina).
    MINA_GRAPHQL_URL="${LOCAL_MINA_GRAPHQL_URL:-http://127.0.0.1:28085/graphql}"
    MINA_ACCOUNTS_URL="${LOCAL_MINA_ACCOUNTS_URL:-http://127.0.0.1:28181}"
    MINA_GRAPHQL_URL_INTERNAL="${LOCAL_MINA_GRAPHQL_URL_INTERNAL:-http://townhouse-dev-mina:3085/graphql}"
    export MINA_GRAPHQL_URL MINA_ACCOUNTS_URL MINA_GRAPHQL_URL_INTERNAL
    log "LOCAL_CHAINS=1 — using local Docker devnet chains:"
    log "  EVM    host=$EVM_RPC_URL    internal=$EVM_RPC_URL_INTERNAL"
    log "  Solana host=$SOLANA_RPC_URL internal=$SOLANA_RPC_URL_INTERNAL"
    [[ "${E2E_MINA:-0}" == "1" ]] && \
      log "  Mina   host=$MINA_GRAPHQL_URL internal=$MINA_GRAPHQL_URL_INTERNAL accounts=$MINA_ACCOUNTS_URL"
    return 0
  fi

  EVM_RPC_URL=$(jq -r '.anvil.url // empty' "$LEASES_PATH")
  SOLANA_RPC_URL=$(jq -r '.solana.url // empty' "$LEASES_PATH")
  FAUCET_URL=$(jq -r '.faucet.url // empty' "$LEASES_PATH")

  [[ -n "$EVM_RPC_URL"    ]] || die "anvil.url missing from leases.json. Run scripts/akash-deploy.sh anvil."
  [[ -n "$SOLANA_RPC_URL" ]] || die "solana.url missing from leases.json. Run scripts/akash-deploy.sh solana."
  [[ -n "$FAUCET_URL"     ]] || die "faucet.url missing from leases.json. Run scripts/akash-deploy.sh faucet."

  # In Akash mode the apex reaches the chains over the same public ingress URLs.
  EVM_RPC_URL_INTERNAL="$EVM_RPC_URL"
  SOLANA_RPC_URL_INTERNAL="$SOLANA_RPC_URL"
  export EVM_RPC_URL SOLANA_RPC_URL FAUCET_URL EVM_RPC_URL_INTERNAL SOLANA_RPC_URL_INTERNAL

  # Mina (Phase-2 Stage 3; only consulted when E2E_MINA=1). On Akash the Mina
  # lightnet GraphQL + accounts-manager come from leases.json (mina.url /
  # mina.accountsUrl); fall back to empty so callers can detect "not provisioned".
  MINA_GRAPHQL_URL=$(jq -r '.mina.url // empty' "$LEASES_PATH" 2>/dev/null || echo '')
  MINA_ACCOUNTS_URL=$(jq -r '.mina.accountsUrl // empty' "$LEASES_PATH" 2>/dev/null || echo '')
  MINA_GRAPHQL_URL_INTERNAL="$MINA_GRAPHQL_URL"
  export MINA_GRAPHQL_URL MINA_ACCOUNTS_URL MINA_GRAPHQL_URL_INTERNAL
}

probe_evm_rpc() {
  local label="$1" url="$2" hint="$3"
  local body
  body=$(curl -sfk --max-time 10 -X POST "$url" \
    -H 'content-type: application/json' \
    -d '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}' \
    2>/dev/null) || die "Akash $label unreachable at $url. $hint"
  echo "$body" | jq -e '.result | test("^0x")' >/dev/null 2>&1 \
    || die "Akash $label RPC returned malformed body: $(echo "$body" | head -c 200). $hint"
  log "Akash $label OK ($(echo "$body" | jq -r .result))"
}

probe_sol_rpc() {
  local label="$1" url="$2" hint="$3"
  local body
  body=$(curl -sfk --max-time 10 -X POST "$url" \
    -H 'content-type: application/json' \
    -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' \
    2>/dev/null) || die "Akash $label unreachable at $url. $hint"
  echo "$body" | jq -e '.result == "ok"' >/dev/null 2>&1 \
    || die "Akash $label RPC getHealth result != 'ok': $(echo "$body" | head -c 200). $hint"
  log "Akash $label OK (getHealth=ok)"
}

probe_faucet() {
  local label="$1" url="$2" hint="$3"
  # Faucet exposes GET /health (no 'z') — verified against the live Akash faucet
  # 2026-05-20: returns {status:"ok",tokenReady:true,...}. The toon-client uses
  # /healthz (with z); the faucet is a different service with a different conv.
  local body
  body=$(curl -sfk --max-time 10 "$url/health" 2>&1) \
    || die "Akash $label unreachable at $url/health. $hint"
  echo "$body" | jq -e '.status == "ok"' >/dev/null 2>&1 \
    || die "Akash $label /health did not return status:ok. body=$(echo "$body" | head -c 200). $hint"
  log "Akash $label OK ($(echo "$body" | jq -c '{status, tokenReady, solanaConfigured}'))"
}

preflight_probes() {
  if [[ "${LOCAL_CHAINS:-0}" == "1" ]]; then
    log "Pre-flight (LOCAL_CHAINS): probing local Docker devnet chains…"
    probe_evm_rpc "local-anvil"  "$EVM_RPC_URL" \
      "→ run scripts/townhouse-dev-infra.sh up (or sdk-e2e-infra.sh up) for local chains"
    probe_sol_rpc "local-solana" "$SOLANA_RPC_URL" \
      "→ run scripts/townhouse-dev-infra.sh up (or sdk-e2e-infra.sh up) for local chains"
    # No local faucet service — the direct_fund_* helpers hit the chain RPCs.
    return 0
  fi
  log "Pre-flight: probing Akash leases (10s timeout each)…"
  probe_evm_rpc "anvil"  "$EVM_RPC_URL"    "→ run scripts/akash-deploy.sh anvil to redeploy"
  probe_sol_rpc "solana" "$SOLANA_RPC_URL" "→ run scripts/akash-deploy.sh solana to redeploy"
  probe_faucet  "faucet" "$FAUCET_URL"     "→ run scripts/akash-deploy.sh faucet to redeploy"
}

# ───────────────────────────────────────────────────────────────────────────────
# Funding (direct via RPC — bypasses the flaky faucet → Anvil/Solana link)
# ───────────────────────────────────────────────────────────────────────────────
#
# Background: the Akash faucet's ethers v6 client times out talking to
# Akash-Anvil under cross-provider TLS load (49.4 carry-forward). Bypass
# entirely by talking to the chain RPCs directly from this script:
#   - EVM native:  anvil_setBalance              (instant)
#   - EVM USDC:    impersonate Anvil acct[0] +
#                  eth_sendTransaction transfer  (mines on next block)
#   - SOL native:  requestAirdrop                (confirms in ~8s)
#   - SOL USDC:    retry the faucet               (best-effort; works when
#                                                  the faucet's anvil link
#                                                  is healthy, no other path)

# Deterministic Akash-Anvil USDC contract + Anvil acct[0] deployer (memory
# note: project_solana_mock_usdc_keys — same posture; public dev keys only).
USDC_CONTRACT="0x5FbDB2315678afecb367f032d93F642f64180aa3"
ANVIL_DEPLOYER="0xf39Fd6e51aad88F6F4ce6aB8827279cfFFb92266"   # acct[0]

# Helper: POST a JSON-RPC call to a given chain RPC.
rpc_post() {
  local url="$1" payload="$2" budget_s="${3:-10}"
  curl -sfk --max-time "$budget_s" -X POST "$url" \
    -H 'content-type: application/json' -d "$payload" 2>&1
}

direct_fund_evm() {
  local addr="$1"
  local addr_pad
  addr_pad=$(printf '%064s' "${addr:2}" | tr ' ' '0')

  # 1) Native: 10 ETH = 0x8AC7230489E80000 wei
  log "anvil_setBalance($addr) = 10 ETH"
  rpc_post "$EVM_RPC_URL" \
    "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"anvil_setBalance\",\"params\":[\"$addr\",\"0x8AC7230489E80000\"]}" \
    > /dev/null || { warn "anvil_setBalance failed"; return 1; }

  # 2) USDC: impersonate deployer, transfer 100 USDC = 100_000_000 (scale=6)
  local amt_hex
  amt_hex=$(printf '%064x' 100000000)
  rpc_post "$EVM_RPC_URL" \
    "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"anvil_impersonateAccount\",\"params\":[\"$ANVIL_DEPLOYER\"]}" \
    > /dev/null || { warn "anvil_impersonateAccount failed"; return 1; }
  log "USDC transfer: 100 USDC → $addr (impersonating $ANVIL_DEPLOYER)"
  local tx
  tx=$(rpc_post "$EVM_RPC_URL" \
    "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"eth_sendTransaction\",\"params\":[{\"from\":\"$ANVIL_DEPLOYER\",\"to\":\"$USDC_CONTRACT\",\"data\":\"0xa9059cbb${addr_pad}${amt_hex}\"}]}" \
    20 | jq -r .result 2>/dev/null) || true
  rpc_post "$EVM_RPC_URL" \
    "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"anvil_mine\",\"params\":[\"0x1\"]}" \
    > /dev/null || true
  rpc_post "$EVM_RPC_URL" \
    "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"anvil_stopImpersonatingAccount\",\"params\":[\"$ANVIL_DEPLOYER\"]}" \
    > /dev/null || true

  # 3) Verify USDC landed
  local usdc_bal_hex
  usdc_bal_hex=$(rpc_post "$EVM_RPC_URL" \
    "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"eth_call\",\"params\":[{\"to\":\"$USDC_CONTRACT\",\"data\":\"0x70a08231${addr_pad}\"},\"latest\"]}" \
    | jq -r .result)
  if [[ "$usdc_bal_hex" == "0x0000000000000000000000000000000000000000000000000000000000000000" ]]; then
    warn "USDC transfer mined but balance still 0 for $addr (tx=$tx)"
    return 1
  fi
  log "EVM funded ✓ ($addr: 10 ETH + USDC bal=$usdc_bal_hex)"
}

direct_fund_sol_native() {
  local addr="$1"
  # Submit airdrop requests AGGRESSIVELY — Solana RPC is rate-limited per
  # address but multiple submissions improve commit speed. Don't sleep between
  # the submission and the first balance check; only sleep on retry.
  log "requestAirdrop($addr, 1 SOL) — submit"
  rpc_post "$SOLANA_RPC_URL" \
    "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"requestAirdrop\",\"params\":[\"$addr\",1000000000]}" \
    > /dev/null || true
  for i in 1 2 3 4 5 6; do
    local bal
    bal=$(rpc_post "$SOLANA_RPC_URL" \
      "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"getBalance\",\"params\":[\"$addr\"]}" \
      | jq -r '.result.value // 0')
    if [[ "$bal" != "0" && -n "$bal" ]]; then
      log "SOL native funded ✓ ($addr: $bal lamports, poll #$i)"
      return 0
    fi
    # Resubmit airdrop every 2 polls in case the first didn't land
    if (( i % 2 == 0 )); then
      rpc_post "$SOLANA_RPC_URL" \
        "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"requestAirdrop\",\"params\":[\"$addr\",1000000000]}" \
        > /dev/null || true
    fi
    sleep 3
  done
  warn "SOL native funding never confirmed for $addr"
  return 1
}

direct_fund_sol_usdc() {
  # SPL transferChecked signed locally with the deterministic faucet authority
  # key. Bypasses the Akash faucet's outbound link (its ethers/web3 fetch layer
  # keeps timing out under cross-Akash-provider TLS load — see 49.4 carry-forward).
  # We have reliable clearnet access to Akash-Solana from the operator's machine.
  local addr="$1"
  log "Direct SOL USDC drip → $addr (100 USDC via signed SPL transferChecked)"
  local out
  if ! out=$(node "${REPO_ROOT}/scripts/sol-usdc-direct-fund.mjs" "$addr" 100 "$SOLANA_RPC_URL" 2>&1); then
    warn "SOL USDC direct-fund failed:"
    echo "$out" | sed 's/^/    /' >&2
    return 1
  fi
  log "SOL USDC funded ✓ ($(echo "$out" | grep '^\[sol-usdc' | tail -1))"
}

poll_evm_balance() {
  local addr="$1" min_wei="$2" budget_s="${3:-30}"
  local deadline=$(( $(date +%s) + budget_s ))
  local hex=''
  while (( $(date +%s) < deadline )); do
    local body
    body=$(curl -sfk --max-time 5 -X POST "$EVM_RPC_URL" \
      -H 'content-type: application/json' \
      -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"eth_getBalance\",\"params\":[\"$addr\",\"latest\"]}" \
      2>/dev/null) || { sleep 2; continue; }
    local hex
    hex=$(echo "$body" | jq -r '.result // empty')
    [[ -z "$hex" || "$hex" == "0x0" ]] && { sleep 2; continue; }
    # Convert hex to decimal
    local dec
    dec=$(( 16#${hex#0x} )) || dec=0
    if (( dec >= min_wei )); then
      log "balance OK: $addr = $hex ($dec wei)"
      return 0
    fi
    sleep 2
  done
  warn "balance poll TIMEOUT after ${budget_s}s for $addr (last seen: $hex)"
  return 1
}

fund_apex_and_town() {
  # Apex (Anvil acct[3]) is pre-funded by Anvil with 10000 ETH. Top-up is a no-op
  # for native, but USDC still requires impersonation. Town gets same treatment.
  # Run both in parallel — independent addresses, no shared state.
  log "Direct-funding apex + town in parallel…"
  direct_fund_evm "$APEX_EVM_ADDRESS" &
  local apex_pid=$!
  direct_fund_evm "$TOWN_EVM_ADDRESS" &
  local town_pid=$!
  wait "$apex_pid" || warn "apex EVM direct-fund failed (continuing — Anvil pre-fund covers native)"
  wait "$town_pid" || warn "town EVM direct-fund failed (continuing — Anvil pre-fund covers native)"

  # ── Apex Solana recipient ATA (Phase-2 Stage 2; opt-in via E2E_SOLANA=1) ──
  # The apex's Solana settlement address is the base58 pubkey of the apex Solana
  # key derived from the mnemonic (Stage 1). Fund its native + USDC ATA so the
  # connector's claimFromChannel can transfer the claimed delta to it.
  #
  # Stage 2c: the client now produces a settleable Solana claim (real on-chain
  # channel + connector-format proof), so funding the apex recipient ATA is part
  # of the live loop — the connector's claimFromChannel transfers the claimed
  # delta here.
  if [[ "${E2E_SOLANA:-0}" == "1" ]]; then
    local apex_sol
    apex_sol="$(resolve_apex_solana_signer)" || true
    if [[ -n "$apex_sol" ]]; then
      log "Funding apex Solana recipient $apex_sol (native + USDC ATA)…"
      direct_fund_sol_native "$apex_sol" || warn "apex SOL native fund failed"
      direct_fund_sol_usdc "$apex_sol" || warn "apex SOL USDC fund failed"
    else
      warn "E2E_SOLANA=1 but could not resolve apex Solana settlement signer — skipping apex ATA funding"
    fi
  fi

  # ── Apex Mina settlement account (Phase-2 Stage 3; opt-in via E2E_MINA=1) ──
  # The Mina lightnet accounts-manager pre-funds accounts. The apex Mina
  # settlement account is the derived apex Mina pubkey (the address the connector
  # logs as "Mina settlement signer resolved"); it needs MINA to pay account-
  # creation + (eventually) on-chain settle fees. Best-effort: the funding step
  # uses the accounts-manager `acquire`/`fund` API where available.
  if [[ "${E2E_MINA:-0}" == "1" ]]; then
    local apex_mina
    apex_mina="$(resolve_apex_mina_signer)" || true
    if [[ -n "$apex_mina" ]]; then
      log "Funding apex Mina recipient $apex_mina (lightnet accounts-manager)…"
      direct_fund_mina "$apex_mina" || warn "apex Mina fund failed (best-effort)"
    else
      warn "E2E_MINA=1 but could not resolve apex Mina settlement signer — skipping apex Mina funding"
    fi
  fi
}

# Best-effort Mina funding via the lightnet accounts-manager. Lightnet pre-funds
# accounts it issues; for an arbitrary externally-derived address (the apex Mina
# pubkey), we request a faucet drip from the accounts-manager when it supports
# one. Failures are non-fatal — the Mina loop is claim-validation gated, so the
# apex never actually settles on-chain in this stack (no funds consumed).
direct_fund_mina() {
  local addr="$1"
  # The o1labs lightnet accounts-manager exposes faucet endpoints across
  # versions; try the documented ones in turn (each non-fatal).
  for path in "fund-account" "faucet"; do
    if curl -sfk --max-time 10 -X POST "$MINA_ACCOUNTS_URL/$path" \
         -H 'content-type: application/json' \
         -d "{\"pk\":\"$addr\",\"amount\":\"100000000000\"}" >/dev/null 2>&1; then
      log "Mina fund request accepted via $MINA_ACCOUNTS_URL/$path for $addr"
      return 0
    fi
  done
  warn "Mina accounts-manager faucet not available at $MINA_ACCOUNTS_URL (tried fund-account, faucet)"
  return 1
}

fund_client_pod() {
  # Read the pod's ephemeral signer addresses from /signer-info, then direct-fund
  # via the chain RPCs. Bypasses the flaky Akash faucet → Anvil link.
  #
  # The pod's boot has a ~30s balance-poll deadline starting after anon SOCKS5
  # bootstrap. Total funding wall must fit in that window — parallelize EVM
  # (instant) and SOL (10-20s for airdrop confirmation) so they run concurrently.
  log "Fetching client signer addresses from /signer-info…"
  local info
  info=$(curl -sfk --max-time 5 "$CLIENT_URL/signer-info" 2>/dev/null) \
    || die "client /signer-info unreachable"
  local client_evm client_sol
  client_evm=$(echo "$info" | jq -r '.evm // .evmAddr // empty')
  client_sol=$(echo "$info" | jq -r '.sol // .solAddr // empty')
  [[ -n "$client_evm" ]] || die "client EVM addr missing from /signer-info"
  [[ -n "$client_sol" ]] || die "client SOL addr missing from /signer-info"
  log "Client EVM=$client_evm SOL=$client_sol (parallel fund: EVM + SOL native + SOL USDC)"

  # EVM funding in foreground (instant ~3s). SOL chain funding in background
  # (parallel) — airdrop confirmation is the slowest step (~10-20s).
  (direct_fund_sol_native "$client_sol" \
     && direct_fund_sol_usdc "$client_sol") &
  local sol_pid=$!

  direct_fund_evm "$client_evm" || warn "client EVM direct-fund failed"

  log "Waiting for SOL funding background job (pid=$sol_pid)…"
  wait "$sol_pid" || warn "client SOL funding chain failed (continuing)"
}

wait_for_client_ready() {
  # The pod's boot sequence has a ~30s balance-poll deadline that starts AFTER
  # the anon daemon bootstrap completes (which can take 10-30s). If we fund
  # before the deadline, anyoneReady flips true; otherwise it's stuck false
  # until next container restart.
  log "Waiting for client anyoneReady=true (180s budget — covers anon bootstrap)…"
  local deadline=$(( $(date +%s) + 180 ))
  while (( $(date +%s) < deadline )); do
    local body
    body=$(curl -sfk --max-time 5 "$CLIENT_URL/healthz" 2>/dev/null) || { sleep 3; continue; }
    if [[ "$(echo "$body" | jq -r '.anyoneReady // false')" == "true" ]]; then
      log "Client ready ✓ — $(echo "$body" | jq -c '{anyoneReady, balances}')"
      return 0
    fi
    sleep 3
  done
  warn "client anyoneReady never flipped to true within 180s"
  warn "  Likely funded after the pod's balance-poll deadline. Inspect:"
  warn "    docker logs $CLIENT_CONTAINER | grep -E 'faucet|balance|boot' | tail -30"
  warn "  Workaround: 'bash $0 down-v && bash $0 up' for a clean retry"
  return 1
}

# ───────────────────────────────────────────────────────────────────────────────
# Townhouse HS apex lifecycle
# ───────────────────────────────────────────────────────────────────────────────

# Resolve the townhouse CLI binary. Prefer the built dist (for developers in
# the monorepo); fall back to a globally-installed `townhouse` command.
resolve_townhouse_cli() {
  local dist_cli="${REPO_ROOT}/packages/townhouse/dist/cli.js"
  if [[ -f "$dist_cli" ]]; then
    echo "node $dist_cli"
    return 0
  fi
  if command -v townhouse >/dev/null 2>&1; then
    command -v townhouse
    return 0
  fi
  die "townhouse CLI not found. Run: pnpm --filter @toon-protocol/townhouse build"
}

# Resolve the apex's REAL Solana settlement signer (participant B for client
# channels). This is the pubkey the connector logs as "Solana settlement signer
# resolved" — derived from the connector's Solana chainProvider keyId, NOT a
# `townhouse wallet show` node-type address (m/44'/501'/N'/0'/0'). Targeting a
# wallet-show address opens a channel PDA the apex's signer is not a participant
# in, so the apex can neither verify nor settle the client's Solana claim.
resolve_apex_solana_signer() {
  docker logs townhouse-hs-connector 2>&1 \
    | grep -F 'Solana settlement signer resolved' \
    | tail -1 \
    | jq -r '.address // empty' 2>/dev/null
}

# Resolve the apex's REAL Mina settlement signer (participant B for client Mina
# channels). The connector logs this when it registers the Mina chainProvider
# from the keyId `townhouse hs up` filled in from the apex Mina key. Mirrors
# resolve_apex_solana_signer — used as the client's Mina claim recipient so the
# apex is a participant in the negotiated channel (Stage 3).
resolve_apex_mina_signer() {
  docker logs townhouse-hs-connector 2>&1 \
    | grep -F 'Mina settlement signer resolved' \
    | tail -1 \
    | jq -r '.address // empty' 2>/dev/null
}

# Deterministic-keypair Mina zkApp deploy (Phase-2 Stage 3). Captures the stable
# zkApp address into MINA_ZKAPP_ADDRESS (exported for chainProvider injection +
# client env). The deploy runs o1js (proof generation, ~30-120s, ~2GB RAM) ONE at
# a time. Deterministic key → idempotent: a second run on an existing account is a
# no-op. The deterministic zkApp key is a documented dev-only key (never real).
#
# NOTE: this requires o1js + the mina-zkapp package + a reachable Mina lightnet
# (GraphQL + accounts-manager). If any prerequisite is missing the deploy fails
# soft (warns); the Mina chainProvider injection then skips and the Mina loop is
# not exercised (which is fine — the loop is claim-validation gated regardless).
MINA_ZKAPP_DETERMINISTIC_KEY="${MINA_ZKAPP_PRIVATE_KEY:-EKEdScHCp4iyHU8Dikj5gzD9Jpu6yEv9XfPrEFE6kEAXanaVQYNu}"
deploy_mina_zkapp_deterministic() {
  if [[ -n "${MINA_ZKAPP_ADDRESS:-}" ]]; then
    log "MINA_ZKAPP_ADDRESS already set ($MINA_ZKAPP_ADDRESS) — skipping deploy"
    return 0
  fi
  # Probe lightnet GraphQL before attempting the (expensive) o1js deploy.
  if ! curl -sfk --max-time 8 -X POST "$MINA_GRAPHQL_URL" \
      -H 'content-type: application/json' \
      -d '{"query":"{ syncStatus }"}' >/dev/null 2>&1; then
    warn "Mina lightnet GraphQL ($MINA_GRAPHQL_URL) unreachable — cannot deploy zkApp."
    warn "  Bring up the Mina lightnet (scripts/townhouse-dev-infra.sh up brings up townhouse-dev-mina)."
    return 1
  fi
  log "Deploying deterministic Mina zkApp (o1js — slow, ~30-120s, ~2GB RAM)…"
  local out
  if ! out=$(MINA_GRAPHQL_URL="$MINA_GRAPHQL_URL" \
       MINA_ACCOUNTS_URL="$MINA_ACCOUNTS_URL" \
       MINA_ZKAPP_PRIVATE_KEY="$MINA_ZKAPP_DETERMINISTIC_KEY" \
       timeout 300 npx tsx "${REPO_ROOT}/scripts/deploy-mina-zkapp.ts" 2>>/tmp/mina-zkapp-deploy.log); then
    warn "Mina zkApp deploy failed (see /tmp/mina-zkapp-deploy.log):"
    tail -8 /tmp/mina-zkapp-deploy.log >&2 || true
    return 1
  fi
  MINA_ZKAPP_ADDRESS="$(echo "$out" | tail -1 | tr -d '[:space:]')"
  export MINA_ZKAPP_ADDRESS
  if [[ -z "$MINA_ZKAPP_ADDRESS" ]]; then
    warn "Mina zkApp deploy produced no address"
    return 1
  fi
  log "Mina zkApp deployed (deterministic) ✓ zkAppAddress=$MINA_ZKAPP_ADDRESS"
}

up_townhouse_hs() {
  local cli
  cli=$(resolve_townhouse_cli)
  log "Using townhouse CLI: $cli"

  # Bring up the apex. The CLI handles compose materialization + container
  # lifecycle. `hs up` returns after containers are up (per 49.4 test usage).
  mkdir -p "$TOWNHOUSE_HOME"
  # Skip init if a complete config already exists. `townhouse init` 1) refuses
  # to overwrite without --force and 2) regenerates wallet/keys (invalidates
  # APEX_EVM_ADDRESS). Both are unwanted on idempotent re-up.
  if [[ -f "$TOWNHOUSE_HOME/config.yaml" && -f "$TOWNHOUSE_HOME/connector.yaml" ]]; then
    log "config.yaml + connector.yaml already exist — skipping init (use 'down-v' to reset)"
  else
    log "townhouse init → $TOWNHOUSE_HOME"
    $cli init --config-dir "$TOWNHOUSE_HOME" --password "$TEST_PASSWORD" >/dev/null
  fi

  # Inject Akash-Anvil chainProviders into config.yaml (mirrors 49.4 test).
  local config_path="$TOWNHOUSE_HOME/config.yaml"
  [[ -f "$config_path" ]] || die "config.yaml missing at $config_path after init"
  if grep -qE '^chainProviders:' "$config_path"; then
    log "config.yaml already has chainProviders — skipping injection"
  else
    cat >> "$config_path" <<EOF

chainProviders:
  - chainType: evm
    chainId: evm:base:31337
    rpcUrl: "$EVM_RPC_URL_INTERNAL"
    registryAddress: "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512"
    tokenAddress: "0x5FbDB2315678afecb367f032d93F642f64180aa3"
    keyId: "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6"
EOF
    log "Injected EVM chainProvider into $config_path (rpcUrl=$EVM_RPC_URL_INTERNAL)"

    # ── Solana chainProvider (Phase-2 Stage 2) ──────────────────────────────
    # Opt-in via E2E_SOLANA=1. The apex's Solana settlement keyId is left blank;
    # `townhouse hs up` fills it from the apex Solana key derived from the
    # mnemonic (Stage 1: WalletManager.getApexSettlementKeys →
    # solanaPrivateKeyBase58 → hs-config-writer fillApexKey).
    #
    # Stage-2 client gate CLEARED: #105 made the client's
    # OnChainChannelClient.openSolanaChannel open a REAL on-chain channel at the
    # connector-parity PDA and sign the connector-format claim, and Stage 2c
    # wired the toon-client entrypoint to negotiate solana:devnet + supply the
    # Solana program/mint/recipient + channel keypair. So with E2E_SOLANA=1 the
    # client now produces a claim the connector should accept (real base58 PDA in
    # claim.channelAccount, signature over that PDA, signer = channel participant).
    if [[ "${E2E_SOLANA:-0}" == "1" ]]; then
      local sol_program="${SOLANA_PROGRAM_ID:-EdJxYPDxGvaJuu57DSUptf4soLv8enpdyQJJhHDLiydG}"
      local sol_mint="${SOLANA_USDC_MINT:-6GbdrVghwNKTz9raga7y3Y4qqX5Zgg3AC4d48Kt7C59Q}"
      cat >> "$config_path" <<EOF
  - chainType: solana
    chainId: solana:devnet
    rpcUrl: "$SOLANA_RPC_URL_INTERNAL"
    programId: "$sol_program"
    tokenMint: "$sol_mint"
    keyId: ""
EOF
      log "Injected Solana chainProvider (E2E_SOLANA=1) rpcUrl=$SOLANA_RPC_URL_INTERNAL program=$sol_program mint=$sol_mint"
    fi

    # ── Mina chainProvider (Phase-2 Stage 3) ────────────────────────────────
    # Opt-in via E2E_MINA=1. Deploys the deterministic-keypair payment-channel
    # zkApp first (capturing zkAppAddress), then injects a `mina:*` chainProvider
    # whose keyId is left blank — `townhouse hs up` fills it from the apex Mina
    # key derived from the mnemonic (Stage 1: WalletManager.getApexSettlementKeys
    # → minaPrivateKeyBase58 → hs-config-writer fillApexKey).
    #
    # GATE (Stage-3, claim-validation — NOT the #88 settle gate): with E2E_MINA=1
    # the negotiation path is exercised end-to-end, but the client's Mina claim
    # does NOT satisfy connector 3.9.0's MinaClaimMessage contract (missing
    # tokenId/balanceCommitment/proof/salt; Schnorr-over-balanceProofFieldsMina
    # vs the connector's Poseidon commitment; no real on-chain zkApp channel). So
    # a mina:* publish is REJECTED at validateClaimMessage. The chainProvider +
    # apex key wiring is shipped so the apex can ADVERTISE + later settle once the
    # client claim path is brought to contract (tracked follow-up).
    if [[ "${E2E_MINA:-0}" == "1" ]]; then
      deploy_mina_zkapp_deterministic || warn "Mina zkApp deploy failed — chainProvider zkAppAddress may be stale"
      local mina_zkapp="${MINA_ZKAPP_ADDRESS:-}"
      if [[ -n "$mina_zkapp" ]]; then
        cat >> "$config_path" <<EOF
  - chainType: mina
    chainId: mina:devnet
    graphqlUrl: "$MINA_GRAPHQL_URL_INTERNAL"
    zkAppAddress: "$mina_zkapp"
    keyId: ""
EOF
        log "Injected Mina chainProvider (E2E_MINA=1) graphqlUrl=$MINA_GRAPHQL_URL_INTERNAL zkApp=$mina_zkapp"
      else
        warn "E2E_MINA=1 but no zkAppAddress captured — skipping Mina chainProvider injection"
      fi
    fi
  fi

  log "townhouse hs up (6-min budget — anon HS bootstrap is slow)…"
  # CLI exit code is ADVISORY — its ink-based TUI can crash post-success
  # (e.g., missing optional peer dep). Trust container health, not the exit.
  TOWNHOUSE_HOME="$TOWNHOUSE_HOME" TOWNHOUSE_WALLET_PASSWORD="$TEST_PASSWORD" \
    timeout 360 $cli hs -c "$TOWNHOUSE_HOME/config.yaml" --password "$TEST_PASSWORD" up \
    || warn "townhouse hs up CLI exited non-zero (probably TUI render glitch). Verifying containers directly…"

  # Probe actual liveness instead of trusting the CLI exit code
  local deadline=$(( $(date +%s) + 60 ))
  local connector_up=0
  while (( $(date +%s) < deadline )); do
    if docker ps --filter "name=townhouse-hs-connector" --filter "status=running" --format '{{.Names}}' \
         | grep -q '^townhouse-hs-connector$' \
       && curl -sfk --max-time 3 "$CONNECTOR_ADMIN_URL/health" >/dev/null 2>&1; then
      connector_up=1
      break
    fi
    sleep 2
  done
  if (( connector_up == 0 )); then
    err "townhouse-hs-connector did not reach healthy state within 60s after CLI exit"
    err "  Inspect: docker logs townhouse-hs-connector | tail -50"
    die "apex boot failed"
  fi
  log "townhouse-hs-connector healthy ✓"

  # host.json appears after the connector publishes the HS
  local host_json="$TOWNHOUSE_HOME/host.json"
  [[ -f "$host_json" ]] || die "host.json missing at $host_json — HS publish likely failed"
  APEX_HOSTNAME=$(jq -r .hostname "$host_json")
  [[ "$APEX_HOSTNAME" =~ ^[a-z2-7]{55,57}\.(anyone|anon)$ ]] \
    || die "host.json hostname malformed: $APEX_HOSTNAME"
  export APEX_HOSTNAME
  log "Apex .anyone hostname: $APEX_HOSTNAME"

  # Wait for townhouse-api transport readiness
  log "Waiting for townhouse-api /api/transport…"
  local deadline=$(( $(date +%s) + 30 ))
  while (( $(date +%s) < deadline )); do
    curl -sfk --max-time 5 "$TOWNHOUSE_API_URL/api/transport" >/dev/null 2>&1 && break
    sleep 2
  done

  # Start town relay + register peer + add self-delivery route
  start_town_relay
}

start_town_relay() {
  local town_compose="$TOWNHOUSE_HOME/compose/townhouse-hs.yml"
  [[ -f "$town_compose" ]] || { warn "town compose missing at $town_compose — skipping town"; return 0; }

  log "Starting town relay (--profile town)…"
  # Anvil acct[4] — must match TOWN_EVM_ADDRESS
  #
  # ── BUG-1 FIX (chain env) ──────────────────────────────────────────────────
  # The compose template wires `TOON_CHAIN: ${EVM_CHAIN:-}` / `TOON_RPC_URL:
  # ${EVM_RPC_URL:-}`. Docker Compose auto-loads `compose/.env` (written by the
  # townhouse `hs up` env-writer), and for a `custom`-network config that has
  # explicit EVM chainProviders that file pins `EVM_CHAIN=none` (the relay-only
  # sentinel — see packages/core/src/chain/network-profile.ts resolveCustom()).
  # The PUBLISHED `town:latest` image predates the `chain=none` relay-only
  # sentinel (packages/town/src/town.ts), so it rejects `TOON_CHAIN=none` with
  # `INVALID_CHAIN` and crash-loops, never reaching /health → its BTP peer never
  # connects → the connector route for g.townhouse.town falls back to the DVM
  # localDelivery handler (T00 "fetch failed"; no DVM runs in this stack).
  #
  # Shell env vars OVERRIDE compose/.env, so explicitly pass EVM_CHAIN=anvil +
  # EVM_CHAIN_ID=31337 (the local Anvil preset, chain-id 31337) here to override
  # the `.env`'s `none`. The town then boots healthy (relay path; the apex —
  # not the town — settles the client's on-chain claim, so the town does not
  # need a live settlement chain to FULFILL forwarded parent traffic).
  TOWNHOUSE_HOME="$TOWNHOUSE_HOME" \
  TOWNHOUSE_WALLET_DIR="$TOWNHOUSE_HOME" \
  TOWNHOUSE_WALLET_PASSWORD="$TEST_PASSWORD" \
  TOWN_SECRET_KEY="$(openssl rand -hex 32)" \
  TOWN_SETTLEMENT_PRIVATE_KEY='0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a' \
  APEX_EVM_ADDRESS="$APEX_EVM_ADDRESS" \
  FEE_PER_EVENT='0' \
  EVM_CHAIN='anvil' \
  EVM_CHAIN_ID='31337' \
  EVM_RPC_URL="$EVM_RPC_URL" \
    docker compose -f "$town_compose" --profile town up -d town \
    || warn "town profile up failed (continuing — smoke test will degrade)"

  log "Waiting for town BLS /health…"
  local deadline=$(( $(date +%s) + 60 ))
  local town_healthy=0
  while (( $(date +%s) < deadline )); do
    curl -sfk --max-time 5 "http://127.0.0.1:3100/health" >/dev/null 2>&1 && { town_healthy=1; break; }
    sleep 2
  done
  if (( town_healthy == 0 )); then
    warn "town BLS /health never came up within 60s — inspect: docker logs townhouse-hs-town | tail -40"
  fi

  # ── BUG-2 FIX (BTP route direction) ────────────────────────────────────────
  # The town's embedded connector DIALS its parent (CONNECTOR_URL=ws://connector
  # :3000) and tags that OUTBOUND session's peer (g.townhouse, == TOON_PARENT_
  # PEER_ID) as `relation:'parent'`, so it skips the inbound per-packet-claim
  # requirement for PREPAREs the apex forwards over that session (connector#78).
  #
  # The apex connector must therefore deliver g.townhouse.town packets BACK over
  # the SAME town→connector session (where the connector authenticates the peer
  # as `town`, from NODE_ID=town). A bare route `g.townhouse.town -> town` does
  # exactly that: nextHop `town` resolves to the town's live inbound BTP session.
  #
  # The PRIOR wiring did two wrong things, both yielding NO town FULFILL:
  #   1. Registered an OUTBOUND `transport:'direct'` peer (url ws://townhouse-hs-
  #      town:3000/btp). That makes the apex DIAL the town and forward over a
  #      SEPARATE connector→town session, where the town's BTP *server* sees the
  #      apex as an ordinary inbound peer (NOT its parent) → InboundClaimValidator
  #      demands a per-packet claim → F06 "No payment channel claim attached".
  #      (The `/btp` path suffix also broke the dial — the connector's BTP client
  #      handshakes at the ws root, not /btp.)
  #   2. Added a self-delivery route `g.townhouse.town -> g.townhouse`, which (via
  #      the apex's own `g.townhouse -> local` DVM-intake route) forced the packet
  #      into localDelivery → the DVM handler (no DVM here) → T00.
  #
  # The minimal correct fix is a single route to the town's inbound session and
  # NO outbound peer / NO self-route. The DVM-intake `g.townhouse -> local`
  # route + localDelivery handler (written by hs-config-writer) is left intact,
  # so stacks that DO run a DVM are unaffected (longest-prefix: g.townhouse.town
  # matches the more-specific town route; bare g.townhouse still self-delivers).
  log "Adding route g.townhouse.town → town (apex delivers over the town's inbound BTP session)…"
  curl -sfk --max-time 10 -X POST "$CONNECTOR_ADMIN_URL/admin/routes" \
    -H 'content-type: application/json' \
    -d '{"prefix":"g.townhouse.town","nextHop":"town","priority":0}' \
    > /dev/null || warn "town route registration failed"

  log "Sleeping 8s for the town→connector BTP session to settle…"
  sleep 8
}

down_townhouse_hs() {
  local cli
  cli=$(resolve_townhouse_cli 2>/dev/null) || return 0
  if [[ -d "$TOWNHOUSE_HOME" && -f "$TOWNHOUSE_HOME/config.yaml" ]]; then
    log "townhouse hs down…"
    TOWNHOUSE_HOME="$TOWNHOUSE_HOME" \
      $cli hs -c "$TOWNHOUSE_HOME/config.yaml" --password "$TEST_PASSWORD" down \
      2>&1 | head -50 || true
  fi
  # Belt-and-suspenders: also kill containers by name in case hs down missed any
  for c in "${HS_CONTAINERS[@]}"; do
    docker rm -f "$c" >/dev/null 2>&1 || true
  done
}

# ───────────────────────────────────────────────────────────────────────────────
# Local client container lifecycle
# ───────────────────────────────────────────────────────────────────────────────

# Build the toon-client image from the working tree (real npm-consumer build,
# docker/Dockerfile.toon-client) and tag it as $CLIENT_IMAGE so the compose file
# runs the freshly-built image. Used by `up --local`.
build_local_client_image() {
  log "Building $CLIENT_IMAGE from working tree (docker/Dockerfile.toon-client)…"
  DOCKER_BUILDKIT=1 docker build \
    -f "$REPO_ROOT/docker/Dockerfile.toon-client" \
    -t "$CLIENT_IMAGE" \
    "$REPO_ROOT" \
    || die "local toon-client image build failed"
}

up_local_client() {
  if [[ "$LOCAL_BUILD" == "1" ]]; then
    # Working-tree build — do NOT pull (it would overwrite the local image).
    build_local_client_image
  else
    log "Pulling toon-client image…"
    docker pull "$CLIENT_IMAGE" 2>&1 | tail -3 || \
      warn "image pull failed (will use local cache if present)"
  fi

  # Solana settlement env (Phase-2 Stage 2c; opt-in via E2E_SOLANA=1). When set,
  # the client entrypoint negotiates solana:devnet, opens a real on-chain channel
  # and pays a Solana-denominated claim to the apex's Solana settlement address.
  local sol_program="" sol_mint="" apex_sol=""
  if [[ "${E2E_SOLANA:-0}" == "1" ]]; then
    sol_program="${SOLANA_PROGRAM_ID:-EdJxYPDxGvaJuu57DSUptf4soLv8enpdyQJJhHDLiydG}"
    sol_mint="${SOLANA_USDC_MINT:-6GbdrVghwNKTz9raga7y3Y4qqX5Zgg3AC4d48Kt7C59Q}"
    apex_sol="$(resolve_apex_solana_signer)" || true
    if [[ -n "$apex_sol" ]]; then
      log "Solana payment ENABLED: program=$sol_program mint=$sol_mint apexRecipient=$apex_sol"
    else
      warn "E2E_SOLANA=1 but could not resolve apex Solana settlement signer — client will fall back to EVM-only"
    fi
  fi

  # Mina settlement env (Phase-2 Stage 3; opt-in via E2E_MINA=1). When set, the
  # client entrypoint negotiates mina:devnet and signs a Mina-denominated claim
  # to the apex's Mina settlement address. GATE: the resulting claim diverges
  # from connector 3.9.0's MinaClaimMessage contract → REJECTED at
  # validateClaimMessage (the wiring is exercised; the loop does NOT FULFILL).
  local mina_zkapp="" apex_mina="" mina_graphql=""
  if [[ "${E2E_MINA:-0}" == "1" ]]; then
    mina_zkapp="${MINA_ZKAPP_ADDRESS:-}"
    apex_mina="$(resolve_apex_mina_signer)" || true
    # Client reaches the lightnet GraphQL via host.docker.internal in LOCAL_CHAINS.
    mina_graphql="$MINA_GRAPHQL_URL"
    if [[ "${LOCAL_CHAINS:-0}" == "1" ]]; then
      mina_graphql="${MINA_GRAPHQL_URL//127.0.0.1/host.docker.internal}"
    fi
    if [[ -n "$mina_zkapp" && -n "$apex_mina" ]]; then
      log "Mina payment ENABLED: zkApp=$mina_zkapp graphql=$mina_graphql apexRecipient=$apex_mina"
    else
      warn "E2E_MINA=1 but zkApp ($mina_zkapp) or apex Mina signer ($apex_mina) missing — client will fall back to EVM-only"
    fi
  fi

  # Chain URLs the CLIENT container uses. In LOCAL_CHAINS mode the client lives on
  # the isolated e2e-client-net and cannot resolve compose service hostnames or
  # the host's 127.0.0.1, so it reaches the host-published local chains via
  # host.docker.internal (mapped to host-gateway in the compose extra_hosts).
  local client_evm_rpc="$EVM_RPC_URL" client_sol_rpc="$SOLANA_RPC_URL" client_faucet="$FAUCET_URL"
  if [[ "${LOCAL_CHAINS:-0}" == "1" ]]; then
    client_evm_rpc="${EVM_RPC_URL//127.0.0.1/host.docker.internal}"
    client_sol_rpc="${SOLANA_RPC_URL//127.0.0.1/host.docker.internal}"
    client_faucet="${FAUCET_URL//127.0.0.1/host.docker.internal}"
    log "LOCAL_CHAINS client chain URLs: evm=$client_evm_rpc solana=$client_sol_rpc"
  fi

  # Force a CLEAN start. Every restart cycles ephemeral keys; if we leave a
  # half-funded container running, the funding step will target stale keys.
  # Export env vars so both `down` AND `up` can interpolate the compose file —
  # docker compose down evaluates the same env-var refs as up.
  log "docker compose down + up -d (fresh client container)…"
  FAUCET_URL="$client_faucet" \
  EVM_RPC_URL="$client_evm_rpc" \
  SOLANA_RPC_URL="$client_sol_rpc" \
  SOLANA_PROGRAM_ID="$sol_program" \
  SOLANA_USDC_MINT="$sol_mint" \
  SOLANA_TOKEN_MINT="$sol_mint" \
  TARGET_SETTLEMENT_ADDRESS_SOLANA="$apex_sol" \
  MINA_ZKAPP_ADDRESS="$mina_zkapp" \
  MINA_GRAPHQL_URL="$mina_graphql" \
  TARGET_SETTLEMENT_ADDRESS_MINA="$apex_mina" \
    docker compose -f "$COMPOSE_FILE" down --remove-orphans 2>&1 | tail -3 || true
  FAUCET_URL="$client_faucet" \
  EVM_RPC_URL="$client_evm_rpc" \
  SOLANA_RPC_URL="$client_sol_rpc" \
  SOLANA_PROGRAM_ID="$sol_program" \
  SOLANA_USDC_MINT="$sol_mint" \
  SOLANA_TOKEN_MINT="$sol_mint" \
  TARGET_SETTLEMENT_ADDRESS_SOLANA="$apex_sol" \
  MINA_ZKAPP_ADDRESS="$mina_zkapp" \
  MINA_GRAPHQL_URL="$mina_graphql" \
  TARGET_SETTLEMENT_ADDRESS_MINA="$apex_mina" \
    docker compose -f "$COMPOSE_FILE" up -d

  # Wait for Fastify bind so /signer-info returns the keys. This happens in
  # ~1-3s after container start — well before the pod's ~30s balance-poll
  # deadline. The funding step that follows MUST complete before the deadline,
  # otherwise anyoneReady is permanently false until next container restart.
  log "Waiting for client /signer-info (Fastify bind, 60s budget)…"
  local deadline=$(( $(date +%s) + 60 ))
  while (( $(date +%s) < deadline )); do
    if curl -sfk --max-time 3 "$CLIENT_URL/signer-info" >/dev/null 2>&1; then
      log "Client HTTP up — $(curl -sk --max-time 3 "$CLIENT_URL/signer-info" | jq -c '{evm, sol}')"
      return 0
    fi
    sleep 2
  done
  warn "client /signer-info never responded within 60s — check: docker logs $CLIENT_CONTAINER"
  return 1
}

down_local_client() {
  log "docker compose down (client container)…"
  docker compose -f "$COMPOSE_FILE" down --remove-orphans 2>&1 | head -10 || true
}

# ───────────────────────────────────────────────────────────────────────────────
# Network isolation check (the user's stated requirement)
# ───────────────────────────────────────────────────────────────────────────────

verify_network_isolation() {
  log "Verifying Docker network isolation (no shared bridge)…"
  local hs_containers
  hs_containers=$(docker network inspect "$HS_NETWORK" 2>/dev/null \
    | jq -r '.[0].Containers | to_entries | map(.value.Name) | .[]' 2>/dev/null \
    || echo "")
  local client_containers
  client_containers=$(docker network inspect "$CLIENT_NETWORK" 2>/dev/null \
    | jq -r '.[0].Containers | to_entries | map(.value.Name) | .[]' 2>/dev/null \
    || echo "")

  if echo "$hs_containers" | grep -q "$CLIENT_CONTAINER"; then
    die "network isolation BROKEN: $CLIENT_CONTAINER is attached to $HS_NETWORK"
  fi
  for hs in "${HS_CONTAINERS[@]}"; do
    if echo "$client_containers" | grep -q "$hs"; then
      die "network isolation BROKEN: $hs is attached to $CLIENT_NETWORK"
    fi
  done

  log "isolation OK — $HS_NETWORK: [$hs_containers] / $CLIENT_NETWORK: [$client_containers]"
}

# ───────────────────────────────────────────────────────────────────────────────
# Smoke (drive one publish manually)
# ───────────────────────────────────────────────────────────────────────────────

cmd_smoke() {
  read_leases
  [[ -f "$TOWNHOUSE_HOME/host.json" ]] || die "Apex host.json missing — run: bash $0 up"
  local apex_hostname
  apex_hostname=$(jq -r .hostname "$TOWNHOUSE_HOME/host.json")

  log "Fetching pre-publish /api/earnings…"
  local pre
  pre=$(curl -sfk --max-time 10 "$TOWNHOUSE_API_URL/api/earnings") || die "townhouse-api /api/earnings not reachable"
  echo "$pre" | jq -c '{eventsRelayed, recentClaimsCount: (.recentClaims | length)}'

  log "POST $CLIENT_URL/publish (target=$apex_hostname, fee=1_000_000 raw USDC)…"
  # Build a minimal kind:1 event without nostr-tools — we just need the wire-valid
  # shape; the pod's ajv validator enforces structure. Sig is a 64-byte zero
  # placeholder; the relay accepts it because we never set strict-sig-validation.
  # Real test path (sig verify) lives in the vitest smoke.
  local now_unix=$(date +%s)
  local body
  body=$(jq -c -n \
    --arg apex "$apex_hostname" \
    --arg now "$now_unix" \
    '{
      event: {
        id: ("0000" | . + ("0" * 60)),
        pubkey: ("aaaa" | . + ("a" * 60)),
        created_at: ($now | tonumber),
        kind: 1,
        tags: [],
        content: "smoke-test",
        sig: ("0000" | . + ("0" * 124))
      },
      targetHostname: $apex
    }')
  # NOTE: this synthetic body won't pass the connector's sig validation in real
  # flow. For a working smoke, use the vitest test which signs with nostr-tools.
  local res
  res=$(curl -sk --max-time 120 -X POST "$CLIENT_URL/publish" \
    -H 'content-type: application/json' \
    -d "$body") || die "publish failed"
  echo "$res" | jq -c '.' || echo "$res"

  log "Sleeping 5s for credit propagation…"
  sleep 5

  log "Fetching post-publish /api/earnings…"
  curl -sfk --max-time 10 "$TOWNHOUSE_API_URL/api/earnings" \
    | jq -c '{eventsRelayed, recentClaims: .recentClaims}' \
    || die "townhouse-api /api/earnings not reachable post-publish"

  log "For a real signed publish + earnings assertion, run the vitest smoke:"
  log "  RUN_LOCAL_HS_E2E=1 pnpm --filter @toon-protocol/townhouse test:integration -- local-docker-hs-paid-earnings-smoke"
}

# ───────────────────────────────────────────────────────────────────────────────
# Status
# ───────────────────────────────────────────────────────────────────────────────

cmd_status() {
  banner "Status"
  log "Docker containers:"
  docker ps --filter "name=townhouse-hs-" --filter "name=$CLIENT_CONTAINER" \
    --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}' || true
  echo
  log "Health probes:"
  for url in "$CONNECTOR_ADMIN_URL/health" "$TOWNHOUSE_API_URL/api/transport" "$CLIENT_URL/healthz"; do
    if curl -sfk --max-time 3 "$url" >/dev/null 2>&1; then
      printf '  \033[32m✓\033[0m %s\n' "$url"
    else
      printf '  \033[31m✗\033[0m %s\n' "$url"
    fi
  done
  echo
  if [[ -f "$TOWNHOUSE_HOME/host.json" ]]; then
    log "Apex .anyone hostname: $(jq -r .hostname "$TOWNHOUSE_HOME/host.json")"
  else
    warn "host.json not found — apex not booted"
  fi
}

# ───────────────────────────────────────────────────────────────────────────────
# Top-level verbs
# ───────────────────────────────────────────────────────────────────────────────

cmd_up() {
  check_prereqs
  read_leases
  preflight_probes
  ensure_image_manifest   # self-heal dist/image-manifest.json + rendered compose

  # townhouse-hs.yml volume mounts hardcode `${TOWNHOUSE_WALLET_DIR:-~/.townhouse}`
  # on BOTH sides of the bind. Docker does NOT expand `~` in volume specs.
  # Pin to an absolute path so the API container can start. Mirror the 49.4
  # test, which sets TOWNHOUSE_WALLET_DIR = TOWNHOUSE_HOME.
  export TOWNHOUSE_WALLET_DIR="$TOWNHOUSE_HOME"
  export TOWNHOUSE_UID="$(id -u)"
  export TOWNHOUSE_DOCKER_GID="$(getent group docker | cut -d: -f3 || echo 0)"

  up_townhouse_hs        # uses ~/.townhouse-e2e
  fund_apex_and_town
  up_local_client         # fresh container; Fastify up within ~3s, keys generated
  fund_client_pod         # fund the FRESH ephemeral keys before pod's poll deadline
  wait_for_client_ready   # poll /healthz until anyoneReady=true (no restart needed)
  verify_network_isolation
  print_banner
}

cmd_fund() {
  read_leases
  fund_apex_and_town
  if docker ps --filter "name=$CLIENT_CONTAINER" --format '{{.Names}}' | grep -q "$CLIENT_CONTAINER"; then
    fund_client_pod
    wait_for_client_ready
  else
    log "Client container not running — skipping client funding"
  fi
}

cmd_down() {
  down_local_client
  down_townhouse_hs
  log "Down complete. Volumes + state preserved. Use 'down-v' to remove them."
}

cmd_down_v() {
  cmd_down
  log "Removing volumes + state dir…"
  docker compose -f "$COMPOSE_FILE" down -v 2>&1 | head -5 || true
  docker volume rm -f townhouse-hs-anon townhouse-hs-town-data >/dev/null 2>&1 || true
  rm -rf "$TOWNHOUSE_HOME"
  log "Clean."
}

print_banner() {
  local apex_hostname="(unknown)"
  if [[ -f "$TOWNHOUSE_HOME/host.json" ]]; then
    apex_hostname=$(jq -r .hostname "$TOWNHOUSE_HOME/host.json")
  fi
  local client_evm="(unknown)" client_sol="(unknown)"
  local client_info
  if client_info=$(curl -sfk --max-time 3 "$CLIENT_URL/signer-info" 2>/dev/null); then
    client_evm=$(echo "$client_info" | jq -r '.evm // .evmAddr // "?"')
    client_sol=$(echo "$client_info" | jq -r '.sol // .solAddr // "?"')
  fi

  banner "Local-HS E2E Stack — READY"
  cat >&2 <<EOF
  Apex .anyone hostname    : $apex_hostname
  townhouse-api /earnings  : $TOWNHOUSE_API_URL/api/earnings
  connector admin /health  : $CONNECTOR_ADMIN_URL/health
  toon-client-e2e /healthz : $CLIENT_URL/healthz

  client EVM addr          : $client_evm
  client SOL addr          : $client_sol
  apex   EVM addr          : $APEX_EVM_ADDRESS
  town   EVM addr          : $TOWN_EVM_ADDRESS

  network isolation        : $HS_NETWORK  <-/X/->  $CLIENT_NETWORK
  ATOR transport           : client SOCKS5 → public ATOR → apex .anyone HS

  Drive a publish manually : bash $0 smoke
  Run gated vitest         : RUN_LOCAL_HS_E2E=1 \\
                               pnpm --filter @toon-protocol/townhouse test:integration -- \\
                               local-docker-hs-paid-earnings-smoke
  Tear down                : bash $0 down-v

EOF
}

# ───────────────────────────────────────────────────────────────────────────────
# Entry
# ───────────────────────────────────────────────────────────────────────────────

VERB="${1:-help}"
# `up --local` rebuilds the toon-client image from the working tree (instead of
# pulling :demo). Accept the flag in either order.
for arg in "$@"; do
  [[ "$arg" == "--local" ]] && LOCAL_BUILD=1
done
case "$VERB" in
  up)      cmd_up ;;
  down)    cmd_down ;;
  down-v)  cmd_down_v ;;
  fund)    cmd_fund ;;
  smoke)   cmd_smoke ;;
  status)  cmd_status ;;
  help|*)
    cat >&2 <<EOF
Local-Docker TOON Client ↔ Townhouse HS E2E (Akash devnet chains)

  bash $0 up           Bring up the whole stack (~3-5min cold boot; pulls toon-client:demo)
  bash $0 up --local   Same, but BUILD toon-client from the working tree first
                       (docker/Dockerfile.toon-client) and skip the registry pull
  bash $0 smoke        Drive one publish + show earnings (manual)
  bash $0 status       Show container + health
  bash $0 fund         Re-drip faucet for apex + town
  bash $0 down         Stop containers, leave volumes
  bash $0 down-v       Stop containers + remove volumes + state dir

State: $TOWNHOUSE_HOME
Compose: $COMPOSE_FILE
Leases: $LEASES_PATH
EOF
    ;;
esac
