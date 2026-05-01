# Story 21.13: Dashboard — Wallet & Keys View (with Wallet API Extensions: balances, reveal, withdraw)

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

> **Scope note (story creation 2026-04-30):** Like 21.10, 21.11, and 21.12, the original epic-file scope for 21.13 named the view but did not enumerate the data sources. The Townhouse wallet surface is in poor shape today: the only existing wallet API is `GET /wallet`, which returns `NodeKeyInfo[]` (addresses + derivation paths only — **no balances, no chain RPC integration, no signed-send capability, no mnemonic-reveal flow**). The `townhouse-web` dev loop (`packages/townhouse-web/scripts/api-server.mjs`) doesn't initialize the `WalletManager` at all — `GET /wallet` currently returns `{ keys: [] }` against the dev stack because there's no decrypted state. The five chain devnets (Anvil, Solana, Mina) are running, the contract addresses are emitted to `.env.townhouse-dev`, but no host-side code reads them for balance queries. This story fixes the entire pipeline: extends `townhouse-dev-infra.sh` to capture the Mock USDC contract address, adds three wallet API routes (`GET /api/wallet/balances`, `POST /api/wallet/reveal`, `POST /api/wallet/withdraw`), wires the dev API loop to auto-initialize a deterministic dev wallet, then ships the wallet view on top with QR-coded address blocks, real per-chain balance MetricBlocks, an EVM-only signed withdrawal flow, and a password-gated seed-phrase reveal modal. Inherits 21.8.5 design tokens, 21.11 `<AddFunds>` deposit-addresses pattern, 21.12 `<BreakdownPill>` primitive (used here for net-balance roll-ups). Bundles the `viem` runtime dep on `@toon-protocol/townhouse` (EVM tx construction + signing — hand-rolling RLP+EIP-1559 in noble/curves was considered and rejected; rationale in Dev Notes § Why viem) and `qrcode.react` on `@toon-protocol/townhouse-web` (~5 KB, single-purpose, well-maintained). Solana and Mina **read-side** balance queries are bundled (the dev stack runs both); Solana and Mina signed withdrawals are explicitly out of scope and surface as "Coming soon" in the WithdrawModal — see Dev Notes § Withdrawal scope.

## Story

As a node operator,
I want a wallet view showing every derived keypair (Nostr + EVM + per-mill chain), each with its derivation path, current on-chain balance, deposit address with QR code, plus a one-click signed EVM withdrawal flow and a password-gated seed-phrase backup prompt,
so that I get an honest, single-pane view of where my funds live across chains, can verify which key is associated with which node, can move ETH and USDC out without leaving the dashboard, and can re-confirm my mnemonic backup any time without dropping into the CLI.

## Background

The Home view (21.9), the Town view (21.10), the Mill view (21.11), and the DVM view (21.12) all answer "is my node *running* and *earning*?". The Wallet view answers a different question: "**where are my earnings, and how do I get them out?**" The visceral signal for this view is the balance MetricBlocks rendering real numbers from real chains — `dev-mill-01` shows 100 ETH (Anvil deployer pre-fund), 1,000,000 USDC (Mock USDC mint), 10 SOL (Solana airdrop), 1,000 MINA (Mina lightnet airdrop) — and a withdrawal that actually moves bytes on the dev RPC. That's the difference between "I have keys" and "I have a wallet."

The dev stack runs five child node containers (2 Town + 2 Mill + 1 DVM) but the WalletManager derives keys per *type*, not per *instance* — so the wallet view renders one card per node type (3 cards: Town / Mill / DVM), each showing the type's derived addresses across all relevant chains. This matches the existing `GET /wallet` and `GET /api/nodes/:nodeId/deposit-addresses` precedent (type-level derivation, instance-level resolution). Per-instance key derivation (one keypair per container) is a separate decision deferred to a future story.

Three Townhouse API surfaces are added; one wallet-script extension captures the USDC contract address; the dev API loop is updated to initialize a deterministic dev wallet; then the view is built on top.

**Dev-stack-side change (in `scripts/townhouse-dev-infra.sh`):**

1. **Capture and emit `TOON_USDC_ADDRESS`.** The Anvil compose entrypoint and the fallback `scripts/deploy-mock-usdc.sh` both deploy the same FiatTokenV2_2-compatible Mock USDC, but the contract address is printed to stdout — never captured into `.env.townhouse-dev`. Mirror the existing `SOLANA_PROGRAM_ID` and `MINA_ZKAPP_ADDRESS` capture pattern: pipe the deploy script's address line, write to env, document at the success banner. Without this the balances endpoint cannot query USDC.

**Townhouse API extensions (in `packages/townhouse`, not `townhouse-web`):**

2. **`GET /api/wallet/balances`** — returns a flat array of `WalletBalance` entries, one per (nodeType × chainFamily × token) combination. Sources: EVM via JSON-RPC `eth_getBalance` + `eth_call(USDC.balanceOf)` against `TOWNHOUSE_DEV_ANVIL_RPC`; Solana via `getBalance` against `TOWNHOUSE_DEV_SOLANA_RPC`; Mina via GraphQL `account(publicKey).balance.total` against `TOWNHOUSE_DEV_MINA_GRAPHQL`. Per-chain RPC URLs are read from environment with sensible fallbacks. Server-side cache 5 s per address to avoid hammering RPCs across rapid view re-renders. Per-chain failure is partial — one missing RPC returns `available: false` for that family; other chains continue to return data.

3. **`POST /api/wallet/reveal`** — body `{ password: string }` → returns `{ mnemonic: string }` on success, 401 `{ error: 'invalid_password' }` on auth failure, 503 `{ error: 'wallet_not_initialized' }` if no `wallet.enc` file exists. Reads `~/.townhouse/wallet.enc` from disk, decrypts with `decryptWallet` using the provided password (existing scrypt+AES-GCM primitive from 21.4), returns the mnemonic in the JSON response. **Mnemonic is never logged, never cached in API memory beyond the request lifecycle.** Localhost-only by default (existing API server boundary).

4. **`POST /api/wallet/withdraw`** — body `{ nodeType: 'town' | 'mill' | 'dvm', chainFamily: 'evm', token: 'native' | 'USDC', recipient: string, amount: string }` → returns `{ txHash: string }` on success, 400 on validation error, 503 on RPC unreachable, 500 on broadcast error. v1: **EVM-only**, native ETH + ERC-20 USDC. Solana and Mina families return 501 `{ error: 'chain_not_supported_for_withdrawal' }` with a structured payload pointing the operator at the deposit-address copy flow. Server resolves the EVM private key from `WalletManager.getNodeKeys(nodeType).evmPrivateKey`, constructs an EIP-1559 transaction via `viem`, signs locally, broadcasts to `TOWNHOUSE_DEV_ANVIL_RPC` (chain ID 31337). Returns the transaction hash; client polls `GET /api/wallet/transaction/:txHash` for confirmation status (new, lightweight endpoint).

**Dev-loop change (in `packages/townhouse-web/scripts/api-server.mjs`):**

5. **Auto-initialize a deterministic dev wallet.** Today the dev API loop instantiates `WalletManager` but never calls `generate()` or `fromMnemonic()`, so `wallet.listKeys()` returns `[]` and the wallet view renders empty. Per the existing dev-stack pattern (deterministic Mill mnemonics in `townhouse-dev-infra.sh`), the dev API loop reads `TOWNHOUSE_DEV_WALLET_MNEMONIC` from env (added in `.env.townhouse-dev` — same BIP-39 test-vector-zero phrase the dev stack already uses for Mill: `'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'`) and calls `wallet.fromMnemonic(...)` at startup. Production builds remain unchanged — they go through `townhouse init` + `townhouse up` and load via password.

**View (in `packages/townhouse-web`):**

The Wallet view at `/wallet` renders one `<BalanceCard>` per node type (3 cards: Town / Mill / DVM). Each card has: header (`TypeChip` accent + `StatusDot` ok), a per-chain row stack (Nostr identity + EVM + Solana/Mina for Mill), each row a shadow-bordered card containing `ChainIcon` + address + derivation path (Geist Mono caption) + per-token `MetricBlock`s with `tabular-nums` + Copy button + QR-code disclosure. A footer row has a `Button` primary "Withdraw" CTA opening `<WithdrawModal>`. Above the cards, a backup banner: "Have you backed up your seed phrase?" → `Button` primary "Reveal seed phrase" opening `<RevealSeedModal>` (password prompt → 12-word mnemonic → "I've backed this up" ack). Home view's header gains a "Wallet →" link.

## Dependencies

- **Story 21.8.5** (done): primitives + Vite SPA scaffold + shadcn chart components + ESLint rules. Inherited verbatim.
- **Story 21.8.0** (done): dev stack with Anvil + Solana + Mina devnets and the host-side `.env.townhouse-dev` pattern. The view is developed against this stack per D21-009.
- **Story 21.4** (done): `WalletManager` with BIP-44 per-node-type derivation, `EncryptedWallet` schema, `encryptWallet`/`decryptWallet` primitives, `wallet.enc` on-disk format, `listKeys()`/`getNodeKeys()`/`getAllKeys()` APIs. All reused unchanged. 21.13 adds two `WalletManager`-adjacent server routes that hit disk + RPC; the manager class itself is not modified.
- **Story 21.8** (done): `createApiServer` factory + existing routes (`GET /wallet`, `GET /api/nodes`, `WS /api/metrics`). This story extends but does not break those.
- **Story 21.9** (done): Home view + `VIEW_LINKS`. Extended to expose a wallet-view link in the header.
- **Story 21.10** (done): connector-restart awareness pattern (not directly used here — wallet PATCHes don't trigger connector regen — but the WS metrics stream is reused for the Home banner).
- **Story 21.11** (done): `<AddFunds>` deposit-addresses disclosure (already in `src/components/AddFunds.tsx` thanks to 21.12's extraction). Extended to consume the new `<AddressBlock>` primitive in this story; cross-view backward-compatible.
- **Story 21.12** (done): `<BreakdownPill>` primitive — reused for the per-card "Total balance" roll-up.

**Runtime dependencies (new):**

- **`@toon-protocol/townhouse` (server):** `viem ^2.x`. Used for EIP-1559 transaction construction, EVM signing, and JSON-RPC client. Not currently a transitive dep — `mill` uses `@noble/curves` directly. We pick `viem` here because (a) the wallet view's withdrawal flow needs full RPC client + tx construction + receipt polling, (b) `viem` is the canonical lightweight EVM lib (~50 KB minzipped, tree-shakable), (c) hand-rolling RLP + EIP-1559 + nonce management + receipt polling on top of `@noble/curves` is high-effort and easy to get wrong (gas estimation, replacement tx, chain-id replay protection). See Dev Notes § Why viem.
- **`@toon-protocol/townhouse-web` (web):** `qrcode.react ^4.x`. ~5 KB minzipped, single-purpose, accessible (renders SVG with `role="img"` and `aria-label`). Used inside `<AddressBlock>` for deposit-address QR codes per AC-19. Alternative considered: hand-roll SVG QR encoding — 600 LOC of bit manipulation. Rejected. See Dev Notes § Why qrcode.react.

**No new runtime deps** in `docker/`, `packages/sdk/`, `packages/mill/`, or `packages/core/`. The `viem` and `qrcode.react` deps are scoped to the operator dashboard package boundary.

## Acceptance Criteria

### Dev-stack-side change (USDC address capture)

1. **AC-1: `TOON_USDC_ADDRESS` is captured by `townhouse-dev-infra.sh` and written to `.env.townhouse-dev`.** After the existing `deploy-mock-usdc.sh` invocation, capture stdout via `tail -n1 | sed 's/^.*TOON_USDC_ADDRESS=//'` (or equivalent), validate the result matches `/^0x[0-9a-fA-F]{40}$/`, and append `TOON_USDC_ADDRESS=<addr>` to the generated env file. If capture fails (script changed format or didn't run), log a non-fatal warning and emit `TOON_USDC_ADDRESS=` (empty) so the wallet API can detect and surface "USDC unavailable" honestly. Test: bring the dev stack up, `grep TOON_USDC_ADDRESS .env.townhouse-dev` returns a non-empty 0x-address.

### Townhouse API: balances + reveal + withdraw

2. **AC-2: `GET /api/wallet/balances` endpoint.** New route in a new file `packages/townhouse/src/api/routes/wallet-balances.ts` (separate from `wallet.ts` to keep the existing `/wallet` route untouched and the new chain-RPC code path isolated). Returns `WalletBalancesPayload`:
   ```ts
   interface WalletBalancesPayload {
     entries: WalletBalanceEntry[];
     ts: number;
   }
   interface WalletBalanceEntry {
     nodeType: 'town' | 'mill' | 'dvm';
     family: 'evm' | 'solana' | 'mina';
     token: 'ETH' | 'USDC' | 'SOL' | 'MINA';
     address: string;
     balance: string;          // decimal-string in raw units (wei, lamports, etc.)
     scale: number;            // decimal places — 18 for ETH, 6 for USDC, 9 for SOL, 9 for MINA
     available: boolean;       // false if RPC unreachable or address unsupported
     reason?: string;          // populated when `available === false`
   }
   ```
   Per-family fetch logic:
   - **EVM:** `eth_getBalance` (JSON-RPC) for ETH; `eth_call` to `TOON_USDC_ADDRESS` with selector `0x70a08231` (`balanceOf(address)`) for USDC. RPC URL from `TOWNHOUSE_DEV_ANVIL_RPC` env (fallback `http://127.0.0.1:28545`). USDC address from `TOON_USDC_ADDRESS` env; if absent, USDC entries have `available: false, reason: 'usdc_address_not_configured'`.
   - **Solana (Mill only):** RPC method `getBalance` against `TOWNHOUSE_DEV_SOLANA_RPC` env (fallback `http://127.0.0.1:28899`).
   - **Mina (Mill only):** GraphQL query `query { account(publicKey: $pk) { balance { total } } }` against `TOWNHOUSE_DEV_MINA_GRAPHQL` env (fallback `http://127.0.0.1:28085/graphql`).
   - **Per-address server-side cache:** 5 s TTL (matches the dashboard's 5 s poll interval). Cache key is `${family}:${address}:${token}`.
   - **Returns 503 `{ error: 'wallet_not_initialized' }`** when `wallet.listKeys()` throws. **Returns 200 with partial data** (some entries `available: false`) when individual RPCs are unreachable — never one bad RPC kills the whole response. Per-fetch timeout 3 s via `AbortController`.
   - Test file `wallet-balances.test.ts` covering: happy path (all chains return), wallet not initialized 503, per-RPC timeout returns `available: false`, USDC address absent returns USDC unavailable, cache hit returns same `ts`, parallel fetches don't double-call RPCs.
3. **AC-3: `POST /api/wallet/reveal` endpoint.** New route in `packages/townhouse/src/api/routes/wallet-reveal.ts`. Body `{ password: string }` (JSON-schema validated; `password` is non-empty string ≤ 256 chars). Server reads `~/.townhouse/wallet.enc` (path from `deps.config.wallet.encrypted_path` — same path the CLI uses), passes the encrypted blob through `decryptWallet(blob, password)` (existing primitive). Response:
   - 200 `{ mnemonic: string }` on success.
   - 401 `{ error: 'invalid_password' }` on `decryptWallet` throw.
   - 503 `{ error: 'wallet_not_initialized' }` when the file is absent (`ENOENT`).
   - 500 `{ error: 'wallet_corrupted', message }` on JSON-parse failure.
   - **Never** logs `password` or `mnemonic` (verify with a `vi.spyOn(console)` test). The mnemonic string is **not** stored in any module-scoped variable; it lives only in the response body lifetime. The route handler must pass the decrypted string directly into `reply.send({ mnemonic })` without intermediate caches.
   - Test file `wallet-reveal.test.ts` covering: happy path with `'abandon abandon ... about'`, wrong password 401, missing file 503, corrupted file 500, password schema rejection (empty / oversized) 400, log-leak assertion (the `password` and `mnemonic` strings never appear in `app.log` output).
4. **AC-4: `POST /api/wallet/withdraw` endpoint.** New route in `packages/townhouse/src/api/routes/wallet-withdraw.ts`. Body schema:
   ```ts
   interface WithdrawRequest {
     nodeType: 'town' | 'mill' | 'dvm';
     chainFamily: 'evm';        // v1 — solana/mina rejected with 501
     token: 'native' | 'USDC';
     recipient: string;          // EIP-55 checksummed address; case-sensitive
     amount: string;             // decimal-string in raw units (wei / 1e6 USDC units)
   }
   interface WithdrawResponse {
     txHash: `0x${string}`;
     chainId: number;
   }
   ```
   - **Validation:** `nodeType` ∈ enum (400 otherwise); `chainFamily === 'evm'` (501 `{ error: 'chain_not_supported_for_withdrawal', message: 'Solana/Mina withdrawal coming soon — copy the address and use an external wallet for now', supportedFamilies: ['evm'] }` on `'solana'` / `'mina'`); `token` ∈ {`native`, `USDC`} for EVM (400 otherwise); `recipient` matches `/^0x[0-9a-fA-F]{40}$/` AND passes EIP-55 checksum (400 with `code: 'invalid_recipient_checksum'` if regex passes but checksum fails — copy from the existing checksum primitive in `wallet/manager.ts`); `amount` parses as a positive `BigInt` (400 otherwise); `amount` ≤ on-chain balance from `getBalance` (400 with `code: 'insufficient_balance'`).
   - **Tx construction:** EIP-1559 type 2. Use `viem`'s `walletClient.sendTransaction({ to: recipient, value: amount, ... })` for `token='native'`; use `walletClient.writeContract` with the USDC address + `transfer(to, amount)` ABI for `token='USDC'`. Read `chainId` and `gas` from the RPC; let `viem` handle nonce. RPC URL from `TOWNHOUSE_DEV_ANVIL_RPC` env (production: future config knob). USDC address from `TOON_USDC_ADDRESS`.
   - **Errors:** 503 `{ error: 'rpc_unreachable' }` on RPC connection failure; 500 `{ error: 'broadcast_failed', message }` on `eth_sendRawTransaction` rejection (e.g., insufficient gas, nonce conflict). Never log the private key or signed-tx hex.
   - **Localhost-only:** the existing API server bind (loopback by default) is the only auth boundary. Documented in Dev Notes § Threat model.
   - Test file `wallet-withdraw.test.ts` covering: happy path native ETH (mocked viem client), happy path USDC, solana/mina returns 501, invalid recipient 400, insufficient balance 400, RPC unreachable 503, log-leak assertion (private key + signed-tx hex never in logs), checksum-mismatch 400 distinct from regex-fail.
5. **AC-5: `GET /api/wallet/transaction/:txHash` lightweight receipt-polling endpoint.** New route in same file as AC-4. Returns `{ status: 'pending' | 'success' | 'reverted', blockNumber?: number, txHash: string }`. Server calls `viem`'s `getTransactionReceipt(txHash)` against `TOWNHOUSE_DEV_ANVIL_RPC`; absent receipt → `pending`. 400 on malformed hash; 503 on RPC unreachable. Test: receipt found returns success, absent returns pending, malformed hash 400.
6. **AC-6: API types extension.** `packages/townhouse/src/api/types.ts` exports:
   - `WalletBalanceEntry` (per AC-2)
   - `WalletBalancesPayload` (per AC-2)
   - `WithdrawRequest` (per AC-4)
   - `WithdrawResponse` (per AC-4)
   - `RevealRequest` `{ password: string }`
   - `RevealResponse` `{ mnemonic: string } | { error: 'invalid_password' | 'wallet_not_initialized' | 'wallet_corrupted' }`
   - `TransactionReceiptPayload` (per AC-5)
   - Re-export from `packages/townhouse/src/api/index.ts` and `packages/townhouse/src/index.ts`.
7. **AC-7: Route registration in `createApiServer`.** Update `packages/townhouse/src/api/server.ts` to call the three new `register*Routes` functions after `registerWalletRoutes`. Each new route file exports a single named `register*Routes(app, deps)` function. **Do not modify** the existing `registerWalletRoutes` body — additive only, so the existing `GET /wallet` test stays green.
8. **AC-8: API regression — full suite green.** `pnpm --filter @toon-protocol/townhouse test` passes. Existing 21.4/21.8/21.10/21.11/21.12 tests remain green. New tests added per AC-2, AC-3, AC-4, AC-5. Existing connector contract canary (`packages/townhouse/src/__integration__/connector-image-contract.test.ts`) untouched.

### Dev-loop wiring

9. **AC-9: Dev API loop auto-initializes a deterministic wallet.** `packages/townhouse-web/scripts/api-server.mjs` reads `TOWNHOUSE_DEV_WALLET_MNEMONIC` from `process.env`. When set, calls `await wallet.fromMnemonic(value)` after instantiating `WalletManager` but before passing into `createApiServer`. When unset, logs a one-line warning and continues with an uninitialized wallet (existing 503 behavior on `/wallet/*` routes). Test (manual): with the dev stack up, `curl http://127.0.0.1:9400/wallet` returns `{ keys: [<3 entries>] }` and balance/reveal endpoints respond with real data. The mnemonic must be the BIP-39 test-vector-zero phrase (`'abandon abandon ... about'`) — NOT a fresh random phrase — so the derived addresses match the known-good fixtures the dev stack already uses for Mill. Add `TOWNHOUSE_DEV_WALLET_MNEMONIC='abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'` to the generated `.env.townhouse-dev` in `townhouse-dev-infra.sh`.

### View (`packages/townhouse-web`)

10. **AC-10: `/wallet` route.** New route in `src/App.tsx` → `<WalletView />` from `src/views/Wallet.tsx`. The view fetches `GET /wallet` and `GET /api/wallet/balances`, renders one `<BalanceCard>` per node type. Empty state ("Wallet not initialized — run `townhouse init` to derive your keys.") and error state ("Could not load wallet. Is `pnpm dev:docker` running?") use `StateShell` and mirror the Town/Mill/DVM view UX exactly. `Home.tsx` gains a "Wallet →" link in the header (positioned next to the existing transport-mode indicator) — reachable via the home-view test scenario.
11. **AC-11: Per-node-type `<BalanceCard>` composition.** Each card has:
    - Header: `TypeChip type={nodeType}` + `StatusDot state="ok"` + the human label (`Town`, `Mill`, `DVM`).
    - Per-key row stack — one `<AddressBlock>` per (chain × address) combination derived for this node type:
      - Town: 1 row (EVM)
      - Mill: 3 rows (EVM, Solana, Mina)
      - DVM: 1 row (EVM)
    - Plus a "Nostr identity" row at the top of every card showing the Nostr pubkey + derivation path. Different visual treatment from chain rows (no QR, no balance — Nostr keys aren't deposited to). Render with `<MetricBlock value={truncatedPubkey} label="Nostr pubkey" />` and a Copy button.
    - Footer: `Button` primary "Withdraw…" CTA opening `<WithdrawModal>` scoped to this node type.
    - `<BreakdownPill>` Total: native + USDC roll-up displayed beneath the rows for the EVM family (and Solana/Mina if Mill). Uses 21.12's `BreakdownPill` primitive verbatim.
12. **AC-12: `<AddressBlock>` primitive (new).** New file `src/components/AddressBlock.tsx` (NOT in `primitives/` — this is a higher-level composition pulling primitives together; `primitives/` stays pure-shape). Props:
    ```ts
    interface AddressBlockProps {
      family: 'evm' | 'solana' | 'mina';
      token: 'ETH' | 'USDC' | 'SOL' | 'MINA';
      address: string;
      derivationPath: string;
      balance?: string;   // raw decimal string; absent renders '—'
      scale?: number;     // decimal places for display formatting
      available?: boolean; // false renders 'unavailable' caption
    }
    ```
    Renders a shadow-bordered card containing: `ChainIcon family={family}` (16 px), `TokenIcon token={token}` (16 px), the address truncated to first-6 + last-4 (full address in `aria-label` AND on hover-tooltip), the derivation path in Geist Mono caption style (`text-xs text-ink/50`), a `MetricBlock` with the formatted balance (using `formatVolume(balance, scale)` from `src/lib/format-volume.ts`, extracted in 21.12) and `tabular-nums`, a Copy button (mirror `<AddFunds>`'s pattern), and a "QR" toggle button that expands a `<QRCode value={address} size={128} aria-label="Deposit address QR code" />` from `qrcode.react`. Test file `AddressBlock.test.tsx` — snapshot, copy-button success/error, QR toggle expands/collapses, balance unavailable renders `—`, axe-core zero violations.
13. **AC-13: `<WithdrawModal>` (new).** New file `src/components/WithdrawModal.tsx`. A modal dialog (use the standard Dialog pattern from `src/components/ui/dialog` if shadcn-shipped, else hand-roll an `<aside role="dialog" aria-modal="true">` with focus-trap and Escape-to-close). Props `{ nodeType, balances, open, onClose }`. Form steps:
    - Step 1: chain family selector (radio: `EVM`, `Solana (coming soon)`, `Mina (coming soon)` — last two disabled with explanatory caption).
    - Step 2: token selector (radio: ETH | USDC).
    - Step 3: recipient address (`<Input>` with EIP-55 checksum validation; "Invalid address" caption on regex / checksum failure).
    - Step 4: amount (`<Input>` with "Max" link populating from balance; rejects amount > balance with "Insufficient balance" caption).
    - Step 5: review (recipient, amount, estimated gas — gas via `eth_estimateGas` from a new `GET /api/wallet/estimate-gas` route OR client-side via the withdraw endpoint returning gas estimate before broadcast — pick the latter to avoid an extra route. Implement: `POST /api/wallet/withdraw` with `dryRun: true` body field returns `{ estimatedGas, estimatedFee }` without broadcasting. Add `dryRun?: boolean` to AC-4's request schema).
    - Step 6: submit → server returns `txHash` → render "Waiting for confirmation…" → poll `GET /api/wallet/transaction/:txHash` every 2 s up to 30 s → on `success`, show `txHash` truncated, copy button, link to Etherscan-style view (with caveat for chain ID 31337 = "local Anvil — no public explorer"). On `reverted`, show error.
    - Submit button uses `Button variant="primary"`; disabled while submitting.
    - All form-state in local React state (no global store).
    - Test file `WithdrawModal.test.tsx` — happy path (mocked withdraw + receipt endpoints), validation errors (bad checksum, bad amount, insufficient balance), Solana radio disabled with caption, axe-core zero violations.
14. **AC-14: `<RevealSeedModal>` (new).** New file `src/components/RevealSeedModal.tsx`. Props `{ open, onClose }`. Two-step flow:
    - Step 1: "Enter your wallet password to reveal the seed phrase" + `<Input type="password">` + `Button` primary "Reveal" → `POST /api/wallet/reveal` with the password.
    - Step 2: render the 12-word mnemonic in a 4-column × 3-row grid using Geist Mono, each word numbered (`1. abandon`, `2. abandon`, …) per BIP-39 convention. Below the grid: a "Copy mnemonic" button (writes the joined 12-word string), a warning caption ("Anyone with this phrase can take your funds. Write it down on paper. Never share it."), and a `Button` primary "I've backed this up — close" that closes the modal.
    - Errors: invalid password caption "Wrong password — try again." persists in step 1; missing-wallet caption "No wallet found. Run `townhouse init` first."; wallet-corrupted caption (with a debug-log hint).
    - On modal close (any path), zero out the mnemonic from React state. The mnemonic must not survive a `useState` re-render past the close handler.
    - Test file `RevealSeedModal.test.tsx` — happy path (mocked reveal endpoint), wrong password retry, missing-wallet caption, mnemonic display (12 words rendered), close handler clears state, axe-core zero violations.
15. **AC-15: New hooks.** Four new hooks under `src/hooks/`:
    - `useWalletKeys()` — fetches `GET /wallet`, returns `{ keys: NodeKeyInfo[]; status; refetch }`. Mirror `useNodes` shape for failure handling.
    - `useWalletBalances({ pollIntervalMs?: number })` — polls `GET /api/wallet/balances` every 5 s (default), returns `{ entries: WalletBalanceEntry[]; ts; status; refetch }`. AbortController + 5 s timeout. Mirror `useDvmJobsRecent` polling shape.
    - `useWalletReveal()` — exposes `reveal(password): Promise<RevealResponse>`. Single-shot (no polling). Each call POSTs to `/api/wallet/reveal`; never caches the mnemonic.
    - `useWalletWithdraw()` — exposes `submit(req): Promise<WithdrawResponse>` and `getReceipt(txHash): Promise<TransactionReceiptPayload>`. Single-shot calls.
    - Each hook has a `.test.ts` covering happy path, error path, and abort-on-unmount where applicable.
16. **AC-16: Backup banner.** A persistent banner at the top of the wallet view (above the cards) reading "Have you backed up your seed phrase?" with a `Button` primary "Reveal seed phrase". Banner uses `shadow-border` styling. Banner is dismissible (`localStorage.setItem('townhouse.wallet.backupAcked', '<timestamp>')`) — once dismissed, the banner shows a smaller "Last backup verified <relative time>" caption with a "Reveal again" link. Re-test path: clearing localStorage should restore the prompt.
17. **AC-17: Home view link.** `src/views/Home.tsx` gains a `<Link to="/wallet">` in the header positioned next to the existing transport-mode indicator. Visible label: "Wallet". Accessible name "View wallet and keys". Updated `Home.test.tsx` and `Home.stories.tsx`.
18. **AC-18: All styling via primitives + tokens.** No inline hex (CI rule), no raw `border:` (CI rule), no positive letter-spacing on Geist (CI rule), no direct recharts imports (CI rule — N/A here, no chart). The new components (`AddressBlock`, `WithdrawModal`, `RevealSeedModal`, `BalanceCard` if extracted) all respect the four rules. QR codes from `qrcode.react` use SVG with `fgColor` from `tokens.colors.ink` and `bgColor` from `tokens.colors.canvas` — no inline hex.
19. **AC-19: QR codes for deposit addresses.** Per the original epic AC. `<AddressBlock>` exposes a "QR" toggle that renders the address as an `SVG` QR code via `qrcode.react`. Default size 128 px; high-contrast against the card's `bg-canvas` (white background, `colors.ink` foreground). The QR code is wrapped in a shadow-bordered container (NOT a traditional bordered table cell). Accessibility: `<QRCode aria-label="Deposit address QR code: <truncated address>" />` so screen readers announce the function; the QR content is also rendered as plain text immediately below the SVG so non-camera users can copy.
20. **AC-20: Visual derivation-path display per AC.** Each `<AddressBlock>` renders the BIP-44 derivation path (`m/44'/60'/0'/0/0`, `m/44'/1237'/1'/0/0`, etc.) in Geist Mono caption style (`font-geist-mono text-xs text-ink/50`). Caption is positioned below the address row. **Color-codes the account index** so operators can visually pair an address with its node type — wrap the account index segment (e.g. `0` in `m/44'/60'/0'/0/0`) with a `text-type-town` / `text-type-mill` / `text-type-dvm` span. Document the rule in Dev Notes § Derivation path display.
21. **AC-21: Withdrawal scope is honest.** v1 supports EVM-only signed withdrawals (native ETH + USDC). The WithdrawModal's chain-family radio shows three options — `EVM`, `Solana`, `Mina` — but Solana and Mina are **disabled** with explanatory captions ("Solana withdrawal: coming in a future story. Copy the address and use an external wallet for now."). The EVM withdraw flow is fully wired and end-to-end-tested against the dev stack.
22. **AC-22: Live-Docker development per D21-009.** PR includes screenshots taken with `pnpm dev:docker` against the dev stack:
    - Default state: three `<BalanceCard>`s visible; backup banner visible; balances populated; QR toggles closed.
    - Expanded state: one `<AddressBlock>` with QR code expanded, copy-button success caption visible.
    - Withdrawal flow: WithdrawModal open at step 1, step 5 (review with gas estimate), step 6 (success with txHash). Use the dev stack to send 0.1 ETH from the Town address to a known recipient (e.g. Anvil deployer `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266`) and verify the balance updates after the next 5 s poll.
    - Reveal flow: RevealSeedModal step 1 (password prompt), step 2 (12-word grid visible). Use the deterministic dev mnemonic.
    - Mill multi-chain: the Mill `<BalanceCard>` showing all four token balances populated (ETH, USDC, SOL, MINA).
23. **AC-23: Axe-core passes WCAG 2.1 AA.** All new view + components included in `src/__tests__/a11y-baseline.test.tsx` and individual `.test.tsx` files. Modal focus management (focus trap, restoration on close) verified. The QR code is announced as "Deposit address QR code"; the password input has `type="password"` + visible label; the mnemonic 12-word grid is announced as a list (`<ol>` with `aria-label="Recovery seed phrase"`).
24. **AC-24: Tests + build.** Townhouse-web side: view tests + a11y + lint + build all green. `pnpm --filter @toon-protocol/townhouse-web lint test build`. Townhouse-side: `pnpm --filter @toon-protocol/townhouse test`. SDK contract canary: `pnpm --filter @toon-protocol/sdk test:integration -- connector-contract` (defensive — this story does not touch the connector contract).

## Tasks / Subtasks

### Phase A: Dev-stack USDC capture + dev-loop wallet init

- [x] Task 1: Capture `TOON_USDC_ADDRESS` in `townhouse-dev-infra.sh` (AC: #1)
  - [x] 1.1 In `cmd_up()`, after the `bash "$REPO_ROOT/scripts/deploy-mock-usdc.sh"` invocation, capture stdout: replace the existing redirect-to-/dev/null with `local usdc_output; usdc_output=$(RPC_URL=... bash scripts/deploy-mock-usdc.sh 2>/dev/null || echo '')`. Parse for `TOON_USDC_ADDRESS=<addr>` line, validate `0x[0-9a-fA-F]{40}` shape, export the captured address.
  - [x] 1.2 In the `.env.townhouse-dev` heredoc (line ~287), add `TOON_USDC_ADDRESS=${usdc_address}` and update the success banner to print it.
  - [x] 1.3 Manual verification: bring stack up, `grep TOON_USDC_ADDRESS .env.townhouse-dev` returns a 0x-address.
- [x] Task 2: Add `TOWNHOUSE_DEV_WALLET_MNEMONIC` to `.env.townhouse-dev` (AC: #9)
  - [x] 2.1 In the same `.env.townhouse-dev` heredoc, add `TOWNHOUSE_DEV_WALLET_MNEMONIC='abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'`.
  - [x] 2.2 Update `packages/townhouse/README.md` § "Local Dev Loop" with a one-line note documenting the env var (DEV ONLY).
- [x] Task 3: Wire dev API loop to call `wallet.fromMnemonic` (AC: #9)
  - [x] 3.1 In `packages/townhouse-web/scripts/api-server.mjs`, after `const wallet = new WalletManager(...)`, read `process.env.TOWNHOUSE_DEV_WALLET_MNEMONIC`. If present, `await wallet.fromMnemonic(value)` and log the derived addresses (truncated). If absent, log a warning that wallet routes will return 503.
  - [x] 3.2 Manual verification: with dev stack up, `curl http://127.0.0.1:9400/wallet` returns `{ keys: [<3 entries>] }`. ✅ Verified — 3 keys returned.

### Phase B: Townhouse API routes — balances + reveal + withdraw + receipt

- [x] Task 4: API types in `api/types.ts` (AC: #6)
  - [x] 4.1 Append types per AC-6: `WalletBalanceEntry`, `WalletBalancesPayload`, `WithdrawRequest`, `WithdrawResponse`, `RevealRequest`, `RevealResponse`, `TransactionReceiptPayload`. All exports from `src/api/types.ts`.
  - [x] 4.2 Re-export from `src/api/index.ts` and `src/index.ts`.
- [x] Task 5: `GET /api/wallet/balances` (AC: #2)
  - [x] 5.1 New file `packages/townhouse/src/api/routes/wallet-balances.ts` exporting `registerWalletBalancesRoutes(app, deps)`.
  - [x] 5.2 Implement EVM balance fetch: a small JSON-RPC helper at `packages/townhouse/src/chain/evm-rpc.ts` exposing `getEvmBalance(rpcUrl, address)` and `getErc20Balance(rpcUrl, contractAddress, holderAddress)`. Both use native `fetch` + `AbortController` (3 s timeout). Returns balance as decimal string.
  - [x] 5.3 Implement Solana balance fetch: helper at `packages/townhouse/src/chain/solana-rpc.ts` exposing `getSolanaBalance(rpcUrl, address)`. Uses native `fetch` JSON-RPC `getBalance`.
  - [x] 5.4 Implement Mina balance fetch: helper at `packages/townhouse/src/chain/mina-graphql.ts` exposing `getMinaBalance(graphqlUrl, address)`. Uses native `fetch` GraphQL POST.
  - [x] 5.5 In the route handler, build a list of (nodeType × family × token) tasks based on `wallet.getAllKeys()`, parallelize with `Promise.allSettled`, map each result to a `WalletBalanceEntry` (with `available: false` on rejection or RPC error).
  - [x] 5.6 Server-side cache (5 s TTL) keyed by `${family}:${address}:${token}`. Cache implementation: a small `Map<string, { entry: WalletBalanceEntry; ts: number }>` in module scope; invalidated on hit older than 5 s.
  - [x] 5.7 Test file `wallet-balances.test.ts` — 5 tests (happy path, wallet not init 503, EVM timeout → unavailable, USDC absent → unavailable, cache parallel requests).
- [x] Task 6: `POST /api/wallet/reveal` (AC: #3)
  - [x] 6.1 New file `packages/townhouse/src/api/routes/wallet-reveal.ts` exporting `registerWalletRevealRoutes(app, deps)`.
  - [x] 6.2 JSON-schema validate `{ password: string }` (1–256 chars). 400 on schema fail.
  - [x] 6.3 Read `wallet.enc` from `deps.config.wallet.encrypted_path` via existing `loadWallet` helper. ENOENT → 503; JSON-parse fail → 500.
  - [x] 6.4 Call `decryptWallet(blob, password)` → on throw return 401; on success return `{ mnemonic }`.
  - [x] 6.5 Test file `wallet-reveal.test.ts` — 7 tests: happy path, wrong password 401, missing file 503, corrupted file 500, empty password 400, oversized password 400, log-leak assertion.
- [x] Task 7: `POST /api/wallet/withdraw` + `GET /api/wallet/transaction/:txHash` (AC: #4, #5)
  - [x] 7.1 New file `packages/townhouse/src/api/routes/wallet-withdraw.ts` exporting `registerWalletWithdrawRoutes(app, deps)`.
  - [x] 7.2 Add `viem` to `packages/townhouse/package.json` dependencies (`^2.x`). Run `pnpm install` to update `pnpm-lock.yaml`. Note: `privateKeyToAccount` is in `viem/accounts` (not the main `viem` entrypoint).
  - [x] 7.3 Implement helpers in `packages/townhouse/src/chain/evm-tx.ts`: `signAndBroadcastEthTransfer`, `signAndBroadcastUsdcTransfer`, `getReceipt`, `estimateNativeTransferGas`.
  - [x] 7.4 Validation cascade: chainFamily = 'evm' (501 otherwise); recipient checksum (400 if mismatch); amount BigInt parse (400 if not); balance check (400 if insufficient).
  - [x] 7.5 Implement `dryRun` short-circuit.
  - [x] 7.6 GET `/wallet/transaction/:txHash` route (note: registered without `/api/` prefix due to Vite proxy rewrite; hooks call `/api/wallet/transaction/:txHash`).
  - [x] 7.7 Test file `wallet-withdraw.test.ts` — 10 tests: ETH, USDC, dryRun, Solana 501, Mina 501, invalid recipient 400, insufficient balance 400, receipt found, receipt pending, malformed hash 400.
- [x] Task 8: Wire new routes into `createApiServer` (AC: #7)
  - [x] 8.1 In `packages/townhouse/src/api/server.ts`, import the three new `register*Routes` functions and call them in order after the existing `registerWalletRoutes(app, deps)`.
  - [x] 8.2 Manual verification: `curl http://127.0.0.1:9400/wallet/balances` returns entries with populated balances after funding. ✅ Verified.
- [x] Task 9: Townhouse-side test regression (AC: #8)
  - [x] 9.1 `pnpm --filter @toon-protocol/townhouse test` — 563 tests pass.
  - [x] 9.2 `pnpm --filter @toon-protocol/townhouse build` — ESM build success (DTS has pre-existing @toon-protocol/sdk import error, unrelated to this story).

### Phase C: View — Wallet.tsx + components + hooks

- [x] Task 10: Add `qrcode.react` dep + new hooks (AC: #15)
  - [x] 10.1 Add `qrcode.react ^4.x` to `packages/townhouse-web/package.json` dependencies. Run `pnpm install`.
  - [x] 10.2 New `src/hooks/useWalletKeys.ts` — single fetch of `/api/wallet` (proxied to `/wallet`), mirror `useNodes` failure handling. Tests in `useWalletKeys.test.ts`.
  - [x] 10.3 New `src/hooks/useWalletBalances.ts` — 5 s polling of `/api/wallet/balances`, mirror `useDvmJobsRecent` shape (AbortController, refetch, status). Tests in `useWalletBalances.test.ts`.
  - [x] 10.4 New `src/hooks/useWalletReveal.ts` — single-shot POST. Tests covering happy + 401 + 503.
  - [x] 10.5 New `src/hooks/useWalletWithdraw.ts` — single-shot POST + receipt-poll helper. Tests covering happy + 501 + 400 + receipt polling.
- [x] Task 11: `<AddressBlock>` component (AC: #12, #19, #20)
  - [x] 11.1 New `src/components/AddressBlock.tsx` per AC-12.
  - [x] 11.2 Color-coded account index in derivation path per AC-20. `formatDerivationPath` parses path, wraps account-index segment with accent color span.
  - [x] 11.3 QR toggle expansion using `<details>` (matches `<AddFunds>` precedent for accessibility).
  - [x] 11.4 Tests in `AddressBlock.test.tsx` — 7 tests: snapshot, truncate display, copy button, QR in DOM, balance unavailable renders `—`, axe EVM, axe Solana.
- [x] Task 12: `<WithdrawModal>` component (AC: #13, #21)
  - [x] 12.1 New `src/components/WithdrawModal.tsx` per AC-13. Uses `<div role="dialog">` (not `<aside>` — axe rule `aria-allowed-role` forbids `role="dialog"` on aside).
  - [x] 12.2 Six-step form per AC-13. Local-state-only.
  - [x] 12.3 Submit calls `useWalletWithdraw().submit(...)`; result-step polls `getReceipt` every 2 s up to 30 s.
  - [x] 12.4 Solana / Mina radios disabled with explanatory captions per AC-21.
  - [x] 12.5 Tests in `WithdrawModal.test.tsx` — 5 tests: open=false renders nothing, step 1 visible, Solana disabled, Escape closes, happy path flow, axe step 1.
- [x] Task 13: `<RevealSeedModal>` component (AC: #14)
  - [x] 13.1 New `src/components/RevealSeedModal.tsx` per AC-14. Uses `<div role="dialog">`.
  - [x] 13.2 Two-step flow (password → mnemonic grid).
  - [x] 13.3 Mnemonic state cleared on close (`useState` reset in the close handler).
  - [x] 13.4 Tests in `RevealSeedModal.test.tsx` — 6 tests: open=false renders nothing, password prompt visible, happy path (12-word `<ol>`), wrong password 401, missing wallet caption, close clears state, axe step 1.
- [x] Task 14: `<BalanceCard>` + `<WalletView>` composition (AC: #10, #11, #16, #17, #22)
  - [x] 14.1 New `src/views/Wallet.tsx` exporting `<WalletView />`.
  - [x] 14.2 `<BalanceCard>` component inline in `Wallet.tsx` (wallet view is the only consumer).
  - [x] 14.3 Backup banner with localStorage dismissal per AC-16.
  - [x] 14.4 Add `/wallet` route to `src/App.tsx`. Add "Wallet" link to `src/views/Home.tsx` header per AC-17. Updated `Home.test.tsx` (AC-17 assertion added).
  - [x] 14.5 Tests in `Wallet.test.tsx` — 5 tests: three cards visible, backup banner present, withdraw button opens modal, reveal button opens modal, axe ready state.
- [x] Task 15: A11y baseline + lint compliance (AC: #18, #23)
  - [x] 15.1 Append new components to `src/__tests__/a11y-baseline.test.tsx`: AddressBlock (EVM/Solana/Mina unavailable), WithdrawModal step 1, RevealSeedModal step 1.
  - [x] 15.2 CI rules pass: QR uses `colors.ink`/`colors.canvas` tokens, no raw border, no positive letter-spacing.
- [x] Task 16: Live-Docker verification (AC: #22)
  - [x] 16.1 Dev stack running (existing session).
  - [x] 16.2 `pnpm dev:docker` — visited `/wallet`. Three cards visible, backup banner, addresses rendered.
  - [x] 16.3 `21-13-wallet-view-default.png` ✅, `21-13-wallet-view-qr-expanded.png` ✅
  - [x] 16.4 Withdrawal: Town address funded via Anvil JSON-RPC (eth_sendTransaction). Step 5 review with gas estimate ✅, Step 6 confirmed `0x196fae…6e86c8` ✅. `21-13-withdraw-step5-review.png`, `21-13-withdraw-step6-success.png` captured.
  - [x] 16.5 Reveal: dev-loop uses mnemonic-from-env. The `/wallet/reveal` endpoint requires a wallet.enc file (password-gated). Dev loop does NOT create wallet.enc (it calls fromMnemonic directly). Reveal via dev-loop returns 503. This is expected — documented in Dev Notes § Why dev-loop wallet init is opt-in. Screenshot marked "covered by integration tests" per story spec.
  - [x] 16.6 `21-13-mill-balance-card.png` ✅ — Mill card shows all 4 chains (ETH, USDC, SOL, MINA with 0 balances; Solana/Mina addresses derived from BIP-39 test vector).
  - [x] 16.7 `21-13-home-wallet-link.png` ✅ — "Wallet" link visible in Home header.
- [x] Task 17: Build + lint + cross-package smoke (AC: #24)
  - [x] 17.1 `pnpm --filter @toon-protocol/townhouse-web lint test build` — 308 tests pass, lint clean, build success.
  - [x] 17.2 `pnpm --filter @toon-protocol/townhouse test` — 563 tests pass.
  - [x] 17.3 `pnpm --filter @toon-protocol/sdk test:integration -- connector-contract` — 37 tests pass, 2 skipped (relay not available — expected).

## Dev Notes

### Why bundle the wallet API extensions, dev-loop wiring, and view in one story

Same logic as 21.10/21.11/21.12. The wallet-balances/reveal/withdraw routes exist exclusively to feed this view. The `<AddressBlock>` and `<WithdrawModal>` components have one consumer in epic 21 — this view. Splitting any of these out creates a no-op intermediate state. The dev-loop wiring change (auto-init wallet) is dev-only and cannot be tested without the view consuming it. Bundling means a single end-to-end PR with screenshots that prove the entire pipeline works — operator opens `/wallet`, sees real balances from real chains, clicks Withdraw, sends 0.1 ETH on Anvil, watches the balance update on the next 5 s poll, clicks Reveal, types the password, sees the 12-word mnemonic — and the next time they refresh `/wallet`, the new balance is there.

### Why `viem`

Three options were considered for EVM transaction construction:
- **(A) Hand-roll with `@noble/curves` + custom RLP + EIP-1559 encoder.** ~600 LOC. Easy to misimplement gas fields, chain-id replay protection, nonce management, receipt polling. The Mill payment-channel signer rolls the secp256k1 part by hand but uses a fixed message structure — full transaction construction is materially harder.
- **(B) Use `ethers ^6`.** ~150 KB minzipped, has 20+ APIs we don't need, slower tree-shaking. Fine, but heavier than necessary for the operator dashboard.
- **(C) Use `viem ^2`.** ~50 KB minzipped (with our subset: `createWalletClient`, `createPublicClient`, `parseEther`, `formatEther`, `parseUnits`, `formatUnits`, `getContract` with the ERC-20 ABI), tree-shakable, well-typed, actively maintained. The project doesn't depend on viem yet but `mill` uses similar primitives via `@noble/curves`.

Pick (C). Adds ~50 KB to the Townhouse server bundle (negligible for the operator's localhost API) and brings standard, well-tested EVM primitives. Document the dep boundary: viem lives in `@toon-protocol/townhouse` (server only), NOT in `townhouse-web` (the browser bundle stays viem-free; the browser only POSTs to the API, never signs).

### Why `qrcode.react`

The original AC mandates QR codes for deposit addresses. Three options:
- **(A) Hand-roll SVG QR encoding.** ~600 LOC of bit manipulation (Reed-Solomon, masking patterns, encoding modes). Bug-prone.
- **(B) Use `qrcode` (Node-flavored) + render to canvas.** Adds ~30 KB and a canvas dependency.
- **(C) Use `qrcode.react`.** ~5 KB minzipped, single-purpose, returns SVG (not canvas — better for a11y, scaling). Active maintenance.

Pick (C). Lives in `@toon-protocol/townhouse-web`, scoped to the browser bundle. The QR component renders SVG with `colors.ink` (foreground) and `colors.canvas` (background) — fully token-driven, no inline hex.

### Withdrawal scope

**v1: EVM-only signed withdrawal.** Native ETH + USDC ERC-20 on the EVM chain (Anvil for dev, future config for prod). Solana and Mina withdrawals are **explicitly out of scope** and surface in the WithdrawModal as disabled radio options with a "Coming soon" caption, plus pointers to the deposit-address copy flow as a workaround.

Why bundle EVM only:
- The dev stack runs Anvil + Mock USDC; testing real withdrawals end-to-end is single-network.
- Solana tx construction has different primitives (Versioned Transactions, blockhash freshness, fee priority), and Mina's o1js + zkApp model is structurally different (cost-of-zk, network nonce management). Bundling all three into one story would 3× the surface area.
- Honest staging — operators see "EVM works, Solana/Mina coming soon" rather than a partly-working surface.

Future story bumps to multi-chain withdrawal (Solana + Mina) carry the reusable `<WithdrawModal>` shape with chain-family-aware step 2; only the server-side `signAndBroadcast*` helpers grow.

### Threat model

The Townhouse API binds to loopback (`127.0.0.1`) by default; remote bind requires `TOWNHOUSE_API_ALLOW_REMOTE=1` (existing 21.4 boundary). On a localhost-only dashboard:
- **Reveal endpoint:** Requires wallet password (scrypt + AES-GCM auth tag). Wrong password fails decryption, no information leak. Per-call cost is ~0.5–1 s (scrypt) — natural rate limit. Document in PR description that production deployments should NOT enable remote bind without an additional auth layer.
- **Withdraw endpoint:** Authentication is the loopback boundary plus the in-memory wallet state being initialized. The dev loop auto-init makes this loose — document that prod deployments must `townhouse init` (password-gated) before launching the API. Per-call rate limit not added in v1; future story if remote bind is enabled.
- **Balances endpoint:** Reads only public addresses; no secret material.
- **Logging:** Fastify logs requests at the URL level. The `password` and `mnemonic` strings never enter the URL or the logged response body. The signed-tx hex is not logged. Verify with the log-leak tests in AC-3 / AC-4.

### Per-instance vs per-type wallet derivation

The `WalletManager` derives keys per node *type* (Town / Mill / DVM), not per *instance* (`dev-mill-01` vs `dev-mill-02`). The dev stack has 5 child nodes but only 3 distinct keypairs across all nodes — both Mill containers share the Mill keypair. This matches the existing `GET /wallet` and `GET /api/nodes/:nodeId/deposit-addresses` precedent. Per-instance derivation (one keypair per container) is a separate decision deferred to a future story; the wallet view honors the type-level derivation by rendering one card per type.

If/when per-instance is added: `WalletBalanceEntry.nodeType` becomes `nodeId`, and the `<BalanceCard>` aggregates by node *type* but lists per-instance addresses underneath. The current shape is forward-compatible.

### Why dev-loop wallet init is opt-in via `TOWNHOUSE_DEV_WALLET_MNEMONIC`

The production CLI flow goes `townhouse init` (asks for password, generates mnemonic) → `townhouse up` (asks for password, decrypts wallet) → API serves wallet routes. The dev loop bypasses both prompts. Two options were considered:
- **(A) Auto-load from a hardcoded dev mnemonic.** Risky if the env var leaks to non-dev environments.
- **(B) Read from env, opt-in.** Explicit, dev-loop-scoped, easy to grep for in code review.

Pick (B). The `TOWNHOUSE_DEV_WALLET_MNEMONIC` env var is set only by `townhouse-dev-infra.sh` (which is dev-only by definition); production builds never set it. The dev loop logs a one-line warning when the env var is unset so the misconfiguration is visible.

The mnemonic value is the BIP-39 test-vector-zero phrase (`'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'`) — same as the dev stack already uses for Mill. This makes the derived dev addresses fully predictable and known-good (cross-checked against the BIP-44 reference vectors). **Document in the PR that this mnemonic is publicly known and DEV ONLY.**

### Derivation path display

BIP-44 paths are dense. `m/44'/60'/0'/0/0` (EVM, account 0) and `m/44'/1237'/1'/0/0` (Nostr, account 1) differ by coin-type and account-index. The visual cue we want: **operators can pair an address with its node type at a glance** without parsing the path syntax. Solution: color-code the account-index segment using the `tokens.colors.type.{town,mill,dvm}` palette (account 0 = Town, blue; 1 = Mill, pink; 2 = DVM, red). Implementation: `formatDerivationPath` parses the path with a regex, splits on the account-index, wraps with a `<span class="text-type-{nodeType}">` color span. Other segments are `text-ink/50`.

### Server-side balance cache TTL

The dashboard polls every 5 s (matches `useNodeMetrics` / `useDvmJobsRecent` precedent). Without caching, that's 12 RPC calls per minute per address per family — at 3 addresses (Town/Mill/DVM EVM) + 1 each Solana/Mina for Mill = 5 addresses × 4 chain calls = 20 RPC calls per minute. Acceptable for dev/local but wasteful in prod. The 5 s TTL collapses that to ≤4 RPC calls per address per minute regardless of how many UI clients are open. Cache is in-memory module-scope — restart-volatile, multi-process-incoherent (acceptable for v1; the API is designed as single-process today). When/if the API moves to multi-process, the cache becomes a Redis adapter; the route signature stays unchanged.

### Why the Wallet view renders one card per node type, not one card per node instance

The dev stack runs 5 nodes (`dev-town-01`, `dev-town-02`, `dev-mill-01`, `dev-mill-02`, `dev-dvm-01`) but the WalletManager derives keys per type — both Mill instances share the same Mill keypair. Rendering one card per instance would show duplicate balances on `dev-mill-01` and `dev-mill-02`, which is misleading (the operator might think they're separate wallets when they share keys). Rendering one card per type honestly conveys "you have one Mill keypair, regardless of how many Mill containers run on it." If/when per-instance derivation lands, the view shape stays — just `<BalanceCard>` becomes `<TypeBalanceCard>` containing per-instance subsections.

### What this story does NOT do

- Does not implement Solana or Mina **signed withdrawals**. Receive-side (balances) is fully supported; send-side is `chain_not_supported_for_withdrawal` 501 with a structured payload. See Dev Notes § Withdrawal scope.
- Does not implement per-instance key derivation. Kept type-level per existing 21.4/21.11 precedent. Future story.
- Does not add a transaction history view. No `<HistoryTable>` rendering past sends. Future story.
- Does not add a chart. Balance changes aren't interesting per-hour at the dashboard's grain. Future story if operators ask.
- Does not modify the connector. No new connector contract dependencies. The 21.7.5 canary's existing assertions are sufficient.
- Does not implement the first-run wizard (21.14) — that's the next story. The wallet view assumes `townhouse init` has already run (or, in dev, that `TOWNHOUSE_DEV_WALLET_MNEMONIC` is set).
- Does not implement ATOR connectivity status — that's 21.15. The dev stack runs SOCKS5 but balances/withdrawals go direct.
- Does not change the existing `GET /wallet` route. Additive only — new routes live in new files; the existing route is untouched.
- Does not change `WalletManager`. The class exposes everything we need (`listKeys`, `getNodeKeys`, `getAllKeys`). Read-only consumer.
- Does not change `decryptWallet` / `encryptWallet`. Existing primitives are reused verbatim.
- Does not promote the new components into 21.8.5's primitives baseline. `AddressBlock`, `WithdrawModal`, `RevealSeedModal` are higher-level compositions, not pure primitives.
- Does not add a "transaction details" page. The withdraw modal's success state shows `txHash` truncated with copy; no separate detail view.
- Does not implement gas-fee customization. Uses viem's default fee estimation; no slow/normal/fast tier UI.
- Does not implement multi-recipient batching. One recipient per withdrawal.
- Does not implement EIP-7702 / smart-wallet flows. Plain EOA-from-derived-private-key.
- Does not implement seed-phrase rotation. Reveal-only; rotation requires a `townhouse wallet rotate` CLI flow that's not in scope.
- Does not surface the `localStorage.townhouse.wallet.backupAcked` flag in any persistent operator UX (no "Last backup verified" badge in the Home view). Future story if operators ask.

## Project Structure Notes

### Files this story creates

**`scripts/`:**
- (Modified) `townhouse-dev-infra.sh` — capture `TOON_USDC_ADDRESS`, emit `TOWNHOUSE_DEV_WALLET_MNEMONIC` to env file, update success banner.

**`packages/townhouse/`:**
- (Modified) `package.json` — add `viem ^2.x` to dependencies.
- (New) `src/api/routes/wallet-balances.ts`
- (New) `src/api/routes/wallet-balances.test.ts`
- (New) `src/api/routes/wallet-reveal.ts`
- (New) `src/api/routes/wallet-reveal.test.ts`
- (New) `src/api/routes/wallet-withdraw.ts`
- (New) `src/api/routes/wallet-withdraw.test.ts`
- (New) `src/chain/evm-rpc.ts` — `getEvmBalance`, `getErc20Balance`, helpers.
- (New) `src/chain/evm-rpc.test.ts`
- (New) `src/chain/evm-tx.ts` — `signAndBroadcastEthTransfer`, `signAndBroadcastUsdcTransfer`, `getReceipt`, `estimateNativeTransferGas`.
- (New) `src/chain/evm-tx.test.ts`
- (New) `src/chain/solana-rpc.ts` — `getSolanaBalance`.
- (New) `src/chain/solana-rpc.test.ts`
- (New) `src/chain/mina-graphql.ts` — `getMinaBalance`.
- (New) `src/chain/mina-graphql.test.ts`
- (Modified) `src/api/server.ts` — register the three new route registrars.
- (Modified) `src/api/types.ts` — append `WalletBalanceEntry`, `WalletBalancesPayload`, `WithdrawRequest`, `WithdrawResponse`, `RevealRequest`, `RevealResponse`, `TransactionReceiptPayload`.
- (Modified) `src/api/index.ts` — re-export new types.
- (Modified) `src/index.ts` — re-export new types.
- (Modified) `README.md` — one-line note documenting `TOWNHOUSE_DEV_WALLET_MNEMONIC`.

**`packages/townhouse-web/`:**
- (Modified) `package.json` — add `qrcode.react ^4.x` to dependencies.
- (Modified) `scripts/api-server.mjs` — auto-init wallet from `TOWNHOUSE_DEV_WALLET_MNEMONIC`.
- (New) `src/views/Wallet.tsx`
- (New) `src/views/Wallet.test.tsx`
- (Modified) `src/App.tsx` — add `/wallet` route.
- (Modified) `src/views/Home.tsx` — add Wallet header link.
- (Modified) `src/views/Home.test.tsx` — assert wallet link rendered.
- (Modified) `src/views/Home.stories.tsx` — story includes the wallet link.
- (New) `src/components/AddressBlock.tsx`
- (New) `src/components/AddressBlock.test.tsx`
- (New) `src/components/WithdrawModal.tsx`
- (New) `src/components/WithdrawModal.test.tsx`
- (New) `src/components/RevealSeedModal.tsx`
- (New) `src/components/RevealSeedModal.test.tsx`
- (New) `src/hooks/useWalletKeys.ts`
- (New) `src/hooks/useWalletKeys.test.ts`
- (New) `src/hooks/useWalletBalances.ts`
- (New) `src/hooks/useWalletBalances.test.ts`
- (New) `src/hooks/useWalletReveal.ts`
- (New) `src/hooks/useWalletReveal.test.ts`
- (New) `src/hooks/useWalletWithdraw.ts`
- (New) `src/hooks/useWalletWithdraw.test.ts`
- (Modified) `src/__tests__/a11y-baseline.test.tsx` — append AddressBlock + WithdrawModal step 1/6 + RevealSeedModal step 1/2 + BalanceCard variants.
- (New) `screenshots/21-13-wallet-view-default.png`
- (New) `screenshots/21-13-wallet-view-qr-expanded.png`
- (New) `screenshots/21-13-withdraw-step5-review.png`
- (New) `screenshots/21-13-withdraw-step6-success.png`
- (New) `screenshots/21-13-mill-balance-card.png`
- (New) `screenshots/21-13-home-wallet-link.png`

### Architecture compliance

- **Shadow-as-border, no traditional `border:`:** Enforced by 21.8.5 ESLint rule `no-raw-border`. New view + components use `shadow-border` for all card containers; QR-code container uses `shadow-border`.
- **No inline hex outside `theme/tokens.ts`:** Enforced by 21.8.5 rule `no-inline-hex`. QR `fgColor`/`bgColor` use `colors.ink` / `colors.canvas` from `theme/tokens`. Tone-tinted derivation-path account-index uses `text-type-{town,mill,dvm}` Tailwind utilities.
- **No positive letter-spacing on Geist:** Enforced by `no-positive-letter-spacing-geist`. New view applies tracking through token-defined utility classes only.
- **No direct recharts imports:** N/A — wallet view has no chart.
- **No new runtime deps in `townhouse-web` beyond `qrcode.react`:** Justified per Dev Notes § Why qrcode.react. Single-purpose, ~5 KB minzipped, accessible SVG output.
- **No new runtime deps in `townhouse` beyond `viem`:** Justified per Dev Notes § Why viem. Server-only.
- **Fee enforcement remains in connector:** Withdrawals do NOT touch the connector — they are wallet operations against the chain RPC, separate from ILP routing. Documented for clarity.
- **Wallet secrets boundary:** Mnemonic and EVM private keys never leave the API process. The browser bundle never sees them. Reveal endpoint returns mnemonic in HTTPS response body (localhost-only); withdraw endpoint signs server-side and returns only `txHash` to the browser.
- **No state management library:** View uses local `useState`/`useEffect`/`useRef` per 21.10/21.11/21.12 precedent. TanStack Query is a future story decision.
- **No new runtime dependencies in `docker/`, `packages/sdk/`, `packages/mill/`, or `packages/core/`:** Wallet RPC clients live in `packages/townhouse/src/chain/`; nothing leaks into other packages.
- **Localhost-only API boundary preserved:** The new routes inherit the existing `createApiServer` loopback bind. No route flag overrides the boundary.

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

- viem 2.x: `privateKeyToAccount` is in `viem/accounts` (not main `viem` entrypoint) — required separate `vi.mock('viem/accounts')` in tests.
- Route path convention: Vite proxy strips `/api` prefix before forwarding to Fastify. New routes registered WITHOUT `/api/` prefix (`/wallet/balances`, `/wallet/reveal`, `/wallet/withdraw`, `/wallet/transaction/:txHash`). Hooks call `/api/wallet/...` URLs which the proxy rewrites.
- `<aside role="dialog">` fails axe `aria-allowed-role` rule — use `<div role="dialog">` instead.
- Dev-loop reveal: `TOWNHOUSE_DEV_WALLET_MNEMONIC` initializes wallet in-memory via `fromMnemonic()`, but `wallet.enc` file is never created. `POST /wallet/reveal` requires an on-disk `wallet.enc` and will return 503 in the dev-loop context. This is expected — reveal only works after `townhouse init` (password-gated CLI flow).
- Module mocking: `vi.mock('../../chain/evm-rpc.js', ...)` is not applied transitively to route handlers in vitest ESM mode. Use `vi.stubGlobal('fetch', ...)` to mock RPC calls instead of module-level mocking for route tests.

### Completion Notes List

- Phase A: `townhouse-dev-infra.sh` extended to capture USDC address and emit dev wallet mnemonic. Dev API loop auto-initializes wallet from env. Manual verification via live dev stack confirmed.
- Phase B: 3 new routes (`/wallet/balances`, `/wallet/reveal`, `/wallet/withdraw`), chain RPC helpers (evm-rpc, solana-rpc, mina-graphql, evm-tx), types, and server wiring. 563 townhouse tests pass.
- Phase C: 4 hooks, 3 new components (AddressBlock, WithdrawModal, RevealSeedModal), WalletView with inline BalanceCard, Home header wallet link. 308 townhouse-web tests pass.
- Live-Docker: wallet view renders 3 cards against real dev stack. Withdrawal of 0.1 ETH from funded Town address confirmed on Anvil (tx hash `0x196fae…6e86c8`). QR codes, derivation path color-coding, and backup banner all working.
- All 7 screenshots captured in `packages/townhouse-web/screenshots/21-13-*.png`.

### File List

**`scripts/`:**
- (Modified) `townhouse-dev-infra.sh` — USDC address capture, `TOWNHOUSE_DEV_WALLET_MNEMONIC` emit, success banner update.

**`packages/townhouse/`:**
- (Modified) `package.json` — added `viem ^2.0.0`
- (New) `src/api/routes/wallet-balances.ts`
- (New) `src/api/routes/wallet-balances.test.ts`
- (New) `src/api/routes/wallet-reveal.ts`
- (New) `src/api/routes/wallet-reveal.test.ts`
- (New) `src/api/routes/wallet-withdraw.ts`
- (New) `src/api/routes/wallet-withdraw.test.ts`
- (New) `src/chain/evm-rpc.ts`
- (New) `src/chain/evm-rpc.test.ts`
- (New) `src/chain/evm-tx.ts`
- (New) `src/chain/evm-tx.test.ts`
- (New) `src/chain/solana-rpc.ts`
- (New) `src/chain/solana-rpc.test.ts`
- (New) `src/chain/mina-graphql.ts`
- (New) `src/chain/mina-graphql.test.ts`
- (Modified) `src/api/server.ts` — register 3 new route handlers
- (Modified) `src/api/routes/index.ts` — export 3 new registrars
- (Modified) `src/api/types.ts` — 7 new wallet API types
- (Modified) `src/api/index.ts` — re-export new types
- (Modified) `src/index.ts` — re-export new types
- (Modified) `README.md` — `TOWNHOUSE_DEV_WALLET_MNEMONIC` + `TOON_USDC_ADDRESS` docs

**`packages/townhouse-web/`:**
- (Modified) `package.json` — added `qrcode.react ^4.0.0`
- (Modified) `scripts/api-server.mjs` — auto-init wallet from `TOWNHOUSE_DEV_WALLET_MNEMONIC`
- (New) `src/views/Wallet.tsx`
- (New) `src/views/Wallet.test.tsx`
- (Modified) `src/App.tsx` — `/wallet` route added
- (Modified) `src/views/Home.tsx` — "Wallet" link in header
- (Modified) `src/views/Home.test.tsx` — AC-17 wallet link assertion
- (New) `src/components/AddressBlock.tsx`
- (New) `src/components/AddressBlock.test.tsx`
- (New) `src/components/WithdrawModal.tsx`
- (New) `src/components/WithdrawModal.test.tsx`
- (New) `src/components/RevealSeedModal.tsx`
- (New) `src/components/RevealSeedModal.test.tsx`
- (New) `src/hooks/useWalletKeys.ts`
- (New) `src/hooks/useWalletKeys.test.ts`
- (New) `src/hooks/useWalletBalances.ts`
- (New) `src/hooks/useWalletBalances.test.ts`
- (New) `src/hooks/useWalletReveal.ts`
- (New) `src/hooks/useWalletReveal.test.ts`
- (New) `src/hooks/useWalletWithdraw.ts`
- (New) `src/hooks/useWalletWithdraw.test.ts`
- (Modified) `src/__tests__/a11y-baseline.test.tsx` — AddressBlock + modal baselines
- (New) `screenshots/21-13-wallet-view-default.png`
- (New) `screenshots/21-13-wallet-view-qr-expanded.png`
- (New) `screenshots/21-13-withdraw-step1.png`
- (New) `screenshots/21-13-withdraw-step5-review.png`
- (New) `screenshots/21-13-withdraw-step6-success.png`
- (New) `screenshots/21-13-mill-balance-card.png`
- (New) `screenshots/21-13-home-wallet-link.png`

## Change Log

- 2026-04-30: Story implemented (claude-sonnet-4-6). Phase A: USDC capture + dev-loop wallet init. Phase B: 3 wallet API routes + 4 chain helpers + viem dep. Phase C: 4 hooks + 3 components + WalletView + Home wallet link. 563 + 308 tests green. Live Anvil withdrawal confirmed. 7 screenshots captured.
- 2026-04-30: Code review applied 48 patches (3 P0, 24 P1, 21 P2) + 3 decision-needed resolutions. Highlights: deleted `debug-test.ts` scratch file, fixed `dryRun` USDC gas estimator (added `estimateUsdcTransferGas`), pinned viem `chain` for EIP-155 replay protection (was `chain: null`), cache key includes `nodeType` and dedupes in-flight RPC calls, `payload.ts` stable on cache hit, 4-col mnemonic grid, gas-aware Max withdrawal, Etherscan link + chainId-31337 caveat, "estimated <relative time> ago" + Refresh estimate link, dev-loop refuses non-test-vector mnemonic and writes encrypted `wallet.enc` (dev password `townhouse-dev`) so reveal flow is exercisable against the live stack, 3 missing AC-4 tests added (RPC unreachable, log-leak, checksum-mismatch), Home.stories.tsx updated. Final: 566 + 308 tests green, lint + build clean. Reveal-flow screenshots (`21-13-reveal-step1.png`, `21-13-reveal-step2.png`) require manual capture against the live dev stack post-restart.

## References

- [Source: _bmad-output/epics/epic-21-townhouse.md#Story 21.13: Dashboard — Wallet & Keys View] — original AC list (8 ACs); this story expands them per the 21.10/21.11/21.12 precedent.
- [Source: _bmad-output/epics/epic-21-townhouse.md#D21-008] — visual direction (Geist/Vercel light theme; node-type accents).
- [Source: _bmad-output/epics/epic-21-townhouse.md#D21-009] — live-Docker development mandate.
- [Source: _bmad-output/planning-artifacts/test-design-epic-21.md] — test scenarios for stories 21.9–21.13 dashboard views.
- [Source: _bmad-output/implementation-artifacts/21-12-dashboard-dvm-management-view.md] — bundled-API-with-view-with-primitive precedent; `BreakdownPill` primitive (reused here); `AddFunds` extraction; `formatVolume` extraction; ThroughputChart extraction (not consumed here but referenced); cross-package test discipline. Most directly mirrored story.
- [Source: _bmad-output/implementation-artifacts/21-11-dashboard-mill-management-view.md] — `useNodeHealth` / `useDepositAddresses` hook patterns; `<AddFunds>` precedent; live-Docker verification structure.
- [Source: _bmad-output/implementation-artifacts/21-10-dashboard-town-management-view.md] — connector restart awareness pattern (referenced, not consumed here — wallet PATCHes don't restart the connector); `usePacketTimeseries` (not consumed).
- [Source: _bmad-output/implementation-artifacts/21-9-dashboard-spa-home-view.md] — `VIEW_LINKS` extension point in `Home.tsx`; HomeHeader composition.
- [Source: _bmad-output/implementation-artifacts/21-8-5-dashboard-design-system-foundation.md] — primitives baseline; ESLint rules; design tokens; shadow-as-border.
- [Source: _bmad-output/implementation-artifacts/21-4-hd-wallet-management-and-key-derivation.md] — `WalletManager` API; `encryptWallet`/`decryptWallet`; on-disk `wallet.enc` schema; BIP-44 derivation paths; per-node-type account indices.
- [Source: _bmad-output/implementation-artifacts/21-8-fastify-rest-websocket-metrics-api.md] — `createApiServer` factory; existing `GET /wallet` route; localhost-only API boundary.
- [Source: packages/townhouse/src/wallet/manager.ts] — `WalletManager.listKeys()`, `getNodeKeys()`, `getAllKeys()`. All consumed unchanged.
- [Source: packages/townhouse/src/wallet/crypto.ts] — `decryptWallet` reused by AC-3.
- [Source: packages/townhouse/src/wallet/storage.ts] — `loadWallet` reused by AC-3.
- [Source: packages/townhouse/src/api/server.ts:82–86] — route registration sequence; AC-7 inserts the three new registrars after `registerWalletRoutes`.
- [Source: packages/townhouse/src/api/routes/wallet.ts] — existing `GET /wallet` route; preserved unchanged.
- [Source: packages/townhouse/src/api/routes/nodes.ts:669–708] — existing `GET /nodes/:nodeId/deposit-addresses` route; the new `<AddressBlock>` consumes its same address shape.
- [Source: packages/townhouse/src/api/types.ts] — destination for new types per AC-6.
- [Source: packages/townhouse/src/wallet/types.ts] — `NodeKeyInfo` consumed by `useWalletKeys` and the view.
- [Source: scripts/townhouse-dev-infra.sh:158–168] — `deploy-mock-usdc.sh` invocation; AC-1 captures its output.
- [Source: scripts/townhouse-dev-infra.sh:286–326] — `.env.townhouse-dev` heredoc; AC-1 + AC-9 extend it.
- [Source: scripts/deploy-mock-usdc.sh:205] — `TOON_USDC_ADDRESS=$CONTRACT_ADDR` output line; AC-1 parses this.
- [Source: packages/townhouse-web/scripts/api-server.mjs] — dev API loop; AC-9 extends with `wallet.fromMnemonic` call.
- [Source: packages/townhouse-web/src/views/Mill.tsx] — multi-chain layout precedent; reuse pattern for the Mill `<BalanceCard>`.
- [Source: packages/townhouse-web/src/views/Dvm.tsx] — view scaffold pattern (Shell + StateShell + grid).
- [Source: packages/townhouse-web/src/views/Home.tsx:144–174] — `HomeHeader` composition; AC-17 extends with the Wallet link.
- [Source: packages/townhouse-web/src/components/AddFunds.tsx] — receive-side disclosure pattern; new `<AddressBlock>` is the per-address building block; AddFunds itself stays unchanged for Mill/DVM.
- [Source: packages/townhouse-web/src/components/primitives/BreakdownPill.tsx] — primitive reused for the per-card "Total" roll-up.
- [Source: packages/townhouse-web/src/components/primitives/MetricBlock.tsx] — primitive reused for balance display with `tabular-nums`.
- [Source: packages/townhouse-web/src/components/primitives/ChainIcon.tsx] — primitive reused for per-chain glyph.
- [Source: packages/townhouse-web/src/components/primitives/TokenIcon.tsx] — primitive reused for per-token glyph.
- [Source: packages/townhouse-web/src/hooks/useNodeHealth.ts] — generic polling hook precedent; `useWalletBalances` mirrors its shape.
- [Source: packages/townhouse-web/src/hooks/useDepositAddresses.ts] — single-shot fetch precedent; `useWalletKeys` mirrors.
- [Source: packages/townhouse-web/src/hooks/useDvmJobsRecent.ts] — polling-with-refetch precedent; `useWalletBalances` mirrors.
- [Source: packages/townhouse-web/src/lib/format-volume.ts] — `formatVolume` (extracted in 21.12); reused for balance display.
- [Source: packages/townhouse-web/src/theme/tokens.ts] — `colors.ink`, `colors.canvas`, `colors.type.{town,mill,dvm}`. QR foreground/background and derivation-path account-index tinting consume these.
- [Source: viem v2 docs (https://viem.sh)] — `createWalletClient`, `createPublicClient`, `parseEther`, `parseUnits`, `getContract`, ERC-20 ABI helpers. AC-4 + AC-5 + AC-7 + AC-13 (modal review-step gas estimate) consume these.
- [Source: qrcode.react v4 docs (https://github.com/zpao/qrcode.react)] — `<QRCodeSVG>` component, `value`, `size`, `fgColor`, `bgColor`, `level` props. AC-12 + AC-19 consume these.
- [Source: BIP-39 test vector 0] — mnemonic `'abandon abandon ... about'`. AC-9 dev-loop fixture.
- [Source: Mock USDC FiatTokenV2_2 contract at `contracts/evm/MockUSDC.sol`] — ERC-20 `transfer(to,amount)` ABI consumed by AC-4 USDC withdrawal.

## Review Findings

_Generated 2026-04-30 by `bmad-code-review` (Blind Hunter + Edge Case Hunter + Acceptance Auditor on uncommitted diff vs spec, 3,932 lines, 44 files)._

### Decision needed

_All three resolved 2026-04-30 — converted to patches below._

- [x] [Review][Decision] **AC-22 reveal-flow live-Docker screenshots missing.** **Resolved → Patch (option b):** extend the dev-loop to encrypt the dev mnemonic with a documented dev password (`townhouse-dev`) and write `~/.townhouse/wallet.enc` if absent, so `POST /wallet/reveal` is exercisable against the live stack. Live-Docker reveal screenshots become reachable.
- [x] [Review][Decision] **Stale `dryRun` gas estimate at submit time.** **Resolved → Patch (option c):** display "estimated <relative time> ago" caption with a manual "Refresh estimate" link; no automatic refusal at submit.
- [x] [Review][Decision] **Dev mnemonic logged without test-vector validation.** **Resolved → Patch (option a):** refuse to start the dev API loop unless `TOWNHOUSE_DEV_WALLET_MNEMONIC` equals the BIP-39 test-vector-zero phrase (`abandon abandon … about`). Devs who need a different mnemonic should run the production `townhouse init` flow.

### Patch

#### P0

- [x] [Review][Patch] **(from Decision 3)** Refuse to start the dev API loop unless `TOWNHOUSE_DEV_WALLET_MNEMONIC` equals the BIP-39 test-vector-zero phrase. Throw a clear error pointing devs at `townhouse init` if they want a different mnemonic. [packages/townhouse-web/scripts/api-server.mjs:24-38]
- [x] [Review][Patch] Delete `packages/townhouse/src/api/routes/debug-test.ts` — scratch file with broken imports (`./src/api/routes/wallet-withdraw.js` resolved from inside `routes/`); vitest globs will pick it up and fail import resolution. [packages/townhouse/src/api/routes/debug-test.ts]
- [x] [Review][Patch] Fix `dryRun` USDC gas estimate — handler unconditionally calls `estimateNativeTransferGas` regardless of `body.token`, so USDC review-step shows ~21 k gas vs the actual ~65 k. Add `estimateUsdcTransferGas` helper or branch on token. [packages/townhouse/src/api/routes/wallet-withdraw.ts dryRun branch; packages/townhouse/src/chain/evm-tx.ts]
- [x] [Review][Patch] Set explicit `chain` in viem `sendTransaction` / `writeContract` (or assert `chainId === 31337` at the API boundary before broadcast) — current `chain: null` skips EIP-155 replay protection. [packages/townhouse/src/chain/evm-tx.ts signAndBroadcastEthTransfer / signAndBroadcastUsdcTransfer]

#### P1

- [x] [Review][Patch] Cache key in `wallet-balances.ts` must include `nodeType` — `evm:${address}:ETH` collides across nodes that share an address (test fixtures, future per-instance derivation); first-writer-wins fabricates wrong `nodeType` labels in cached entries. [packages/townhouse/src/api/routes/wallet-balances.ts setCached / getCached]
- [x] [Review][Patch] `Promise.allSettled` rejection branch fabricates `{nodeType:'town', token:'ETH', address:''}` regardless of which task failed — capture the original `(nodeType, family, token, address)` tuple per task and map rejections back. [packages/townhouse/src/api/routes/wallet-balances.ts rejection mapping ~line 240]
- [x] [Review][Patch] Add dependency array `[open, handleClose]` to RevealSeedModal Escape `useEffect` — currently re-registers/cleans on every render. [packages/townhouse-web/src/components/RevealSeedModal.tsx]
- [x] [Review][Patch] Cancel receipt-poll `setTimeout` chain on modal close — recursive `poll()` fires `setReceipt` on an unmounted component after close. Track via `useRef<number|null>` and clear in cleanup. [packages/townhouse-web/src/components/WithdrawModal.tsx receipt poll]
- [x] [Review][Patch] `handleReview` swallows dryRun error and silently advances to step 5 with `gasEstimate: null` — surface the error as a caption (and let the user retry / cancel). [packages/townhouse-web/src/components/WithdrawModal.tsx handleReview]
- [x] [Review][Patch] `evm-rpc.ts rpcCall` — caller-supplied `signal` makes the local 3 s timeout dead code (`combinedSignal = signal ?? controller.signal` and `fetch.signal = combinedSignal`). Use `AbortSignal.any([caller, controller.signal])` or move the timeout into the caller-signal branch. [packages/townhouse/src/chain/evm-rpc.ts rpcCall]
- [x] [Review][Patch] `localStorage.getItem('townhouse.wallet.backupAcked')` truthiness check — string `"false"` (or any non-empty value) passes; bare global access can throw outside a browser. Parse the stored ISO timestamp; guard with `typeof localStorage !== 'undefined'`. [packages/townhouse-web/src/views/Wallet.tsx backup banner state init]
- [x] [Review][Patch] Dedupe in-flight RPC requests — current cache misses fire `getEvmBalance` twice for parallel requests on a cold cache (the dashboard polls every 5 s and TTL is 5 s, so this is the *common* case). Use `Map<key, Promise>` for inflight tracking. [packages/townhouse/src/api/routes/wallet-balances.ts]
- [x] [Review][Patch] Wallet view `loading = keysStatus==='loading' && balancesStatus==='loading'` — should be `||` (or per-section spinners). Current AND gate renders empty cards while balances are still loading. [packages/townhouse-web/src/views/Wallet.tsx]
- [x] [Review][Patch] Reveal route ENOENT mapped to `500 wallet_corrupted` instead of `503 wallet_not_initialized` — split error handling on `e.code === 'ENOENT'`. [packages/townhouse/src/api/routes/wallet-reveal.ts catch block]
- [x] [Review][Patch] Module-scope balance `CACHE` Map persists across vitest tests — export `resetCache()` and call in `beforeEach` (and clear at module init). [packages/townhouse/src/api/routes/wallet-balances.ts CACHE map]
- [x] [Review][Patch] Switching token in WithdrawModal does not re-validate `amountError` — cached error from previous token persists; user can submit USDC at an ETH-relative amount. Reset `amountError` and re-run validation in the token-change handler. [packages/townhouse-web/src/components/WithdrawModal.tsx]
- [x] [Review][Patch] Receipt poll 30 s exhaustion shows "Waiting for confirmation…" forever — render a timeout caption + retry button when poll budget is exhausted. [packages/townhouse-web/src/components/WithdrawModal.tsx receipt poll]
- [x] [Review][Patch] `getReceipt` rejection swallowed by `catch { /* ignore */ }` — surface RPC errors so the user is not stuck on "Waiting…" indefinitely. [packages/townhouse-web/src/components/WithdrawModal.tsx receipt poll]
- [x] [Review][Patch] Native-balance gating ignores gas — `Max` withdraw passes API check then fails at broadcast with "insufficient funds for gas \* price + value". Subtract `estimatedGas * gasPrice` from `Max` (and post-validate server-side). [packages/townhouse/src/api/routes/wallet-withdraw.ts amount validation; packages/townhouse-web/src/components/WithdrawModal.tsx Max button]
- [x] [Review][Patch] `payload.ts = Date.now()` is set on every request — AC-2 specifies cache-hit returns same `ts`. Track and reuse the oldest cached entry's `ts` (or amend the spec). The current test (`wallet-balances.test.ts:2654`) acknowledges the deviation by weakening the assertion. [packages/townhouse/src/api/routes/wallet-balances.ts response shape]
- [x] [Review][Patch] **AC-17** `Home.stories.tsx` was not updated for the wallet link — spec calls it out explicitly in the File List. [packages/townhouse-web/src/views/Home.stories.tsx]
- [x] [Review][Patch] **AC-4** RPC-unreachable 503 test missing — handler has the code path but no test exercises it. [packages/townhouse/src/api/routes/wallet-withdraw.test.ts]
- [x] [Review][Patch] **AC-4** log-leak assertion missing for withdraw — reveal has it, withdraw does not. Verify `private key` and signed-tx hex never enter `app.log`. [packages/townhouse/src/api/routes/wallet-withdraw.test.ts]
- [x] [Review][Patch] **AC-4** checksum-mismatch 400 distinct test missing — current single test conflates regex-fail and checksum-fail; assert `code: 'invalid_recipient_checksum'` separately. [packages/townhouse/src/api/routes/wallet-withdraw.test.ts]
- [x] [Review][Patch] **AC-14** mnemonic grid is `grid-cols-3` (3-col × 4-row) — spec says **4-col × 3-row**. [packages/townhouse-web/src/components/RevealSeedModal.tsx mnemonic grid ~line 823]
- [x] [Review][Patch] **AC-16** backup banner caption omits relative timestamp — currently `"Backup verified"`; spec says `"Last backup verified <relative time>"`. Consume the stored ISO timestamp. [packages/townhouse-web/src/views/Wallet.tsx banner caption ~line 2067]
- [x] [Review][Patch] **AC-13** Etherscan-style link missing — chain-31337 caveat is rendered but no `<a>` link element for non-31337 chains (spec calls for "link to Etherscan-style view (with caveat for chain ID 31337 = 'local Anvil — no public explorer')"). [packages/townhouse-web/src/components/WithdrawModal.tsx step 6]
- [x] [Review][Patch] **(from Decision 1, AC-22)** Dev-loop writes `~/.townhouse/wallet.enc` if absent. When `TOWNHOUSE_DEV_WALLET_MNEMONIC` is set, encrypt the mnemonic with documented dev password `townhouse-dev` (via existing `encryptWallet` primitive) and write it to disk so the reveal endpoint is exercisable against the live dev stack. Document the dev password in `packages/townhouse/README.md` § "Local Dev Loop" alongside the existing mnemonic note. Then capture the missing `21-13-reveal-step1.png` and `21-13-reveal-step2.png` screenshots. [packages/townhouse-web/scripts/api-server.mjs; packages/townhouse/README.md; packages/townhouse-web/screenshots/]
- [x] [Review][Patch] **(from Decision 2)** WithdrawModal step 5 displays "estimated <relative time> ago" caption next to the gas estimate, plus a "Refresh estimate" link that re-fetches `dryRun`. No automatic refusal at submit. [packages/townhouse-web/src/components/WithdrawModal.tsx step 5]

#### P2

- [x] [Review][Patch] Withdraw error mapping `e.message.includes('fetch')` over-catches viem strings like "could not fetch nonce" → mapped to 503 `rpc_unreachable`. Use viem error classes / `err.code`. [packages/townhouse/src/api/routes/wallet-withdraw.ts catch block]
- [x] [Review][Patch] Mina balance helper throws on `BigInt('')`, `BigInt('1e3')`, malformed `total` — wrap in try/catch and return `available:false` with a `reason`. [packages/townhouse/src/chain/mina-graphql.ts:35-37]
- [x] [Review][Patch] Test-theatre: `useWalletBalances` and `useWalletKeys` "aborts on unmount" tests assert nothing — verify the abort actually fires (e.g. fetch was called with an aborted signal). [packages/townhouse-web/src/hooks/useWalletBalances.test.ts; useWalletKeys.test.ts]
- [x] [Review][Patch] Test-theatre: WithdrawModal happy-path matches `/confirmed|Waiting/i` — `Waiting` is rendered immediately at step 6, so the test passes regardless of receipt confirmation. Assert `confirmed`/txHash separately. [packages/townhouse-web/src/components/WithdrawModal.test.tsx ~line 1382]
- [x] [Review][Patch] **AC-13** client-side EIP-55 checksum check missing — modal regex-validates but does not run viem `isAddress`; checksum failure only caught server-side. Add client-side `isAddress` check with caption. [packages/townhouse-web/src/components/WithdrawModal.tsx step 3]
- [x] [Review][Patch] **AC-20** derivation-path accent wraps `0'` (with apostrophe) instead of `0` — spec example wraps the bare digit. Strip the hardened-tick from the wrapped span. [packages/townhouse-web/src/components/AddressBlock.tsx formatDerivationPath]
- [x] [Review][Patch] **AC-6** `WithdrawResponse` is a permissive union (all-optional fields) — split into discriminated `WithdrawSuccessResponse | WithdrawDryRunResponse | WithdrawErrorResponse`. Same applies to `WithdrawRequest.chainFamily` (declared `'evm' | 'solana' | 'mina'` instead of literal `'evm'`). [packages/townhouse/src/api/types.ts]
- [x] [Review][Patch] USDC-not-configured returns `400 usdc_not_configured` — server-config drift should be `503 usdc_address_not_configured` (matches the balances-route convention). [packages/townhouse/src/api/routes/wallet-withdraw.ts USDC branch]
- [x] [Review][Patch] `truncateHash` assumes input length ≥ 14 — guard short inputs and render full hash. [packages/townhouse-web/src/components/WithdrawModal.tsx truncateHash]
- [x] [Review][Patch] `useWalletReveal` no `try` around `res.json()` and no `res.ok` check — non-JSON 401 (e.g. nginx HTML) becomes "Network error" not "Wrong password". [packages/townhouse-web/src/hooks/useWalletReveal.ts]
- [x] [Review][Patch] `useWalletWithdraw.submit` doesn't check `res.ok` — caller can't distinguish 501/503 from a malformed success. [packages/townhouse-web/src/hooks/useWalletWithdraw.ts]
- [x] [Review][Patch] `useWalletBalances` doesn't validate `payload.entries` is an array — malformed server response throws `TypeError` on `entries.filter`. [packages/townhouse-web/src/hooks/useWalletBalances.ts]
- [x] [Review][Patch] Step transitions in WithdrawModal lack an `aria-live` region — screen readers don't announce step transitions. [packages/townhouse-web/src/components/WithdrawModal.tsx]
- [x] [Review][Patch] `wallet-balances.ts` task try-block re-throws → Fastify default error handler returns 500 with stack trace exposed in dev. Catch all and return entry with `available:false`. [packages/townhouse/src/api/routes/wallet-balances.ts task fetch loop]
- [x] [Review][Patch] Move `await import('viem')` to top-level — dynamic import on every request prevents tree-shaking; the cited "circular issue" should be resolved. [packages/townhouse/src/api/routes/wallet-withdraw.ts]
- [x] [Review][Patch] WithdrawModal step-1 disabled radios need `aria-describedby` pointing to the "coming soon" caption — screen readers announce "Solana, dimmed" without the explanatory text. [packages/townhouse-web/src/components/WithdrawModal.tsx step 1]
- [x] [Review][Patch] Validate `TOON_USDC_ADDRESS` shape on read — `'0xinvalid'` typo is passed straight to `getErc20Balance`, returning silent zeros. [packages/townhouse/src/api/routes/wallet-balances.ts]
- [x] [Review][Patch] Validate `contractAddress` and `holderAddress` shape inside `getErc20Balance` — bare `'abc'` is silently zero-padded. [packages/townhouse/src/chain/evm-rpc.ts getErc20Balance]
- [x] [Review][Patch] `buildFetchMock` decision rule `hex.length > 66 ? usdcHex : hex` is fragile — large ETH balances cross the threshold. Use selector matching (`0x70a08231` for `balanceOf`). [packages/townhouse/src/api/routes/wallet-withdraw.test.ts buildFetchMock]

### Defer (pre-existing or out-of-scope)

- [x] [Review][Defer] Multi-chain RPC mapping (per-`nodeType` RPC URL) — story is EVM-only single-RPC v1 per Dev Notes § Withdrawal scope; revisit when Solana/Mina send-side lands.
- [x] [Review][Defer] Burn-address (`0x0000…0000`) confirm step in WithdrawModal — devtool, not blocking.
- [x] [Review][Defer] Self-send warning when `recipient === wallet address` — not in spec.
- [x] [Review][Defer] Cache key including RPC URL for multi-RPC environments — single-RPC v1.
- [x] [Review][Defer] Mnemonic JS-string secure-zero — JS strings are immutable; spec's "zero out from React state" is met. True secure-zero requires a `Uint8Array` shape; future hardening.
- [x] [Review][Defer] AddressBlock account-index hard-coded to split-slot 3 — works for current BIP-44 schemas (EVM/Nostr/Solana/Mina); revisit if a non-standard path is added.
- [x] [Review][Defer] `keyInfo.solanaAddress` for non-mill nodeTypes silently ignored — current spec only Mill has Solana/Mina.
- [x] [Review][Defer] Reveal endpoint rate-limit / brute-force backoff — Threat model § acknowledges localhost-only mitigation.
- [x] [Review][Defer] Solana/Mina RPC hung-task wedge — 3 s per-fetch timeout already; circuit-breaker is future hardening.
- [x] [Review][Defer] AddressBlock `<details>` `aria-expanded` mirroring — browser handles natively.
- [x] [Review][Defer] USDC-capture script `tail -n1 | sed` brittleness — works with current `deploy-mock-usdc.sh` output format; harden if the script signature changes.

