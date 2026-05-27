FROM node:20-alpine

WORKDIR /app

# Build context = repo root (so the deterministic Solana faucet authority
# under infra/solana/keys/ can be baked into the image at /etc/faucet/).
# Invocation: `docker build -f packages/faucet/Dockerfile .` from repo root.
#
# Explicit per-dir COPY (not `COPY packages/faucet/ ./`) so the operator's
# local `packages/faucet/node_modules` doesn't collide with the layer that
# `npm install --omit=dev` produced below.
COPY packages/faucet/package.json packages/faucet/package-lock.json ./

RUN npm install --omit=dev

COPY packages/faucet/src ./src
COPY packages/faucet/public ./public

# Schema-contract file for server-side ajv validation (DN1, story 49.2
# code review AC #1). Placed at contracts/ relative to src/ so index.js
# can resolve it via `../contracts/faucet.schema.json`.
RUN mkdir -p contracts
COPY packages/townhouse/contracts/faucet.schema.json ./contracts/faucet.schema.json

# Bake the deterministic Solana faucet authority. Same security posture as
# Anvil's account[0] private key — public devnet fixture, committed to repo.
# See the deploy/akash/README.md § "Faucet" and § "Why public dev keypairs"
# for the security rationale. Mode 0o644 is fine because the file is
# treated as a fixture, not a secret. Override the mount path with
# SOLANA_FAUCET_AUTHORITY_KEYPAIR_PATH at runtime if needed.
RUN mkdir -p /etc/faucet
COPY infra/solana/keys/faucet-authority.json /etc/faucet/sol-authority.json
RUN chmod 0644 /etc/faucet/sol-authority.json

EXPOSE 3500

HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:3500/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

CMD ["npm", "start"]
