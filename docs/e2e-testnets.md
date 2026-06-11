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

The local infra deploys the EVM registry/token, Solana program, and Mina zkApp
fresh each run. On public testnets these are deployed **once** and their
addresses pinned in `e2e/testnets.json`:

- **Base Sepolia:** deploy the payment-channel registry + a mock USDC (or use an
  existing testnet token). Deployer = the funded EVM key at role index 0.
- **Solana devnet:** deploy the payment-channel program (`contracts/solana/`).
  ⚠️ Solana **devnet resets periodically** — when it does, the program + funds
  are wiped and must be redeployed/refunded.
- **Mina devnet:** deploy the PaymentChannel zkApp (o1js). Slow (multi-minute
  slots) — keep Mina nightly, not per-PR.

> Deploy scripts targeting public testnets are tracked as the next phase (they
> parameterize the existing local deploy scripts by RPC + `E2E_DEV_MNEMONIC`).

---

## Open decision: distinct non-EVM keys

The SDK's `fromMnemonicFull(mnemonic, { accountIndex })` only varies the
**EVM/Nostr** key by `accountIndex`. Solana (`m/44'/501'/0'/0'`) and Mina
(`m/44'/12586'/0'/0/0`) derive at **fixed** paths, so every role (peer1, peer2,
treasury) shares **one** Solana key and **one** Mina key from a single mnemonic.

A two-peer settlement/swap E2E needs **distinct** identities per peer on every
chain. Two ways to get there:

1. **Enhance SDK derivation** (recommended) — thread `accountIndex` into the
   Solana/Mina paths (`m/44'/501'/{idx}'/0'`, `m/44'/12586'/{idx}'/0/0`).
   Backward-compatible at index 0; keeps the single-seed model. Touches the SDK
   derivation golden-vector tests.
2. **Per-role mnemonics** — one secret per peer (`E2E_PEER1_MNEMONIC`, …). No
   SDK change; more secrets to manage.

Pick one before deploying — it changes which addresses you fund.

---

## Status

- ✅ Key plumbing: `.env.e2e.example`, `.gitignore`, `scripts/e2e-wallet.mjs`,
  `e2e/testnets.json` skeleton, this runbook.
- ⏳ Next: resolve the "distinct non-EVM keys" decision, deploy contracts to the
  three testnets + record addresses, add the public-mode harness
  (`sdk-e2e-infra.sh --public` or equivalent) that skips local chain boot and
  points peers/tests at the testnets, and a nightly CI job using the org secret.
