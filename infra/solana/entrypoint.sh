#!/bin/sh
# Solana Test Validator Entrypoint
# Starts the validator with embedded BPF programs, waits for readiness.
#
# Uses --bpf-program to load .so files at genesis (avoids needing solana CLI
# for deploy). Readiness is probed via JSON-RPC `getHealth` (no CLI needed),
# so this entrypoint works on minimal images that ship only the validator.
set -eu

# Trap SIGTERM/SIGINT and forward to the validator for graceful shutdown
VALIDATOR_PID=""
cleanup() {
  if [ -n "${VALIDATOR_PID:-}" ]; then
    kill -TERM "$VALIDATOR_PID" 2>/dev/null || true
  fi
}
trap cleanup TERM INT

# Build --bpf-program flags for every .so in /programs into a positional-args
# array. Using `set --` keeps each path as one argv token, so paths containing
# whitespace are preserved correctly.
set --
for so_file in /programs/*.so; do
  if [ -f "$so_file" ]; then
    basename=$(basename "$so_file" .so)
    keypair_file="/programs/${basename}-keypair.json"
    if [ -f "$keypair_file" ]; then
      echo "Loading $basename at genesis (keypair: $keypair_file)"
      set -- "$@" --bpf-program "$keypair_file" "$so_file"
    else
      echo "Loading $basename at genesis (auto program ID)"
      set -- "$@" --bpf-program "$so_file" "$so_file"
    fi
  fi
done

/workspace/bin/solana-test-validator \
  --reset \
  --limit-ledger-size 50000000 \
  "$@" \
  &
VALIDATOR_PID=$!

# Wait for readiness via JSON-RPC `getHealth` (avoids depending on the `solana`
# CLI binary, which is not present on minimal validator images).
echo "Waiting for Solana validator to be ready..."
until curl -sf -X POST http://localhost:8899 \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' \
  2>/dev/null | grep -q '"result":"ok"'; do
  sleep 1
done
echo "Validator ready."

# `|| true` so a graceful SIGTERM (validator exits non-zero) does not propagate
# under `set -e` and confuse compose health/restart policies.
wait "$VALIDATOR_PID" || true
