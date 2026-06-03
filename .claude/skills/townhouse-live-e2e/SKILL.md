---
name: townhouse-live-e2e
description: Run the full operator+client live-infra exercise against a local townhouse hidden-service (HS). Use when the user wants to "run the townhouse live e2e", "stand up an HS and pay packets to town/dvm/mill", "do the operator and client agent demo", "exercise all three node types over the .anon", "upload an image to the dvm and verify the Arweave txId", or "/townhouse-live-e2e". Orchestrates two background agents — an OPERATOR that adopts-or-stands-up the apex + town/dvm/mill against local Docker chains and funds wallets, and a CLIENT that uses @toon-protocol/client over the apex .anon SOCKS5h address to pay a kind:1 publish to town, a kind:5094 hero-image blob upload to the dvm, and an EVM→Solana streamSwap to the mill — then files GitHub issues for findings and dispatches worktree-isolated fixer PRs. Bakes in the hard-won gotchas (RAM ceiling/adopt-don't-rebuild, sub-agents can't spawn sub-agents, dvm destination g.townhouse via localDelivery, MockUSDC 18-decimal, mill claim-issuance-layer caveat, prettier glob check).
---

# Townhouse live E2E (operator + client)

Reproduce the end-to-end TOON Protocol demonstration: an **operator** stands up (or adopts) a
townhouse hidden-service (HS) apex with `town` + `dvm` + `mill` children against local Docker chain
devnets, and a **client** uses the real `@toon-protocol/client` to pay packets to all three node
types over the apex `.anon` address — `kind:1` → town, `kind:5094` hero-image upload → dvm,
EVM→Solana `streamSwap` → mill. Both agents file GitHub issues for anything rough; **you (the
orchestrator)** dispatch worktree-isolated fixer agents that open PRs.

Argument: `adopt` (default) reuses a healthy running HS stack; `fresh` drives a real
`townhouse init → hs up → node add` bring-up.

> **Fast deterministic alternative (no agents):** `./scripts/townhouse-3node-e2e.sh` runs just the
> 3-node client exercise against an already-running stack and prints PASS/FAIL per node. Use this
> skill when you want the full agentic flow (bring-up verification + issue-filing + fixer PRs).

## Hard constraints (read first)

- **RAM is tight (~8 GB free; Mina alone wants ~4 GB).** Do NOT stand up a second full stack. If a
  healthy stack is already running (`docker ps` shows `townhouse-hs-connector/town/dvm/mill` +
  `townhouse-dev-anvil/solana/mina`), **adopt it** — verify via CLI/admin, don't rebuild.
- **Sub-agents CANNOT spawn their own sub-agents** (the Agent tool isn't exposed to them). So the
  operator/client agents file issues but CANNOT self-dispatch fixers — **you** dispatch fixer agents
  after collecting their findings.
- Per-package tests only with timeouts (`pnpm --filter <pkg> test`, timeout 120000). NEVER root
  `pnpm test`/`pnpm build`; NEVER pet-circuit. Set a timeout on every Bash call.
- Public ATOR proxies are flaky → 60–120 s handshake timeouts, retry/rotate among the `:9052` IPs.

## Phase 0 — preflight (you, before spawning agents)

1. `docker ps` — is a townhouse HS + chains already up? Note the active config dir
   (`~/.townhouse-local` or `~/.townhouse`), the `.anon` hostname (`<configdir>/host.json`), and the
   connector admin URL (usually `http://127.0.0.1:9401`).
2. `curl -s http://127.0.0.1:9401/admin/peers` — confirm `town`+`mill` connected. `dvm` shows
   `connected:false` **by design** (it receives via the connector `localDelivery` HTTP route to
   `http://townhouse-hs-dvm:3300`, not a BTP session).
3. Ensure the from-source townhouse CLI is built (`packages/townhouse/dist/cli.js`) and chains are
   healthy (`curl :28545` anvil, `:28899` solana; Mina's `unhealthy` is usually a strict-healthcheck
   false negative — daemon GraphQL serves on 3085).
4. `mkdir -p /tmp/toon-e2e`.

## Phase 1 — spawn the OPERATOR agent (background)

Give it the verified facts from Phase 0 and have it:
- Verify the deployment via the real CLI (`status`, `node list`, `health`) + `/admin/peers`.
- Derive each node's nostr pubkey from its container `NODE_NOSTR_SECRET_KEY` (older images ship an
  empty `NODE_NOSTR_PUBKEY`; getPublicKey via nostr-tools). NOTE the mill has TWO keys: the
  `NODE_NOSTR_SECRET_KEY` node identity AND the `MILL_MNEMONIC`-derived swap gift-wrap recipient —
  streamSwap callers need the **mnemonic-derived** one (it's what `mill_ready` logs and what
  kind:10032 publishes).
- Fund the client wallet (anvil acct[6] `0x976EA74…`) with ETH + MockUSDC (`scripts/faucet-evm.sh`
  or direct `cast`). MockUSDC is **18-decimal** on-chain (scale EVM claims by 1e18).
- Write `/tmp/toon-e2e/handoff.json`: `.anon` hostname/btpUrl, node ilp addresses + pubkeys, mill
  swapPair + solana channelId, chain RPCs (anvil 28545 / solana 28899), MockUSDC + registry, client
  funding key, socks proxies, hero image path. The client agent BLOCKS on this file.
- Collect findings (mis-wirings, healthcheck false-negatives, empty pubkey env, funding gaps).

If the argument is `fresh`: instead drive a real bring-up —
`townhouse init --network custom --evm-url http://townhouse-dev-anvil:8545 --sol-url http://townhouse-dev-solana:8899`
→ `hs up -c <config.yaml>` (note `-c`, not `--config-dir`) →
`docker network connect townhouse-hs-net townhouse-dev-anvil` (+solana/mina so child DNS resolves)
→ `node add town|dvm|mill`.

## Phase 2 — spawn the CLIENT agent (background, after handoff.json exists)

Have it reuse the existing harnesses rather than rewrite transport:
- `packages/client/scripts/all-three-nodes-hs-LOCAL.ts` (the consolidated 3-node harness) — or the
  per-node templates `social-flow-hs-LOCAL.ts` (town) + `mill-swap-hs-LOCAL.ts` (mill).
- Connect `BtpRuntimeClient` over `socks5h://<ator>:9052` to `ws://<.anon>:3000/btp`, open a
  client→apex EVM channel, sign the balance proof, then:
  - **town**: `publishEvent(kind:1)` → expect FULFILL.
  - **dvm**: `buildBlobStorageRequest` kind:5094 of the hero image
    (`_bmad-output/branding/social-assets/github-hero-readme.jpg`, image/jpeg) to **destination
    `g.townhouse`** → expect FULFILL; decode base64 FULFILL → Arweave txId (view via
    `https://arweave.net/<txId>`; 404 right after upload = Turbo free-tier propagation delay).
  - **mill**: `streamSwap` EVM USDC→Solana USDC → expect `state:completed` + signed claim. KNOWN:
    the current mill image returns ILP **T00** live (the handler ACCEPTS in local repro); the Solana
    mint/channel aren't on-chain on the devnet, so the swap verifies at the **claim-issuance layer
    only**. Report mill, don't hard-fail on it.
- Write `/tmp/toon-e2e/client-results.json` and collect client-side findings.

## Phase 3 — issues + fixer PRs (you)

Each role agent files GitHub issues for its findings:
`gh issue create --repo <owner/repo> --title … --body "<repro + observed + affected files + proposed fix>"`
(client agent dedupes against the operator's via `gh issue list`).

Then **you** dispatch ONE fixer per issue (or grouped by package to avoid conflicting PRs) using the
Agent tool with `isolation:"worktree"`, in **batches of ≤2** for RAM. Each fixer:
- bases off `origin/main` (`git checkout -b fix/issue-<n>-<slug> origin/main`);
- runs tests cheaply WITHOUT `pnpm install` — symlink deps then run vitest directly:
  `ln -sfn <repo>/node_modules ./node_modules`,
  `ln -sfn <repo>/packages/<pkg>/node_modules ./packages/<pkg>/node_modules`,
  `<repo>/node_modules/.bin/vitest run <test> --root packages/<pkg> --no-coverage`;
- commits (`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`), pushes, opens a
  PR (`Closes #<n>`). Verify prettier with the repo's **glob** (`pnpm format:check`), not an explicit
  file path — a path-scoped `prettier --check` can falsely pass.

Report a consolidated table: each node's result (town/dvm FULFILL, dvm Arweave txId, mill state),
issues filed, and PR links.

## Cleanup

`git worktree prune` the fixer worktrees once branches are pushed. Leave the docker stack running
unless asked to tear down (`townhouse hs down` + `docker compose -p <proj> … down`).
