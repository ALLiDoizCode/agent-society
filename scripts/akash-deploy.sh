#!/usr/bin/env bash
# Akash Console REST API deploy orchestrator for TOON demo chain nodes.
#
# Builds + pushes custom images (SHA-pinned + :demo convenience tag), deploys
# all 4 SDLs in order (anvil, solana, blockscout, solana-explorer — explorers
# depend on chain nodes' lease URLs) via the managed-wallet Console API, and
# writes deploy/akash/leases.json with the resulting hostnames + image digests.
#
# Auth model: Akash Console managed wallet. No mnemonic, no AKT, no gas. The
# Console hosts a wallet that signs txs on your behalf; you fund it via card
# in console.akash.network and call the REST API with an x-api-key header.
#
# Prereqs:
#   - AKASH_CONSOLE_API_KEY exported (format: ac.sk.production.*)
#     Create at: https://console.akash.network -> profile -> API Keys
#   - Console balance >=$50 (covers all 4 leases for ~30d at our prices)
#   - docker login ghcr.io (PAT with write:packages)
#   - jq, curl
#
# Usage:
#   scripts/akash-deploy.sh build              # build + push images only
#   scripts/akash-deploy.sh anvil              # deploy anvil
#   scripts/akash-deploy.sh solana             # deploy solana
#   scripts/akash-deploy.sh blockscout         # deploy blockscout (anvil first)
#   scripts/akash-deploy.sh solana-explorer    # deploy explorer (solana first)
#   scripts/akash-deploy.sh all                # build + deploy all (in order)
#   scripts/akash-deploy.sh close <name>       # close a lease (DELETE)
#   scripts/akash-deploy.sh redeploy <name>    # close + redeploy, denylist prior provider

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SDL_DIR="$ROOT/deploy/akash"
LEASES_FILE="$SDL_DIR/leases.json"

API_BASE="${AKASH_CONSOLE_API_URL:-https://console-api.akash.network}"

# Per-service deposit in dollars (Console minimum is $5). Conservative for ~30d
# at our SDL prices. Top up via Console UI if a lease starts running low.
DEPOSIT_ANVIL=5
DEPOSIT_SOLANA=10
DEPOSIT_BLOCKSCOUT=15
DEPOSIT_SOLANA_EXPLORER=5

# Compute build SHAs from inputs the image actually depends on.
ANVIL_SHA="$(
  cat "$ROOT/docker/Dockerfile.akash-anvil" 2>/dev/null \
  | { find "$ROOT/contracts/evm" -type f -print0 2>/dev/null | xargs -0 cat 2>/dev/null; cat; } \
  | sha256sum | head -c 12
)"
SOLANA_SHA="$(
  cat "$ROOT/docker/Dockerfile.akash-solana" "$ROOT/infra/solana/entrypoint.sh" 2>/dev/null \
  | { find "$ROOT/contracts/solana" -type f -print0 2>/dev/null | xargs -0 cat 2>/dev/null; cat; } \
  | sha256sum | head -c 12
)"
SOLANA_EXPLORER_SHA="$(sha256sum "$ROOT/docker/Dockerfile.akash-solana-explorer" 2>/dev/null | head -c 12 || echo unknown)"

ANVIL_IMAGE_TAGGED="ghcr.io/toon-protocol/akash-anvil:sha-$ANVIL_SHA"
ANVIL_IMAGE_DEMO="ghcr.io/toon-protocol/akash-anvil:demo"
SOLANA_IMAGE_TAGGED="ghcr.io/toon-protocol/akash-solana:sha-$SOLANA_SHA"
SOLANA_IMAGE_DEMO="ghcr.io/toon-protocol/akash-solana:demo"
SOLANA_EXPLORER_IMAGE_TAGGED="ghcr.io/toon-protocol/akash-solana-explorer:sha-$SOLANA_EXPLORER_SHA"
SOLANA_EXPLORER_IMAGE_DEMO="ghcr.io/toon-protocol/akash-solana-explorer:demo"

require_env() {
  for v in "$@"; do
    if [ -z "${!v:-}" ]; then
      echo "ERROR: $v not set" >&2
      exit 1
    fi
  done
}

require_cli() {
  for c in "$@"; do
    if ! command -v "$c" >/dev/null 2>&1; then
      echo "ERROR: $c not on PATH" >&2
      exit 1
    fi
  done
}

ensure_leases_file() {
  if [ ! -f "$LEASES_FILE" ]; then
    echo '{}' > "$LEASES_FILE"
  fi
}

# Wrap a Console API call. Adds auth header, fails on non-2xx, returns body.
api() {
  local method="$1" path="$2" body="${3:-}"
  require_env AKASH_CONSOLE_API_KEY
  if [ -n "$body" ]; then
    curl -fsS -X "$method" "$API_BASE$path" \
      -H "x-api-key: $AKASH_CONSOLE_API_KEY" \
      -H "Content-Type: application/json" \
      -d "$body"
  else
    curl -fsS -X "$method" "$API_BASE$path" \
      -H "x-api-key: $AKASH_CONSOLE_API_KEY"
  fi
}

write_lease() {
  local name="$1" dseq="$2" provider="$3" host="$4" port="$5" url="$6" image_digest="${7:-}"
  ensure_leases_file
  local tmp
  tmp="$(mktemp)"
  jq --arg n "$name" --arg d "$dseq" --arg p "$provider" --arg h "$host" \
     --arg port "$port" --arg url "$url" --arg digest "$image_digest" \
     '.[$n] = {
        dseq: $d,
        provider: $p,
        host: $h,
        port: ($port|tonumber),
        url: $url,
        image_digest: $digest,
        deployed_at: now | todate
      }' \
     "$LEASES_FILE" > "$tmp"
  mv "$tmp" "$LEASES_FILE"
  echo "Wrote lease for $name → $url"
}

# Poll until the URL responds with a service-specific success, or time out.
wait_for_url() {
  local name="$1" url="$2" probe="$3" timeout="${4:-300}"
  local start now
  start="$(date +%s)"
  echo "[$name] Waiting up to ${timeout}s for $url..."
  while true; do
    if "$probe" "$url"; then
      echo "[$name] Ready at $url"
      return 0
    fi
    now="$(date +%s)"
    if [ "$((now - start))" -gt "$timeout" ]; then
      echo "[$name] ERROR: $url did not become ready within ${timeout}s" >&2
      return 1
    fi
    sleep 5
  done
}

probe_evm_rpc() {
  curl -sf -m 5 -X POST "$1" \
    -H 'Content-Type: application/json' \
    -d '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}' \
    2>/dev/null | grep -q '"result"'
}

probe_evm_ws() {
  local out
  out="$(curl -sS -m 5 --include \
    -H "Connection: Upgrade" \
    -H "Upgrade: websocket" \
    -H "Sec-WebSocket-Version: 13" \
    -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" \
    "$1" 2>&1 | head -1)"
  echo "$out" | grep -q '101'
}

probe_solana_rpc() {
  curl -sf -m 5 -X POST "$1" \
    -H 'Content-Type: application/json' \
    -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' \
    2>/dev/null | grep -q '"result":"ok"'
}

probe_blockscout() {
  local code
  code="$(curl -sf -m 5 -o /dev/null -w '%{http_code}' "$1/api/v1/health" 2>/dev/null || echo 000)"
  [ "$code" = "200" ]
}

probe_otterscan() {
  # Otterscan is a static React SPA — root returns 200 once nginx is up.
  # Use --connect-timeout to fail fast on routing-broken providers; the
  # default behavior (TLS opens, then HTTP hangs forever) ate our 300s
  # readiness window once.
  local code
  code="$(curl -sf -m 8 --connect-timeout 5 -o /dev/null -w '%{http_code}' "$1/" 2>/dev/null || echo 000)"
  [ "$code" = "200" ]
}

probe_http_200() {
  local code
  code="$(curl -sf -m 5 -o /dev/null -w '%{http_code}' "$1" 2>/dev/null || echo 000)"
  [ "$code" = "200" ]
}

cmd_build() {
  require_cli docker
  echo "Building $ANVIL_IMAGE_TAGGED + :demo..."
  docker build -f "$ROOT/docker/Dockerfile.akash-anvil" \
    -t "$ANVIL_IMAGE_TAGGED" -t "$ANVIL_IMAGE_DEMO" "$ROOT"
  echo "Pushing anvil image (both tags)..."
  docker push "$ANVIL_IMAGE_TAGGED"
  docker push "$ANVIL_IMAGE_DEMO"

  echo "Building $SOLANA_IMAGE_TAGGED + :demo..."
  docker build -f "$ROOT/docker/Dockerfile.akash-solana" \
    -t "$SOLANA_IMAGE_TAGGED" -t "$SOLANA_IMAGE_DEMO" "$ROOT"
  echo "Pushing solana image (both tags)..."
  docker push "$SOLANA_IMAGE_TAGGED"
  docker push "$SOLANA_IMAGE_DEMO"

  if [ -f "$ROOT/docker/Dockerfile.akash-solana-explorer" ]; then
    echo "Building $SOLANA_EXPLORER_IMAGE_TAGGED + :demo..."
    docker build -f "$ROOT/docker/Dockerfile.akash-solana-explorer" \
      -t "$SOLANA_EXPLORER_IMAGE_TAGGED" -t "$SOLANA_EXPLORER_IMAGE_DEMO" "$ROOT"
    echo "Pushing solana-explorer image (both tags)..."
    docker push "$SOLANA_EXPLORER_IMAGE_TAGGED"
    docker push "$SOLANA_EXPLORER_IMAGE_DEMO"
  fi
}

image_digest() {
  docker inspect --format '{{index .RepoDigests 0}}' "$1" 2>/dev/null \
    | sed 's|^[^@]*@||' \
    || echo ""
}

# Akash Console deploy flow: POST /v1/deployments → GET /v1/bids → POST /v1/leases
# → poll GET /v1/deployments/{dseq} until forwarded_ports populate.
deploy_sdl() {
  local name="$1" sdl="$2" service="$3" port="$4" probe_fn="$5" deposit="$6" image_digest="${7:-}"
  require_env AKASH_CONSOLE_API_KEY
  require_cli curl jq

  echo "[$name] Reading SDL: $sdl"
  local sdl_content
  sdl_content="$(cat "$sdl")"

  echo "[$name] POST /v1/deployments (deposit=\$$deposit)..."
  local create_body create_resp dseq manifest
  create_body="$(jq -n --arg s "$sdl_content" --argjson d "$deposit" \
    '{data: {sdl: $s, deposit: $d}}')"
  create_resp="$(api POST /v1/deployments "$create_body")"
  dseq="$(echo "$create_resp" | jq -r '.data.dseq // empty')"
  manifest="$(echo "$create_resp" | jq -r '.data.manifest // empty')"
  if [ -z "$dseq" ]; then
    echo "[$name] ERROR: create returned no dseq:" >&2
    echo "$create_resp" >&2
    exit 1
  fi
  echo "[$name] DSEQ=$dseq"

  echo "[$name] Waiting 45s for bids..."
  sleep 45

  local bids_resp denylist provider gseq oseq
  bids_resp="$(api GET "/v1/bids?dseq=$dseq")"

  if [ -f "$SDL_DIR/denylist.json" ]; then
    denylist="$(jq -c '. // []' "$SDL_DIR/denylist.json")"
  else
    denylist='[]'
  fi

  # Sort by price ascending (numeric on amount string), exclude denylisted providers.
  local picked
  picked="$(echo "$bids_resp" | jq --argjson deny "$denylist" '
    (.data // .) as $arr
    | [$arr[] | select(.bid.id.provider as $p | $deny | index($p) | not)]
    | sort_by(.bid.price.amount | tonumber)
    | .[0].bid.id // empty')"
  provider="$(echo "$picked" | jq -r '.provider // empty')"
  gseq="$(echo "$picked" | jq -r '.gseq // empty')"
  oseq="$(echo "$picked" | jq -r '.oseq // empty')"

  if [ -z "$provider" ]; then
    echo "[$name] ERROR: no eligible bids for DSEQ=$dseq (after denylist)" >&2
    echo "$bids_resp" >&2
    # Close the open deployment so the deposit (which is still locked in the
    # provider-less escrow account) is refunded. Without this, every aborted
    # bid round leaks ~$deposit AKT until manually closed via the Console.
    echo "[$name] Closing orphan DSEQ=$dseq to refund \$$deposit deposit..." >&2
    api DELETE "/v1/deployments/$dseq" >/dev/null \
      || echo "[$name] WARNING: orphan close failed; close DSEQ=$dseq manually" >&2
    exit 1
  fi
  echo "[$name] Selected provider: $provider (gseq=$gseq oseq=$oseq)"

  echo "[$name] POST /v1/leases (creates lease + sends manifest)..."
  local lease_body
  lease_body="$(jq -n --arg m "$manifest" --arg d "$dseq" \
    --argjson g "$gseq" --argjson o "$oseq" --arg p "$provider" \
    '{manifest: $m, leases: [{dseq: $d, gseq: $g, oseq: $o, provider: $p}]}')"
  api POST /v1/leases "$lease_body" >/dev/null

  await_lease_ready "$name" "$dseq" "$provider" "$service" "$port" "$probe_fn" "$image_digest"
}

# Polls /v1/deployments/{dseq} until either:
#   (a) forwarded_ports has an entry for the requested service+port (TCP path), or
#   (b) services[service].uris[0] is populated (Akash HTTP ingress path —
#       used when SDL `as: 80` or `as: 443` triggers the L7 ingress)
# Then writes the lease to leases.json and waits for the URL to actually
# respond with the service-specific probe.
#
# Used both by deploy_sdl (after creating a fresh lease) and cmd_resume
# (re-attaching to an in-flight deploy whose script run was interrupted).
await_lease_ready() {
  local name="$1" dseq="$2" provider="$3" service="$4" port="$5" probe_fn="$6" image_digest="${7:-}"

  echo "[$name] Polling /v1/deployments/$dseq for endpoint (timeout 180s)..."
  local status_resp host external_port uri url elapsed=0
  while [ "$elapsed" -lt 180 ]; do
    status_resp="$(api GET "/v1/deployments/$dseq" 2>/dev/null || echo '{}')"

    # Path A: forwarded TCP port (anvil, solana RPC/WS, solana-explorer)
    host="$(echo "$status_resp" | jq -r --arg s "$service" --arg p "$port" \
      '(.data.leases // []) | .[].status.forwarded_ports[$s][]?
       | select(.port == ($p|tonumber)) | .host' | head -1)"
    external_port="$(echo "$status_resp" | jq -r --arg s "$service" --arg p "$port" \
      '(.data.leases // []) | .[].status.forwarded_ports[$s][]?
       | select(.port == ($p|tonumber)) | .externalPort' | head -1)"

    if [ -n "$host" ] && [ "$host" != "null" ] && [ -n "$external_port" ] && [ "$external_port" != "null" ]; then
      url="http://$host:$external_port"
      break
    fi

    # Path B: HTTP ingress URI (blockscout — `as: 80` triggers L7 ingress).
    # Akash ingress fronts with TLS automatically — scheme is https, no port.
    uri="$(echo "$status_resp" | jq -r --arg s "$service" \
      '(.data.leases // []) | .[].status.services[$s].uris[0]? // empty' | head -1)"
    if [ -n "$uri" ] && [ "$uri" != "null" ]; then
      host="$uri"
      external_port="443"
      url="https://$uri"
      break
    fi

    sleep 5
    elapsed=$((elapsed + 5))
  done

  if [ -z "${url:-}" ]; then
    echo "[$name] ERROR: no endpoint assigned within 180s" >&2
    echo "$status_resp" >&2
    exit 1
  fi

  write_lease "$name" "$dseq" "$provider" "$host" "$external_port" "$url" "$image_digest"

  local timeout=300
  if [ "$name" = "blockscout" ]; then
    timeout=900
  fi
  if ! wait_for_url "$name" "$url" "$probe_fn" "$timeout"; then
    echo "[$name] HINT: provider $provider may be misconfigured. Try:"
    echo "       scripts/akash-deploy.sh redeploy $name"
    exit 1
  fi
}

# Re-attach to an in-flight deploy whose script run was interrupted (e.g.
# script timed out before the slow Blockscout boot finished). Reads dseq +
# provider from the existing leases.json (or accepts dseq + provider as
# args) and resumes the polling.
cmd_resume() {
  local name="${1:-}" override_dseq="${2:-}" override_provider="${3:-}"
  if [ -z "$name" ]; then
    echo "Usage: $0 resume <anvil|solana|blockscout|solana-explorer> [dseq] [provider]" >&2
    exit 1
  fi

  ensure_leases_file
  local dseq provider service port probe_fn image_digest=""
  case "$name" in
    anvil) service=anvil; port=8545; probe_fn=probe_evm_rpc; image_digest="$(image_digest "$ANVIL_IMAGE_DEMO" 2>/dev/null || true)" ;;
    solana) service=solana; port=8899; probe_fn=probe_solana_rpc; image_digest="$(image_digest "$SOLANA_IMAGE_DEMO" 2>/dev/null || true)" ;;
    blockscout) service=blockscout; port=4000; probe_fn=probe_blockscout ;;
    otterscan) service=otterscan; port=80; probe_fn=probe_otterscan ;;
    solana-explorer) service=solana-explorer; port=3000; probe_fn=probe_http_200; image_digest="$(image_digest "$SOLANA_EXPLORER_IMAGE_DEMO" 2>/dev/null || true)" ;;
    *) echo "Unknown service: $name" >&2; exit 1 ;;
  esac

  if [ -n "$override_dseq" ]; then
    dseq="$override_dseq"
    provider="$override_provider"
  else
    dseq="$(jq -r --arg n "$name" '.[$n].dseq // ""' "$LEASES_FILE")"
    provider="$(jq -r --arg n "$name" '.[$n].provider // ""' "$LEASES_FILE")"
  fi

  if [ -z "$dseq" ]; then
    echo "ERROR: no DSEQ for $name; pass it as second arg or check $LEASES_FILE" >&2
    exit 1
  fi

  # Provider isn't strictly required for polling — fetch it from API if missing.
  if [ -z "$provider" ]; then
    provider="$(api GET "/v1/deployments/$dseq" | jq -r '.data.leases[0].id.provider // empty')"
  fi

  echo "[$name] Resuming dseq=$dseq provider=$provider"
  await_lease_ready "$name" "$dseq" "$provider" "$service" "$port" "$probe_fn" "$image_digest"
}

cmd_anvil() {
  local digest
  digest="$(image_digest "$ANVIL_IMAGE_DEMO")"
  deploy_sdl anvil "$SDL_DIR/anvil.sdl.yaml" anvil 8545 probe_evm_rpc "$DEPOSIT_ANVIL" "$digest"

  local anvil_url
  anvil_url="$(jq -r '.anvil.url' "$LEASES_FILE")"
  if probe_evm_ws "$anvil_url"; then
    echo "[anvil] WebSocket upgrade OK"
  else
    echo "[anvil] WARNING: WebSocket upgrade rejected by this provider." >&2
    echo "[anvil] HINT: dashboard WS subscriptions will fail. Run:" >&2
    echo "       scripts/akash-deploy.sh redeploy anvil" >&2
  fi
}

cmd_solana() {
  local digest
  digest="$(image_digest "$SOLANA_IMAGE_DEMO")"
  deploy_sdl solana "$SDL_DIR/solana.sdl.yaml" solana 8899 probe_solana_rpc "$DEPOSIT_SOLANA" "$digest"

  # Capture WS host:port (port 8900) from the same lease.
  local dseq status_resp host port
  dseq="$(jq -r '.solana.dseq' "$LEASES_FILE")"
  status_resp="$(api GET "/v1/deployments/$dseq")"
  host="$(echo "$status_resp" | jq -r \
    '(.data.leases // []) | .[].status.forwarded_ports.solana[]?
     | select(.port == 8900) | .host' | head -1)"
  port="$(echo "$status_resp" | jq -r \
    '(.data.leases // []) | .[].status.forwarded_ports.solana[]?
     | select(.port == 8900) | .externalPort' | head -1)"
  if [ -n "$host" ] && [ "$host" != "null" ]; then
    local tmp
    tmp="$(mktemp)"
    jq --arg h "$host" --arg p "$port" \
       '.solana.ws_host = $h | .solana.ws_port = ($p|tonumber) | .solana.ws_url = ("ws://" + $h + ":" + $p)' \
       "$LEASES_FILE" > "$tmp"
    mv "$tmp" "$LEASES_FILE"
    echo "Solana WS → ws://$host:$port"
  fi
}

cmd_blockscout() {
  ensure_leases_file
  local anvil_url
  anvil_url="$(jq -r '.anvil.url // ""' "$LEASES_FILE")"
  if [ -z "$anvil_url" ]; then
    echo "ERROR: anvil lease not found in $LEASES_FILE — deploy anvil first" >&2
    exit 1
  fi

  local secret_key
  secret_key="$(openssl rand -hex 32)"

  local templated
  templated="$(mktemp --suffix=.yaml)"
  sed -e "s|\$ANVIL_RPC_URL|$anvil_url|g" \
      -e "s|\$BLOCKSCOUT_SECRET_KEY_BASE|$secret_key|g" \
      "$SDL_DIR/blockscout.sdl.yaml" > "$templated"

  deploy_sdl blockscout "$templated" blockscout 4000 probe_blockscout "$DEPOSIT_BLOCKSCOUT" ""
  rm -f "$templated"
}

# Otterscan — current default EVM explorer. Replaces Blockscout for
# Anvil dev chains (Blockscout's all-in-one path is broken in the multi-
# service split of recent versions; Otterscan is purpose-built for dev).
cmd_otterscan() {
  ensure_leases_file
  local anvil_url
  anvil_url="$(jq -r '.anvil.url // ""' "$LEASES_FILE")"
  if [ -z "$anvil_url" ]; then
    echo "ERROR: anvil lease not found in $LEASES_FILE — deploy anvil first" >&2
    exit 1
  fi

  local templated
  templated="$(mktemp --suffix=.yaml)"
  sed -e "s|\$ANVIL_RPC_URL|$anvil_url|g" \
      "$SDL_DIR/otterscan.sdl.yaml" > "$templated"

  # Otterscan deposit reuses the blockscout budget (it's the same lease slot).
  deploy_sdl otterscan "$templated" otterscan 80 probe_otterscan "$DEPOSIT_BLOCKSCOUT" ""
  rm -f "$templated"
}

cmd_solana_explorer() {
  ensure_leases_file
  local sol_url sol_ws_url
  sol_url="$(jq -r '.solana.url // ""' "$LEASES_FILE")"
  sol_ws_url="$(jq -r '.solana.ws_url // ""' "$LEASES_FILE")"
  if [ -z "$sol_url" ]; then
    echo "ERROR: solana lease not found in $LEASES_FILE — deploy solana first" >&2
    exit 1
  fi

  local templated
  templated="$(mktemp --suffix=.yaml)"
  sed -e "s|\$SOLANA_RPC_URL|$sol_url|g" \
      -e "s|\$SOLANA_WS_URL|$sol_ws_url|g" \
      "$SDL_DIR/solana-explorer.sdl.yaml" > "$templated"

  local digest
  digest="$(image_digest "$SOLANA_EXPLORER_IMAGE_DEMO")"
  deploy_sdl solana-explorer "$templated" solana-explorer 3000 probe_http_200 "$DEPOSIT_SOLANA_EXPLORER" "$digest"
  rm -f "$templated"
}

# Akash Console UI stores deployment display names in browser localStorage:
#   key: `${networkId}/${walletAddress}/deployments/${dseq}.data`
#   value: { owner, name, manifest?, manifestVersion? }
# There is no Console API endpoint to set names server-side. This subcommand
# emits a JS snippet you paste into the Console browser console (DevTools)
# while logged in at https://console.akash.network/deployments — it seeds the
# friendly names for every lease in leases.json in one shot.
cmd_name() {
  ensure_leases_file
  require_env AKASH_CONSOLE_API_KEY
  require_cli curl jq

  # Friendly names per service.
  local -A FRIENDLY_NAME=(
    [anvil]="Town EVM Devnet"
    [solana]="Town SOL Devnet"
    [otterscan]="Town EVM Explorer"
    [blockscout]="Town Blockscout"
    [solana-explorer]="Town SOL Explorer"
  )

  # Build a JS object literal { dseq: name, ... }.
  local entries=""
  local owner=""
  for service in anvil solana otterscan blockscout solana-explorer; do
    local dseq
    dseq="$(jq -r --arg n "$service" '.[$n].dseq // empty' "$LEASES_FILE")"
    if [ -z "$dseq" ]; then continue; fi

    # Fetch owner once — same wallet for all our deployments.
    if [ -z "$owner" ]; then
      owner="$(curl -sS -H "x-api-key: $AKASH_CONSOLE_API_KEY" \
        "$API_BASE/v1/deployments/$dseq" \
        | jq -r '.data.deployment.id.owner // empty')"
    fi

    entries="$entries  '$dseq': '${FRIENDLY_NAME[$service]}',
"
  done

  if [ -z "$owner" ]; then
    echo "ERROR: no leases found in $LEASES_FILE" >&2
    exit 1
  fi

  cat <<EOF
# ──────────────────────────────────────────────────────────────────────
# Paste this into the DevTools console at https://console.akash.network
# (any page after you've signed in) to seed deployment display names:
# ──────────────────────────────────────────────────────────────────────
const owner = '$owner';
const network = 'akashnet-2';
const names = {
$(printf '%s' "$entries")};
for (const [dseq, name] of Object.entries(names)) {
  const key = \`\${network}/\${owner}/deployments/\${dseq}.data\`;
  const existing = JSON.parse(localStorage.getItem(key) || '{}');
  localStorage.setItem(key, JSON.stringify({ ...existing, owner, name }));
}
location.reload();
EOF
}

cmd_close() {
  local name="${1:-}"
  if [ -z "$name" ]; then
    echo "Usage: $0 close <anvil|solana|otterscan|blockscout|solana-explorer>" >&2
    exit 1
  fi
  ensure_leases_file
  local dseq
  dseq="$(jq -r --arg n "$name" '.[$n].dseq // ""' "$LEASES_FILE")"
  if [ -z "$dseq" ]; then
    echo "ERROR: no lease found for $name" >&2
    exit 1
  fi
  echo "DELETE /v1/deployments/$dseq..."
  api DELETE "/v1/deployments/$dseq" >/dev/null
  local tmp
  tmp="$(mktemp)"
  jq --arg n "$name" 'del(.[$n])' "$LEASES_FILE" > "$tmp"
  mv "$tmp" "$LEASES_FILE"
  echo "Closed $name (DSEQ=$dseq)"
}

cmd_redeploy() {
  local name="${1:-}"
  if [ -z "$name" ]; then
    echo "Usage: $0 redeploy <anvil|solana|otterscan|blockscout|solana-explorer>" >&2
    exit 1
  fi
  ensure_leases_file

  local prior_provider
  prior_provider="$(jq -r --arg n "$name" '.[$n].provider // ""' "$LEASES_FILE")"
  if [ -n "$prior_provider" ]; then
    local deny_file="$SDL_DIR/denylist.json"
    if [ ! -f "$deny_file" ]; then echo '[]' > "$deny_file"; fi
    local tmp
    tmp="$(mktemp)"
    jq --arg p "$prior_provider" '. + [$p] | unique' "$deny_file" > "$tmp"
    mv "$tmp" "$deny_file"
    echo "Added $prior_provider to denylist."
  fi

  cmd_close "$name"
  case "$name" in
    anvil) cmd_anvil ;;
    solana) cmd_solana ;;
    blockscout) cmd_blockscout ;;
    otterscan) cmd_otterscan ;;
    solana-explorer) cmd_solana_explorer ;;
    *) echo "Unknown service: $name" >&2; exit 1 ;;
  esac
}

cmd_all() {
  cmd_build
  cmd_anvil
  cmd_solana
  cmd_otterscan
  cmd_solana_explorer
  echo
  echo "All leases provisioned. See $LEASES_FILE."
  jq . "$LEASES_FILE"
}

cmd_redeploy_all() {
  local rebuild=false
  for arg in "$@"; do
    case "$arg" in
      --rebuild) rebuild=true ;;
      *) echo "Unknown redeploy-all flag: $arg" >&2; exit 1 ;;
    esac
  done
  require_env AKASH_CONSOLE_API_KEY
  require_cli curl jq
  ensure_leases_file

  # Snapshot which services are currently deployed. We redeploy *exactly
  # this set* — not `cmd_all`'s default — because the operator's intent is
  # "rebuild what I have," and silently adding services they never deployed
  # (solana-explorer, blockscout) would surprise them.
  local has_anvil has_solana has_otterscan has_blockscout has_sol_explorer
  has_anvil="$(jq -r '.anvil.dseq // empty' "$LEASES_FILE")"
  has_solana="$(jq -r '.solana.dseq // empty' "$LEASES_FILE")"
  has_otterscan="$(jq -r '.otterscan.dseq // empty' "$LEASES_FILE")"
  has_blockscout="$(jq -r '.blockscout.dseq // empty' "$LEASES_FILE")"
  has_sol_explorer="$(jq -r '."solana-explorer".dseq // empty' "$LEASES_FILE")"

  local plan=()
  [ -n "$has_anvil" ]        && plan+=("anvil")
  [ -n "$has_solana" ]       && plan+=("solana")
  [ -n "$has_otterscan" ]    && plan+=("otterscan")
  [ -n "$has_blockscout" ]   && plan+=("blockscout")
  [ -n "$has_sol_explorer" ] && plan+=("solana-explorer")

  if [ "${#plan[@]}" -eq 0 ]; then
    echo "[redeploy-all] No leases in $LEASES_FILE — use \`$0 all\` for a fresh full deploy." >&2
    exit 1
  fi

  echo "[redeploy-all] Will redeploy: ${plan[*]}"

  if $rebuild; then
    echo "[redeploy-all] --rebuild: building + pushing images first..."
    cmd_build
  fi

  # Close in reverse-dependency order. Explorers template their upstream
  # chain URLs (anvil/solana) at deploy time, so closing them first means
  # we can safely close the chains underneath without leaving an explorer
  # pointing at a dead RPC.
  echo "[redeploy-all] Closing existing leases (reverse-dependency order)..."
  [ -n "$has_otterscan" ]    && cmd_close otterscan
  [ -n "$has_sol_explorer" ] && cmd_close solana-explorer
  [ -n "$has_blockscout" ]   && cmd_close blockscout
  [ -n "$has_anvil" ]        && cmd_close anvil
  [ -n "$has_solana" ]       && cmd_close solana

  # Deploy in dependency order. Chains first, explorers second — explorers
  # read the chain URLs from leases.json at deploy time.
  echo "[redeploy-all] Deploying fresh leases..."
  [ -n "$has_anvil" ]        && cmd_anvil
  [ -n "$has_solana" ]       && cmd_solana
  [ -n "$has_otterscan" ]    && cmd_otterscan
  [ -n "$has_blockscout" ]   && cmd_blockscout
  [ -n "$has_sol_explorer" ] && cmd_solana_explorer

  echo
  echo "[redeploy-all] Done. Leases:"
  jq . "$LEASES_FILE"
}

case "${1:-}" in
  build) cmd_build ;;
  anvil) cmd_anvil ;;
  solana) cmd_solana ;;
  blockscout) cmd_blockscout ;;
  otterscan) cmd_otterscan ;;
  solana-explorer) cmd_solana_explorer ;;
  all) cmd_all ;;
  close) shift; cmd_close "$@" ;;
  redeploy) shift; cmd_redeploy "$@" ;;
  redeploy-all) shift; cmd_redeploy_all "$@" ;;
  resume) shift; cmd_resume "$@" ;;
  name) cmd_name ;;
  *)
    cat <<USAGE
Usage: $0 <command>

Commands:
  build              Build + push images (SHA-pinned + :demo tags)
  anvil              Deploy anvil.sdl.yaml — writes leases.json
  solana             Deploy solana.sdl.yaml — writes leases.json (RPC + WS)
  otterscan          Deploy otterscan.sdl.yaml — EVM explorer (anvil must be up)
  blockscout         Deploy blockscout.sdl.yaml — legacy EVM explorer
                     (Otterscan is the recommended replacement; this remains
                     for cases where the historical Blockscout config is preferred)
  solana-explorer    Deploy solana-explorer.sdl.yaml (solana must be up)
  all                build + anvil + solana + otterscan + solana-explorer
  close <name>       Close a lease (DELETE /v1/deployments/{dseq})
  redeploy <name>    Close + redeploy, denylist prior provider
  redeploy-all [--rebuild]
                     Close every existing lease (in reverse-dependency
                     order, no denylist changes) then deploy fresh in the
                     right order. Pass --rebuild to also rebuild + push
                     all images first. Idempotent on partial state — safe
                     to run when only some leases exist.
  resume <name> [dseq] [provider]
                     Re-attach to an in-flight deploy whose script run was
                     interrupted; polls the existing dseq until ready and
                     writes leases.json. Defaults dseq+provider from
                     leases.json or accepts overrides.
  name               Emit a browser-console JS snippet that seeds friendly
                     names for every lease in leases.json (Console stores
                     names in localStorage; no server-side API exists)

Env required:
  AKASH_CONSOLE_API_KEY        Console API key (ac.sk.production.*)
  AKASH_CONSOLE_API_URL        Optional override (default: https://console-api.akash.network)
USAGE
    exit 1 ;;
esac
