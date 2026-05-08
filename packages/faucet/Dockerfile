FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies (includes @noble/curves for the Solana SPL primitives)
RUN npm install --omit=dev

# Copy application code
COPY . .

# Expose port
EXPOSE 3500

# Solana faucet authority keypair mount point (optional — only needed for the
# Solana USDC drip). The runtime/compose layer is responsible for mounting
# `infra/solana/keys/faucet-authority.json` to /etc/faucet/sol-authority.json.
# Override the path with SOLANA_FAUCET_AUTHORITY_KEYPAIR_PATH if needed.
# Without the mount, SOL airdrops still work; only the USDC drip is disabled.

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:3500/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

# Start the application
CMD ["npm", "start"]
