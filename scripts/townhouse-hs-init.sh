#!/usr/bin/env bash
# Townhouse hidden-service initialization.
#
# One-time keypair generator for the townhouse-hs operator stack. Generates
# a v3 hidden-service keypair locally, captures the .anyone hostname, and
# writes both:
#   - infra/townhouse-hs-keys/hs/   (the keypair — gitignored)
#   - .env.townhouse-hs.local       (the secret + URL — gitignored)
#   - docker/configs/townhouse-hs-connector.local.yaml  (rendered config)
#
# After running this once, the operator can `docker compose up` repeatedly
# and the .anyone address stays stable. To rotate, delete the keys directory
# and re-run.
#
# Why pre-generate locally instead of letting the sidecar regenerate on each
# boot: the apex connector needs to know its own externalUrl BEFORE startup
# to advertise to peers. With pre-generated keys, the address is known upfront
# and gets baked into both the connector YAML and the sidecar's seeded
# secret. (The connector image's `externalUrl: 'auto'` runtime resolver only
# works when `managed: true`, but managed=true triggers the broken in-process
# anon SDK path — see Phase 3 findings.)

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
KEYS_DIR="$ROOT/infra/townhouse-hs-keys"
RELAY_KEYS_DIR="$ROOT/infra/townhouse-hs-keys-relay"
ENV_FILE="$ROOT/.env.townhouse-hs.local"
CONNECTOR_TEMPLATE="$ROOT/docker/configs/townhouse-hs-connector.yaml"
CONNECTOR_RENDERED="$ROOT/docker/configs/townhouse-hs-connector.local.yaml"
SIDECAR_IMAGE="${SIDECAR_IMAGE:-toon:townhouse-ator-sidecar}"

usage() {
  cat <<USAGE
Usage: $0 [--rotate]

One-time keypair generator for townhouse-hs mode. Idempotent: re-running
without --rotate prints the existing .anyone address.

Options:
  --rotate    Delete the existing keypair and generate a fresh one. The
              .anyone address WILL change. External peers cached on the
              old address will need to be re-told the new one.

Outputs (all gitignored):
  $KEYS_DIR/hs/hostname                       connector .anyone address
  $KEYS_DIR/hs/hs_ed25519_secret_key          connector identity key
  $RELAY_KEYS_DIR/hs/hostname                 relay .anyone address
  $RELAY_KEYS_DIR/hs/hs_ed25519_secret_key    relay identity key
  $ENV_FILE                                    HS_*_SECRET_KEY_B64 + URL env vars
  $CONNECTOR_RENDERED                          connector YAML with explicit externalUrl
USAGE
}

rotate=false
while [ "$#" -gt 0 ]; do
  case "$1" in
    --rotate) rotate=true; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown arg: $1" >&2; usage >&2; exit 1 ;;
  esac
done

if $rotate; then
  echo "[hs-init] --rotate: removing existing keypairs under $KEYS_DIR and $RELAY_KEYS_DIR"
  rm -rf "$KEYS_DIR" "$RELAY_KEYS_DIR"
fi

# Ensure docker is available; the sidecar image is the source of truth for
# anon's keypair format.
command -v docker >/dev/null || { echo "ERROR: docker required" >&2; exit 1; }
command -v base64 >/dev/null || { echo "ERROR: base64 required" >&2; exit 1; }

# Verify the sidecar image is built locally. Don't auto-build here — keep
# this script focused on keygen. The operator builds via:
#   docker build -f docker/townhouse-ator-sidecar/Dockerfile \
#     -t toon:townhouse-ator-sidecar docker/townhouse-ator-sidecar
if ! docker image inspect "$SIDECAR_IMAGE" >/dev/null 2>&1; then
  echo "ERROR: $SIDECAR_IMAGE not found locally. Build it first:" >&2
  echo "  docker build -f docker/townhouse-ator-sidecar/Dockerfile \\" >&2
  echo "    -t $SIDECAR_IMAGE docker/townhouse-ator-sidecar" >&2
  exit 1
fi

# Generate a fresh v3 hidden-service keypair into <target_dir>/hs/.
# Uses docker run + docker cp out (NOT a bind mount) — the sidecar image's
# `chown -R root:root /var/lib/anon` would conflict with a host-uid-1000
# bind mount and segfault anon (Phase 1 lesson).
generate_keypair() {
  local target_dir="$1"
  local label="$2"
  echo "[hs-init] generating fresh v3 keypair for ${label} via $SIDECAR_IMAGE..."
  rm -rf "$target_dir"
  mkdir -p "$target_dir"

  local cid
  cid="$(docker run -d --rm=false "$SIDECAR_IMAGE")"
  # shellcheck disable=SC2064
  trap "docker rm -f $cid >/dev/null 2>&1 || true" EXIT

  local waited=0
  while [ "$waited" -lt 15 ]; do
    if docker exec "$cid" test -s /var/lib/anon/hs/hostname 2>/dev/null; then
      break
    fi
    sleep 1
    waited=$((waited + 1))
  done

  if ! docker exec "$cid" test -s /var/lib/anon/hs/hostname 2>/dev/null; then
    echo "ERROR: ${label} keypair didn't materialize in $waited seconds. Container logs:" >&2
    docker logs "$cid" 2>&1 | tail -20 >&2
    exit 1
  fi

  docker cp "$cid:/var/lib/anon/hs" "$target_dir/hs"
  docker rm -f "$cid" >/dev/null 2>&1
  trap - EXIT
}

# ── Connector keypair ──
if [ -s "$KEYS_DIR/hs/hostname" ] && [ -s "$KEYS_DIR/hs/hs_ed25519_secret_key" ]; then
  echo "[hs-init] connector keypair already exists at $KEYS_DIR (use --rotate to regenerate)"
else
  generate_keypair "$KEYS_DIR" "connector"
fi

# ── Relay keypair (second hidden service for the Nostr relay on :7100) ──
if [ -s "$RELAY_KEYS_DIR/hs/hostname" ] && [ -s "$RELAY_KEYS_DIR/hs/hs_ed25519_secret_key" ]; then
  echo "[hs-init] relay keypair already exists at $RELAY_KEYS_DIR (use --rotate to regenerate)"
else
  generate_keypair "$RELAY_KEYS_DIR" "relay"
fi

# Read the connector address + secret.
ONION="$(cat "$KEYS_DIR/hs/hostname" | tr -d '\n')"
SECRET_B64="$(base64 -w0 "$KEYS_DIR/hs/hs_ed25519_secret_key")"
EXTERNAL_URL="wss://${ONION}/btp"

# Read the relay address + secret. The relay HS is published on port 7100,
# so external Nostr clients dial wss://<relay-onion>:7100 directly.
RELAY_ONION="$(cat "$RELAY_KEYS_DIR/hs/hostname" | tr -d '\n')"
RELAY_SECRET_B64="$(base64 -w0 "$RELAY_KEYS_DIR/hs/hs_ed25519_secret_key")"
RELAY_EXTERNAL_URL="wss://${RELAY_ONION}:7100"

# Write .env.townhouse-hs.local — sourced by docker compose AND by
# scripts/akash-deploy.sh townhouse.
cat > "$ENV_FILE" <<EOF
# AUTO-GENERATED by scripts/townhouse-hs-init.sh — do not edit by hand.
# Regenerate via: scripts/townhouse-hs-init.sh --rotate

# Apex connector's hidden-service identity (ator-sidecar seeds this on startup).
HS_SECRET_KEY_B64=${SECRET_B64}

# The .anyone URL the apex connector advertises to peers. Pre-known because
# we generated the keypair locally; matches what the sidecar publishes.
TOWNHOUSE_EXTERNAL_URL=${EXTERNAL_URL}

# Nostr relay's hidden-service identity (ator-sidecar-relay seeds this).
# Distinct .anyone identity from the connector so the relay can be dialed
# directly by external Nostr clients without going through the BTP connector.
HS_RELAY_SECRET_KEY_B64=${RELAY_SECRET_B64}

# The .anyone URL the relay advertises to peers (kind:10166 seed entries +
# NIP-65 relay lists). Forwarded into the town container as
# TOON_EXTERNAL_RELAY_URL by docker-compose-townhouse-hs.yml. The :7100
# port matches the HS_PORT directive in the relay sidecar's torrc.
TOWNHOUSE_RELAY_EXTERNAL_URL=${RELAY_EXTERNAL_URL}
EOF

# Write a rendered connector YAML with the concrete externalUrl. The compose
# mounts THIS file (not the template) into the connector container.
sed \
  -e "s|__TOWNHOUSE_EXTERNAL_URL__|${EXTERNAL_URL}|g" \
  "$CONNECTOR_TEMPLATE" \
  > "$CONNECTOR_RENDERED"

cat <<MSG

[hs-init] DONE.

  Connector .anyone address:  ${ONION}
  Connector externalUrl:      ${EXTERNAL_URL}
  Connector keys dir:         ${KEYS_DIR}/hs/

  Relay .anyone address:      ${RELAY_ONION}
  Relay externalUrl:          ${RELAY_EXTERNAL_URL}
  Relay keys dir:             ${RELAY_KEYS_DIR}/hs/

  env file:                    ${ENV_FILE}
  connector yaml:              ${CONNECTOR_RENDERED}

Next steps:
  1. Boot the stack:
       docker compose --env-file ${ENV_FILE} \\
         -f docker-compose-townhouse-hs.yml \\
         --profile localnet --profile town --profile mill --profile faucet up -d
  2. Wait ~30-90s for the HS descriptors to publish (visible in:
       docker compose logs ator-sidecar       | grep "HS hostname"
       docker compose logs ator-sidecar-relay | grep "HS hostname")
  3. Share with peers:
       - BTP/connector:  ${EXTERNAL_URL}
       - Nostr relay:    ${RELAY_EXTERNAL_URL}

Note: town + mill come pre-keyed with DEV-ONLY deterministic identities baked
      into the compose env block (matching scripts/townhouse-dev-infra.sh).
      Override per-service in ${ENV_FILE} for non-default keys:
        TOWN_SECRET_KEY=...   # 64-char hex Nostr secret for town
        MILL_MNEMONIC="..."   # BIP-39 phrase for mill BIP-32 swap key derivation
        MILL_SECRET_KEY=...   # 64-char hex fallback (only used if MILL_MNEMONIC unset)
MSG
