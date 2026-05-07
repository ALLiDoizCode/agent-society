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
# CLI binary, which is not present on minimal validator images). We also
# require getSlot to advance — `getHealth: ok` can lie when the leader is
# wedged but the RPC is still serving cached state (observed on the first
# Akash Solana lease, slot stuck at 27009 for hours).
echo "Waiting for Solana validator to be ready..."
PREV_SLOT=""
READY_CHECKS=0
while true; do
  HEALTH=$(curl -sf -X POST http://localhost:8899 \
    -H 'Content-Type: application/json' \
    -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' 2>/dev/null || true)
  SLOT=$(curl -sf -X POST http://localhost:8899 \
    -H 'Content-Type: application/json' \
    -d '{"jsonrpc":"2.0","id":1,"method":"getSlot"}' 2>/dev/null \
    | sed -n 's/.*"result":\([0-9]*\).*/\1/p' || true)
  if echo "$HEALTH" | grep -q '"result":"ok"' && \
     [ -n "$SLOT" ] && [ "$SLOT" != "$PREV_SLOT" ] && [ "$SLOT" != "0" ]; then
    READY_CHECKS=$((READY_CHECKS + 1))
    if [ "$READY_CHECKS" -ge 2 ]; then break; fi
  else
    READY_CHECKS=0
  fi
  PREV_SLOT="$SLOT"
  sleep 1
done
echo "Validator ready (slot $SLOT)."

# Idempotent bootstrap: SPL Mock USDC mint + faucet treasury. Best-effort —
# logs failure but doesn't kill the validator, so a transient bootstrap error
# on a flaky network won't take the lease down. Re-running this entrypoint
# (e.g. after a container restart with persistent ledger) is a no-op once the
# mint exists.
if [ -f /bootstrap/bootstrap-usdc.mjs ]; then
  echo "Running USDC bootstrap..."
  cd /bootstrap
  node bootstrap-usdc.mjs || \
    echo "[bootstrap-usdc] non-fatal failure — continuing without USDC"
fi

# `|| true` so a graceful SIGTERM (validator exits non-zero) does not propagate
# under `set -e` and confuse compose health/restart policies.
wait "$VALIDATOR_PID" || true
