# Akash CLI Reference

## Table of Contents
- Installation
- Environment Setup
- Wallet Management
- Certificate Management
- Deployment Lifecycle Commands
- Monitoring Commands
- AuthZ Delegation
- Troubleshooting

## Installation

**macOS (Homebrew):**
```bash
brew tap akash-network/tap
brew install akash-provider-services
provider-services version  # Expect v0.10.0
```

**Linux:**
```bash
# Install dependencies
apt-get install -y jq unzip  # Debian/Ubuntu
# Download and run install script from official repo
# Add /root/bin to PATH via /etc/environment
provider-services version
```

**Windows:** Use WSL2 and follow Linux steps.

**From Source:** Requires Go 1.21+, properly configured GOPATH.

## Environment Setup

```bash
# Wallet identity
export AKASH_KEY_NAME="mykey"

# Network configuration (mainnet)
export AKASH_NET="https://raw.githubusercontent.com/akash-network/net/main/mainnet"
export AKASH_CHAIN_ID=$(curl -s "$AKASH_NET/chain-id.txt")
export AKASH_NODE=$(curl -s "$AKASH_NET/rpc-nodes.txt" | head -1)

# Gas settings
export AKASH_GAS=auto
export AKASH_GAS_ADJUSTMENT=1.25
export AKASH_GAS_PRICES=0.025uakt
export AKASH_SIGN_MODE=amino-json

# After wallet creation, set address
export AKASH_ADDRESS=$(provider-services keys show $AKASH_KEY_NAME -a)
```

## Wallet Management

```bash
# Create new wallet (SAVE THE MNEMONIC)
provider-services keys add $AKASH_KEY_NAME

# Recover from mnemonic
provider-services keys add $AKASH_KEY_NAME --recover

# Check balance (result in uakt; divide by 1,000,000 for AKT)
provider-services query bank balances $AKASH_ADDRESS

# List keys
provider-services keys list
```

Minimum 0.5 AKT required to create a deployment (funds the escrow account).

## Certificate Management

JWT authentication is default and automatic — no setup needed.

**Optional mTLS (for direct provider API access):**
```bash
# Generate client certificate
provider-services tx cert generate client --from $AKASH_KEY_NAME

# Publish certificate on-chain (~0.01 AKT, valid 1 year)
provider-services tx cert publish client --from $AKASH_KEY_NAME
```

## Deployment Lifecycle Commands

### 1. Create Deployment
```bash
provider-services tx deployment create deploy.yml --from $AKASH_KEY_NAME
```
Returns a deployment sequence number (DSEQ). Save it:
```bash
export DSEQ=<returned-dseq>
```

### 2. View Bids (wait ~30 seconds after creation)
```bash
provider-services query market bid list --owner $AKASH_ADDRESS --dseq $DSEQ
```
Review: provider address, price per block, and provider attributes.

### 3. Accept Bid / Create Lease
```bash
export PROVIDER=<chosen-provider-address>
provider-services tx market lease create \
  --dseq $DSEQ \
  --provider $PROVIDER \
  --from $AKASH_KEY_NAME
```

### 4. Send Manifest
```bash
provider-services send-manifest deploy.yml \
  --dseq $DSEQ \
  --provider $PROVIDER \
  --from $AKASH_KEY_NAME
```

### 5. Update Deployment (two-step)
```bash
# Step 1: Update on-chain deployment hash
provider-services tx deployment update deploy.yml \
  --dseq $DSEQ \
  --from $AKASH_KEY_NAME

# Step 2: Re-send manifest to provider
provider-services send-manifest deploy.yml \
  --dseq $DSEQ \
  --provider $PROVIDER \
  --from $AKASH_KEY_NAME
```

### 6. Close Deployment
```bash
provider-services tx deployment close \
  --dseq $DSEQ \
  --from $AKASH_KEY_NAME
```
Remaining escrow funds are refunded upon closure.

### 7. Add Funds to Escrow
```bash
provider-services tx deployment deposit <amount>uakt \
  --dseq $DSEQ \
  --from $AKASH_KEY_NAME
```

## Monitoring Commands

```bash
# Deployment status
provider-services lease-status \
  --dseq $DSEQ --provider $PROVIDER --from $AKASH_KEY_NAME

# Stream logs
provider-services lease-logs \
  --dseq $DSEQ --provider $PROVIDER --from $AKASH_KEY_NAME

# Shell access (interactive)
provider-services lease-shell \
  --dseq $DSEQ --provider $PROVIDER \
  --service <service-name> --tty \
  --from $AKASH_KEY_NAME

# Query deployment details
provider-services query deployment get --dseq $DSEQ --owner $AKASH_ADDRESS

# List all active leases
provider-services query market lease list --owner $AKASH_ADDRESS

# List available providers
provider-services query provider list
```

## AuthZ Delegation

Grant another address permission to deploy on your behalf (for CI/CD, team workflows):

**Supported message types:**
- `/akash.deployment.v1beta3.MsgCreateDeployment`
- `/akash.deployment.v1beta3.MsgUpdateDeployment`
- `/akash.deployment.v1beta3.MsgCloseDeployment`
- `/akash.market.v1beta3.MsgCreateLease`
- `/akash.market.v1beta3.MsgWithdrawLease`

```bash
# Grant deployment permissions to another address
provider-services tx authz grant <grantee-address> generic \
  --msg-type /akash.deployment.v1beta3.MsgCreateDeployment \
  --from $AKASH_KEY_NAME \
  --fees 5000uakt

# Grant all deployment message types (repeat for each msg-type)

# Deposit with delegator (grantee deploys, granter funds)
provider-services tx deployment deposit <amount>uakt \
  --dseq $DSEQ \
  --from <deploy-wallet> \
  --depositor-account <funding-wallet>
```

Granter pays deposits and fees. Transactions appear on-chain as from the granter.

## Troubleshooting

### No bids received
- Check pricing — if too low, no providers will bid. Increase `amount` in placement pricing.
- Verify resources are available — GPU models may have limited supply.
- Wait longer — bids can take 30-60 seconds to appear.

### Deployment goes OVERDRAWN
- Escrow balance depleted. Lease and all payments close automatically.
- Prevention: Monitor balance with `query deployment get`, add funds with `tx deployment deposit`.

### Manifest send fails
- Ensure lease is created first (step 3 before step 4).
- Verify provider address matches the accepted bid.
- Check certificate if using mTLS (JWT is default and automatic).

### SDL validation errors
- See SDL Reference for complete validation rules.
- Common: relative storage paths, name mismatches between profiles and services.

### Provider unreachable
- Provider may have gone offline. Close deployment, redeploy with a different provider.
- Use audited providers for higher reliability.
