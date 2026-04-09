---
name: akash-deploy
description: "Deploy and manage applications on Akash Network's decentralized cloud using the provider-services CLI. Use when the user asks about: (1) deploying on Akash ('deploy on Akash', 'deploy to decentralized cloud', 'Akash deployment'), (2) writing SDL manifests ('create SDL', 'Akash deployment file', 'deploy.yaml for Akash'), (3) Akash CLI operations ('install provider-services', 'Akash CLI', 'check deployment status', 'view Akash logs', 'close deployment'), (4) Akash cost/pricing ('how much does Akash cost', 'Akash pricing', 'choose Akash provider'), (5) Akash advanced features ('persistent storage on Akash', 'GPU deployment Akash', 'Akash AuthZ', 'IP leases'), (6) Akash troubleshooting ('no bids on Akash', 'deployment failed', 'escrow overdraw')."
---

# Akash Network CLI Deployment

Deploy Docker containers on Akash Network's decentralized cloud marketplace via the `provider-services` CLI. Akash uses a reverse-auction marketplace where tenants define resources in SDL (YAML) and providers bid to fulfill them, typically 50-85% cheaper than AWS/GCP/Azure.

## Task Routing

Determine what the user needs and follow the appropriate section:

- **First-time setup** -> "Setup" section
- **Write/edit an SDL manifest** -> "SDL Authoring" section + read [references/sdl-reference.md](references/sdl-reference.md)
- **Deploy an application** -> "Deploy" section
- **Monitor/manage a running deployment** -> "Operate" section
- **Something isn't working** -> "Troubleshoot" section
- **Cost questions or provider selection** -> "Optimize" section
- **Persistent storage, GPU, IP leases, AuthZ** -> "Advanced" section + read [references/sdl-reference.md](references/sdl-reference.md)
- **Full CLI command reference** -> read [references/cli-reference.md](references/cli-reference.md)

## Setup

Install the CLI and configure the environment. Guide the user through each step, confirming completion before proceeding.

1. **Install CLI:**
   - macOS: `brew tap akash-network/tap && brew install akash-provider-services`
   - Linux: Binary download from official repo, add to PATH
   - Verify: `provider-services version` (expect v0.10.0+)

2. **Set environment variables:**
```bash
export AKASH_KEY_NAME="mykey"
export AKASH_NET="https://raw.githubusercontent.com/akash-network/net/main/mainnet"
export AKASH_CHAIN_ID=$(curl -s "$AKASH_NET/chain-id.txt")
export AKASH_NODE=$(curl -s "$AKASH_NET/rpc-nodes.txt" | head -1)
export AKASH_GAS=auto
export AKASH_GAS_ADJUSTMENT=1.25
export AKASH_GAS_PRICES=0.025uakt
export AKASH_SIGN_MODE=amino-json
```

3. **Create wallet:** `provider-services keys add $AKASH_KEY_NAME` — save the mnemonic securely.

4. **Set address:** `export AKASH_ADDRESS=$(provider-services keys show $AKASH_KEY_NAME -a)`

5. **Fund wallet** with minimum 0.5 AKT (for escrow deposit).

6. **Verify balance:** `provider-services query bank balances $AKASH_ADDRESS`

Authentication is JWT by default (automatic, no setup). For mTLS details, see [references/cli-reference.md](references/cli-reference.md).

## SDL Authoring

Help the user write a `deploy.yaml` manifest. For complete SDL specification, validation rules, and examples, read [references/sdl-reference.md](references/sdl-reference.md).

**Decision tree:**
- User has a Docker image -> Help write SDL from scratch using the minimal template
- User wants a common app (database, web server, AI model) -> Point to matching template from Awesome Akash (290+ at https://github.com/akash-network/awesome-akash)
- User has an existing SDL -> Review for validation errors

**Key SDL structure:** `version` + `services` (containers) + `profiles` (compute resources + placement/pricing) + `deployment` (maps services to profiles with instance count).

**Pricing guidance:** Set `amount` in `uakt` (1 AKT = 1,000,000 uakt). Too low = no bids. Start with 1000 uakt for a small web app. Use https://akash.network/pricing/usage-calculator/ for estimates.

## Deploy

Guide the user through the 5-step deployment sequence. Each step must complete before the next.

```bash
# 1. Create deployment (returns DSEQ)
provider-services tx deployment create deploy.yml --from $AKASH_KEY_NAME
export DSEQ=<returned-dseq>

# 2. Wait ~30s, then view bids
provider-services query market bid list --owner $AKASH_ADDRESS --dseq $DSEQ

# 3. Accept bid / create lease
export PROVIDER=<chosen-provider-address>
provider-services tx market lease create --dseq $DSEQ --provider $PROVIDER --from $AKASH_KEY_NAME

# 4. Send manifest to provider
provider-services send-manifest deploy.yml --dseq $DSEQ --provider $PROVIDER --from $AKASH_KEY_NAME

# 5. Verify deployment is running
provider-services lease-status --dseq $DSEQ --provider $PROVIDER --from $AKASH_KEY_NAME
```

**Bid selection tips:** Compare price per block across providers. Check provider attributes for audited capabilities. Lower price is not always better — audited providers offer higher reliability.

## Operate

```bash
# Check status
provider-services lease-status --dseq $DSEQ --provider $PROVIDER --from $AKASH_KEY_NAME

# Stream logs
provider-services lease-logs --dseq $DSEQ --provider $PROVIDER --from $AKASH_KEY_NAME

# Shell access
provider-services lease-shell --dseq $DSEQ --provider $PROVIDER --service <name> --tty --from $AKASH_KEY_NAME

# Update deployment (2-step: update on-chain hash, then re-send manifest)
provider-services tx deployment update deploy.yml --dseq $DSEQ --from $AKASH_KEY_NAME
provider-services send-manifest deploy.yml --dseq $DSEQ --provider $PROVIDER --from $AKASH_KEY_NAME

# Add funds to escrow
provider-services tx deployment deposit <amount>uakt --dseq $DSEQ --from $AKASH_KEY_NAME

# Close deployment (refunds remaining escrow)
provider-services tx deployment close --dseq $DSEQ --from $AKASH_KEY_NAME

# List all active leases
provider-services query market lease list --owner $AKASH_ADDRESS
```

## Troubleshoot

| Problem | Likely Cause | Fix |
|---------|-------------|-----|
| No bids received | Pricing too low or resources unavailable | Increase `amount` in SDL pricing; check GPU model availability |
| Deployment OVERDRAWN | Escrow balance depleted | Add funds: `tx deployment deposit`; set higher initial deposit |
| Manifest send fails | Lease not created, or wrong provider address | Ensure step 3 (lease create) completed; verify PROVIDER matches bid |
| SDL validation error | Relative storage path, name mismatch, missing mount | See validation rules in [references/sdl-reference.md](references/sdl-reference.md) |
| Provider unreachable | Provider went offline | Close deployment, redeploy with different provider |
| Certificate error (mTLS) | Expired or unpublished cert | Regenerate: `tx cert generate client` + `tx cert publish client` |

## Optimize

**Cost estimation:** Use https://akash.network/pricing/usage-calculator/ or compare bid prices after deployment creation.

**Cost reduction strategies:**
- Right-size resources (start minimal, scale up based on actual usage)
- Compare multiple bids — prices vary significantly between providers
- Use CPU-only profiles when GPU is not needed
- Monitor escrow balance to avoid overdraw and redeployment costs

**Provider selection:** Use `provider-services query provider list` to browse. Filter by audited attributes for verified capabilities (GPU type, region, uptime).

## Advanced

For SDL syntax for these features, read [references/sdl-reference.md](references/sdl-reference.md). For CLI commands, read [references/cli-reference.md](references/cli-reference.md).

- **Persistent storage** — Add `persistent: true` storage volumes with absolute mount paths. Max 2 volumes per profile. Data survives container restarts but NOT provider migration.
- **IP leases** — Top-level `endpoints` section with `kind: ip` for dedicated IPv4. Bind to services via `ip:` field in expose rules.
- **GPU resources** — Add `gpu` section to compute profile with `units`, vendor, and model attributes.
- **AuthZ delegation** — Grant deployment permissions to other addresses for CI/CD without exposing private keys. Supports 5 message types (create/update/close deployment, create/withdraw lease).
- **Multi-service deployments** — Define multiple services with internal networking via `expose.to.service`. Use `depends-on` for startup ordering.
