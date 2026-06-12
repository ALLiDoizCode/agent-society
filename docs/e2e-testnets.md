# Public-testnet E2E — dev wallet & bootstrap runbook

The public-testnet E2E mode runs the settlement/swap/pay-to-write flows against
**real public testnets** instead of the local devnets:

| Chain  | Network                           | RPC / endpoint                                   | Faucet                                                    |
| ------ | --------------------------------- | ------------------------------------------------ | --------------------------------------------------------- |
| EVM    | **Base Sepolia** (`eip155:84532`) | `https://sepolia.base.org`                       | https://www.alchemy.com/faucets/base-sepolia (and others) |
| Solana | **Devnet** (`solana:devnet`)      | `https://api.devnet.solana.com`                  | `solana airdrop` / https://faucet.solana.com              |
| Mina   | **Devnet** (`mina:devnet`)        | `https://api.minascan.io/node/devnet/v1/graphql` | https://faucet.minaprotocol.com                           |

Endpoints + deployed contract addresses live in [`e2e/testnets.json`](../e2e/testnets.json)
(public, committed). The funded wallet **seed phrase** does **not** — it lives in
`E2E_DEV_MNEMONIC` (org GitHub secret in CI, `.env.e2e.local` locally).

> This is an **additive** mode. The local devnet stack
> (`scripts/sdk-e2e-infra.sh`) stays as the fast, free, offline path for PR
> iteration; public testnets are the nightly gate.

---

## Key management

**One BIP-39 mnemonic → all chains.** A single dedicated, **testnet-only** seed
derives the EVM (Base Sepolia), Solana (devnet), and Mina (devnet) keys.

- **Local:** `.env.e2e.local` (gitignored). Copy from `.env.e2e.example`.
- **CI:** org GitHub Actions secret **`E2E_DEV_MNEMONIC`** (org-scoped so the
  connector repo can share the same funded wallet). GitHub auto-masks it in
  logs; fork-triggered PRs do **not** receive it, so the public gate only runs
  on `push` / `schedule` / `workflow_dispatch` from the main repo — which
  matches the nightly-only design.

**Rules**

- NEVER reuse a seed that has held mainnet funds. Testnet-only.
- NEVER commit `.env.e2e.local` or print private keys. `scripts/e2e-wallet.mjs`
  prints **public addresses only**.
- Rotate the wallet if the seed leaks (low stakes on testnets, but still).

---

## Bootstrap (one time)

```bash
# 0. Build the SDK once (the helper imports its derivation).
pnpm --filter @toon-protocol/sdk build

# 1. Generate a fresh testnet mnemonic (prints to stdout — it's a SECRET).
node scripts/e2e-wallet.mjs generate

# 2. Save it locally and in CI.
cp .env.e2e.example .env.e2e.local
#   → paste the mnemonic into E2E_DEV_MNEMONIC in .env.e2e.local
#   → add the SAME value as the org GitHub secret E2E_DEV_MNEMONIC

# 3. Print the addresses to fund.
node scripts/e2e-wallet.mjs addresses

# 4. Fund each printed address from the faucets in the table above.

# 5. Deploy the payment-channel contracts to each testnet (see below) and
#    record their addresses in e2e/testnets.json (registryAddress/tokenAddress,
#    programId/tokenMint, zkAppAddress).

# 6. Run the public-mode E2E (harness — see "Status" below).
```

---

## Contract deployment (one time, needs funded keys)

Deployed **once** per testnet from the funded deployer (the role index in
`E2E_DEPLOYER_INDEX`, default 2 — the only funded role today); addresses are
pinned in `e2e/testnets.json`. Reproducible scripts:

- **Base Sepolia** — `node scripts/deploy-e2e-testnet-evm.mjs`. Deploys
  `MockERC20` (USDC) + `TokenNetworkRegistry` and creates the `TokenNetwork`,
  via viem reading the connector's compiled Foundry artifacts (no `forge`
  needed). Records `registryAddress` / `tokenAddress` / `tokenNetworkAddress`.
- **Solana devnet** — `./scripts/deploy-e2e-testnet-solana.sh`. Deploys the
  `contracts/solana/` program at its deterministic ID + a mock USDC SPL mint.
  ⚠️ **Use a STABLE solana CLI (1.18.x)** — Agave 4.0.x fails fresh-program
  deploys with `AccountNotFound … error sending request`. ⚠️ Solana **devnet
  resets periodically** — re-run to redeploy/refresh after a reset.
- **Mina devnet** — `node scripts/deploy-e2e-mina-zkapp-bare.mjs` (needs
  `E2E_DEV_MNEMONIC` + a funded treasury idx-2 Mina account). Deploys the
  PaymentChannel zkApp **BARE** (`MINA_SKIP_INIT=1`, channelState=0) at a
  **dedicated deterministic index** (`E2E_MINA_ZKAPP_INDEX`, default **98**) and
  records the address into `e2e/testnets.json` `mina.zkAppAddress`. **Bare is
  required for settlement** (issue #185): a deployer-**initialized** zkApp writes
  `channelHash = Poseidon(deployer, deployer, 0)`, which the connector's
  `claimFromChannel` (`Poseidon(apex, client, 0)`) can never reproduce
  ("Supplied participant keys do not match the on-chain channelHash"). A bare
  deploy lets the **client**'s `openMinaChannel` write the correct
  `(client, apex)` channelHash on-chain. The wrapper derives the deployer (idx 2)
  - zkApp (idx 98) `EK…` keys from the mnemonic via the SDK + `@toon-protocol/core`'s
    `hexToMinaBase58PrivateKey`, then delegates to `scripts/deploy-mina-zkapp.ts`
    (the single source of truth for the o1js compile/deploy). Slow (o1js compile +
    multi-minute devnet slots) — keep Mina nightly, not per-PR. You cannot re-init
    over an existing account, so to deploy a genuinely fresh bare channel bump
    `E2E_MINA_ZKAPP_INDEX`.

  > **One-liner (init variant, NOT settle-able — kept for reference only):**
  > `MINA_GRAPHQL_URL=<devnet> MINA_DEPLOYER_PRIVATE_KEY=<EK> MINA_ZKAPP_PRIVATE_KEY=<EK> npx tsx scripts/deploy-mina-zkapp.ts`
  > deploys + **initializes** the zkApp (channelState=1). The connector cannot
  > settle against it — use the bare wrapper above for the real settle run.

  **Verify settlement (after the client opens the channel on-chain):** the
  connector settles by landing an on-chain `claimFromChannel`. Confirm the Mina
  `nonceField` advances **0 → 1** on the first settled publish (that transition
  is the on-chain proof a Mina-settled write landed). See
  `packages/townhouse/RUNBOOK.md` § "Mina reset gotcha — bare-zkApp precondition".

The deployed addresses currently in `e2e/testnets.json` were produced by these
scripts against the live testnets.

---

## Fund the peers (idx 0 / idx 1) from the treasury

The contracts above are deployed, but only the **treasury** role (BIP-32 account
index **2**) is faucet-funded on each chain. A two-party channel / swap / settle
flow needs **both peers** funded with native gas + tokens to deposit:

- **idx 0** = peer1 settlement (also the EVM contract deployer)
- **idx 1** = peer2 settlement

`scripts/fund-e2e-peers.mjs` has the funded treasury **distribute** to idx 0 /
idx 1 on every chain (decision: distribute-from-treasury, not per-address
faucet). One canonical invocation:

```bash
# Build the SDK + core once (the script + its Mina helper import their dists).
pnpm --filter @toon-protocol/sdk build
pnpm --filter @toon-protocol/core build

# All three chains (reads E2E_DEV_MNEMONIC + e2e/testnets.json):
node scripts/fund-e2e-peers.mjs

# Subset / preview:
node scripts/fund-e2e-peers.mjs --chains evm,solana
node scripts/fund-e2e-peers.mjs --dry-run     # print the plan, broadcast nothing
```

What it sends to **each** of idx 0 / idx 1:

| Chain         | Native gas (top-up to floor)                                      | Token                                                                     |
| ------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Base Sepolia  | ETH → `EVM_GAS_FLOOR_ETH` (0.01)                                  | MockUSDC transfer (`EVM_USDC_AMOUNT`, 50, 18-decimal)                     |
| Solana devnet | SOL → `SOL_GAS_FLOOR_SOL` (0.05)                                  | mock-USDC SPL transfer + recipient ATA (`SOL_USDC_AMOUNT`, 50, 6-decimal) |
| Mina devnet   | MINA (`MINA_AMOUNT`, 5; includes the 1 MINA account-creation fee) | — (native only)                                                           |

- **Derivation** matches `scripts/e2e-wallet.mjs`: `fromMnemonicFull(mnemonic, {
accountIndex })` from the built SDK, so the funded addresses are exactly the
  keys the harness transacts with (SDK #177 — every chain varies by index).
- **Idempotent / re-runnable.** Amounts are **top-ups to a target floor**: a peer
  already at/above the floor is skipped, and a re-run after a devnet reset (which
  wipes balances) refunds. Recipient ATAs / Mina accounts are created on first
  run only. Tune the floors via the `*_FLOOR_*` / `*_AMOUNT` env vars above.
- **Mina** is delegated to `scripts/fund-e2e-peers-mina.ts` (`npx tsx`), which
  signs a native MINA payment from the treasury's mnemonic-derived Mina key via
  o1js against the real devnet GraphQL endpoint (there is no lightnet
  accounts-manager on a public testnet). `fund-e2e-peers.mjs` invokes it
  automatically; `--dry-run` prints the Mina plan **without** invoking it.
- **Security.** Reads only the treasury seed (`E2E_DEV_MNEMONIC`, first from the
  env, then `.env.e2e.local`) to sign treasury-funded transfers. It never prints
  a private key. Use a TESTNET-ONLY wallet.

> **Live broadcast is operator/CI-only** — it requires the real
> `E2E_DEV_MNEMONIC` secret and a faucet-funded treasury on all three public
> testnets. Locally without the secret, validate with `--dry-run` (it reads
> live public RPC balances and prints the transfer plan, broadcasting nothing).

---

## Distinct per-peer keys (resolved — SDK #177)

`fromMnemonicFull(mnemonic, { accountIndex })` now varies **every** chain by
`accountIndex`:

- EVM/Nostr: `m/44'/60'|1237'/…/{accountIndex}`
- Solana: `m/44'/501'/{accountIndex}'/0'`
- Mina: `m/44'/12586'/{accountIndex}'/0/0`

So a **single** `E2E_DEV_MNEMONIC` yields fully distinct per-peer identities on
all chains (one account index per role; see `scripts/e2e-wallet.mjs`). Index 0
is byte-identical to the historical fixed paths, so existing keys are
unchanged. No per-role mnemonics needed.

---

## Status

- ✅ Key plumbing: `.env.e2e.example`, `.gitignore`, `scripts/e2e-wallet.mjs`,
  `e2e/testnets.json`, this runbook.
- ✅ Distinct per-peer keys on every chain from one seed (SDK #177).
- ✅ Wallet funded (idx 2 / treasury) + `E2E_DEV_MNEMONIC` org secret.
- ✅ **Contracts deployed to all three testnets** (Base Sepolia / Solana devnet
  / Mina devnet) and pinned in `e2e/testnets.json`, via the scripts above.
- ✅ **Public-mode harness** (`scripts/sdk-e2e-infra.sh --public`, #183): skips
  the local chain boot and points the docker peers at the live testnets. It
  derives the per-peer settlement keys (idx0=peer1, idx1=peer2) from
  `E2E_DEV_MNEMONIC` via the SDK (`scripts/e2e-derive-peer-config.mjs`), reads
  endpoints/addresses from `e2e/testnets.json` (refusing to run if any required
  address is null), and layers `docker-compose-sdk-e2e.public.yml` over the base
  compose (EVM chain-id suffix 31337→84532). Run the offline derivation gate
  with `node scripts/e2e-derive-peer-config.mjs --check`.
- ✅ **Host-side EVM test actors point at the testnet too.** The SDK e2e helper
  (`packages/sdk/tests/e2e/helpers/docker-e2e-setup.ts`) used to hardcode the
  EVM RPC / chain-id / contract addresses / client keys to local Anvil values,
  ignoring the testnet env — so the host-side client kept hitting Anvil under
  `--public`. It now reads them from env (Anvil defaults preserved when unset):
  `EVM_RPC_URL`, `EVM_CHAIN_ID`, `EVM_TOKEN_ADDRESS`, `EVM_TOKEN_NETWORK_ADDRESS`,
  `EVM_REGISTRY_ADDRESS`, plus the funded test-actor keys `EVM_CLIENT_PRIVATE_KEY`
  / `EVM_CLIENT_ADDRESS` (publish/pay-to-write) and `EVM_SETTLEMENT_PRIVATE_KEY_A`
  / `_B` (settlement). The harness derives these from `E2E_DEV_MNEMONIC` at
  dedicated indices — **client idx3, settlement A idx4, settlement B idx5** — and
  writes them into the gitignored `.env.sdk-e2e` (removed on `down`).
- ✅ **Funding covers the run accounts.** `scripts/fund-e2e-peers.mjs` (#182/#187,
  invoked by `--public --fund`) distributes treasury (idx2) → peers idx0/idx1 on
  all three chains, **plus the host-side EVM test actors idx3/idx4/idx5 (ETH gas +
  MockUSDC on Base Sepolia only)** so the public pay-to-write + settlement e2e can
  open its channels. Idempotent top-ups; `--dry-run` validated. **Live run is
  operator/CI-only** (needs the secret + a funded treasury).
- ✅ **Nightly CI burn-in** (`.github/workflows/e2e-public-testnet.yml`, #184):
  `schedule` + `workflow_dispatch` only (fork PRs get no secret), injects
  `E2E_DEV_MNEMONIC`, and runs fund → `--public` up → SDK/mill e2es → teardown,
  every step `continue-on-error` until proven stable.
- ⏳ Next: run the live Mina **bare** deploy (`scripts/deploy-e2e-mina-zkapp-bare.mjs`,
  #185/#186) against devnet and pin the address; then, once the burn-in is stable,
  promote the nightly job from `continue-on-error` to a required gate.
