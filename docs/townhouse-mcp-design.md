# Townhouse MCP Server — Design

**Status:** Draft / proposal
**Package (proposed):** `@toon-protocol/townhouse-mcp`
**Date:** 2026-06-13

A Model Context Protocol server that lets an LLM agent (Claude Code, Claude Desktop, or any MCP client) act as a **full Townhouse operator** — bootstrap a stack from nothing, run it, provision and tune nodes, manage settlement chains and credits, and move earnings. One stdio server, works identically in Claude Code and Claude Desktop.

> **Trust model:** the agent _is_ the operator. Whatever funds the apex holds belong to the agent; it is trusted to manage them. There is therefore **no read-only mode, no confirm-gating, and no withheld tools** for safety reasons. The server's job is to give the agent the full operator surface ergonomically and reliably, not to police it.

---

## 0. Prior art — `@toon-protocol/client-mcp` (shipped, main @ #221/#222)

Main already ships **`@toon-protocol/client-mcp`**: an MCP server that lets an agent act as a full TOON _client_ (pay-to-write, free reads, channel/balance management, mill swaps). It is **complementary, not overlapping** — client-mcp is the paying customer; townhouse-mcp is the operator who runs town/mill/dvm and earns the fees. We mirror its conventions rather than invent parallel ones:

- **SDK & build:** `@modelcontextprotocol/sdk ^1.12.0`, `type:module`, `tsup` build, `vitest` (unit `vitest.config.ts` + gated live integration `vitest.integration.config.ts`, env-gated like its `RUN_LIVE_HS_E2E`).
- **Tool naming:** `toon_*` there → **`townhouse_*`** here.
- **Companion skill + evals** (its `toon-client` skill) → a `townhouse-operator` skill teaching the operator lifecycle.
- **README** with copy-paste Claude Desktop / Claude Code registration.
- **Two patterns we adopt** (see §2, §3): the MCP server **holds no chain keys**, and it **auto-spawns the long-lived layer if down** and surfaces a "bootstrapping — retry" state instead of a hard error.

**Justified divergence — no second daemon.** client-mcp introduced a `toon-clientd` daemon because a client otherwise has no long-lived process to own the BTP session, channels, signer, and relay subscription. **Townhouse already provides that layer** — the apex (connector + Fastify API `:9400`, started by `up`) is the always-on stateful process that owns the wallet. So townhouse-mcp is a **single stdio binary** driving the existing CLI + API; a second daemon would duplicate what the apex already is.

---

## 1. Goals & non-goals

**Goals**

- Give an agent the **complete** operator capability set: `init → up`/`hs up`, `node add/remove`, `chains add/remove`, fee tuning, `credits buy`, `wallet` operations, `withdraw`, transport flip, plus full read/telemetry.
- Cover the stack **before it is running** (init/up), not just while it is.
- One server binary, two client registrations (Claude Code, Claude Desktop), no code differences.

**Non-goals (v1)**

- Multi-apex / remote fleet management. v1 is a single local apex on one host.
- Re-implementing orchestration. The server drives the _existing, tested_ `townhouse` CLI and Fastify API — it adds no new orchestration logic.
- A UI. This is a peer of `@toon-protocol/townhouse-web`, not a replacement.

---

## 2. Architecture — two surfaces, by phase

A full operator needs to act in two regimes, and the right backing surface differs:

```
                          ┌─────────────────────┐
                          │ townhouse-mcp       │  (stdio MCP server)
   Claude Code/Desktop ──►│                     │
                          │  ┌────────────────┐ │   exec        ┌──────────────────────────┐
                          │  │ CLI driver     │─┼──────────────►│ `townhouse` CLI          │
                          │  │ (lifecycle +   │ │  --json       │  init/up/hs/node/chains/ │
                          │  │  config + $)   │ │               │  credits/wallet/withdraw │
                          │  └────────────────┘ │               └──────────────────────────┘
                          │  ┌────────────────┐ │   HTTP/SSE/WS ┌──────────────────────────┐
                          │  │ API client     │─┼──────────────►│ Fastify API :9400        │
                          │  │ (live telemetry)│ │  (when up)    │  earnings/balances/      │
                          │  └────────────────┘ │               │  metrics/logs/channels   │
                          └─────────────────────┘               └──────────────────────────┘
```

**Primary surface = the `townhouse` CLI.** It is the canonical operator interface, it works whether or not the stack is up, and it already contains every hard part we'd otherwise duplicate: `handleDirectUp`/`handleHsUp`, the atomic 6-step node-provision pipeline with rollback, the wallet derivation, the connector peer registration. The MCP server **shells out** to it — reusing tested code rather than re-driving `DockerOrchestrator` in-process (which would force the MCP process to own the Docker socket, wallet unlock, and connector admin creds, and risk drifting from the CLI's behavior).

**Secondary surface = the Fastify API (when the stack is up).** For _live telemetry_ — earnings deltas, cached balances, packet metrics, log streaming, channels — the API returns clean structured JSON and avoids parsing CLI text. The server prefers the API for these reads when `:9400` is reachable, and falls back to `townhouse status`/`metrics`/`logs` otherwise.

**Rule of thumb:** state-changing & lifecycle → CLI; live read/telemetry → API (fallback CLI). The server consumes `--json` on every CLI call — **never** scrapes human text. Several commands don't emit `--json` yet (`init`, `up`, `hs up`, `status`, `wallet seed`, `credits buy/balance`, `down`, `hs enable/down`) and those are exactly the flows the agent leans on most. Adding `--json` to the remaining command set is a **prerequisite work item** (§10): terminal commands → one JSON object; long-running `up`/`hs up` → NDJSON progress events + a final summary object so the `up` tool can stream/poll instead of blocking opaquely. It's additive (existing human output untouched) and also helps CI.

---

## 3. Operating the wallet — one env var, no password

Because the agent is a real operator (not a human at a TTY) **and owns the funds**, the wallet should load from a single env-var secret with no password indirection.

**Target model: `TOWNHOUSE_MNEMONIC`.** The mnemonic is supplied directly via env; the operator wallet loads from it with no encrypted file and no decrypt/password step. This is the natural shape for a trusted autonomous agent — one secret, in env. The flow becomes: agent generates (or is handed) a 12/24-word mnemonic → sets `TOWNHOUSE_MNEMONIC` → `up`. `init` is not even required to pre-write an encrypted wallet.

**Status: P1 done (CLI), P1b remaining (container).** Townhouse stores the wallet AES-256-GCM-encrypted at rest and unlocks via `--password` → `TOWNHOUSE_WALLET_PASSWORD` → TTY prompt. `WalletManager` already exposes `fromMnemonic()`.

- **P1 — CLI unlock (DONE, commit `975baeb`).** It wasn't a single branch: the unlock pattern is duplicated across **7 sites** (`handleDirectUp`, `handleHsUp`, `handleUp`, `handleWalletShow`, `handleWalletSeed`, `handleCreditsBuy`, `handleCreditsBalance`). A shared `tryEnvMnemonicWallet(walletPath)` helper now short-circuits each: if `TOWNHOUSE_MNEMONIC` is set, load via `fromMnemonic()` — no file, no password. The existing flow is byte-for-byte preserved when the env var is absent. This covers all CLI-backed tools and the in-process `up --dev` API.
- **P1b — containerized `townhouse-api` (DONE, commit `9826c8d`).** The apex `up`/`hs up` boots a _separate_ `ghcr.io/toon-protocol/townhouse-api` image whose entrypoint previously enforced the password at startup. It serves `:9400` — the surface the MCP server's API-backed tools (`balances`, `earnings`, `list_nodes`, `withdraw`) use. Now: (1) `entrypoint-townhouse-api.ts` takes the same direct-mnemonic path; (2) `TOWNHOUSE_MNEMONIC: '${TOWNHOUSE_MNEMONIC:-}'` passes through both compose templates; (3) the var is added to the orchestrator's stderr secret-redaction list. **The published image must be rebuilt** to ship the entrypoint change (CI, or a from-source build with `pull_policy: never` for local testing). With P1+P1b the whole apex runs from a single `TOWNHOUSE_MNEMONIC` — no wallet file, no password.

**Fallback if we don't touch upstream first:** the MCP server sets `TOWNHOUSE_WALLET_PASSWORD` from its own env so the agent is never prompted. Functional, but keeps an encrypted-wallet-file + password concept the agent must have created — strictly worse than the mnemonic-env model. Use only as a stopgap.

**Keys live at the townhouse layer, not in the MCP server (per client-mcp).** `TOWNHOUSE_MNEMONIC` is the townhouse stack's secret — read by `init`/`up`/the wallet, persisted in its config dir. The MCP server is a thin driver and **holds no long-term key state**: it passes the env through to the child CLI and never stores the mnemonic itself. (Mirrors client-mcp, where the `toon-clientd` daemon owns the signer and `toon-mcp` holds no chain keys.) On cold-start the seed is generated by `init` and surfaced once for the agent to custody — it then lives in the townhouse config, not the MCP process.

**Other non-interactive handling:**

- **Seed custody.** Whether the agent supplied the mnemonic or `init` generated one, the agent is the custodian — `init_apex` **returns the mnemonic** and `get_seed` exposes it. No reason to hide it.
- **Destructive flags.** `node remove --yes`, `wallet seed --confirm`, `credits buy --yes` are passed automatically — the agent's tool call _is_ the confirmation.

These are _operational_ requirements, not security gates. Document the env contract clearly in the package README.

---

## 4. Tool catalog (full operator surface)

Grouped by function. CLI-backed unless noted. All responses are structured JSON content.

### Lifecycle (CLI)

| Tool               | Backing                                                       | Notes                                                                                                                                                      |
| ------------------ | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `init_apex`        | `townhouse init [--preset --network]`                         | Creates config; loads `TOWNHOUSE_MNEMONIC` if set, else **generates and returns a fresh mnemonic** for the agent to custody (§3).                          |
| `up`               | `townhouse up [--transport direct\|hs] [--town --mill --dvm]` | Boots the apex (direct default). **Returns a job handle fast; poll `up_status`** — does not block for the full boot (§5). Wallet via `TOWNHOUSE_MNEMONIC`. |
| `hs_up`            | `townhouse hs up`                                             | Boots the hidden-service apex. Same job-handle + poll model as `up`.                                                                                       |
| `hs_enable`        | `townhouse hs enable`                                         | Switches a running direct apex to HS.                                                                                                                      |
| `up_status`        | server job record (fed by `up`/`hs up` NDJSON)                | Per-step boot progress: pulling/starting/healthcheck/hs-hostname/done/error. Poll target for `up`/`hs_up`.                                                 |
| `down` / `hs_down` | `townhouse down` / `hs down [--rotate-keys]`                  | Stops the stack.                                                                                                                                           |
| `get_status`       | `townhouse status --json` → API `/api/nodes` when up          | Health of apex/connector/nodes/.anyone.                                                                                                                    |

### Nodes

| Tool               | Backing                                                 | Notes                                                                                       |
| ------------------ | ------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `add_node`         | `POST /api/nodes` (up) / `townhouse node add`           | type ∈ town\|mill\|dvm; surfaces the 6-step pipeline result.                                |
| `remove_node`      | `DELETE /api/nodes/:id` / `townhouse node remove --yes` | Destructive deprovision.                                                                    |
| `list_nodes`       | API `/api/nodes` → CLI `node list`                      | id, type, ilpAddress, status, lastSeenAt, nostrPubkey.                                      |
| `get_node_runtime` | API `/nodes`                                            | Docker state, uptime, image.                                                                |
| `set_node_fees`    | `PATCH /nodes/:type/config`                             | town `feePerEvent` / mill `feeBasisPoints` / dvm `feePerJob`+`kindPricing`. Echoes old→new. |
| `set_node_enabled` | `PATCH /nodes/:type/config` `{enabled}`                 | returns `orchestratorAction` (did a container bounce).                                      |

### Settlement chains

| Tool                              | Backing                                                   | Notes                              |
| --------------------------------- | --------------------------------------------------------- | ---------------------------------- |
| `list_chains`                     | API `/api/chains` → CLI `chains list`                     | configured EVM/Solana/Mina chains. |
| `add_chain`                       | `townhouse chains add --chain-type evm\|solana\|mina ...` | RPC + chain-id config.             |
| `remove_chain`                    | `townhouse chains remove`                                 |                                    |
| `set_network`                     | `PATCH /api/network`                                      | mainnet/testnet/devnet/custom.     |
| `get_transport` / `set_transport` | API `/api/transport`                                      | direct ↔ hidden-service.           |

### Wallet, earnings & credits

| Tool                 | Backing                                                       | Notes                                                                                                                                                                                                                |
| -------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `get_balances`       | API `/wallet/balances` → CLI `wallet show`                    | EVM/SOL/AR balances with scale & availability.                                                                                                                                                                       |
| `get_earnings`       | API `/api/earnings`                                           | apex + per-peer balances and today/month/year deltas.                                                                                                                                                                |
| `get_wallet`         | API `/wallet` / CLI `wallet show --json`                      | derived addresses (Nostr/EVM/SOL/Mina/Arweave).                                                                                                                                                                      |
| `get_seed`           | CLI `wallet seed --confirm`                                   | mnemonic backup. Exposed — agent owns it.                                                                                                                                                                            |
| `withdraw`           | `POST /wallet/withdraw`                                       | params `nodeType`, `chainFamily` (evm v1; sol/mina → 501), `token` native\|USDC, `recipient`, `amount`. **No confirm gate.** Optional `dryRun` exposed as a param the _agent_ may set if it wants an estimate first. |
| `get_credit_balance` | `townhouse credits balance --token`                           | Arweave/Turbo credits.                                                                                                                                                                                               |
| `buy_credits`        | `townhouse credits buy --token --amount [--quote-only] --yes` | DVM upload credits. `quote-only` is an agent-chosen param.                                                                                                                                                           |

### Telemetry / observability (API, fallback CLI)

| Tool                   | Backing                                     | Notes                                           |
| ---------------------- | ------------------------------------------- | ----------------------------------------------- |
| `get_channels`         | API `/channels` equivalent / CLI `channels` | open payment channels.                          |
| `get_metrics_snapshot` | `WS /metrics` (one frame)                   | packetsForwarded/Rejected, bytesSent. See §5.   |
| `tail_logs`            | SSE `/api/logs/stream` / CLI `logs --lines` | bounded slice, filter by service/level. See §5. |
| `get_peer`             | CLI `peer` / API node detail                | per-peer detail card.                           |
| `health`               | CLI `health` / API ping                     | apex/api/nodes/.anyone probe.                   |

**Nothing is withheld.** `withdraw`, `get_seed`, `remove_node`, `set_transport` are all first-class. `dryRun`/`quote-only` remain available as _agent-controlled_ params (useful for an agent that wants to estimate before committing), but the server never forces them.

---

## 5. Streaming endpoints → MCP

MCP tools are request/response; backing sources stream. The server **consumes** streams internally and exposes request/response tools — it never holds a tool call open on a stream:

- **`up` / `hs_up` (long-running boot).** The spawned `townhouse up` emits NDJSON progress (after P2). The `up` tool returns a job handle immediately; a background reader consumes the child's stdout — **buffering partial lines until `\n`** before `JSON.parse` — and folds each event into a job-state record keyed by handle. The agent polls `up_status`. The call is never held open for the minutes a boot takes, so it's immune to MCP client timeouts/drops. MCP `notifications/progress` may be emitted on top for clients that render it, but the job record is the source of truth.
- **`tail_logs`** opens SSE `/api/logs/stream` (or `townhouse logs`), collects until `maxLines` (default 100) or `timeoutMs` (default 3000), filters by `service`/`level`, drops `: heartbeat` comments, returns the batch.
- **`get_metrics_snapshot`** opens `WS /metrics`, returns the first non-heartbeat `metrics`/`batch` frame, closes. No socket held across calls.

High-volume `relayEvents` frames are out of scope (the dashboard owns that live view).

Optionally expose MCP **resources** mirroring the cheap reads — `townhouse://status`, `townhouse://earnings` — for clients that prefer resource subscriptions. Tools first; add resources if a client benefits.

---

## 6. Client configuration

Identical server, two registrations. The env contract carries the operator mnemonic so the agent can operate non-interactively. The `bin` is `townhouse-mcp` (matching client-mcp's `toon-mcp` stdio entry).

**Claude Desktop** — `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "townhouse": {
      "command": "npx",
      "args": ["-y", "@toon-protocol/townhouse-mcp"],
      "env": {
        "TOWNHOUSE_API_URL": "http://127.0.0.1:9400",
        "TOWNHOUSE_MNEMONIC": "word1 word2 … word12",
        "TOWNHOUSE_CONFIG_DIR": "~/.townhouse"
      }
    }
  }
}
```

**Claude Code**:

```bash
claude mcp add townhouse \
  -e TOWNHOUSE_MNEMONIC="word1 word2 … word12" \
  -- npx -y @toon-protocol/townhouse-mcp
# or commit a project-scoped .mcp.json with the same shape
```

Server config (env):

- `TOWNHOUSE_API_URL` (default `http://127.0.0.1:9400`)
- `TOWNHOUSE_MNEMONIC` — the operator wallet seed; loaded directly, no password (see §3). Stopgap until the upstream change lands: `TOWNHOUSE_WALLET_PASSWORD` against an encrypted wallet.
- `TOWNHOUSE_CONFIG_DIR` — where `init`/`up` read & write config
- `TOWNHOUSE_AUTOUP` (default `1`) — auto-`up` the apex on demand with a "booting — retry" response (§7); set `0` for explicit-control operators
- `TOWNHOUSE_BIN` (optional) — path/override for the `townhouse` CLI (default: resolve from PATH / workspace)

---

## 7. Error & degradation contract

The API degrades gracefully (connector down → 200 with `status:'unknown'`); preserve that. Standard envelope as tool content:

```json
{ "error": "<code>", "message": "<human text>", "hint": "<next step>" }
```

**Auto-spawn + "bootstrapping — retry" (per client-mcp).** When a telemetry/operate tool needs a live apex and `:9400` is unreachable, the server does **not** hard-fail: if `TOWNHOUSE_AUTOUP=1` (default) it kicks off `up` (returning the `up_status` handle) and returns a `booting` result the agent can retry against, mirroring client-mcp's auto-spawn-the-daemon + "bootstrapping — retry" UX. Operators who want explicit control set `TOWNHOUSE_AUTOUP=0` and get `apex_not_running` instead.

Codes to handle explicitly:

- `apex_not_running` — API `ECONNREFUSED` with auto-up disabled; for telemetry tools, transparently fall back to the CLI.
- `apex_booting` — auto-up in progress; agent polls `up_status` / retries.
- `wallet_unavailable` — money/lifecycle op but `TOWNHOUSE_MNEMONIC` is unset (and no encrypted-wallet fallback).
- `node_lifecycle_in_flight` (409) — another node op running; retry.
- CLI non-zero exit — surface stderr verbatim with the failing command + exit code.
- API typed errors (`insufficient_balance`, `invalid_recipient`, `unknown_node_type`, etc.) passed through with their HTTP status.

---

## 8. Package layout (proposed)

Mirrors `@toon-protocol/client-mcp` conventions (`type:module`, tsup, vitest unit + gated-live integration). **One** `bin` (no daemon — the apex is the daemon, §0).

```
packages/townhouse-mcp/
  src/
    index.ts          # exports
    mcp.ts            # bin: townhouse-mcp — stdio server bootstrap, tool/resource registration
    cli.ts            # CLI driver: spawn townhouse, consume --json/NDJSON, pass TOWNHOUSE_MNEMONIC through
    api.ts            # typed fetch wrapper over the Fastify API (reuses townhouse types)
    up-jobs.ts        # up/hs-up job records: background NDJSON consumer + up_status (§5)
    tools/
      lifecycle.ts    # init/up/hs/down/status/up_status
      nodes.ts        # add/remove/list/fees/enabled
      chains.ts       # chains/network/transport
      wallet.ts       # balances/earnings/seed/withdraw/credits
      telemetry.ts    # channels/metrics/logs/peer/health
    streams.ts        # SSE + WS snapshot adapters
  package.json        # bin: { "townhouse-mcp": "./dist/mcp.js" }
  tsup.config.ts ; vitest.config.ts ; vitest.integration.config.ts   # env-gated live test
  README.md           # Claude Desktop / Code registration + env contract
```

Deps: `@modelcontextprotocol/sdk ^1.12.0`, `ws` (metrics WS), undici/native fetch. Reuse request/response **types** exported from `@toon-protocol/townhouse` so the API/CLI wrappers stay in lockstep with the contract. Ship a companion **`townhouse-operator` skill + evals** alongside (as client-mcp ships `toon-client`).

---

## 9. Open questions

_(Resolved by investigation — kept for the record:)_

- **CLI `--json` coverage** — confirmed. Already JSON: `wallet show`, `node add/list/remove`, `chains list/add`, `channels`, `logs` (NDJSON), `peer`, `health`, `metrics`. Missing (→ prereq, §10): `init`, `up`, `hs up`, `status`, `wallet seed`, `credits buy/balance`, `down`, `hs enable/down`.
- **Wallet unlock** — decided: add a `TOWNHOUSE_MNEMONIC` direct-load path (§3), no password. Existing chain is `--password` → `TOWNHOUSE_WALLET_PASSWORD` → TTY prompt; `WalletManager.fromMnemonic()` already exists to build on.

- **Long-running `up`** — decided: **job handle + poll, not a held-open streaming call.** NDJSON is a reliable substrate for _server-internal_ consumption and a poll-able job record, but it is **not** reliable as a stream-to-the-model mechanism: an MCP tool call is request/response (one result), `notifications/progress` is a percentage bar with uneven client support, and holding a call open for the minutes `up`/`hs up` take (image pulls, HS bootstrap, the ~20s town inbound-session race) exposes it to MCP client timeouts and drops. So: P2 makes `up`/`hs up` emit NDJSON progress events; the `up` tool spawns and returns a job handle fast; the server consumes the child's NDJSON in the background (buffering partial lines) into a job-state record; the agent polls `up_status`/`get_status`. MCP progress notifications are an optional layer on top, never the source of truth. (See §5.)
- **Mnemonic generation ownership** — decided: when `TOWNHOUSE_MNEMONIC` is empty, **`init_apex` generates the mnemonic and returns it** to the agent (cold-start). When the env var is set, that seed is authoritative and `init_apex` uses it.

_(Resolved in implementation:)_

1. **API vs CLI version skew.** Done — **both**. The MCP package pins `@toon-protocol/townhouse` as an optional `peerDependencies` range (`>=0.26.0`, install-time warning), and a runtime `townhouse_version` tool shells `townhouse version` (a new CLI command) and lower-bound-checks the detected CLI against that pin (`satisfies` true/false/null). `version.ts` + `mcp-tools.ts`.

**Implemented since the original design:**

- **Streams adapter (§5)** — `streams.ts`: `townhouse_metrics` prefers WS `/metrics`, `townhouse_logs` prefers SSE `/api/logs/stream`, each with a CLI fallback and a `source` discriminator.
- **MCP resources (§5)** — `resources.ts`: `townhouse://status` + `townhouse://earnings`, thin aliases over the mirroring telemetry tools.

---

## 10. Suggested build order

**Prerequisite upstream changes to `@toon-protocol/townhouse` (do first):**

- **P1 — `TOWNHOUSE_MNEMONIC` direct load (§3). ✅ DONE (`975baeb`).** `tryEnvMnemonicWallet` helper across 7 CLI unlock sites; covers CLI-backed tools + in-process `up --dev`.
- **P1b — containerized `townhouse-api` mnemonic support (§3). ✅ DONE (`9826c8d`).** Entrypoint direct-load path + compose passthrough (both templates) + orchestrator redaction. Published image must be rebuilt to ship it. Enables the apex `:9400` API (the MCP server's `balances`/`earnings`/`list_nodes`/`withdraw` tools) in mnemonic mode.
- **P2 — `--json` on terminal commands (§2). ✅ DONE (`babb113`).** `init` (→ `{created, configPath, walletPath, mnemonic, addresses}` — the cold-start seed), `status` (→ `{nodes, hiddenServices?, connector, earnings?}`, graceful when the connector is down), `down` (→ `{stopped, nodes}`), `wallet seed` (→ `{mnemonic}`). `--json` is a global strict:false flag so each handler just gained a JSON branch; human output unchanged without it.
- **P2b — `--json`/NDJSON on the harder commands (§2). ✅ DONE (`a50921d`).** `credits balance` → one object; `credits buy` → `{kind:'quote'|'submit', ...}` (progress suppressed; submit requires `--yes`). `up`/`hs up` emit additive NDJSON `{step}` markers — `starting` / terminal `done` (with `alreadyLive` on the idempotent re-run) / `error` — via a small `emitUpStep` helper; human ribbon output is left intact (the `readUpStatus` parser skips non-JSON lines), so the OnboardingRibbon/retry flow is untouched. `townhouse_up_status` now sees a terminal step. **Every command the MCP server shells out to emits JSON/NDJSON.**

**MCP package:**

1. `cli.ts` driver + `api.ts` client; wire `get_status`, `list_nodes`, `get_earnings`, `get_balances` against a live `townhouse up`.
2. Lifecycle tools: `init_apex` (with seed surfacing) → `up`/`hs up` → `down`, with non-interactive unlock and long-running progress handling (#4).
3. Node tools: `add_node`/`remove_node`/`set_node_fees`/`set_node_enabled`.
4. Chains/network/transport tools.
5. Money & credits: `withdraw`, `buy_credits`, `get_seed`.
6. Telemetry: `tail_logs`, `get_metrics_snapshot`, `channels`, `peer`, `health`; optional resources.
7. README with the Claude Desktop / Claude Code config + env contract.

```

```
