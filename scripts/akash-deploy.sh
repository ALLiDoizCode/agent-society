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
# ATOR probe is a short-lived derisking deploy (~hour, not month). Min deposit.
DEPOSIT_ATOR_PROBE=5
# Faucet — dedicated dev faucet lease (story 49.2 architecture A2).
# Single small service; ~$2-5/mo. Min deposit.
DEPOSIT_FAUCET=5
# Foreign-TOON-client pod (story 49.3) — persistent lease, slightly heavier
# than the faucet (anon daemon + viem + Fastify). ~$3-5/mo. Min deposit.
DEPOSIT_FOREIGN_CLIENT=5
# Townhouse — full operator stack (apex connector + town + mill + dvm + faucet)
# behind a .anyone hidden service. 5 services × ~30d at SDL prices ≈ $10.
DEPOSIT_TOWNHOUSE=10

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
# ATOR probe SHA covers the Dockerfile + entrypoint + checksums (the .deb itself
# is content-addressed by the checksum file, so a checksum bump = new image).
ATOR_PROBE_SHA="$(
  cat \
    "$ROOT/docker/akash-ator-probe/Dockerfile" \
    "$ROOT/docker/akash-ator-probe/entrypoint.sh" \
    "$ROOT/docker/akash-ator-probe/checksums.txt" \
    2>/dev/null \
  | sha256sum | head -c 12
)"
# Faucet SHA covers the faucet package source + the baked Solana faucet
# authority + the Dockerfile. A change to any of these = fresh image tag.
FAUCET_SHA="$(
  cat "$ROOT/packages/faucet/Dockerfile" 2>/dev/null \
  | { find "$ROOT/packages/faucet/src" "$ROOT/packages/faucet/public" -type f -print0 2>/dev/null | xargs -0 cat 2>/dev/null; cat; } \
  | { cat "$ROOT/infra/solana/keys/faucet-authority.json" 2>/dev/null; cat; } \
  | sha256sum | head -c 12
)"
# Foreign-toon-client SHA covers the Dockerfile + entrypoint source + schema
# contract + workspace pieces the entrypoint actually imports. Story 49.3.
FOREIGN_CLIENT_SHA="$(
  for _sha_f in \
    "$ROOT/docker/Dockerfile.foreign-toon-client" \
    "$ROOT/docker/src/entrypoint-foreign-pod.ts" \
    "$ROOT/packages/townhouse/contracts/foreign-publish.schema.json" \
    "$ROOT/docker/townhouse-ator-sidecar/checksums.txt" \
  ; do
    if [ ! -f "$_sha_f" ]; then
      echo "[sha] ERROR: required file missing for FOREIGN_CLIENT_SHA: $_sha_f" >&2
      exit 1
    fi
    cat "$_sha_f"
  done | sha256sum | head -c 12
)"

ANVIL_IMAGE_TAGGED="ghcr.io/toon-protocol/akash-anvil:sha-$ANVIL_SHA"
ANVIL_IMAGE_DEMO="ghcr.io/toon-protocol/akash-anvil:demo"
SOLANA_IMAGE_TAGGED="ghcr.io/toon-protocol/akash-solana:sha-$SOLANA_SHA"
SOLANA_IMAGE_DEMO="ghcr.io/toon-protocol/akash-solana:demo"
SOLANA_EXPLORER_IMAGE_TAGGED="ghcr.io/toon-protocol/akash-solana-explorer:sha-$SOLANA_EXPLORER_SHA"
SOLANA_EXPLORER_IMAGE_DEMO="ghcr.io/toon-protocol/akash-solana-explorer:demo"
ATOR_PROBE_IMAGE_TAGGED="ghcr.io/toon-protocol/akash-ator-probe:sha-$ATOR_PROBE_SHA"
ATOR_PROBE_IMAGE_DEMO="ghcr.io/toon-protocol/akash-ator-probe:demo"
FAUCET_IMAGE_TAGGED="ghcr.io/toon-protocol/akash-faucet:sha-$FAUCET_SHA"
FAUCET_IMAGE_DEMO="ghcr.io/toon-protocol/akash-faucet:demo"
# Compat alias — the existing townhouse.sdl.yaml references this name, so
# we keep it published in parallel until that SDL is updated.
FAUCET_IMAGE_TOWNHOUSE_DEMO="ghcr.io/toon-protocol/townhouse-faucet:demo"
# Foreign-TOON-client pod image (Story 49.3 — persistent Akash foreign-pod
# with POST /publish). Hosts the Fastify control plane + in-pod anon daemon.
FOREIGN_CLIENT_IMAGE_TAGGED="ghcr.io/toon-protocol/akash-foreign-toon-client:sha-$FOREIGN_CLIENT_SHA"
FOREIGN_CLIENT_IMAGE_DEMO="ghcr.io/toon-protocol/akash-foreign-toon-client:demo"

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
  # -k tolerates self-signed certs. Some Akash providers issue them on the
  # ingress; we don't care about chain trust for liveness probes — we only
  # care that *something* is responding 200 on the configured port. The
  # round-trip security model relies on Tor / Anyone, not the lease URL.
  local code
  code="$(curl -sf -k -m 5 -o /dev/null -w '%{http_code}' "$1" 2>/dev/null || echo 000)"
  [ "$code" = "200" ]
}

# ator-probe has no public ingress (no `expose:` in its SDL), so there's
# nothing to HTTP-probe. cmd_ator_probe handles its own readiness signal
# directly (lease state == active + the round-trip test through SOCKS5).
# Connector .anon vs .anyone hostname-suffix discrepancy: connector source in
# packages/connector/src/config/ uses `.anon` everywhere, but live anon
# v0.4.10.0-beta emits `.anyone`. This means the connector's log-redaction
# logic in config-loader.ts will silently fail to redact real hostnames —
# worth a connector-side fix before townhouse wires server-side ATOR.

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

# Build (and push) the dedicated dev-faucet image. Story 49.2 — bakes the
# Solana faucet authority keypair from infra/solana/keys/ into the image at
# /etc/faucet/sol-authority.json. Build context is the repo root so the
# Dockerfile can reach outside packages/faucet/ for the key file.
# Pushes townhouse-faucet:demo — the only tag the current PAT can write.
# The story 49.2 canonical name akash-faucet:demo is also tagged locally
# so `docker push akash-faucet:demo` works once the GHCR package is
# created (`gh api orgs/toon-protocol/packages` or via the GitHub UI).
# Until then, faucet.sdl.yaml references the townhouse-faucet:demo alias.
cmd_build_faucet() {
  require_cli docker
  echo "Building $FAUCET_IMAGE_TAGGED + akash-faucet:demo + townhouse-faucet:demo..."
  docker build \
    -f "$ROOT/packages/faucet/Dockerfile" \
    -t "$FAUCET_IMAGE_TAGGED" \
    -t "$FAUCET_IMAGE_DEMO" \
    -t "$FAUCET_IMAGE_TOWNHOUSE_DEMO" \
    "$ROOT"
  echo "Pushing $FAUCET_IMAGE_TOWNHOUSE_DEMO (canonical alias used by faucet.sdl.yaml)..."
  docker push "$FAUCET_IMAGE_TOWNHOUSE_DEMO"
  # Try the canonical akash-faucet:demo push; tolerate scope failures so
  # the build script doesn't break when the GHCR package isn't created yet.
  echo "Pushing $FAUCET_IMAGE_DEMO (canonical name per story 49.2)..."
  docker push "$FAUCET_IMAGE_DEMO" \
    || echo "[faucet] WARNING: push of $FAUCET_IMAGE_DEMO failed (likely GHCR package scope). Continuing with townhouse-faucet:demo alias." >&2
  echo "Pushing $FAUCET_IMAGE_TAGGED (SHA-pinned)..."
  docker push "$FAUCET_IMAGE_TAGGED" \
    || echo "[faucet] WARNING: push of $FAUCET_IMAGE_TAGGED failed (likely GHCR package scope)." >&2
}

# Build (and push) the Foreign-TOON-Client pod image (Story 49.3).
# Builds from the repo root so the Dockerfile can reach packages/townhouse/
# contracts + docker/townhouse-ator-sidecar/ checksums + docker/src/
# entrypoint-foreign-pod.ts.
cmd_build_foreign_toon_client() {
  require_cli docker
  echo "Building $FOREIGN_CLIENT_IMAGE_TAGGED + :demo..."
  docker build \
    -f "$ROOT/docker/Dockerfile.foreign-toon-client" \
    -t "$FOREIGN_CLIENT_IMAGE_TAGGED" \
    -t "$FOREIGN_CLIENT_IMAGE_DEMO" \
    "$ROOT"
  echo "Pushing $FOREIGN_CLIENT_IMAGE_TAGGED (SHA-pinned)..."
  docker push "$FOREIGN_CLIENT_IMAGE_TAGGED" || {
    echo "[foreign-toon-client] ERROR: push of SHA-pinned tag failed." >&2
    echo "  Create the package first: https://github.com/orgs/toon-protocol/packages" >&2
    echo "  Then re-run: $0 build-foreign-toon-client" >&2
    exit 1
  }
  echo "Pushing $FOREIGN_CLIENT_IMAGE_DEMO (canonical)..."
  docker push "$FOREIGN_CLIENT_IMAGE_DEMO" || {
    echo "[foreign-toon-client] ERROR: push of $FOREIGN_CLIENT_IMAGE_DEMO failed." >&2
    exit 1
  }
}

# Render the foreign-toon-client SDL (story 49.3). Reads FAUCET_URL +
# EVM_RPC_URL + SOLANA_RPC_URL from leases.json with fallback to localnet
# defaults, then substitutes them into a temp SDL. Output goes to stdout
# so deploy_sdl can `cat` it through to the Console API.
render_foreign_toon_client_sdl() {
  local sdl_template="$SDL_DIR/foreign-toon-client.sdl.yaml"

  local faucet_url evm_rpc sol_rpc
  faucet_url="${FAUCET_URL:-$(jq -r '.faucet.url // empty' "$LEASES_FILE" 2>/dev/null || true)}"
  faucet_url="${faucet_url:-http://localhost:3500}"
  evm_rpc="${EVM_RPC_URL:-$(jq -r '.anvil.url // empty' "$LEASES_FILE" 2>/dev/null || true)}"
  evm_rpc="${evm_rpc:-http://localhost:8545}"
  sol_rpc="${SOLANA_RPC_URL:-$(jq -r '.solana.url // empty' "$LEASES_FILE" 2>/dev/null || true)}"
  sol_rpc="${sol_rpc:-http://localhost:8899}"

  # Story 49.4 Option B: allow caller to override the ILP fee per event via
  # TOON_FEE_PER_EVENT env var (e.g. TOON_FEE_PER_EVENT=1000000 for 1 USDC).
  # When unset, the value baked into the SDL template is used unchanged.
  local rendered
  rendered="$(sed \
    -e "s#__FAUCET_URL__#$faucet_url#g" \
    -e "s#__EVM_RPC_URL__#$evm_rpc#g" \
    -e "s#__SOLANA_RPC_URL__#$sol_rpc#g" \
    "$sdl_template")"
  if [ -n "${TOON_FEE_PER_EVENT:-}" ]; then
    if ! [[ "${TOON_FEE_PER_EVENT}" =~ ^[0-9]+$ ]]; then
      echo "[foreign-toon-client] TOON_FEE_PER_EVENT must be a non-negative integer, got: ${TOON_FEE_PER_EVENT}" >&2
      exit 1
    fi
    # Count env-LINE matches before/after substitution (not text occurrences —
    # comments may also mention TOON_FEE_PER_EVENT= and would skew the count).
    local env_lines_before
    env_lines_before="$(echo "$rendered" | grep -cE "^[[:space:]]*-[[:space:]]+TOON_FEE_PER_EVENT=[0-9]+" || true)"
    rendered="$(echo "$rendered" | sed -E "s#^([[:space:]]*-[[:space:]]+)TOON_FEE_PER_EVENT=[0-9]+#\1TOON_FEE_PER_EVENT=${TOON_FEE_PER_EVENT}#g")"
    local env_lines_after
    env_lines_after="$(echo "$rendered" | grep -cE "^[[:space:]]*-[[:space:]]+TOON_FEE_PER_EVENT=${TOON_FEE_PER_EVENT}[[:space:]]*$" || true)"
    if [ "$env_lines_before" -lt 1 ] || [ "$env_lines_after" -lt 1 ]; then
      echo "[foreign-toon-client] TOON_FEE_PER_EVENT override did not substitute (env_lines before=$env_lines_before, after=$env_lines_after with value=${TOON_FEE_PER_EVENT}) — SDL formatting drift?" >&2
      exit 1
    fi
    echo "[foreign-toon-client] Using TOON_FEE_PER_EVENT=${TOON_FEE_PER_EVENT} (override) — $env_lines_after env line(s) substituted" >&2
  fi
  echo "$rendered"
}

cmd_foreign_toon_client() {
  require_env AKASH_CONSOLE_API_KEY
  require_cli curl jq

  ensure_leases_file

  # Foreign-pod depends on the faucet + chain leases being up. Warn loudly
  # but don't block — operator may be deploying out-of-order intentionally.
  local faucet_url anvil_url solana_url
  faucet_url="$(jq -r '.faucet.url // ""' "$LEASES_FILE")"
  anvil_url="$(jq -r '.anvil.url // ""' "$LEASES_FILE")"
  solana_url="$(jq -r '.solana.url // ""' "$LEASES_FILE")"
  if [ -z "$faucet_url" ]; then
    echo "[foreign-toon-client] WARNING: faucet lease not found in $LEASES_FILE." >&2
    echo "[foreign-toon-client] Pod boot will fail at the faucet auto-fund step." >&2
    echo "[foreign-toon-client] Run: $0 build-faucet && $0 faucet" >&2
  fi
  if [ -z "$anvil_url" ] || [ -z "$solana_url" ]; then
    echo "[foreign-toon-client] WARNING: anvil/solana leases not both found." >&2
    echo "[foreign-toon-client] Pod will fail balance polling." >&2
  fi

  local rendered_sdl
  rendered_sdl="$(mktemp --suffix=.sdl.yaml)"
  trap 'rm -f "${rendered_sdl-}"' EXIT
  render_foreign_toon_client_sdl > "$rendered_sdl"

  local digest
  digest="$(image_digest "$FOREIGN_CLIENT_IMAGE_DEMO")"

  # Readiness probe — the pod's /healthz returns 200 only after the anon
  # daemon binds SOCKS5 AND the faucet auto-fund completes. The cold-boot
  # window is ~30-90s for anon + ~5s for faucet, so the wait_for_url
  # timeout needs to be at least 180s; we use 300s per deploy_sdl default.
  deploy_sdl foreign-toon-client "$rendered_sdl" foreign-toon-client 8080 probe_foreign_pod_healthz "$DEPOSIT_FOREIGN_CLIENT" "$digest"

  echo
  echo "[foreign-toon-client] Deployed."
  echo "  URL:        $(jq -r '."foreign-toon-client".url // "(pending)"' "$LEASES_FILE")"
  echo "  /healthz:   $(jq -r '."foreign-toon-client".url // "(pending)"' "$LEASES_FILE")/healthz"
  echo "  /publish:   $(jq -r '."foreign-toon-client".url // "(pending)"' "$LEASES_FILE")/publish"
  echo
  echo "  Lease owner: dev.jonathan.green@gmail.com"
  echo "  Sunset:      Close via \`$0 close foreign-toon-client\` when Epic 49 retires"
  echo "               (see deferred-work.md § 'Epic 49 sunset checklist')."
}

# Probe — fetches /healthz and checks `"anyoneReady": true`. The pod's
# JSON shape is fixed by packages/townhouse/contracts/foreign-publish.schema.json.
# NOTE: always appends /healthz to the base URL — bare / returns 404 from
# Fastify (D-49.4-PR1-3 fix). probe_http_200 must NOT be used for this class.
probe_foreign_pod_healthz() {
  local body
  body="$(curl -sf -k -m 8 --connect-timeout 5 "$1/healthz" 2>/dev/null || echo '')"
  echo "$body" | grep -q '"anyoneReady":[[:space:]]*true'
}

# Manual readiness probe for the foreign-toon-client lease (D-49.4-PR1-3).
# Reads the URL from leases.json and calls probe_foreign_pod_healthz which
# hits /healthz — bare / returns 404 from Fastify and is not a valid probe.
cmd_probe_foreign_pod() {
  ensure_leases_file
  local url
  url="$(jq -r '."foreign-toon-client".url // empty' "$LEASES_FILE")"
  if [ -z "$url" ]; then
    echo "ERROR: no foreign-toon-client lease in $LEASES_FILE" >&2
    exit 1
  fi
  echo "[probe-foreign-pod] Probing $url/healthz ..."
  local body
  body="$(curl -sf -k -m 10 --connect-timeout 5 "$url/healthz" 2>/dev/null || echo '')"
  if echo "$body" | grep -q '"anyoneReady":[[:space:]]*true'; then
    echo "[probe-foreign-pod] PASS — anyoneReady=true"
    echo "$body" | jq -c '{anyoneReady, evmAddr, solAddr, balances}' 2>/dev/null || echo "$body"
  else
    echo "[probe-foreign-pod] FAIL — anyoneReady not true (or pod unreachable)"
    echo "  body: $(echo "$body" | head -c 200)"
    exit 1
  fi
}

# Build (and push) the ATOR probe image only. Kept separate from cmd_build so
# the chain images aren't rebuilt unnecessarily during ATOR derisking.
cmd_build_ator_probe() {
  require_cli docker
  echo "Building $ATOR_PROBE_IMAGE_TAGGED + :demo..."
  # Build context is docker/akash-ator-probe/ — the image only needs that dir's
  # contents (Dockerfile, checksums.txt, entrypoint.sh).
  docker build \
    -f "$ROOT/docker/akash-ator-probe/Dockerfile" \
    -t "$ATOR_PROBE_IMAGE_TAGGED" \
    -t "$ATOR_PROBE_IMAGE_DEMO" \
    "$ROOT/docker/akash-ator-probe"
  echo "Pushing ator-probe image (both tags)..."
  docker push "$ATOR_PROBE_IMAGE_TAGGED"
  docker push "$ATOR_PROBE_IMAGE_DEMO"
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
    faucet) service=faucet; port=3500; probe_fn=probe_http_200; image_digest="$(image_digest "$FAUCET_IMAGE_DEMO" 2>/dev/null || true)" ;;
    ator-probe)
      # `resume` doesn't apply: cmd_ator_probe owns its own deploy flow
      # (no-ingress, no HTTP poll). Re-run cmd_ator_probe to redeploy with
      # the cached keypair, or pass --reuse-dseq to attach to an in-flight
      # deployment (not yet implemented).
      echo "ator-probe doesn't support 'resume' — re-run 'scripts/akash-deploy.sh ator-probe' instead." >&2
      exit 1 ;;
    townhouse)
      # Same shape as ator-probe: cmd_townhouse owns its own deploy flow
      # (renders SDL with templated chain URLs + HS keypair). Re-run
      # cmd_townhouse — the cached keypair preserves the .anyone hostname.
      echo "townhouse doesn't support 'resume' — re-run 'scripts/akash-deploy.sh townhouse' instead." >&2
      exit 1 ;;
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

# Generate (or reuse) the v3 hidden-service keypair used by the probe. Keys
# live under deploy/akash/ator-probe-keys/hs/ — gitignored, never committed.
# The .anyone hostname is deterministic across redeploys as long as this
# directory is preserved.
#
# We DON'T bind-mount the host dir into the container because anon refuses
# to load /var/lib/anon when its ownership disagrees with the running user
# (root vs host's uid 1000) — it logs "free(): invalid size" and segfaults.
# Instead, we let anon write keys to the container's own filesystem and pull
# them out via `docker cp` after the hostname file appears.
ensure_ator_probe_keys() {
  require_cli docker
  local keys_dir="$SDL_DIR/ator-probe-keys"
  if [ -s "$keys_dir/hs/hostname" ] && [ -s "$keys_dir/hs/hs_ed25519_secret_key" ]; then
    return 0
  fi
  echo "[ator-probe] generating fresh v3 keypair..."
  rm -rf "$keys_dir"
  mkdir -p "$keys_dir"
  # No --rm: we need the container alive long enough to docker-cp out of it.
  # No volume mount: anon writes to its container-internal /var/lib/anon
  # which has correct root ownership (set in Dockerfile).
  local cid
  cid="$(docker run -d --name ator-probe-keygen "$ATOR_PROBE_IMAGE_DEMO")"
  local waited=0
  while [ "$waited" -lt 15 ]; do
    if docker exec "$cid" test -s /var/lib/anon/hs/hostname 2>/dev/null; then
      break
    fi
    sleep 1
    waited=$((waited + 1))
  done
  if ! docker exec "$cid" test -s /var/lib/anon/hs/hostname 2>/dev/null; then
    echo "[ator-probe] ERROR: keypair generation failed in container after ${waited}s" >&2
    echo "[ator-probe] container logs (last 20 lines):" >&2
    docker logs "$cid" 2>&1 | tail -20 >&2
    docker rm -f "$cid" >/dev/null 2>&1 || true
    exit 1
  fi
  # Copy the full hs/ tree out — preserves the secret key + hostname + pub key.
  docker cp "$cid:/var/lib/anon/hs" "$keys_dir/hs"
  docker rm -f "$cid" >/dev/null 2>&1 || true
  echo "[ator-probe] generated .anyone hostname: $(cat "$keys_dir/hs/hostname")"
}

# Render the probe SDL with HS_SECRET_KEY_B64 substituted for the placeholder.
# Output goes to stdout so the caller can pipe to the API.
render_ator_probe_sdl() {
  local keys_dir="$SDL_DIR/ator-probe-keys"
  local sdl_template="$SDL_DIR/ator-probe.sdl.yaml"
  local secret_b64
  secret_b64="$(base64 -w0 "$keys_dir/hs/hs_ed25519_secret_key")"
  # `sed` with a delimiter unlikely to appear in base64 (`|`) — base64 only
  # contains [A-Za-z0-9+/=].
  sed "s|__HS_SECRET_KEY_B64__|$secret_b64|" "$sdl_template"
}

cmd_ator_probe() {
  require_env AKASH_CONSOLE_API_KEY
  require_cli curl jq docker

  ensure_ator_probe_keys

  local keys_dir="$SDL_DIR/ator-probe-keys"
  local hostname digest
  hostname="$(cat "$keys_dir/hs/hostname")"
  digest="$(image_digest "$ATOR_PROBE_IMAGE_DEMO")"

  echo "[ator-probe] target .anyone: $hostname"

  # Render the SDL template (substitute HS_SECRET_KEY_B64) into a temp file
  # so deploy_sdl can `cat` it like every other SDL. The temp file is wiped
  # on script exit — the secret never persists outside the keys dir.
  local rendered_sdl
  rendered_sdl="$(mktemp --suffix=.sdl.yaml)"
  # `${var-}` expansion guards against `set -u` firing on the trap if the
  # function exits via a different path before $rendered_sdl is in scope.
  trap 'rm -f "${rendered_sdl-}"' EXIT
  render_ator_probe_sdl > "$rendered_sdl"

  # Reuse the standard deploy_sdl flow. The container's port 8080 hosts a
  # tiny socat HTTP responder (200 OK) just so Akash's manifest validator
  # accepts the deployment and the kubelet readiness probe passes — it's
  # NOT the operational access path. The hidden service is.
  deploy_sdl ator-probe "$rendered_sdl" ator-probe 8080 probe_http_200 "$DEPOSIT_ATOR_PROBE" "$digest"

  # Annotate the lease entry with the .anyone hostname (deploy_sdl wrote
  # URL/host/port but doesn't know about the HS).
  ensure_leases_file
  local tmp
  tmp="$(mktemp)"
  jq --arg o "$hostname" '."ator-probe".onion = $o' "$LEASES_FILE" > "$tmp"
  mv "$tmp" "$LEASES_FILE"

  echo
  echo "[ator-probe] Deployed."
  echo "  .anyone: $hostname"
  echo
  echo "  Wait ~60-120s for the HS descriptor to publish, then run:"
  echo "    scripts/townhouse-dev-infra.sh up   # if not already running"
  echo "    scripts/akash-ator-probe-test.sh --socks 127.0.0.1:28050"
}

# Generate (or reuse) the v3 hidden-service keypair for the townhouse apex
# connector. Keys live under deploy/akash/townhouse-keys/hs/ — gitignored.
# The .anyone hostname is deterministic across redeploys as long as this
# directory is preserved.
#
# Same pattern as ensure_ator_probe_keys: anon's strict ownership check on
# /var/lib/anon means a host bind-mount segfaults (root-vs-uid-1000); we let
# anon write to the container's own filesystem and `docker cp` the keypair
# out. Reuses the ator-probe image since it carries the right anon binary
# version and a known-working keygen path.
ensure_townhouse_keys() {
  require_cli docker
  local keys_dir="$SDL_DIR/townhouse-keys"
  if [ -s "$keys_dir/hs/hostname" ] && [ -s "$keys_dir/hs/hs_ed25519_secret_key" ]; then
    return 0
  fi
  echo "[townhouse] generating fresh v3 keypair..."
  rm -rf "$keys_dir"
  mkdir -p "$keys_dir"
  local cid
  cid="$(docker run -d --name townhouse-keygen "$ATOR_PROBE_IMAGE_DEMO")"
  local waited=0
  while [ "$waited" -lt 15 ]; do
    if docker exec "$cid" test -s /var/lib/anon/hs/hostname 2>/dev/null; then
      break
    fi
    sleep 1
    waited=$((waited + 1))
  done
  if ! docker exec "$cid" test -s /var/lib/anon/hs/hostname 2>/dev/null; then
    echo "[townhouse] ERROR: keypair generation failed in container after ${waited}s" >&2
    echo "[townhouse] container logs (last 20 lines):" >&2
    docker logs "$cid" 2>&1 | tail -20 >&2
    docker rm -f "$cid" >/dev/null 2>&1 || true
    exit 1
  fi
  docker cp "$cid:/var/lib/anon/hs" "$keys_dir/hs"
  docker rm -f "$cid" >/dev/null 2>&1 || true
  echo "[townhouse] generated .anyone hostname: $(cat "$keys_dir/hs/hostname")"
}

# Render the townhouse SDL by substituting all 7 template tokens. Output goes
# to stdout. Chain endpoints are resolved with a fallback chain:
#   1. env vars from $ROOT/.env.townhouse-hs (if file exists)
#   2. leases.json (.anvil.url, .solana.url) — Akash devnet profile
#   3. localnet defaults (http://anvil:8545 etc.)
#
# Mock USDC defaults match the addresses baked into the akash-anvil and
# akash-solana images (same as the laptop-compose localnet profile).
render_townhouse_sdl() {
  local keys_dir="$SDL_DIR/townhouse-keys"
  local sdl_template="$SDL_DIR/townhouse.sdl.yaml"
  local connector_yaml="$ROOT/docker/configs/townhouse-hs-connector.yaml"

  # Source operator env file if present (gitignored — operator-managed).
  if [ -f "$ROOT/.env.townhouse-hs" ]; then
    # shellcheck disable=SC1091
    set -a
    . "$ROOT/.env.townhouse-hs"
    set +a
  fi

  # Resolve chain endpoints with the documented fallback chain.
  local evm_rpc evm_chain_id evm_usdc sol_rpc sol_usdc
  evm_rpc="${EVM_RPC_URL:-$(jq -r '.anvil.url // empty' "$LEASES_FILE" 2>/dev/null || true)}"
  evm_rpc="${evm_rpc:-http://localhost:8545}"
  evm_chain_id="${EVM_CHAIN_ID:-31337}"
  evm_usdc="${EVM_USDC_ADDRESS:-0x5FbDB2315678afecb367f032d93F642f64180aa3}"
  sol_rpc="${SOLANA_RPC_URL:-$(jq -r '.solana.url // empty' "$LEASES_FILE" 2>/dev/null || true)}"
  sol_rpc="${sol_rpc:-http://localhost:8899}"
  sol_usdc="${SOLANA_USDC_MINT:-6GbdrVghwNKTz9raga7y3Y4qqX5Zgg3AC4d48Kt7C59Q}"

  # Resolve the .anyone hostname from the local keypair and build the
  # externalUrl. Phase 4 sidecar pattern: the connector YAML's externalUrl
  # is rendered up-front (no runtime `auto` resolution — the SDK that does
  # that is broken at v1.1.3). The same secret key gets seeded into the
  # sidecar's HS dir so the published .anyone matches what the connector
  # advertises to peers.
  local hs_hostname external_url
  hs_hostname="$(cat "$keys_dir/hs/hostname" | tr -d '\n')"
  external_url="wss://${hs_hostname}/btp"

  # Render the connector YAML template with the concrete externalUrl, THEN
  # base64-encode. The SDL injects the encoded blob via CONNECTOR_CONFIG_YAML_B64.
  local rendered_connector_yaml
  rendered_connector_yaml="$(mktemp --suffix=.yaml)"
  # shellcheck disable=SC2064
  trap "rm -f '$rendered_connector_yaml'" RETURN
  sed -e "s|__TOWNHOUSE_EXTERNAL_URL__|$external_url|g" \
    "$connector_yaml" \
    > "$rendered_connector_yaml"

  # Base64-encode the rendered connector yaml + the HS secret key.
  local connector_b64 secret_b64
  connector_b64="$(base64 -w0 "$rendered_connector_yaml")"
  secret_b64="$(base64 -w0 "$keys_dir/hs/hs_ed25519_secret_key")"

  # `sed` with `|` delimiter — base64 only contains [A-Za-z0-9+/=], URLs may
  # contain `/` so chain URLs can't use a `/` delimiter either.
  sed \
    -e "s|__CONNECTOR_CONFIG_YAML_B64__|$connector_b64|" \
    -e "s|__HS_SECRET_KEY_B64__|$secret_b64|" \
    -e "s|__EVM_RPC_URL__|$evm_rpc|g" \
    -e "s|__EVM_CHAIN_ID__|$evm_chain_id|g" \
    -e "s|__EVM_USDC_ADDRESS__|$evm_usdc|g" \
    -e "s|__SOLANA_RPC_URL__|$sol_rpc|g" \
    -e "s|__SOLANA_USDC_MINT__|$sol_usdc|g" \
    "$sdl_template"
}

cmd_townhouse() {
  require_env AKASH_CONSOLE_API_KEY
  require_cli curl jq docker base64

  ensure_leases_file
  ensure_townhouse_keys

  local keys_dir="$SDL_DIR/townhouse-keys"
  local hostname
  hostname="$(cat "$keys_dir/hs/hostname")"

  echo "[townhouse] target .anyone: $hostname"

  # Render the SDL template into a temp file so deploy_sdl can `cat` it like
  # every other SDL. The temp file is wiped on exit — neither the secret key
  # nor the operator's env vars persist outside the keys dir / .env file.
  local rendered_sdl
  rendered_sdl="$(mktemp --suffix=.sdl.yaml)"
  trap 'rm -f "${rendered_sdl-}"' EXIT
  render_townhouse_sdl > "$rendered_sdl"

  # Readiness probing happens via the faucet service on port 3500 (the only
  # exposed service per SDL — the connector is HS-only). probe_http_200 is
  # sufficient since the faucet's UI returns 200 from its root path.
  deploy_sdl townhouse "$rendered_sdl" faucet 3500 probe_http_200 "$DEPOSIT_TOWNHOUSE" ""

  # Annotate the lease entry with the .anyone hostname (deploy_sdl wrote
  # URL/host/port for the faucet but doesn't know about the HS).
  local tmp
  tmp="$(mktemp)"
  jq --arg o "$hostname" '."townhouse".onion = $o' "$LEASES_FILE" > "$tmp"
  mv "$tmp" "$LEASES_FILE"

  echo
  echo "[townhouse] Deployed."
  echo "  .anyone:    $hostname"
  echo "  faucet UI:  $(jq -r '.townhouse.url // "(pending)"' "$LEASES_FILE")"
  echo
  echo "  Wait ~60-120s for the HS descriptor to publish, then dial:"
  echo "    btp+wss://$hostname:3000   # via anon SOCKS5"
}

# Render the dedicated dev-faucet SDL (story 49.2 architecture A2). Reads
# EVM_RPC_URL + SOLANA_RPC_URL from `leases.json` (Akash chain leases) with
# fallback to localnet defaults, then substitutes them + the Mock USDC
# addresses into a temp SDL. Output goes to stdout so `deploy_sdl` can
# `cat` it through to the Console API. Same pattern as render_townhouse_sdl.
render_faucet_sdl() {
  local sdl_template="$SDL_DIR/faucet.sdl.yaml"

  # Resolve chain RPCs via the same fallback chain the townhouse renderer
  # uses (env -> leases.json -> localnet defaults).
  local evm_rpc evm_usdc sol_rpc sol_usdc
  evm_rpc="${EVM_RPC_URL:-$(jq -r '.anvil.url // empty' "$LEASES_FILE" 2>/dev/null || true)}"
  evm_rpc="${evm_rpc:-http://localhost:8545}"
  evm_usdc="${EVM_USDC_ADDRESS:-0x5FbDB2315678afecb367f032d93F642f64180aa3}"
  sol_rpc="${SOLANA_RPC_URL:-$(jq -r '.solana.url // empty' "$LEASES_FILE" 2>/dev/null || true)}"
  sol_rpc="${sol_rpc:-http://localhost:8899}"
  sol_usdc="${SOLANA_USDC_MINT:-6GbdrVghwNKTz9raga7y3Y4qqX5Zgg3AC4d48Kt7C59Q}"

  sed \
    -e "s|__EVM_RPC_URL__|$evm_rpc|g" \
    -e "s|__EVM_USDC_ADDRESS__|$evm_usdc|g" \
    -e "s|__SOLANA_RPC_URL__|$sol_rpc|g" \
    -e "s|__SOLANA_USDC_MINT__|$sol_usdc|g" \
    "$sdl_template"
}

cmd_faucet() {
  require_env AKASH_CONSOLE_API_KEY
  require_cli curl jq

  ensure_leases_file

  # Faucet depends on at least one chain lease being up — otherwise the
  # drip routes will 5xx out of the gate. Warn loudly but don't block; the
  # operator may be deploying out-of-order intentionally.
  local anvil_url solana_url
  anvil_url="$(jq -r '.anvil.url // ""' "$LEASES_FILE")"
  solana_url="$(jq -r '.solana.url // ""' "$LEASES_FILE")"
  if [ -z "$anvil_url" ] && [ -z "$solana_url" ]; then
    echo "[faucet] WARNING: neither anvil nor solana leases found in $LEASES_FILE." >&2
    echo "[faucet] The faucet will start but all drip routes will 5xx until at least one chain lease is up." >&2
  fi

  local rendered_sdl
  rendered_sdl="$(mktemp --suffix=.sdl.yaml)"
  trap 'rm -f "${rendered_sdl-}"' EXIT
  render_faucet_sdl > "$rendered_sdl"

  # Currently the SDL references townhouse-faucet:demo (see SDL header
  # for the GHCR scope rationale). Use that digest for accurate manifest
  # tracking.
  local digest
  digest="$(image_digest "$FAUCET_IMAGE_TOWNHOUSE_DEMO")"

  # Readiness probe — the faucet UI returns 200 from root once the Express
  # server is up. `/health` would also work; root is simpler + matches the
  # townhouse SDL's faucet probe path.
  deploy_sdl faucet "$rendered_sdl" faucet 3500 probe_http_200 "$DEPOSIT_FAUCET" "$digest"

  echo
  echo "[faucet] Deployed."
  echo "  URL: $(jq -r '.faucet.url // "(pending)"' "$LEASES_FILE")"
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
    ator-probe) cmd_ator_probe ;;
    townhouse) cmd_townhouse ;;
    faucet) cmd_faucet ;;
    foreign-toon-client) cmd_foreign_toon_client ;;
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
  build-ator-probe) cmd_build_ator_probe ;;
  build-faucet) cmd_build_faucet ;;
  build-foreign-toon-client) cmd_build_foreign_toon_client ;;
  anvil) cmd_anvil ;;
  solana) cmd_solana ;;
  blockscout) cmd_blockscout ;;
  otterscan) cmd_otterscan ;;
  solana-explorer) cmd_solana_explorer ;;
  ator-probe) cmd_ator_probe ;;
  townhouse) cmd_townhouse ;;
  faucet) cmd_faucet ;;
  foreign-toon-client) cmd_foreign_toon_client ;;
  probe-foreign-pod) cmd_probe_foreign_pod ;;
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
  build-ator-probe   Build + push the ATOR-probe image only
  build-faucet       Build + push the dev-faucet image only
                     (ghcr.io/toon-protocol/akash-faucet:demo +
                      ghcr.io/toon-protocol/townhouse-faucet:demo compat tag)
  anvil              Deploy anvil.sdl.yaml — writes leases.json
  solana             Deploy solana.sdl.yaml — writes leases.json (RPC + WS)
  otterscan          Deploy otterscan.sdl.yaml — EVM explorer (anvil must be up)
  blockscout         Deploy blockscout.sdl.yaml — legacy EVM explorer
                     (Otterscan is the recommended replacement; this remains
                     for cases where the historical Blockscout config is preferred)
  solana-explorer    Deploy solana-explorer.sdl.yaml (solana must be up)
  ator-probe         Deploy ator-probe.sdl.yaml — derisks anon-on-Akash by
                     publishing a hidden service descriptor and exposing the
                     .anon hostname at <lease>/hostname. Once deployed, run
                     scripts/akash-ator-probe-test.sh for the round-trip test.
  faucet             Deploy faucet.sdl.yaml — dedicated dev-faucet lease
                     (story 49.2 A2). Reads chain RPCs from leases.json
                     (anvil + solana) and writes the faucet URL back to
                     leases.json. Run AFTER anvil + solana are healthy.
  townhouse          Deploy townhouse.sdl.yaml — full operator stack (apex
                     connector + town + mill + dvm + faucet) behind a .anyone
                     hidden service. Reads chain endpoints from
                     .env.townhouse-hs (or falls back to leases.json + local
                     defaults). Generates / reuses an HS keypair under
                     deploy/akash/townhouse-keys/ — gitignored, deterministic
                     across redeploys.
  probe-foreign-pod  Probe the foreign-toon-client /healthz from leases.json
                     (D-49.4-PR1-3: bare / returns 404 from Fastify — always /healthz)
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
