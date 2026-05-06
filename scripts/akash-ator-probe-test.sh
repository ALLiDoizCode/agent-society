#!/usr/bin/env bash
# ATOR-on-Akash round-trip test — no-ingress design.
#
# Validates the full path:
#   1. The Akash lease has been deployed (deploy/akash/leases.json has the
#      .anyone hostname recorded by scripts/akash-deploy.sh ator-probe)
#   2. From this host, dialing <hostname>.anyone:9000 through a local anon-
#      backed SOCKS5 proxy reaches the in-container probe target inside the
#      Akash lease and returns "PROBE-OK"
#
# Why anon-backed SOCKS5 specifically:
#   The .anyone TLD is Anyone Protocol-specific. Vanilla Tor SOCKS5 at
#   127.0.0.1:9050 cannot resolve .anyone hostnames — only an anon binary
#   joined to the Anyone network can. The connector dev infra exposes one
#   at 127.0.0.1:28050 (Story 21.15); that's the recommended endpoint.
#
# Exit codes:
#   0  — full round-trip succeeded; probe target reachable via .anyone
#   1  — usage / preflight failure (no leases.json, missing dependencies)
#   2  — round-trip failed (HS descriptor not yet propagated, anon binary
#        not available locally, or Akash lease not actually serving)

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LEASES_FILE="$ROOT/deploy/akash/leases.json"
SOCKS_PROXY="${SOCKS_PROXY:-127.0.0.1:28050}"
TARGET_PORT="${TARGET_PORT:-9000}"
ROUND_TRIP_TIMEOUT="${ROUND_TRIP_TIMEOUT:-30}"

usage() {
  cat <<USAGE
Usage: $0 [--socks <host:port>]

Validates the ATOR-probe Akash lease end-to-end. Reads the .anyone hostname
from leases.json (deploy first via 'scripts/akash-deploy.sh ator-probe'), then
dials it through a local anon SOCKS5 proxy to confirm the probe target
inside the lease responds via the hidden service.

Options:
  --socks <host:port>    SOCKS5 proxy address. Default: 127.0.0.1:28050
                         (the connector dev infra's anon-backed SOCKS).

Environment overrides:
  SOCKS_PROXY            Same as --socks
  TARGET_PORT            HS port to dial (default: 9000)
  ROUND_TRIP_TIMEOUT     Seconds to wait for round-trip (default: 30)
USAGE
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --socks) SOCKS_PROXY="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown arg: $1" >&2; usage; exit 1 ;;
  esac
done

# Preflight: deps
for c in jq curl; do
  if ! command -v "$c" >/dev/null 2>&1; then
    echo "ERROR: $c not on PATH" >&2
    exit 1
  fi
done

# Preflight: leases.json with ator-probe entry
if [ ! -f "$LEASES_FILE" ]; then
  echo "ERROR: $LEASES_FILE not found." >&2
  echo "       Deploy first: scripts/akash-deploy.sh ator-probe" >&2
  exit 1
fi

ONION="$(jq -r '."ator-probe".onion // empty' "$LEASES_FILE")"
if [ -z "$ONION" ]; then
  echo "ERROR: no ator-probe.onion in $LEASES_FILE." >&2
  echo "       Deploy first: scripts/akash-deploy.sh ator-probe" >&2
  exit 1
fi
if ! echo "$ONION" | grep -qE '^[a-z2-7]{56}\.anyone$'; then
  echo "ERROR: ator-probe.onion in leases.json is not a valid .anyone hostname:" >&2
  echo "       got: '$ONION'" >&2
  exit 1
fi
echo "[round-trip] .anyone hostname: $ONION"

# Preflight: SOCKS5 proxy reachable. The connector dev infra's anon SOCKS at
# 127.0.0.1:28050 is the recommended endpoint — vanilla system Tor does NOT
# resolve .anyone hostnames.
echo "[round-trip] checking SOCKS5 proxy at $SOCKS_PROXY..."
PROXY_HOST="${SOCKS_PROXY%:*}"
PROXY_PORT="${SOCKS_PROXY##*:}"
if ! (echo > "/dev/tcp/$PROXY_HOST/$PROXY_PORT") 2>/dev/null; then
  echo "ERROR: SOCKS5 proxy unreachable at $SOCKS_PROXY" >&2
  echo "       The probe target is a .anyone hidden service — only an anon" >&2
  echo "       binary joined to the Anyone network can resolve it. Vanilla" >&2
  echo "       Tor will not work." >&2
  echo "       Start the connector dev infra (which runs anon):" >&2
  echo "         scripts/townhouse-dev-infra.sh up" >&2
  echo "       Then re-run this test." >&2
  exit 1
fi

# Round-trip dial. The probe target is a socat listener that responds with
# "PROBE-OK\n" to any TCP connection. --socks5-hostname forces .anyone
# resolution at the SOCKS proxy (the only resolver that knows the TLD).
echo "[round-trip] dialing $ONION:$TARGET_PORT through $SOCKS_PROXY..."
RESP="$(
  curl -sf -m "$ROUND_TRIP_TIMEOUT" \
    --connect-timeout 15 \
    --socks5-hostname "$SOCKS_PROXY" \
    "telnet://$ONION:$TARGET_PORT" 2>/dev/null \
  || true
)"

if echo "$RESP" | grep -q '^PROBE-OK$'; then
  echo "[round-trip] SUCCESS — probe responded via .anyone"
  echo
  echo "  ✓ anon binary works on Akash provider runtime"
  echo "  ✓ HS descriptor published to the public Anyone network"
  echo "  ✓ TCP traffic routes through .anyone → 127.0.0.1:$TARGET_PORT inside the lease"
  echo "  ✓ No public ingress required — the .anyone address is the only access path"
  echo
  echo "Proceed to Phase 2: townhouse connector schema delta."
  exit 0
fi

echo "[round-trip] FAIL — no PROBE-OK from $ONION:$TARGET_PORT" >&2
echo "             Possible causes:" >&2
echo "             - HS descriptor not yet propagated. Initial publish takes" >&2
echo "               60-120s after deploy; retry in another minute." >&2
echo "             - Akash provider's egress is firewalled from outbound" >&2
echo "               Anyone HSDir traffic (rare; redeploy + denylist if so)." >&2
echo "             - The seeded keypair didn't load inside the container." >&2
echo "               Check that the keys at deploy/akash/ator-probe-keys/hs/" >&2
echo "               match the .anyone hostname recorded in leases.json." >&2
exit 2
