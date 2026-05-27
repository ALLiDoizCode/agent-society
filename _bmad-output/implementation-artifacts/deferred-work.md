
## Deferred from: Epic 21.18 — Arweave Turbo Credit Funding (2026-05-22)

- ~~**D1 — human-crypto-keys vendoring**~~ **RESOLVED 2026-05-22** — Replaced `human-crypto-keys@0.1.4` + `node-forge@0.8.5` with `rsa-from-seed.ts` (HMAC-DRBG via `@noble/hashes` + `node-forge@1.3.3`). Byte-identical RSA-4096 derivation; CVE-free; 126/126 wallet tests pass.

- **D2 — live DVM integration smoke against real orchestrator** — `townhouse up --dvm` live test (verify `DVM_ARWEAVE_JWK_B64` appears in container env) was deferred because running it requires stopping the HS stack. Unit tests in `orchestrator.test.ts:1537–1694` cover the 4 code paths. Do live smoke before 21.18 ships as `done`. [`packages/townhouse/src/docker/orchestrator.ts`]

- **D3 — cold pull narration smoke** — `pull-narrator.ts` was added but live pull-narration (removing a Docker image and re-running `hs up`) was not smoke-tested in this session. Run once before 21.18 ships. [`packages/townhouse/src/cli/pull-narrator.ts`]

- ~~**D6 — Story 49-5 ATOR green run**~~ **RESOLVED 2026-05-26** — `townhouse-dvm-arweave-e2e.test.ts` gate ran **5/5 PASS in 71s**. ATOR network stable; B anon SOCKS5 ready before channel open. Arweave txid `ENO_lSHMz672WRtBru3PFHVKPCGZyYkLzuRCxPHRuus` confirmed in ILP FULFILL data. Two fixes landed: (1) ephemeral JWK for free-tier Turbo uploads (`TurboFactory.unauthenticated()` is read-only); (2) connector.yaml self-route `g.townhouse → local` (missing route caused F02 before localDelivery check). `@anyone-protocol/anyone-client@1.1.3` 60s timeout is hardcoded (not configurable). Fallback gate (`local-docker-hs-paid-earnings-smoke.test.ts`, `RUN_LOCAL_HS_E2E=1`) documented in `scripts/townhouse-e2e-real-hs.sh` comments for ATOR-instability conditions.

- **D4 — `credits buy` live on-chain test** — `--quote-only` was tested live with Turbo devnet. Full `topUpWithTokens` submit path (real on-chain tx) was not tested. Requires funded DVM SOL/EVM address. Smoke once before v0.1 pilot. [`packages/townhouse/src/credits/buy.ts`]

- **D5 — `wallet.arweave.enc` export from `wallet/index.ts`** — `ar-cache.ts` functions are not currently re-exported from the wallet index (only consumed internally via manager.ts). Expose if scripting access is needed.

## Epic 49 sunset checklist

Track-forward: when Epic 49 retires (or by 2026-08-31, whichever comes first),
close these long-lived Akash leases. Each runs ~$2-5/mo and has NO consumer
outside Epic 49 — closing the epic = closing the leases.

- **49.3 foreign-toon-client lease** — close via `scripts/akash-deploy.sh close foreign-toon-client`.
  Lease URL recorded in `deploy/akash/leases.json["foreign-toon-client"].url` after deploy.
  Owner: `dev.jonathan.green@gmail.com`. Monthly AKT-burn budget: ~$3-5/mo at
  1500 uakt/block × 30 days; alert at 50% drain (manual eyeball discipline
  for now — wire to monthly cron if pilot extends past 2026-08-31). The pod
  holds ZERO persistent state (ephemeral signer keys, no on-disk wallet); a
  clean close + redeploy is safe at any time.
- **49.2 faucet lease** — close at the same time as 49.3. The faucet has no
  consumers once 49.3 closes (49.4/49.5 also retire alongside).
- **anvil + solana chain leases** — close after 49.3 + 49.2 (they're the only
  remaining consumers; downstream Mock USDC state is throwaway).

Orphan-lease detector follow-up (NOT blocking 49.3): wire
`scripts/akash-status.sh --orphan-check` into CI nightly to page on any
unknown leases under the toon-protocol Akash Console wallet. Currently
manual via the Console UI. Belongs in a small infra-hardening story.

## Deferred from: code review of 49-2-akash-devnet-faucets-and-ui (2026-05-19)

- **W1 — Smoke test 5 exercises IP rate-limit, not per-address token-bucket** — `Promise.all` fires 6 requests concurrently; all 6 see no prior hit at check-time before any `recordFaucetHit` runs; the IP 5/min cap is what actually fires. A sequential per-address sub-test (two requests 500ms apart to the same address, expect second=429) would properly gate AC#1's 1/sec address limit. Low impact in devnet context. [`packages/townhouse/src/__integration__/akash-faucet-smoke.test.ts:188`]

- **W2 — `"unknown"` IP bucket shared by all clients lacking a resolvable IP** — `clientIp()` returns `"unknown"` when both `X-Forwarded-For` and `req.socket.remoteAddress` are absent; all such callers share one IP rate-limit slot (5/min aggregate cap). Akash L7 `accept-http-hosts` SDL rule does propagate XFF; best-effort in devnet context. [`packages/faucet/src/index.js:547`]

- **W3 — `render_faucet_sdl` sed injection via leases.json URL values** — `$evm_rpc`, `$evm_usdc`, `$sol_rpc`, `$sol_usdc` are interpolated unquoted into sed `|`-delimited expressions; a `|` in a URL value corrupts the command. `leases.json` is operator-controlled; HTTP URLs don't normally contain `|`. Same pattern as other deploy scripts. [`scripts/akash-deploy.sh` `render_faucet_sdl`]

- **W4 — Sequential EVM transactions: ETH disbursed even if token transfer fails** — `dripEvmCore` sends ETH then sends token; if `tokenTx.wait()` rejects, the caller receives a 502 even though ETH was already transferred. Inherent blockchain limitation; no atomic rollback possible. Devnet context, spec doesn't require partial-win surface. [`packages/faucet/src/index.js`]

- **W5 — `startRetryCountdown` doesn't re-disable submit button when user edits address during countdown** — `renderDetect` re-enables submit for a valid address while countdown is ticking; next `tick()` shows rate-limit message but button is clickable and a new request can fire. UX-only, devnet tool, low impact. [`packages/faucet/public/index.html`]

## Deferred from: 49-2-akash-devnet-faucets-and-ui (2026-05-18)

- **F1 — Create the `akash-faucet` GHCR package + push canonical tag** — Story 49.2 spec calls for `ghcr.io/toon-protocol/akash-faucet:demo` to match the `akash-{anvil,solana}:demo` convention. The current PAT in `~/.docker/config.json` (`toon-protocol`) only has push rights on existing packages, so `docker push akash-faucet:demo` fails with `permission_denied: token doesn't match expected scopes`. Workaround: `deploy/akash/faucet.sdl.yaml` uses the `townhouse-faucet:demo` alias (same image content, scope-pushable today). Right fix: create the GHCR package via `gh api orgs/toon-protocol/packages` or the GitHub UI, grant the existing PAT push perms, then `scripts/akash-deploy.sh build-faucet` will push both tags cleanly. After that, flip `faucet.sdl.yaml`'s image reference to `akash-faucet:demo` and remove this entry.

- **F2 — Refactor faucet drip logic into a shared module imported by both `packages/faucet/src/index.js` AND `packages/townhouse/src/api/routes/faucet.ts`** — Story 49.2 Task 1.4 confirmed the drip logic is duplicated between the standalone Express faucet (story 49.2 deployment target) and the townhouse dashboard's Fastify route (used by the React `FaucetPanel`). Story 49.2 explicitly recommended (a) leave both in place — refactoring is scope creep — but flagged it as a follow-up. The shared module would live at `packages/faucet/src/drip-core.{evm,sol}.mjs` and be imported by both, eliminating drift risk on the address regex, the SOL+USDC compose flow, and the `MINT_NOT_FOUND` partial-success path. Separate-PR work; do not bundle with another story.

- **F3 — Epic 49 sunset checklist — close the faucet lease** — When Epic 49 retires, close the `faucet` Akash lease via `scripts/akash-deploy.sh close faucet`. The lease has no rollback dependency (downstream consumers 49.3/49.4/49.5 are all Epic 49 stories that retire alongside). Tracked here so the close step isn't forgotten when the epic is rolled up; the close also refunds the unconsumed escrow.

- ~~**F4 — Redeploy dead Akash-Anvil + Akash-Solana leases**~~ **RESOLVED 2026-05-19** — Anvil redeployed as DSEQ 26888410, Solana as DSEQ 26888424; faucet redeployed as DSEQ 26888459. Smoke 7/7 PASS. — Story 49.2 smoke surfaced that both upstream chain leases listed in `deploy/akash/leases.json` are non-responsive at the HTTP layer (`scripts/akash-status.sh` reports `down`; `curl -k` also returns empty). Leases were deployed 2026-05-07; appear to have died sometime between then and 2026-05-18. Direct impact on 49.2: Tests 3+4 of the smoke (`POST /faucet/evm` and `POST /faucet/sol` strict-success paths) are BLOCKED-EXTERNAL until the chains come back. Fix: `./scripts/akash-deploy.sh redeploy anvil` + `./scripts/akash-deploy.sh redeploy solana`, then re-run the faucet smoke (it will auto-pick the new URLs from `leases.json`). Downstream impact: stories 49.3/49.4/49.5 all depend on these chains being up. Should be sequenced BEFORE Epic 49 progresses past 49.2.

- **F5 — Akash provider image-cache stickiness** — When `cmd_faucet` redeploys, the Akash provider's docker daemon serves the cached `:demo` tag even if GHCR's `:demo` has been re-pushed with a new digest. Worked around in 49.2 by tagging the corrected build as `townhouse-faucet:v49-2-fix` and updating the SDL. Long-term fix: pin SDL `image:` lines to SHA-pinned tags (e.g., `townhouse-faucet:sha-XXXX`) via the existing `image_digest()` helper, the same way `ANVIL_IMAGE_TAGGED` works. Lifting this to `cmd_faucet` matches the existing anvil/solana SHA-pinning pattern. Belongs in a small infra hardening story.

## Deferred from: code review of 49-1-toon-client-foreign-townhouse-hs-smoke (2026-05-18, Pass 2)

- **D1 — Real SOCKS5 handshake probe for `waitForBSocks5`** — Current gate is a raw TCP `connect()` to `127.0.0.1:9050`, which succeeds the instant the anon-client daemon binds the listener (5–30s) but BEFORE anon circuits are usable for `.anon` SOCKS5 tunnels (60–180s). Three downstream `ToonClient.start()` retries (~3 min slack) mask the gap today, but the gate is misleading and inflates failure-diagnostic time. Right fix: SOCKS5 greeting exchange + CONNECT to a known `.anon` target (or at minimum the SOCKS5 protocol greeting). Re-raised by both Blind Hunter (B6) and Edge Case Hunter (E5) in Pass 2 review. [`packages/townhouse/src/__integration__/townhouse-foreign-hs-smoke.test.ts:402-423, 1079-1100`]

- **D-DN4 — `build-app.ts` package.json path resolution unit test (follow-up for Hard Rule #2 exception d)** — `build-app.ts` was edited in 49.1 under Hard Rule #2 exception (d) (createRequire rename + relative path fix from `'../../package.json'` to `'../package.json'`). Exception (c) socks5.ts has a documented follow-up PR (D2 above); exception (d) had none. Resolved 2026-05-18 Pass 2 (DN4) by mirroring the commitment: write a unit test that asserts package.json resolution from BOTH `dist/cli.js` (current bundle target) AND a future chunked `dist/api/build-app.js` (hypothetical tsup-config change). Catches the fragility flagged in Pass 2 patch P37. [`packages/townhouse/src/api/build-app.ts:28-30`]

- **D2 — `socks5.ts` CJS/ESM unit test for the `(WS as any).default ?? WS` constructor fallback** — Production fallback added by the Pass 1 socks5.ts edit (Hard Rule #2 exception c) has no unit test. Test should pin both CJS (`{ default: WSClass }`) and ESM (`WSClass` directly) shapes, plus the malformed-default boundary (namespace object with no `WebSocket` named export). Originally deferred in Pass 1 (Decision D2 → "follow-up PR"); re-raised by Blind Hunter (B7) in Pass 2 because the runtime ladder is still incomplete. The constructor-ladder code patch (P40, Pass 2) is independent of and complementary to this test. [`packages/client/src/transport/socks5.ts:71-78`]

## Deferred from: code review of 49-1-toon-client-foreign-townhouse-hs-smoke (2026-05-18, Pass 1)

- `townhouse logs` SIGKILL race in Test 2 — outer 15s timer + `waitForExit`'s own SIGKILL fire near-simultaneously; the child exits with `code=null` (killed-by-signal). The current raw `waitForExit` swallows this fine, but if anyone later swaps to `waitForExitLabelled`, the labelled wrapper throws on null exit and would mis-classify normal teardown as a failure. Works as-is today; the right fix is a broader teardown-helper refactor that consolidates SIGKILL ownership, outside the scope of a single story. [`packages/townhouse/src/__integration__/townhouse-foreign-hs-smoke.test.ts:947-962`]

## Deferred from: Epic 49 re-scope (2026-05-18) — Aggregated Pilot Telemetry

Epic 49 was originally scoped as a 7-story "Telemetry & Validation Gate" — pilot operators opt in to anonymous weekly earnings pings; the median across all pilot operators fires a $1.00 / $0.10 / <$0.10 validation gate at pilot day-30 that decides v1.0 marketing copy. Receiver server at `telemetry.toon-protocol.dev` behind Cloudflare (IP-stripping at the edge per NFR5 "no PII") and Let's Encrypt SSL.

**Why deferred:** v0.1 pilot reality is n=2 (Jonathan + Drew). A median of two data points is not a validation gate, it's an anecdote. The Cloudflare/Let's Encrypt/receiver-server toil tax (Story 49.5 was BLOCKED pending owner assignment for Cloudflare account + domain + Grafana hosting) buys nothing at n=2. The new Epic 49 instead targets the actual blocking job: prove the revenue loop closes end-to-end on real `.anyone` infrastructure between two boxes.

**Re-entry criteria for Epic 49-future (Aggregated Pilot Telemetry):**
- ≥ 10 opted-in operators are on the recruitment calendar (n=2 → n=5 → n=10 is the noise-floor heuristic; medians below n≈10 are too noisy to fork v1.0 marketing on)
- Cloudflare account owner named for `telemetry.toon-protocol.dev`
- Domain owner named for `telemetry.toon-protocol.dev`
- Grafana hosting owner named (Story 49.5 BLOCKER)
- Disclosure copy reviewed against the then-current pilot framing
- FR30–FR34 / NFR5 / NFR6 / NFR10 / NFR18 numbers may be renumbered or repurposed at re-staging time (they were rewritten for the new Epic 49 on 2026-05-18)

**Archived stories** (full AC bodies preserved in git history at `_bmad-output/planning-artifacts/epics-townhouse-hs-v1.md` pre-2026-05-18; see `git log --follow -p`):

- **49.1 (deferred)** — Telemetry Payload Schema + Zod Validator. Versioned, zod-validated payload at `packages/townhouse/src/telemetry/schema.ts`; fields: `operatorIdHash`, `townhouseVersion`, `weekNumber`, `enabledNodes`, `earnings.apex.usdcCents`, `earnings.perPeer`, `metrics`, `flags`. `operatorIdHash = sha256(operatorPubkey + STATIC_SALT)`. No PII fields (no IP, no hostname, no `.anyone` address, no unhashed wallet pubkey, no claim IDs, no peer counterparty pubkeys). Includes `'external'` in `perPeer[].type` literal union.

- **49.2 (deferred)** — Opt-In Flow + Disclosure Copy + State File. Locked disclosure copy: *"You're joining the v0.1 pilot. Townhouse will send anonymous earnings telemetry (peer-id hash, USDC/day, uptime — no IP, no wallet) so we can validate the economics before public launch. This is required for pilot participation. Type 'agree' to continue."* State file `~/.townhouse/telemetry.json` mode 0o600 with `{ optedIn, firstBootAt, lastPingAt, pendingPings }`. v1.0 release replaces "required" with optional language.

- **49.3 (deferred)** — Telemetry HTTP Client + Retry Buffer. Weekly scheduled POST to `https://telemetry.toon-protocol.dev/v1/townhouse-pulse` jittered ±6h from `firstBootAt`. Retry backoff: 1h, 4h, 1d, 3d after first failure; drop after 4 weeks with `~/.townhouse/telemetry-dropped.log` entry. Telemetry never blocks operator-facing operations. Hard-stop: when `optedIn: false`, HTTP client is never instantiated.

- **49.4 (deferred)** — `townhouse telemetry on|off|status` CLI. Three verbs; `--json` machine-readable output; `off` clears pending pings and disables scheduler; `on` re-prompts the disclosure copy and requires `agree`.

- **49.5 (deferred — was BLOCKED)** — Telemetry Receiver Server + Cloudflare + Grafana Dashboard. Server at `telemetry.toon-protocol.dev/v1/townhouse-pulse`; Cloudflare IP-stripping at edge (origin never sees client IP — enforces NFR5); Let's Encrypt SSL; same zod schema validation as client (Story 49.1) — schema drift returns HTTP 400; Grafana dashboard renders weekly active pings + 30% WoW drop alert. Block was pending owner assignment for Cloudflare account + domain + Grafana hosting.

- **49.6 (deferred)** — Pilot Day-30 Decision Artifact. Day-30 script queries telemetry for opted-in operators' week-4 records; computes per-operator `total_usdc_cents = earnings.apex.usdcCents + sum(earnings.perPeer.usdcCents)`; median is the gate input. Exactly ONE branch fires: `median ≥ $1.00/wk` → full earnings hero ("Earn passive USDC from your homelab."); `$0.10 ≤ median < $1.00/wk` → demote earnings panel ("Run yields, be early."); `median < $0.10/wk` → DELAY public launch, hero pivots to "events relayed + uptime" ("Be early to the network."). Result + raw data committed to `_bmad-output/v0.1-pilot-results.md`.

- **49.7 (deferred)** — Live E2E Gate — Telemetry & Validation. End-to-end gate against deployed `telemetry.toon-protocol.dev`: fresh `~/.townhouse/`, opt-in flow, immediate POST (jitter-bypass), Grafana write within 5min, NO PII verified at receiver side, retry buffer behavior, day-30 script against fixture dataset. Mary signs off disclosure copy + opt-in flow as pilot-ready.

**Open downstream questions to resolve before Epic 49-future re-staging:**
- Should the receiver be hosted on `.anyone` HS instead of Cloudflare/Let's Encrypt? Winston flagged this as the ethos-aligned alternative; trade-off is operator-side connectivity fragility during a paywall-fragile window (party-mode discussion 2026-05-18).
- Mary's 2026-05-25 recruitment pitch needs revising independent of Epic 49-future timing — current pitch promises "required for pilot participation" but the new Epic 49 doesn't require telemetry. The pitch should be updated to reflect what is actually being asked of pilot operators.

## Deferred from: code review of 48-4-activity-ticker-footer-and-activity-overlay (2026-05-14, second pass)

- W9: `key.escape` closes the overlay even when `key.ctrl` or `key.meta` is also set. The ESC branch short-circuits before the modifier guard (intentional, per the inline comment, to handle Ink's bare-ESC parsing setting `meta=true`). Side-effect: Ctrl-ESC and Alt-ESC also close. Spec AC #5 does not forbid this. Tighten with `if (key.escape && !key.ctrl)` once Ink's per-terminal ESC parsing is understood. [packages/townhouse/src/tui/components/ActivityOverlay.tsx:79-82]
- W10: `formatRelativeTime(iso, now)` returns `"NaN mo ago"` when `now` is invalid. `iso === null` and `Number.isFinite(ms)` guard the `iso` arg; `now` is implicitly trusted. Only triggered by a test fixture passing `new Date(NaN)` — production default is `new Date()`. Cheap fix: `if (!Number.isFinite(now.getTime())) return '?';` at line 5. [packages/townhouse/src/tui/format.ts:4-17]
- W11: ActivityOverlay row React `key` includes `scroll + i`, forcing full row remount on every `j`/`k`. The 5-field `claimKeyForReact(c)` is already unique within the visible window. Perf, not correctness. Drop the `-${scroll + i}` suffix. [packages/townhouse/src/tui/components/ActivityOverlay.tsx:111]
- W12: `useActivityBuffer` runs full Map/sort/trim every 2s tick when `incoming === []` AND buffer non-empty (prolonged connector outage with a settled prior buffer). Same-check bails on `setBuffer` so correctness is preserved; 200 entries of work wasted per tick. Tighten the early-return: `if (incoming.length === 0) return;` at line 20. [packages/townhouse/src/tui/use-activity-buffer.ts:18-34]
- W13: Direction-unknown rendering is duplicated across two parallel ternaries (`arrowFor` + `directionLabel`), each with its own `directionUnknown` fallback. Future change to one without the other → silent row misalignment. Consolidate into a single `directionMeta(d): { arrow, label }` helper. [packages/townhouse/src/tui/components/ActivityOverlay.tsx:25-35, ActivityTicker.tsx:17-19]
- W14: Sort tie (two claims sharing `at`) surfaces an arbitrary peer. Stable sort uses wire order; if a tied-`at` claim is buffer-only (not in current wire), ticker and overlay can disagree on the newest. Add a tiebreaker to `sortKey` (`peerId`, arrival index, or composite). Low-frequency event. [packages/townhouse/src/tui/components/ActivityTicker.tsx:26, use-activity-buffer.ts:27]

## Deferred from: code review of 48-4-activity-ticker-footer-and-activity-overlay (2026-05-14)

- W1: `useActivityBuffer` effect dep array omits `buffer`. Spec-prescribed (Task 9.1 sample code uses `}, [incoming]);` verbatim). React's per-render closure refresh means the buffer is read correctly each fire — the "stale closure" concern is a false positive. However, `react-hooks/exhaustive-deps` would flag this if strict. Idiomatic fix: `setBuffer(prev => ...)` with `buffer` removed from merge body. [packages/townhouse/src/tui/use-activity-buffer.ts:34]
- W2: `formatUsdcMicro('-1', 6)` shows `-$0.0000`. Mirrors pre-existing 48.1 pattern in `formatUsdc`. Both formatters check `value !== 0n` against the raw bigint, not the displayed digits — so negative sub-precision values keep their sign even after truncation rounds them to zero. The "negative-zero collapses correctly" Dev Notes claim is incorrect for sub-precision. Cross-cutting fix; reconcile with `formatUsdc` in a follow-up. [packages/townhouse/src/tui/format.ts:38]
- W3: `columnsProp === 0` falls through to width 0 because `??` preserves 0. Matches `PeerTable.tsx:54` precedent. Test-contract concern only; production never passes 0. [packages/townhouse/src/tui/components/ActivityOverlay.tsx:51]
- W4: `formatUsdcMicro` has no defensive guard for non-integer or negative `scale` — `BigInt(NaN)` or `BigInt(-1)` would throw `RangeError`. Wire is frozen at `assetScale: integer >= 0`, so this is theoretical today. Harden if the formatter ever consumes user input. [packages/townhouse/src/tui/format.ts:28-29]
- W5: `formatTime` requires full-ICU Node build to render `'en-GB'` `HH:MM:SS` deterministically. On `small-icu` Node builds, `'en-GB'` locale data is absent and `toLocaleTimeString` silently falls back to `'en-US'` (`"2:32:08 PM"`), breaking UX-DR6 column alignment. Add an `intl-icu` runtime check to `townhouse hs up` preflight in a follow-up story. [packages/townhouse/src/tui/components/ActivityOverlay.tsx:13]
- W6: `[a]` → quick `q` race during overlay `useInput` registration cycle. Ink's input dispatch is synchronous on stdin readable, but `useInput` registration is async via `useEffect`. Same-batch `[a][q]` keypresses can drop the `q`. `app-keybindings.test.tsx` already works around with `setTimeout(50ms)` between keys — evidence the race exists. Hard to fix without a global keybinding dispatcher above both surfaces. [packages/townhouse/src/tui/App.tsx:26-32 + ActivityOverlay.tsx:60-72]
- W7: Keybinding tests rely on `setTimeout` delays not `act()`/flush primitives. `ink-testing-library` does not expose `act()`. Heavy-loaded CI (Anvil + Solana + Mill containers) may flake on the 50ms guards. Fix would need either a longer delay, fake timers (contract change), or a Townhouse-side `flushInk()` helper. [packages/townhouse/src/tui/app-keybindings.test.tsx:430-498]
- W8: `MIN_OVERLAY_WIDTH = 40` causes row wrapping at narrow terminals. Longest row is ~55 cols; at modal width 40 (the clamp floor), Ink wraps to 2 lines per claim, halving effective `visibleRows` and shifting scroll math. UX-DR6 covers 80ch and 120ch but not <56-col degradation. The `columns=40` test only asserts the title appears — doesn't detect wrapping. Document the <56-col contract in UX-DR6 as a follow-up; <56-col is below Townhouse's documented `80×24` baseline. [packages/townhouse/src/tui/components/ActivityOverlay.tsx:7]

## Deferred from: code review of 48-3-youre-early-badge (2026-05-14)

- UX-DR1 row-budget completeness — `_bmad-output/design/townhouse-tui-wireframe.md:10` documents only the badge-visible case (11/13). The non-visible case (10/14) is not stated. Cosmetic doc gap; no impact on code or design intent. Defer until UX-DR1 sees its next structural edit. [_bmad-output/design/townhouse-tui-wireframe.md:10]

## Deferred from: code review of 48-1-ink-tui-scaffold-with-hero-band-and-empty-state-foundation (2026-05-13)

- W1: No automated tmux capture-pane fixture. AC #7 reads as automated ("spawn under `tmux new-session -d -s test`, assert `\x1b[?1049h` NOT emitted"); dev relegated to manual Task 10.5 (`[ ]` unchecked at close). Add `__integration__/tmux-altscreen.test.ts` once a docker-based tmux runner is wired into CI. [packages/townhouse/src/__integration__/ — missing fixture]
- W2: `patchConsole: false` may leak connector/docker logs into rendered TUI frame. Spec-mandated for tmux alt-screen avoidance (AC #7 + Dev Notes "tmux Compatibility"). Reconciliation between "no alt-screen" and "no log corruption" needs Sally + a real tmux smoke before decision. [packages/townhouse/src/tui/index.ts:14]
- W3: `App.tsx` loading branch returns bare `<Text>` outside the column layout, briefly breaking the row-budget reservation (~30ms window pre-first-fetch). Consider rendering hero-with-zeros + a `Banner({ bannerKey: 'loading' })` instead. [packages/townhouse/src/tui/App.tsx:20-22]
- W4: `Banner` not wrapped in `<Box>` — wraps to 2 rows if copy text exceeds 80ch. Fits today (longest banner ~69 chars); fragile to copy edits. [packages/townhouse/src/tui/components/Banner.tsx:16]
- W5: `useEarnings` effect deps include `fetchImpl`; passing inline arrow restarts the interval every render. `mountTui({})` doesn't hit this in production; test mocks are stable. Add `useRef` capture once a real caller passes an inline fetcher. [packages/townhouse/src/tui/use-earnings.ts:107]
- W6: Race between `abortController = null` in `finally` and the next interval tick's `doFetch`. Bounded by `cancelled` flag at fetch entry, so the worst case is a non-aborted in-flight that no longer mutates state. [packages/townhouse/src/tui/use-earnings.ts:41-90]
- W7: No min-width gate in `shouldRenderInk` — a 20-column terminal renders unreadable layout instead of falling back to non-TTY ribbon-only output. Component-level degrade ladder covers ≥40ch reasonably; entry-gate min-width is a UX call. [packages/townhouse/src/tui/tty-detect.ts]
- W8: Ribbon vs Ink stdout race window between `ribbon.start('live', hostname)` and `mountTui()`. Ribbon's `'live'` is a one-shot print; not animated. If a future refactor adds ongoing ribbon writes, the two will fight for stdout. [packages/townhouse/src/cli.ts:1074-1083]
- W9: SIGINT cleanup ordering — Ink's `exitOnCtrlC: true` resolves `waitUntilExit()` and the parent `finally` runs `walletManager.lock()`. Node's default SIGINT could in theory exit-first; observed stable, but no explicit `process.once('SIGINT', deferShutdown)` wrapper. [packages/townhouse/src/cli.ts:1079-1092]
- W10: `vi.mock('./tui/index.js')` vs dynamic `import('./tui/index.js')` — Vitest path-resolution works by happy coincidence (both specifiers normalize to the same absolute path). A future refactor to `'../tui/...'` or no-extension would silently un-mock. Add `vi.isMockFunction(mountTui)` after the dynamic import to make the contract explicit. [packages/townhouse/src/cli.hs.test.ts:5,23-29]
- W11: `RecentClaim` re-exported in `tui/types.ts` and seeded in `EMPTY_EARNINGS` but never rendered in this story. Intentional staging for Story 48.4 Activity overlay; revisit when 48.4 lands. [packages/townhouse/src/tui/types.ts:2]
- W12: `vitest.config.ts` `exclude: ['src/__integration__/**']` doesn't cover hypothetical `.tsx` integration tests. None exist today; tighten the glob if/when needed. [packages/townhouse/vitest.config.ts:6]
- W13: `CI === 'true'` strict equality misses CI providers using `CI=1` etc. Mirrors the `onboarding-ribbon.ts` precedent per spec Task 1.2; cross-cutting tightening for both files at the same time. [packages/townhouse/src/tui/tty-detect.ts:3]
- W15 (P23 deferred from patch pass): `copy-sync.test.ts` uses `markdown.includes(value)` — substring match. Anti-pattern doc says "verbatim (backtick-wrapped)" but the test doesn't enforce backticks/fences. Tighten to either `\`<value>\`` inline OR fenced block once the markdown table section is restructured. [packages/townhouse/src/tui/copy-sync.test.ts:34]
- W14: Production `$?.??` fallback for malformed `formatUsdc` input silently hides upstream bugs. Intentional defensive posture per Task 7.1 — but the cost (silent malformed display vs crash) is asymmetric. Consider emitting a one-shot `console.error` (after the TUI exits) or routing through a telemetry hook. [packages/townhouse/src/tui/format.ts:4-7]

## Deferred from: code review of 46-4-live-e2e-gate-lazy-peer-node-provisioning (2026-05-11)

- `waitForExit` resolves on the `'exit'` event but Node only guarantees stdout pipe drain by `'close'`. Single-line JSON outputs rarely flake, but a chatty CLI or loaded runner can produce a truncated `lastLine` → `JSON.parse('')` failure. Shared helper used by every integration test. [packages/townhouse/src/__integration__/_test-helpers.ts:127-139]
- `cleanupContainersAndVolumes` depends on GNU `xargs -r`. BSD `xargs` (macOS default) lacks the flag; on empty match the pipe invokes `docker rm -f` with no args and exits non-zero. Try/catch masks it. Same pattern in `townhouse-hs-up.test.ts:54-91`; cross-cutting fix. [packages/townhouse/src/__integration__/townhouse-node-lifecycle-e2e.test.ts:84-87]
- Test 5 (idempotent re-up) lacks positive proof the fast path was taken. Container *names* are preserved across a cold boot, so a regression that silently falls through to cold-boot and completes in ≤30 s would pass. Compare container IDs or assert on stdout idempotency marker. [packages/townhouse/src/__integration__/townhouse-node-lifecycle-e2e.test.ts:347-380]
- Poll-loop iteration time vs budget in test 2. Each iteration spends ~1–3 s spawn + `waitForExit(10s)` + `sleep(2s)`. On a loaded CI box only 3–5 iterations may fit in the 30 s deadline. Mitigations: backoff, longer per-iteration budget. [packages/townhouse/src/__integration__/townhouse-node-lifecycle-e2e.test.ts:257-279]
- `hs up` re-run 30 s budget ignores cold-boot fallback. If the connector transiently reports `hostname: null` between tests, the idempotency probe falls through to cold-boot which has no inner budget — the 30 s `waitForExit` SIGKILLs mid-boot, corrupting state for `afterAll`. Low probability. [packages/townhouse/src/__integration__/townhouse-node-lifecycle-e2e.test.ts:353-359]
- `dockerPs` / `volumeExists` `execSync` calls have no timeout. A hung dockerd freezes the test until vitest's outer budget kills the worker, producing "test exceeded timeout" instead of "docker ps hung". Adding `timeout: 15_000` improves diagnostics but drifts from the `townhouse-hs-up.test.ts:54-91` template; cross-cutting decision. [packages/townhouse/src/__integration__/townhouse-node-lifecycle-e2e.test.ts:66-80]
- `runCli` `stderr` buffer is declared on `RunCliResult` but never populated. `stdio: ['ignore', 'pipe', 'inherit']` means stderr inherits to the runner's TTY but isn't attached to assertion-failure messages. Shared helper issue. [packages/townhouse/src/__integration__/_test-helpers.ts:62-118]

## Deferred from: code review of 45-3-docker-orchestrator-profile-param (2026-05-10, round 3)

- `up()` mutates `this.activeNodes` before HS-path validation rejects unknown profiles — pre-existing pattern in dev path; HS-path's new `OrchestratorError` for unknown profile types interacts with it but doesn't fundamentally change the picture. [packages/townhouse/src/docker/orchestrator.ts:279,320-334]
- `upHs` does not roll back successfully-started compose containers when `waitForHsHostname` later times out — operator must `townhouse hs down` manually before re-invoking. Story 45.4 retry-policy territory. [packages/townhouse/src/docker/orchestrator.ts:343-376]
- `surfaceComposeFailure` pattern 3 hardcodes `townhouse-hs-` container-name prefix — silently dead code for operators who set `COMPOSE_PROJECT_NAME`. [packages/townhouse/src/docker/orchestrator.ts:389]
- Integration test `docker ps --filter name=townhouse-hs-` is a substring filter — pollutes on a host with leftover state or a parallel townhouse stack. [packages/townhouse/src/__integration__/orchestrator-hs.test.ts:90,107]
- HS `up()` ENOENT path attributes failure to "docker CLI not found on PATH" — could equally mean the compose plugin is missing. [packages/townhouse/src/docker/orchestrator.ts:360-361]
- `runDockerCompose` silently drops stderr chunks past 16 MB without truncation marker. [packages/townhouse/src/docker/orchestrator.ts:78-83]
- HS `waitForHsHostname` "polls until non-null" unit test uses real timers (~6 s wall clock) — slows CI marginally, correctness fine. [packages/townhouse/src/docker/orchestrator-hs.test.ts]
- `waitForHsHostname` deadline can overrun the advertised 120 s by ~7 s when each request takes ~5 s and the deadline check happens before the call. [packages/townhouse/src/docker/orchestrator.ts:419]
- `waitForHsHostname` uses `Date.now()` for the deadline — laptop suspend/resume + system clock backward jump can extend the timeout indefinitely. Future hardening (`process.hrtime.bigint()`). [packages/townhouse/src/docker/orchestrator.ts:414,419]
- `downHs` is not idempotent when nothing is running — exits 0 with WARN on some Compose versions, exits 1 on others. CLI consumers (Story 45.4) need to handle gracefully.
- `downHs` 60 s timeout may be tight for 3-peer HS stacks where each container's SIGTERM grace is 10 s. Tune on evidence. [packages/townhouse/src/docker/orchestrator.ts:570]
- HS-path fake-timer tests are sensitive to microtask ordering between `getHsHostname` mock resolution and `setTimeout` advance. Tests pass; refactor is style. [packages/townhouse/src/docker/orchestrator-hs.test.ts:660-685]

## Deferred from: code review of 44-4-connector-release-contract-cross-repo-doc (2026-05-08)

- Bare `CONNECTOR_MIGRATION.md` reference in body-identical mirror is a dangling reference from the connector-side reader's perspective (file lives only in town). Acceptable trade-off for byte-equivalence discipline; consider path-qualifying as `packages/sdk/CONNECTOR_MIGRATION.md (in toon-protocol/town)` in a future tightening pass. — [`packages/sdk/CONNECTOR_RELEASE_CONTRACT.md` `### Townhouse pin discipline`]
- No in-file breadcrumb in connector source pointing to the town mirror — the asymmetric `tail -n +4` discipline lives entirely inside the doc body (`## Verification` section). A single HTML comment at the top of the connector file (`<!-- Mirrored at toon-protocol/town:packages/sdk/CONNECTOR_RELEASE_CONTRACT.md -->`) would make the relationship discoverable without breaking the diff invariant. Follow-up commit on the connector side. — [`/home/jonathan/Documents/connector/CONNECTOR_RELEASE_CONTRACT.md:1`]
- `image-manifest.json` referenced in present tense in the new `### Townhouse pin discipline` paragraph; the file does not yet exist (Story 45.1 will produce it). Forward-applying language is the explicit intent — verb tense to be revisited when 45.1 lands. — [`packages/sdk/CONNECTOR_RELEASE_CONTRACT.md` `### Townhouse pin discipline`]
- PATCH-bump exception clause "...unless the patch fixes a behavior townhouse actively relied on being broken" is unfalsifiable. Reviewer cannot apply mechanically. Could be tightened to a procedural gate (e.g., "...unless the contract canary turns red on the new digest"). Cross-repo follow-up. — [`packages/sdk/CONNECTOR_RELEASE_CONTRACT.md` `### Townhouse pin discipline`]

## Resolved from: code review of 44-4-... (2026-05-08, post-merge polish cycle)

_Six cross-repo patches (P3, P4, P5, P6, P7, Q1) shipped in lock-step via [connector#68](https://github.com/toon-protocol/connector/pull/68) + [town#36](https://github.com/toon-protocol/town/pull/36) on 2026-05-08. Body-equivalence diff returned empty post-merge. Resolved._

## Deferred from: code review of 21-15-ator-privacy-transport-and-connectivity-status (2026-05-01)

- AC-5 validateConfig round-trip failure path untested — implementation is correct, only the assertion is missing. [packages/townhouse/src/api/routes/transport.ts:146-161]
- AC-3 rollback test asserts mock `saveConfig` call count, not actual on-disk reversion — true integration test would need a temp filesystem. [packages/townhouse/src/api/routes/transport.test.ts:278-297]
- No-op detection runs before mutex acquire (AC-3 ordering deviation) — no mutation occurs and AC accepts either ordering operationally. [packages/townhouse/src/api/routes/transport.ts:120-131]
- Concurrent GET during PATCH torn read — single-machine sub-Hz operation; consequence is one stale poll. [packages/townhouse/src/api/routes/transport.ts]
- PATCH allows `activeNodes === []` (connector restart with no peers) — pre-existing pattern shared with nodes-patch.ts. [packages/townhouse/src/api/routes/transport.ts:167-169]
- Module-level mutex potential dual-import (esm/cjs) — pure-ESM monorepo; only manifests under future bundler change. [packages/townhouse/src/api/config-mutex.ts]
- `<TransportStatusPanel>` `lastProbedAt > 24 h ago` renders as "500 hr ago" — only manifests if probe is broken (its own surfaced state). [packages/townhouse-web/src/components/TransportStatusPanel.tsx:7-14]
- `<SettingsView>` no-op success has no user feedback — Save button disable handles the practical case. [packages/townhouse-web/src/views/Settings.tsx]
- AC-20 SPA-side `import.meta.env.DEV` guard absent — server-side hook in dev API server is equivalent (script never ships in production builds). [packages/townhouse-web/scripts/api-server.mjs]
- Massive prettier reformatting drift across 60+ files — required by Dev Notes "Lint/format after every set of file edits"; no semantic changes detected in sampled files.

## Deferred from: code review of 21-13-dashboard-wallet-and-keys-view (2026-04-30)

- Multi-chain RPC mapping (per-`nodeType` RPC URL) for non-EVM withdrawal — story is EVM-only single-RPC v1 per Dev Notes § Withdrawal scope; revisit when Solana/Mina send-side lands. [packages/townhouse/src/api/routes/wallet-withdraw.ts]
- Burn-address (`0x0000…0000`) confirm step in WithdrawModal — devtool scope, not blocking. [packages/townhouse-web/src/components/WithdrawModal.tsx step 3]
- Self-send warning when `recipient === wallet address` — not in spec. [packages/townhouse-web/src/components/WithdrawModal.tsx step 3]
- Cache key including `rpcUrl` for multi-RPC environments — single-RPC v1. [packages/townhouse/src/api/routes/wallet-balances.ts]
- Mnemonic JS-string secure-zero (true buffer wipe) — JS string immutability; spec's "zero out from React state" is met. Future hardening would need a `Uint8Array` shape end-to-end (route → JSON → React). [packages/townhouse-web/src/components/RevealSeedModal.tsx]
- `formatDerivationPath` hard-codes account-index at split-slot 3 — works for current BIP-44 schemas (EVM/Nostr/Solana/Mina). Future-proof if a non-standard path is added. [packages/townhouse-web/src/components/AddressBlock.tsx]
- `keyInfo.solanaAddress`/`minaAddress` for non-mill nodeTypes silently ignored — current spec only Mill exposes those chains. [packages/townhouse/src/api/routes/wallet-balances.ts task generation]
- Reveal endpoint rate-limit / brute-force backoff — Threat model § acknowledges localhost-only mitigation; needed if remote bind becomes supported. [packages/townhouse/src/api/routes/wallet-reveal.ts]
- Solana/Mina RPC hung-task wedge — 3 s per-fetch timeout already; aggregate circuit-breaker is future hardening. [packages/townhouse/src/chain/{solana-rpc,mina-graphql}.ts]
- AddressBlock `<details>` `aria-expanded` mirroring — browser handles natively today; revisit if assistive-tech reports gaps. [packages/townhouse-web/src/components/AddressBlock.tsx]
- USDC-capture script `tail -n1 | sed` parsing brittleness — works with current `deploy-mock-usdc.sh` output format. Harden if the deploy script signature changes. [scripts/townhouse-dev-infra.sh:160-176]

## Deferred from: code review of 21-12-dashboard-dvm-management-view (2026-04-30)

- PATCH `/api/nodes/dvm/config` is type-level not instance-level — slider on `dev-dvm-01` card applies to all DVM nodes. `void nodeId` comment in the diff acknowledges. The 21.11 multi-instance refactor scoped health/swaps/deposit-addresses by `:nodeId` but did not refactor PATCH. Promote to per-instance scope in a future story. [packages/townhouse-web/src/views/Dvm.tsx handleApplyKindFee, packages/townhouse/src/api/routes/nodes-patch.ts]
- `useDvmJobsRecent` polling doesn't pause when tab is backgrounded — codebase-wide pattern (no other hook gates on `document.visibilityState`). Address as a cross-cutting improvement. [packages/townhouse-web/src/hooks/useDvmJobsRecent.ts:84]
- Refetch + interval-tick race may overwrite fresh data with stale; add monotonic request id. [packages/townhouse-web/src/hooks/useDvmJobsRecent.ts:54-95]
- `BigInt(entry.amount)` throws on non-decimal amount strings — connector contract concern; current connector emits decimal strings only. [packages/townhouse/src/api/routes/nodes.ts:602,610]
- Connector-down asymmetry: `swaps/recent` returns 200/empty, `jobs/recent` returns 503. Reconcile in a future tidy-up. [packages/townhouse/src/api/routes/nodes.ts:539-549 vs :436-447]
- `windowSec=0050` leading-zero passes regex — cosmetic. [packages/townhouse/src/api/routes/nodes.ts:867-882]
- Number → BigInt precision loss for `kindPricing` values > MAX_SAFE_INTEGER — rare (>9 quadrillion fees). [docker/src/entrypoint-dvm.ts:424-426]
- `primaryKind.reduce` ties broken by insertion order (non-deterministic) — cosmetic; tie-break by `kind` ascending if needed. [packages/townhouse-web/src/views/Dvm.tsx:147-150]
- Static-analysis tests duplicated between `dvm-dockerfile.test.ts` and `entrypoint-dvm.test.ts` — pre-existing pattern (mill has same dual-test setup). [packages/townhouse/src/docker/dvm-dockerfile.test.ts:1112-1137, docker/src/entrypoint-dvm.test.ts:1443-1469]
- `KIND_PRICING_0=N` silently accepted (kind:0 is Nostr profile metadata, not a DVM job kind) — no functional harm; UI iterates handlerKinds (won't include 0). [docker/src/entrypoint-dvm.ts:308-316]
- Counter `processing` not decremented on unhandled rejection inside the wrapped handler — Promise wrapping in v1 catches all rejections; real risk only if handler launches fire-and-forget work that throws. [docker/src/entrypoint-dvm.ts:83-96]
- Clock skew / non-monotonic `Date.now()` breaks event eviction invariant — rare NTP step. [docker/src/entrypoint-dvm.ts:76-81]
- AbortError on timeout briefly flips status loading→error→ready — minor UX flicker. [packages/townhouse-web/src/hooks/useDvmJobsRecent.ts:67-78]
- `DvmFeeSlider` `isDirty` microtask race — drag during success-path setIsDirty(false) — rare race window. [packages/townhouse-web/src/views/Dvm.tsx:2537-2539]
- `/jobs/recent` returns 200/zero with no degraded indicator when ilpAddress is missing — caller can't distinguish "no jobs" from "address unknown"; consider a `degraded: true` field in a future tidy-up. [packages/townhouse/src/api/routes/nodes.ts:928-939]
- Health response cached without shape validation — improvement not bug; container-side trust boundary. [packages/townhouse/src/api/routes/nodes.ts:909-911]
- VITEST env-var gate is fragile — use `import.meta.url === pathToFileURL(process.argv[1]).href` if a different test runner is ever introduced. [docker/src/entrypoint-dvm.ts:247-255]

## Deferred from: code review of 21-11-dashboard-mill-management-view (2026-04-30)

- Fee slider doesn't proactively transition the card to `loading` while the PATCH is in flight; transition is purely WS-driven (`connectorRestarting` / `connectorRestarted`). Matches the 21.10 TownView pattern explicitly referenced by AC-16; changing this view alone would diverge from the precedent. Re-evaluate if a unified loading approach is adopted across both views. [packages/townhouse-web/src/views/Mill.tsx MillFeeSlider]
- `/nodes/:type/packets/timeseries` and `/nodes/:type` (and `useNodeMetrics`/`usePacketTimeseries`) are still per-type, so the volume chart and current-fee aggregate across all mill instances. The 21.11 multi-instance refactor only covered health / swaps/recent / deposit-addresses. Promote these to per-instance scoping in a future story when DVM views land.

## Deferred from: code review of 21-10-dashboard-town-management-view (2026-04-30)

- `getPacketLog` 404 detection via error message string matching — `msg.includes('404')` on the thrown error string works for all realistic cases; refactor to status-code inspection if `ConnectorAdminClient.fetch()` is ever restructured to not throw on non-200 responses. [packages/townhouse/src/connector/admin-client.ts:157]
- Double `regenerateConnectorConfig` when `enabled` flip + fee change arrive in one PATCH body — two sequential restarts in rapid succession; pre-existing in the 21.8 PATCH handler, not introduced by 21.10. [packages/townhouse/src/api/routes/nodes-patch.ts]
- Inline `rgba(0,0,0,0.06)` in `CartesianGrid` stroke — rgba is not hex; the `no-inline-hex` lint rule targets hex strings only and CI passes. Revisit if the rule is expanded to cover rgba/hsl. [packages/townhouse-web/src/views/Town.tsx:239]
- `getNodeRelayEndpoint` Docker-internal fallback (`ws://townhouse-<id>:7100`) unreachable when Townhouse API runs on the host — fallback is intentional for Townhouse-in-Docker (Oyster CVM) deployments; dev stack and production single-instance deployments use the port-binding path. [packages/townhouse/src/docker/orchestrator.ts:229]
- `useNodeMetrics` uses `nodeType` (e.g., `'town'`) not `nodeId` (e.g., `'town-01'`) — both Town cards show identical metrics; per-instance isolation requires a new `/api/nodes/:type/:id` API surface (future story). [packages/townhouse-web/src/views/Town.tsx:331-332]
- Bandwidth always `null`/`'—'` in dev stack — `GET /nodes/:type/bandwidth` builds container name as `townhouse-town` but dev stack containers are named `townhouse-dev-town-01`; works correctly in single-instance production. [packages/townhouse/src/api/routes/nodes.ts:291]

## Deferred from: code review of 21-7-5-connector-version-sweep-and-contract-canary (2026-04-29)

- SOCKS_PROXY empty-string is inconsistent: `ConnectorConfigGenerator.generate()` keeps an empty `socksProxy` in the runtime config (`?? DEFAULT_ATOR_PROXY` only kicks on null/undefined), but `toEnvVars()` then drops the key via a truthy check. Pre-existing in `config-generator.ts`; story does not modify that file. [packages/townhouse/src/connector/config-generator.ts]
- `ConnectorAdminClient.getPeers()` returns typed `PeerStatus[]` but does not validate per-element shape — `[null]` / `[42]` / `[{ totally: 'random' }]` pass `Array.isArray()`. Story explicitly scope-excludes admin-client modifications; future fix should align with the admin-client path/shape gap already documented in `CONNECTOR_MIGRATION.md §Known Contract Gaps`. [packages/townhouse/src/connector/admin-client.ts:77-84]
- `inspect()` race: on slow systems (Docker-on-Mac VM, CI under load), `start()` resolves on container-state=running, not on port-forwarding-complete. `Ports['9401/tcp']` may be `null` momentarily; `expect.toBeTruthy()` fires on transient race rather than real regression. Speculative — address if it actually flakes. [packages/townhouse/src/__integration__/connector-image-contract.test.ts:139-150]
- `getHealth()` validator accepts `NaN`/`Infinity`/negative `uptime` (`typeof NaN === 'number'`). A buggy connector emitting `NaN` (divide-by-zero) silently propagates to consumers. Pre-existing in admin-client. [packages/townhouse/src/connector/admin-client.ts:40-47]
- Stub canary lacks coverage for empty / single-element / very-large `activeNodes` cases. The story's spec required a specific 3-node case and a SOCKS_PROXY case; broader coverage was not in scope. [packages/townhouse/src/connector/contract-canary.test.ts]
- No escaping of pathological values (NUL byte, newline) in `toEnvArray()` joining `${KEY}=${VALUE}`. dockerode passes verbatim to the kernel which interprets NUL as terminator. Pre-existing in config-generator. [packages/townhouse/src/connector/config-generator.ts:81-84]
- Image-pull has no `AbortController` / retry / timeout. A hung pull blocks `beforeAll` for the full 30s; vitest then aborts mid-pull leaving partial layers. Pre-existing pattern; address with a CI-side image-prepull step if flakiness emerges. [packages/townhouse/src/__integration__/connector-image-contract.test.ts:76-92]

## Deferred from: code review of 22-5-connector-interface-contract-smoke-test (2026-04-28)

- Action pinning is half-applied in `.github/workflows/test.yml` — new canary job pins to commit SHAs (OWASP A08), pre-existing jobs in the same file still use floating `@v4` tags. Either the threat is real for the whole file or the rationale is theatrical. Tracked for a follow-up workflow-wide pinning sweep.
- Vitest filename filter `pnpm test:integration -- tests/integration/connector-contract.test.ts` is a substring match. A rename of the canary file without updating the CI command would silently run the entire integration suite under the 5-minute cap and time out as a false-red.
- No `beforeEach`/`afterEach` teardown of `vi.fn` mocks in `connector-contract.test.ts`. Speculative — not a bug today; matters only if shared module mocks are added later.

## Deferred from: code review of 21-7-dvm-node-dockerfile (2026-04-21)

- Health check doesn't verify JSON response — Static test cannot validate runtime health endpoint behavior, requires actual Docker run
- Process.env secret deletion ineffective — This is how Node.js works - env vars are process-local. True secrets require Docker-level handling which is out of scope
- rot-js dependency not explicitly bundled — Relies on transitive inclusion through pet-dvm, can verify at Docker build time

## Deferred from: code review of 21-8-fastify-rest-websocket-metrics-api (2026-04-21)

- `saveConfig` re-validates full config on every write — migration hazard if future required fields are added (config-schema evolution concern, not 21.8) [packages/townhouse/src/config/loader.ts]
- `saveConfig` atomic-rename cross-device / Windows semantics — Townhouse is Linux-first per epic scope
- Module-level `isMutating` + `resetConfigMutex` test-seam export — behaviorally correct for single-process v1; refactor into factory-scoped closure [packages/townhouse/src/api/routes/nodes-patch.ts]

## Deferred from: code review of 21-8-fastify-rest-websocket-metrics-api (2026-04-21)

- `cli.test.ts:114-115` and `cli-wallet.test.ts:95-96` MockInstance generics mismatch — pre-existing vitest typing issue unrelated to 21.8.
- `connector/config-generator.test.ts:93,194` possibly-undefined access — pre-existing.
- `wallet/manager.test.ts:229,232` index-signature cast — pre-existing.
- `buildCorsOptions` omits `HEAD` from methods — low severity; no caller uses HEAD today.
- `server.ts` error handler leaks `error.message` outside production — matches spec Dev Note intent (log full error server-side, return safe message); message leak is low risk given loopback-only bind.

## Deferred from: code review of 22-4-fix-sdk-solana-settlement-e2e (2026-04-28)

- Mixed commitment levels — `getAccountInfo` upgraded to `'confirmed'`, but `getLatestBlockhash` / `requestAirdrop` retain defaults; theoretical flake source [packages/sdk/tests/e2e/docker-solana-settlement-e2e.test.ts]
- Account index u8 wraparound at >255 accounts in legacy-message serializer [packages/sdk/tests/e2e/docker-solana-settlement-e2e.test.ts]
- `compactU16Size` / `writeCompactU16` invariant lacks runtime assert at slice point — risks silent corruption if future divergence
- `.env.sdk-e2e` parser doesn't handle quoted values, comments, or whitespace-padded values [packages/sdk/tests/e2e/helpers/docker-e2e-setup.ts:90]
- Hand-rolled base58 encoder — all-zero pubkey returns `'1'`, no validation [packages/sdk/tests/e2e/helpers/docker-e2e-setup.ts:104-131]
- Module-load side effects — `loadSdkE2eEnv()` runs once at import, `SOLANA_PROGRAM_ID` is a resolved-once `const`; stale across vitest worker re-imports [packages/sdk/tests/e2e/helpers/docker-e2e-setup.ts:102,134]
- `expect(channelAfterSettle).toBeNull()` assumes connector v3.3.2 closes the channel account on settle — semantic shift from prior `state==='settled'` check; should be confirmed against connector source
- Auto-keypair `--bpf-program` branch in entrypoint passes `.so` as both address and program path [infra/solana/entrypoint.sh:29] — only triggers when `*-keypair.json` missing
- `deriveSolanaProgramIdFromKeypair` returns `'1'` (system program) for all-zero pubkey input [packages/sdk/tests/e2e/helpers/docker-e2e-setup.ts:127]
- `discoverProgramId` returns first program from RPC enumeration order — fragile if multiple BPF programs are loaded [packages/sdk/tests/e2e/docker-solana-settlement-e2e.test.ts]


## Deferred from: code review of 21-6-1-mill-review-findings-remediation (2026-04-29)

- Shutdown test `emitAndAwaitShutdown` yields one `setImmediate` tick — sufficient with trivial mock, brittle if `stop()` ever does real async work. Consider `vi.waitFor()` pattern.
- `process.removeAllListeners` in `afterEach` is indiscriminate — silently removes any future Vitest or plugin signal handlers registered on the worker. Scope to known test-registered listeners.
- `applyEnvOverlay` regression sanity test uses `as never` cast, suppressing compile-time type-checking on the stub input.
- `Dockerfile.mill` `LABEL version="1.0.0"` is a hardcoded literal — not parameterized via `--build-arg`. Every image build reports 1.0.0 regardless of actual package version.
- `MILL_CONFIG_PATH` file containing the string `"null"` bypasses the empty-file guard and produces a raw `TypeError` from `parseRawConfig` instead of a wrapped error.
- AC-5 line citations in `21-6-mill-node-dockerfile-review-findings.md` drifted ~6 lines after prettier pass (`b161cd4`) — `delete` cited at `:188-189` actual `:195`; `SIGQUIT` cited at `:335` actual `:354`.

## Deferred from: code review of 21-8-0-townhouse-dev-infrastructure (2026-04-29)

- SOCKS5 service has no healthcheck — silent failure if port collision; only consumed by story 21.15 (ATOR transport).
- `MILL_RELAYS` env in `docker-compose-townhouse-dev.yml:303,343` duplicates fixture `relayUrls` and overrides via `applyEnvOverlay`; Dev Agent Record acknowledged the intentional override.
- `dev-fixtures.test.ts:66-67` validates `cumulativeAmount`/`nonce` with `Number()` — loses precision >2^53; current fixture values fit safely.
- Smoke test workspace-root resolution via four-level relative path (`dev-stack-smoke.test.ts:45`) is fragile to file relocation but currently correct.
- Anvil compose entrypoint and host `deploy-mock-usdc.sh` both attempt USDC deploy; resolved as part of patch finding #7 if user opts to drop the host call.

## Deferred from: code review of 21-8-5-dashboard-design-system-foundation (2026-04-29)

- `Home.tsx` placeholder lacks AbortController, no `r.ok` check, possible duplicate-type key collision — placeholder for 21.9-lite (`packages/townhouse-web/src/pages/Home.tsx:24-32`).
- `chart.tsx` uses `dangerouslySetInnerHTML` with developer-controlled color values — shadcn-generated; revisit when user-controllable colors are introduced.
- `tsconfig.build.json` excludes `src/components/ui/**` from typecheck — known shadcn `@ts-nocheck` workaround; revisit when shadcn types stabilize.
- `no-inline-hex` `TemplateLiteral` regex is unanchored — would false-positive on URI-like strings containing `#abc...`; no current call sites trigger it.
- `no-direct-recharts` doesn't catch CJS `require('recharts')` — codebase is ESM-only; defer until/unless CJS is introduced.
- `no-positive-letter-spacing-geist` regex allow-list permits `tracking-tight-${anything-positive}` — current tokens are all negative by design.
- Storybook `viteFinal` spreads `viteConfig.resolve.alias` as object — Vite supports array form too; would drop existing aliases. Revisit if Storybook ever adds array-form aliases.
- `MetricBlock` `value: number` not localized via `toLocaleString()` — caller responsibility per spec; consider adding a `format` prop in a future view story.
- `dev-docker.mjs` doesn't explicitly forward parent SIGINT/SIGTERM — `concurrently --kill-others` + `shell: true` handle it in practice; tighten if orphan processes appear in smoke testing.
- `index.css` font URLs use `../node_modules/geist/...` — fragile to pnpm hoisting changes; pinned to pnpm 8.15.0 currently. Switch to `import 'geist/...?url'` if hoisting drifts.

## Deferred from: code review of 21-9-dashboard-spa-home-view (2026-04-29)

- AC-3 hook surface keying differs from spec (`useNodeStatusStream` returns `statesByName: Record<string, string>` rather than `Map<NodeType, NodeState>`). Documented in Dev Notes "Implementation Plan" #2 as deliberate. Revisit if a stricter type contract is needed for richer view stories.
- AC-5 transport-status indicator is static (reflects configured `transport.mode` only, not live ATOR proxy reachability). Gated behind story 21.15 per spec's plumbing-decision clause; TODO comment in `Home.tsx:866-869`.
- AC-9 (live-Docker screenshot) and AC-10 (`docker pause townhouse-dev-town-02` degraded demo) — explicit PR-review gate per spec. Dev Agent flagged that the dev-stack container-name caveat may block AC-10 until 21.14 fixtures land or the orchestrator is wired to dev fixtures.

## Deferred from: code review of 21-14-first-run-setup-wizard (2026-05-01)

- AC-13 `<WizardHeader>` component / left-aligned breadcrumb missing — inline progress indicator satisfies the user-facing requirement; resolution depends on Decision-needed item in story file (extract component or amend AC).
- Per-step component test files absent (`WizardStepNodes.test.tsx`, `WizardStepWallet.test.tsx`, `WizardStepPrivacy.test.tsx`, `WizardStepFees.test.tsx`, `WizardStepLaunch.test.tsx`) — `Wizard.test.tsx` covers basic flows; per-step coverage of regenerate confirm-discard, password-mismatch caption, slider bounds, summary card, error-code mapping, axe assertions left for a follow-up test-coverage story.
- `cli/browser-opener.test.ts` not in diff — cross-platform spawn-arg shape coverage (`open` / `xdg-open` / `cmd /c start` per Dev Notes) absent; defer to a follow-up.
- `useWizardState` polls every 2s forever (even after `containers_running: true`) — wasted requests on idle Home view; bounded by SPA tab lifetime; consider stopping the poll once normal mode is stable.
- Mnemonic internal-multi-space + ZWSP/Unicode-invisible normalization on import — current `\s+` split handles common whitespace; uncommon paste paths fall through to a generic "Invalid BIP-39" error.
- AC-4 validation cascade order in impl differs slightly from spec list order (length before mismatch); both still produce a 400 with a `code`; tests don't pin ordering — align spec or impl in a future polish pass.

## Deferred from: code review of 45-2-embed-compose-templates-and-image-manifest-in-npm-tarball (2026-05-09)

- Concurrent `materializeComposeTemplate('hs')` calls race — `mkdirSync` + `chmodSync` + `writeFileSync` is non-atomic; no `tmp + rename` pattern. Low likelihood unless townhouse-api restarts during a CLI invocation.
- `defaultDistDir()` `import.meta.url` resolution assumes tsup output layout — fragile under future bundlers (esbuild/vite/webpack inlining the source). Forward-looking concern for Story 45.4+ when bundled CLI imports the loader.
- No idempotency guard on `pnpm publish` rerun — npm returns 409 if version already published. Workflow rerun on the same `v*` tag fails loudly but ungracefully. Add a pre-flight `npm view ... || pnpm publish ...` shim later.
- `tarball-contents.test.ts` parses `pnpm pack` stdout (`result.trim().split('\n').pop()`) — brittle if pnpm 9+ changes output format or adds trailing summary lines. Fallback `readdirSync` saves it; tighten to readdir-only when convenient.
- `DOCKER_AVAILABLE=1` env override skips real daemon probe in `compose-template-validity.test.ts` — when daemon is dead, test crashes after a 30s timeout instead of cleanly skipping. Add a pre-test `docker info --format '{{.ID}}'` probe.
- Lifecycle-script asymmetry between `pnpm pack` (verify step) and `pnpm publish` (live step) — `prepublishOnly` runs only on publish. If a future PR adds `prepublishOnly: pnpm build`, `tsup`'s `clean: true` wipes the manifest and ships unsubstituted YAML undetected. Add `--ignore-scripts` to the live-publish step.
- Brief TOCTOU readability between `writeFileSync(manifestPath, ..., { mode: 0o600 })` and the follow-up `chmodSync(manifestPath, 0o600)` — on filesystems where the mode option is umask-masked (WSL2), another local process can `open(O_RDONLY)` between the two calls. Marginal — manifest itself is not secret, but the same pattern is used for compose YAML which can carry env-injected secrets.
- `tsup.config.ts onSuccess` and `scripts/render-compose-template.mjs` duplicate the placeholder-substitution arrays (5 entries each). Drift risk when adding a 6th image — refactor to a shared `renderComposeTemplate(distDir, srcDir)` module imported by both.
- `pnpm pack --pack-destination` requires pnpm ≥ 8.4 (added in v7.18 actually — but `--filter` + `--pack-destination` interaction was solidified in 8.4). The workflow's `pnpm/action-setup` version is not visible in this diff — verify it's pinned to ≥ 8.4 to avoid silent flag-ignored failures.

## Deferred from: code review of 45-2-embed-compose-templates-and-image-manifest-in-npm-tarball — Round 2 (2026-05-09)

- D3-Patch port-collision documentation in HS template + README is technically incorrect — host ports HS/dev don't actually overlap. The "must not run concurrently" guidance is a reasonable defensive default but cite the right mechanism (canonical ports may collide with non-townhouse system services rather than each other).
- `describe.skipIf` inverted-logic sibling pattern in compose-template-validity.test.ts only emits a visible "skipped" line in the file-missing case; in the normal case (file present), the sibling describe is silently absent. Refactor to emit a single skip from inside the main describe.
- TOCTOU between manifest existence check and copy in `materializeComposeTemplate` (race with concurrent `pnpm install --force`). Low likelihood; consider switching to read-then-write pattern with single fs.readFile that throws on missing.
- `loadComposeTemplate` ENOENT race between `existsSync` check and `readFileSync` propagates raw `fs.Error` instead of wrapped `ComposeLoaderError`. Caller `catch (e instanceof ComposeLoaderError)` mis-routes.
- `compose-template-validity.test.ts` `0\.0\.0\.0:` reject misses YAML long-form `host_ip: 0.0.0.0\n` (no trailing colon).
- Connector image cache check in `connector-image-contract.test.ts` uses `includes(parsedRef.digest!)` — substring match where `endsWith('@' + digest)` would be safer.
- `tarball-contents.test.ts` afterAll cleanup deletes the tarball even on test failure, killing post-mortem inspection. Consider keeping the tarball when an assertion fails (vitest's task context exposes failure state).
- Manifest-alignment test path resolution via `import.meta.url + '../../dist/...'` is fragile under bundler reconfiguration. Same pattern is acknowledged in compose-loader.ts:30.
- `tarball-contents.test.ts` "freshness precondition" only checks `existsSync(DIST_COMPOSE_HS)` — stale dist (e.g., dev rebuilt last week, manifest changed since) passes the gate. Add mtime-vs-source comparison or a digest cross-check against current `image-manifest.json`.

## Deferred from: code review of 45-3-docker-orchestrator-profile-param (2026-05-09)

- README documents the anon-disabled error message verbatim — drift hazard between code and doc. Recommend exporting the message string as a const both code and doc reference. [`packages/townhouse/README.md` § "DockerOrchestrator Profiles"]
- Magic numbers (timeouts: 120_000 / 2_000 / 5_000 / 180_000 / 60_000; maxBuffer 16 MiB; stderr truncation 500) not named constants. [`packages/townhouse/src/docker/orchestrator.ts`]
- AC #5 ECONNREFUSED retry-within-budget path has no dedicated unit test — branch in `waitForHsHostname` swallows non-anon-disabled errors and continues, but no test asserts the retry behavior. AC #12 didn't enumerate this case. [`packages/townhouse/src/docker/orchestrator-hs.test.ts`]
- AC #12 "constructor stores profile/composePath" assertion is `instanceof`-only — private fields never observably verified. Consider `Object.getOwnPropertyDescriptor`/`@ts-expect-error` access or a behavior-driven check. [`packages/townhouse/src/docker/orchestrator-hs.test.ts:479-491`]
- Integration test container assertion uses substring `name=townhouse-hs-` filter — pollutes when host has leftover containers from prior runs. Use exact-name filter or list-and-include. [`packages/townhouse/src/__integration__/orchestrator-hs.test.ts:161-167`]
- Integration test relies on vitest `it`-order: third `it` calls `orch.down()` and asserts `townhouse-hs-anon` volume survives, while `afterAll` runs `down -v`. Order-dependence not enforced. [`packages/townhouse/src/__integration__/orchestrator-hs.test.ts`]
- `process.env['TOWNHOUSE_WALLET_PASSWORD']` mutated in `beforeAll` without try/finally restore — leaks across worker reuse if `beforeAll` throws between set and the matching `afterAll` delete. [`packages/townhouse/src/__integration__/orchestrator-hs.test.ts:129, :153`]
- No partial-failure rollback when `docker compose up` exits non-zero or times out — Node's `timeout` kills the CLI but dockerd keeps going, leaving a half-started stack. Story 45.4 retry policy will dictate whether to attempt `docker compose down` in the catch path. [`packages/townhouse/src/docker/orchestrator.ts:213-231`]
- User-visible `OrchestratorError` message truncates stderr to 500 chars; full stderr preserved on `error.stderr` field but human-readable diagnostic is gutted for multi-line compose YAML errors. [`packages/townhouse/src/docker/orchestrator.ts:228, :432`]
- `composePath` not validated as absolute or existing on disk at construct time — defense-in-depth gap. Current callers pass paths from `materializeComposeTemplate` so the gap is only relevant to direct API consumers. [`packages/townhouse/src/docker/orchestrator.ts:159`]
- Non-503 / non-200 statuses (404 from a connector pre-v3.5.0 without the endpoint, 500, 502) are silently retried for the full 120s budget. AC #5 specifies 503 fast-fail and ECONNREFUSED retry but is silent on other statuses; could fast-fail 404 with an actionable "connector pre-v3.5.0" diagnostic. [`packages/townhouse/src/docker/orchestrator.ts:284-294`]
- `activeNodes` mutated before `upHs/upDev` could fail — leaves stale state on error. Pre-existing in dev path; flagged for symmetry. Move assignment to after success or implement actual-state tracking in a follow-up. [`packages/townhouse/src/docker/orchestrator.ts:174`]

## Deferred from: code review of 46-1-nodes-yaml-schema-boot-reconciler-peer-type-resolver (2026-05-11)

- `deriveBtpUrl` uses `entry.type` not `entry.id` — collides for multi-peer-per-type. Already acknowledged in Implementation Notes; Epic 46.2 will persist operator-defined URLs into `nodes.yaml`. [`packages/townhouse/src/reconciler.ts:455-457`]
- Concurrent `hs up` invocations would interleave-corrupt `reconciler.log` via non-atomic `fs.appendFile`. Single-operator tool; concurrent invocations not supported. Revisit if a daemon/automation layer ever calls `hs up` from cron. [`packages/townhouse/src/reconciler.ts:115-127`]
- Reconciler ignores `ilpAddress` field-level mismatch — `diff()` only checks set membership of peerIds, not full equivalence. AC4 specifies "missing", not "mismatched". Epic 46.2 may extend to detect drift in routing fields. [`packages/townhouse/src/reconciler.ts:398-422`]
- `writeNodesYaml` does not `fsync` tmp file before rename — power-loss between rename and disk flush could leave a zero-byte yaml. Beyond AC9 scope; consider adding when first multi-host deployment requires durability guarantees. [`packages/townhouse/src/state/nodes-yaml.ts:902-918`]
- `writeNodesYaml` tmp-path collision under concurrent writers — fixed `${path}.tmp` filename. Same out-of-scope reason as the log-interleave item. [`packages/townhouse/src/state/nodes-yaml.ts:909-913`]
- `registerPeer` sends `authToken: ''` for internal Townhouse peers with no validation. Already acknowledged in Implementation Notes; Epic 46.2 may add real auth on internal peer URLs. [`packages/townhouse/src/reconciler.ts:380`]
- No bound on number of sequential `registerPeer` calls — 1000 yaml entries → 1000 sequential 5s-timeout HTTP calls (worst case ~83 minutes blocking apex boot). Scale concern beyond current personal-laptop target. Add concurrency limiter when first power-user with >50 peers shows up. [`packages/townhouse/src/reconciler.ts:372-391`]
- Symlink attack on `~/.townhouse/nodes.yaml` — `fs.rename` follows symlinks and `chmod` chmods the target. Mitigated today by `~/.townhouse` mode `0o700`. Add `O_NOFOLLOW` / `lstat` guard before first multi-user deployment. [`packages/townhouse/src/state/nodes-yaml.ts:65-79`]
- `readNodesYaml` has no file-size limit — operator-edited 1GB nodes.yaml would OOM the CLI. Operator-managed file is non-adversarial input today. Add `fs.stat` size cap if yaml ingestion ever opens to untrusted input. [`packages/townhouse/src/state/nodes-yaml.ts:36-50`]
- `reconciler.log` has no rotation — appends forever, grows unbounded over months of `hs up` invocations. Ongoing-maintenance concern; revisit when Epic 49 telemetry stack lands and a centralized log strategy exists. [`packages/townhouse/src/reconciler.ts:113-127`]
- (from D2 in 46.1 review) Idempotent `hs up` re-print path skips reconciler — current spec'd behavior keeps the re-print free of connector-state mutations, but means drift while apex stays up (e.g. connector restart) is unrepairable without `hs down && hs up`. Revisit when Epic 49 telemetry stack lands an always-on reconciler daemon, or earlier if operators report drift in the wild. [`packages/townhouse/src/cli.ts` `handleHsUp`]

## Deferred from: code review of 46-2-post-and-delete-api-nodes-host-api (2026-05-11)

- `getMnemonic()` is a public plaintext-string accessor returning a live reference; spec-mandated v1 surface but the captured ref outlives `lock()`. Harden when wallet-export flows are reworked or when a public-API consumer materializes. [`packages/townhouse/src/wallet/manager.ts:226-228`]
- `registerPeer` called with `authToken: ''` — in-network-only BTP convention for v1. Generate per-peer random token when the BTP port stops being network-namespace-isolated. [`packages/townhouse/src/api/routes/nodes-lifecycle.ts:370`]
- `stopNodeViaCompose` idempotent-stderr matcher is brittle (substring match against 3 fixed strings) — mirrors existing `downHs` pattern; revisit when first Docker Compose version bump breaks a benign "already-gone" detection in the wild. [`packages/townhouse/src/docker/orchestrator.ts:613-616`]
- `acquireNodeLifecycleMutex` is a per-process boolean — no flock against multi-process race. Single-process v1 constraint; add file lock when HA / sidecar CLI invocations become a real path. [`packages/townhouse/src/api/config-mutex.ts:18-23`]
- Mutex blocks all lifecycle ops (any type) for up to ~4 min during slow provisioning. Per-type mutex is forward work for Epic 47+. [`packages/townhouse/src/api/config-mutex.ts:39-50`]
- `removePeer` doesn't inspect response body for `success: false` shape — connector contract guarantees 2xx = removed today; defensive body-check if connector API ever changes. [`packages/townhouse/src/connector/admin-client.ts:329-379`]
- Atomic-write `.tmp` orphan on ENOSPC mid-write — pre-existing in `writeNodesYaml` from Story 46.1. Add tmp-cleanup catch when first disk-full incident surfaces. [`packages/townhouse/src/state/nodes-yaml.ts:97-112`]
- `waitForHealthy` does not validate URL once before polling — URL is constructed from constants today, but a future operator-configurable port could pass a malformed URL and burn the full 60s. [`packages/townhouse/src/api/routes/nodes-lifecycle.ts:67-88`]
- Mnemonic-in-heap window — `lock()` zeros `state.mnemonic` but previously-captured refs (e.g. inside an in-flight env object) persist until GC. Spec accepts the trade-off; revisit if mnemonic-disclosure incidents materialize.
- `surfaceComposeFailure` regex may miss some compose container-name shapes (no project prefix, very short names). Existing pattern; bundle with `downHs` matcher next time compose stderr format changes. [`packages/townhouse/src/docker/orchestrator.ts:430-460`]
- Healthcheck URL only resolves via Docker DNS — `townhouse-api` runs inside `townhouse-hs-net`; document host-mode fallback if anyone deploys the API outside the network. [`packages/townhouse/src/api/routes/nodes-lifecycle.ts:176`]
- `registerPeer` of same `id` with different route priorities may dup routes — connector spec dedupes by prefix; revisit if route-priority drift shows up in operator reports. [`packages/townhouse/src/api/routes/nodes-lifecycle.ts:371`]
- `removePeer` non-AbortError body-read failure swallows the inner cause and reports the outer "returned 500" without `cause:`. Message-quality polish. [`packages/townhouse/src/connector/admin-client.ts:218-233`]
- `pullImage` may re-pull a digest-form ref when only the tag-form is locally cached (RepoTags vs RepoDigests mismatch). Performance, not correctness. [`packages/townhouse/src/docker/orchestrator.ts:500-518`]
- `runDockerCompose` env override would drop PATH/HOME if a future caller passes `env: {}` without spreading `process.env` — defensive merge for future-proofing. [`packages/townhouse/src/docker/orchestrator.ts:462-474`]
- `enabledAt` uses local clock without NTP-skew documentation — not 46.2-specific; affects reconciler drift classification globally. [`packages/townhouse/src/api/routes/nodes-lifecycle.ts:229`]
- 409 `node_lifecycle_in_flight` lacks `retry-after` / in-flight detail for SPA polling — UX polish. [`packages/townhouse/src/api/routes/nodes-lifecycle.ts:146-150`]
- EACCES on `mill.config.json` write returns a raw error message with no actionable TOWNHOUSE_UID guidance — operator-facing polish. [`packages/townhouse/src/api/routes/nodes-lifecycle.ts:270-283`]
- Mutex acquire pattern is sync test-and-set; future maintainer inserting an `await` between acquire and `try {` would leak the mutex — structural safety today, refactor risk later. Wrap in `withNodeLifecycleMutex(fn)` helper. [`packages/townhouse/src/api/routes/nodes-lifecycle.ts:146-152`]
- Mill happy-path route tests use a mock wallet that always returns FAKE_KEYS — real Solana/Mina derivation in `deriveNodeKey('mill', …)` is never exercised end-to-end. Integration-test gap. [`packages/townhouse/src/api/routes/nodes-lifecycle.test.ts:142-152`]
- Healthcheck-timeout test does not use fake timers; cannot assert AbortController/timer cleanup per iteration. Test polish. [`packages/townhouse/src/api/routes/nodes-lifecycle.test.ts:430-453`]
- Rollback tests don't assert absence of `.tmp` files in homeDir after failure injection — test polish.
- No regression test guarding mutex-leak-on-throw-between-acquire-and-try — pair with the acquire-helper refactor.
- `id = peerId = type` v1 invariant — forward-compat trap when multi-instance support lands; pre-check should switch from `e.type === type` to a richer match. Comment-documented today. [`packages/townhouse/src/api/routes/nodes-lifecycle.ts:170-172`]
- (D4 from 46.2 review) `nodes.<type>.enabled` config flag vs. lifecycle-add — Epic 46 lazy provisioning may have replaced the static flag as the source of truth for HS mode, but the answer was deferred to Story 46.3 (CLI verbs) where it surfaces naturally. Decide whether `townhouse node add` rejects on `enabled: false` or treats the flag as deprecated for lifecycle-managed nodes. [`packages/townhouse/src/api/routes/nodes-lifecycle.ts:131-144`]
> Resolved 2026-05-11 (Story 46.3): HS-mode nodes.yaml is the source of truth. `townhouse node add <type>` ignores `config.nodes[type].enabled` entirely — the static flag is dev-profile only. The TODO(46.3) comment in nodes-lifecycle.ts has been removed.

## Deferred from: code review of 46-3-townhouse-node-add-remove-list-cli (2026-05-11)

- `getPeers()` error classification — any throw maps to `connectorUnreachable: true` masking TLS/auth/parse failures vs network refusal. Distinguish transient connection-refused from misconfigured admin client. [`packages/townhouse/src/api/routes/nodes-lifecycle.ts:148-156`]
- `AbortController` is never explicitly torn down on the fetch success path — signal listener stays attached until GC. Minor per-call leak. [`packages/townhouse/src/cli/node-commands.ts` fetch sites in handleNodeAdd/Remove/List]
- `confirmInteractive` has no SIGINT cleanup — if Ctrl-C races `rl.close()` in the `finally`, terminal may stay in raw mode. Protect with `process.on('SIGINT', ...)` scoped to the prompt. [`packages/townhouse/src/cli/node-commands.ts` confirmInteractive]
- `NODE_ID_PATTERN` accepts unbounded length — server-side fetch will reject, but a megabyte id can be constructed before the network rejects it. Add a sensible client cap (e.g. 64 chars). [`packages/townhouse/src/cli/node-commands.ts`]
- Server-supplied `body.err` is written to stderr unsanitized — `\x1b[...]` ANSI / `\r\b` sequences from a misbehaving connector pass through. Other CLI paths sanitize; this one doesn't. [`packages/townhouse/src/cli/node-commands.ts` error rendering]
- `GET /api/nodes` yaml-read failure returns 500 with raw `err: errMsg` including absolute home-directory path — leaks filesystem layout to API consumer. Strip or redact. [`packages/townhouse/src/api/routes/nodes-lifecycle.ts:135-141`]
- `'disconnected'` status collapses two states: peer-missing-from-connector vs peer-present-but-`connected: false` (handshake pending). No `'pending'` state distinguishes them. Refine in Epic 47/48 when SPA needs the distinction. [`packages/townhouse/src/api/routes/nodes-lifecycle.ts:160-164`]
- `parseArgs({ strict: false })` silently ignores unknown long flags — `townhouse node add town --jsno` runs without `--json`, no diagnostic. Pre-existing CLI-wide pattern; revisit if operator-report rate justifies. [`packages/townhouse/src/cli.ts:1230`]
- DELETE-id regex `^[a-z][a-z0-9-]*$` duplicated client-side without a shared constant — if the server route schema diverges (e.g. allows underscores or longer ids), CLI fail-fast rejects valid ids. Single-source-of-truth refactor. [`packages/townhouse/src/cli/node-commands.ts` NODE_ID_PATTERN vs route schema]
- `STAGE_LABELS` visual order (`Pulling image → Deriving wallet → Registering with apex → Live`) doesn't match server pipeline execution order (which begins with `derive-key`). Minor UX surprise on failure-step display. [`packages/townhouse/src/cli/node-commands.ts` STAGE_LABELS]

## Deferred from: code review of 47-1-sdk-get-earnings-wrap-and-contract-canary (2026-05-12)

- **Test silently passes on 503 in minimal config (Path B by design)** — image-contract canary accepts 503-with-`/503/`-in-message OR 200-with-shape. If a future connector image always 503s in test env (e.g. settlement subsystem regression), this test greens forever with zero shape coverage. Spec-sanctioned per Edge Case A Path B; flag for Story 47.5 live gate to assert real shape coverage against a fully-wired apex. [`packages/townhouse/src/__integration__/connector-image-contract.test.ts:306-330`]
- **Body-read outside AbortController timeout window** — `await response.json()` runs after `this.fetch()` returns and `clearTimeout(timer)` fires in the helper's `finally`. Slow chunked-body reads hang past `timeoutMs`. Pattern parity with `getMetrics()` / `getPeers()` — fix is project-wide hardening. [`packages/townhouse/src/connector/admin-client.ts:238-239`]
- **Empty/non-ISO `timestamp` passes the string-typeof check** — validator accepts `""` or `"not-a-date"`; downstream `new Date(iso)` yields Invalid Date. Same pattern as `getMetrics().timestamp` / `getHealth().timestamp`; project-wide. [`packages/townhouse/src/connector/admin-client.ts:248`]
- **NaN / Infinity / negative `uptimeSeconds` passes `typeof === 'number'`** — `typeof NaN === 'number'` is true. Add `Number.isFinite(x) && x >= 0` guard. Same pattern across admin-client methods; project-wide. [`packages/townhouse/src/connector/admin-client.ts:244`]
- **Array body slips past `typeof === 'object'` first guard** — `Array.isArray(body) && body !== null` passes; later guards reject because `obj['uptimeSeconds']` is undefined, but rejection happens at the wrong stack frame. Defense-in-depth gap, pre-existing across `getMetrics()` / `getPeers()`. [`packages/townhouse/src/connector/admin-client.ts:240`]
- **`response.json()` SyntaxError leaks instead of structured error** — non-JSON 200 (e.g. HTML error page) throws a cryptic SyntaxError caller-side rather than the documented `'Connector admin API: invalid earnings response shape'`. Project-wide pattern; wrap `await response.json()` in a try/catch that re-throws with the documented shape-error contract. [`packages/townhouse/src/connector/admin-client.ts:238`]

## Deferred from: code review of 47-2-aggregator-earnings-surgery (2026-05-12)

- **Per-request `nodes.yaml` disk read on every 5s poll — no caching** — For v1 dashboard (single client, 5s poll), negligible; revisit in 47.4 / perf pass if multi-client polling lands. [`packages/townhouse/src/api/routes/earnings.ts:27`]
- **Duplicate `peerId` and duplicate `assetCode` silently dedup via last-write-wins** — Connector contract is silent on uniqueness for `earnings.peers[].peerId` and `peer.byAsset[].assetCode`; `Promise.all` ordering makes the winner non-deterministic. Tighten via the 47.1 contract canary OR add defensive dedup in the aggregator. [`packages/townhouse/src/earnings/aggregator.ts:122-142, 109-119`]
- **`peerId === ''` (empty string) passes through to `id: ''`** — `admin-client.ts:264` validates `typeof === 'string'` only. React `key={peer.id}` collision risk if two empty-id peers ever appear in one payload. Connector-side validation + contract-canary tightening. [`packages/townhouse/src/earnings/aggregator.ts:124`]
- **`claimsReceivedTotal` content not validated** — Negative / scientific / empty-string passes the `typeof === 'string'` check and surfaces as `lifetime` verbatim. `BigInt('-100')` renders as `-100` in the SPA. Contract canary tightening. [`packages/townhouse/src/earnings/aggregator.ts:117, 136`]
- **Hero shows only first asset — multi-asset apex earnings under-report on the headline number** — `apexEntries[0]` is whatever `Object.entries` returns first (insertion order = connector array order). v1 is USDC-only; multi-asset is post-v1. [`packages/townhouse-web/src/components/earnings-panel.tsx:142-151`]
- **e2e `PerAssetShape` interface drops `assetScale`** — Wire shape intentionally collapses asset-scale into a per-asset-code lookup in the renderer. Document the semantic loss in 47.3 / 47.4 specs. [`packages/townhouse-web/e2e/demo-roundtable.spec.ts:55-60`]
- **`truncateHash` exported but no in-component consumer** — Dead export from the deleted recent-claims block; three tests keep it alive. Minor cleanup. [`packages/townhouse-web/src/components/earnings-panel.tsx:74-77`]
- **No upper bound on `peers[]` (D2 resolution: leave unbounded)** — Drew's v1 fleet ≤ 3 nodes; connector is operator-trusted; capping is YAGNI today. Revisit if Epic 48/49 surfaces multi-tenant or scaling requirements. [`packages/townhouse/src/earnings/aggregator.ts`]

## Deferred from: code review of 47-3-hourly-earnings-snapshot-writer (2026-05-13)

- **No cross-call reader cache — 9× file-reads per dashboard poll (OQ6 v1 acceptable)** — Each `DeltaComputer` call re-streams the full JSONL. At v1 scale (≤9 deltas × ≤1.4MB × 5s poll = ~2.5 MB/s) it's fine; revisit if multi-client polling lands or fleet scales past single-Town/single-USDC. [`packages/townhouse/src/earnings/snapshot-reader.ts:128-148`]
- **Pruner loads entire file into RAM via `fs.readFile`** — Watermark caps the practical OOM risk at v1 scale (≤86k lines × ~150 bytes ≈ 13MB). Stream-process via readline → tmp writeStream when fleet/asset cardinality grows. [`packages/townhouse/src/earnings/snapshot-writer.ts:212`]
- **Stale `.tmp` from previous crash silently overwritten by `writeFile`** — Recoverable on next prune; not a data-loss vector. Add an `fs.unlink(tmpPath).catch(()=>{})` if symlink-target attack is ever a concern on shared hosts. [`packages/townhouse/src/earnings/snapshot-writer.ts:242-244`]
- **`fs.rename` fails with EXDEV across filesystem boundaries** — `~/.townhouse` is a single bind-mount in townhouse-hs Docker compose, so no real cross-FS path today. Add copy+unlink EXDEV fallback if architecture changes (e.g. tmpfs-backed snapshots). [`packages/townhouse/src/earnings/snapshot-writer.ts:245`]
- **`setInterval(tick, 3_600_000)` accumulated drift over hours/days** — Dev Notes §"Time, Tick Cadence & Boundary Math" explicitly accepts bounded drift; floor-to-hour `ts` masks minor skew. Revisit only if a real operational symptom appears. [`packages/townhouse/src/earnings/snapshot-writer.ts:73-75`]

## Deferred from: code review of 47-4-get-api-earnings-two-bucket-endpoint (2026-05-13)

- **Route tests bypass `buildFastifyApp`** — Production registers the route via `buildFastifyApp` with `ajv.customOptions: { removeAdditional: false }`; route tests use raw `Fastify()`. Direct-Ajv validation in the test (patch from this review) closes the contract gap; broader test-arch refactor (switch all route tests to `buildFastifyApp`) is out of 47.4 scope. [`packages/townhouse/src/api/routes/earnings.test.ts`]
- **`__apex__` sentinel collides with a peer literally named `__apex__`** — Aggregator uses the literal string `'__apex__'` as the scope key for routing-fee snapshot rows; snapshot-reader maps by `${peerId}\\0${assetCode}`. A connector peer registered with `peerId === '__apex__'` would clobber the apex bucket. Requires malicious or buggy peer registration; defensive only. Move to a sentinel that cannot be a valid peerId (e.g. `'\\x00__apex__\\x00'`) or validate at the aggregator. [`packages/townhouse/src/earnings/aggregator.ts:176, 204`; `snapshot-reader.ts:83`]
- **Snapshot reader silently degrades on EACCES / mid-stream errors** — `createDeltaComputer` catches stream errors and returns empty map; reader has no logger injection point. Operator with a misconfigured `~/.townhouse` (mode 0o000 or partial corruption) sees all deltas stub to `'0'` with no actionable warning. Belongs in 47.3's reader; cross-story scope. [`packages/townhouse/src/earnings/snapshot-reader.ts:60-65`]
- **`nodes.yaml` symlink traversal not guarded** — `resolveNodesYamlPath()` joins from `dirname(configPath)`; a symlinked `nodes.yaml` would be followed by `readNodesYaml`. YAML parse + Zod validation surfaces a 500 with no content leak, but an attacker with write access to `~/.townhouse` can force arbitrary disk reads on every `/api/earnings` request (e.g. symlink to `/dev/zero`). Operator-local; pre-existing pattern from 47.2. [`packages/townhouse/src/api/routes/earnings.ts:33-35`]

## Deferred from: code review of 47-5-live-e2e-gate-earnings-data-plane (2026-05-13)

- AdminServer captured-reference race + ClaimReceiver-not-disposed lifecycle is a pre-existing connector pattern — fix should land in a connector-repo PR with proper review (not under a townhouse gate-story branch). [`../connector/packages/connector/src/core/connector-node.ts:1251,1497`]
- `docker ps --filter name=townhouse-hs-` substring-match is the cleanup pattern across all townhouse integration tests (already deferred from 45.3 + 46.4) — cross-cutting fix needed: anchored regex or `label=town-test=<id>` discipline. [`packages/townhouse/src/__integration__/*.test.ts`]
- `waitForExit` timeout-vs-non-zero-exit diagnostic conflation lives in shared `_test-helpers.ts` (already deferred from 46.4) — cross-cutting fix to distinguish the two cases in error messages. [`packages/townhouse/src/__integration__/_test-helpers.ts:127-139`]
- Hardcoded compose volume names in `cleanupContainersAndVolumes` (`townhouse-hs-anon`, `townhouse-hs-{town,mill,dvm}-data`) assume compose-template stability — silent leak if templates rename. Label-based volume discipline would fix this cross-test. [`packages/townhouse/src/__integration__/townhouse-earnings-e2e.test.ts:150-160`]
- UTC midnight rollover crossing during long `beforeAll` could shift the snapshot baseline mid-run; the seed's `ts` is captured once but the route reads wall-clock for UTC boundaries — pre-existing snapshot system design, not gate-introduced. [`packages/townhouse/src/__integration__/townhouse-earnings-e2e.test.ts:200-213`]
- SOCKS5 dial-loop log noise when the synthetic external peer's `wss://gate-external.example` is dialed through the connector's HS-mode transport — connector behavior; suppressing requires a `transport: 'direct'` option on `registerPeer` (per connector v3.6.2 PR #69's per-peer transport selection). Outside this story scope. [`packages/townhouse/src/__integration__/townhouse-earnings-e2e.test.ts:382-388`]

## Deferred from: code review of 48-5-drill-subcommands (2026-05-15)

- `/health` route mixes `process.uptime()` (host-API) with package version — semantically misleading, but satisfies AC #7 as written. [packages/townhouse/src/api/build-app.ts:89-94]
- `createRequire('../../package.json')` is fragile across build-output layouts but matches existing townhouse pattern; module-load failure surfaces immediately in tests. [packages/townhouse/src/api/build-app.ts:74-80]
- `handlePeerDetail` collapses 503/timeouts/auth-fail into a single "endpoint unavailable" message; spec'd UX per AC #4. [packages/townhouse/src/cli/drill-commands.ts:1026-1034, 1070, 1090]
- `lastActivity` no ISO validation — non-ISO string renders `?` per `formatRelativeTime` contract; contract drift detection belongs at the connector boundary. [packages/townhouse/src/cli/drill-commands.ts:707, 1098]
- `emitJsonError` doesn't await stdout drain — Node flushes on natural exit (no sync `process.exit(1)` in these paths); false positive in practice. [packages/townhouse/src/cli/drill-commands.ts:657-660]
- `AbortSignal.timeout` for `probeHostApi` body-read — Node 20+ fetch respects signal abort on the response stream; non-issue in practice. [packages/townhouse/src/cli/drill-commands.ts:1129-1148]
- `channels` table widths break on Unicode wide chars / `truncate16` may split UTF-16 surrogate pairs — channelId/peerId/chain are hex/ASCII strings in practice. [packages/townhouse/src/cli/drill-commands.ts:649-651, 711-718]
- `computeOverall` treats `n/a` as healthy (asymmetric vs `degraded`) — intentional per spec; `n/a` means "feature off", not "broken". [packages/townhouse/src/cli/drill-commands.ts:1225-1236]
- `handlePeerDetail` may TypeError on `peer.ilpAddresses === undefined` if connector contract drifts — connector contract canary covers; out-of-scope for this story. [packages/townhouse/src/cli/drill-commands.ts:1053-1057]
- AC #9 PARTIAL — help-text constants `CHANNELS_HELP`/`LOGS_HELP`/`PEER_HELP`/`HEALTH_HELP` exported from `drill-commands.ts` but cli.ts duplicates the lines inline; cosmetic dual-source-of-truth. [packages/townhouse/src/cli.ts:206-209]
- AC #10 PARTIAL — `channels` placement in HELP_TEXT not between `init` and `metrics` per spec ordering; cosmetic. [packages/townhouse/src/cli.ts:206-209]
- AC #13 deferred per spec — live smoke run gated to PR close-out, not the in-session review.

## Deferred from: code review of 48-6-sats-power-user-flag (2026-05-15)

- `addDecimalStrings` validates only `b`, not `a` — asymmetric defense pattern copied verbatim from `HeroBand.tsx`; fixing here diverges from the source helper. [packages/townhouse/src/cli/status-earnings.ts:16-23]
- `addDecimalStrings` silently drops malformed values without logging — same HeroBand-parity concern; cross-cutting cleanup belongs in a shared utility so both the TUI and CLI surfaces diagnose schema drift uniformly. [packages/townhouse/src/cli/status-earnings.ts:16-23]
- `--rate` silently discarded when `--units` is `usdc` or unspecified — operator misuse (typoed `--units`); not spec-required and adds no correctness defect, but a warn-on-discard would catch the common typo. [packages/townhouse/src/cli.ts:1422-1434]
- `usdcMicroToSats` accepts rounded-but-unsafe rates from direct callers — `resolveSatsRate` is the only caller in the cli flow and defends with `Number.isSafeInteger`; direct-caller defense-in-depth (relevant if the helper is reused in TUI/JSON-export/library paths). [packages/townhouse/src/cli/status-earnings.ts:52-60]
- AC #10 close-out — smoke run against live apex + Story Close-Out Checklist boxes (Tasks 10.1-10.8, 11.1-11.2) are operator-side gates before flipping sprint-status to `done`; this Review Findings entry fulfills 11.1.

## Deferred from: second-pass code review of 48-6-sats-power-user-flag (2026-05-15)

- Stdout label "Earnings (USDC): unavailable" maps local config errors to "connector unavailable" — stderr breadcrumb (P1) gives operator the disambiguation signal, but the stdout label still reads as a network-side fault. Full fix would extend `AggregatedEarnings.status` enum with a `'local_error'` variant and add a render branch — cross-cutting refactor. [packages/townhouse/src/cli/status-earnings.ts:84-86]
- Test name "fractional USDC truncates (floor division)" mislabels truncation-toward-zero on negative inputs — BigInt division truncates toward zero, then sign is re-applied. For positives, truncate==floor; for negatives they differ (floor(-150000/1000000) is -1; truncation is 0). Behavior is correct and tested, only the doc/test-name needs cleanup. [packages/townhouse/src/cli/status-earnings.test.ts:111]
- `resolveEarnings` catch swallows ALL throws on a contract assumption about `aggregateEarnings` — comment encodes the contract but the type system doesn't enforce it. If `aggregateEarnings` ever grows a non-connector failure mode, breadcrumb message could mislead. [packages/townhouse/src/cli.ts:438-444]
- P1 breadcrumb on local config corruption does NOT set `process.exitCode` — shell pipelines (`townhouse status && ...`) cannot detect a stale `nodes.yaml`. Matches existing graceful-degradation pattern, but inconsistent with `--units=sats` no-rate path which DOES set exitCode=1 on a comparable local error. Debatable UX choice. [packages/townhouse/src/cli.ts:438-444]

## Deferred from: smoke-run blockers during 48.6 close-out (2026-05-15)

- **Dev-tree `townhouse hs up` is broken** — two cumulative build-toolchain bugs surfaced when attempting AC #10 smoke run:
  1. tsup emits duplicate `import { createRequire } from "module"` in `dist/chunk-*.js` (one auto-prepended at line 1, one from `build-app.ts:13` import — both survive into the bundle → `SyntaxError: Identifier 'createRequire' has already been declared`). Reproduces on a pristine `epic-48` build with zero 48.6 changes (verified by stashing and rebuilding). Workaround: `sed -i '<line>d' dist/chunk-*.js` to remove the duplicate.
  2. `_pkgVersion` resolves `'../../package.json'` relative to the dist chunk path, not the source. Fix in source would change `build-app.ts:18` from `createRequire(import.meta.url)('../../package.json')` to use a build-time inlined version, or `'../package.json'` if always shipped under `dist/`. Workaround: `sed -i 's|"\.\./\.\./package\.json"|"../package.json"|g' dist/chunk-*.js`.
  3. `dist/image-manifest.json` is only produced by the npm-publish CI workflow, so `townhouse hs up` always fails in dev with "HS mode requires a digest-pinned image manifest". The user's installed rc5 manifest is `{}` empty (pre-existing rc5 tarball bug — town#43 lineage). Workaround for smoke: use the dev-infra script + mock-connector fixture instead.
  These three together block every dev-tree story that needs to verify HS-mode behavior end-to-end. Cross-cutting; should be filed as its own story under Epic 22 (Restore Green CI) or a new build-hardening epic.

## Deferred from: code review of 48-7-live-e2e-gate-operator-dashboard (2026-05-18)

All findings target `packages/townhouse/src/__integration__/townhouse-tui-e2e.test.ts` — the Story 48.7 gate test file. Gate passed 8/8 on 2026-05-18; these are test-quality / future-flake hardening items, not gate blockers.

- `addedPeerId.slice(0, 4)` substring at line 835 is trivially satisfied by 'town' in any container name or copy — false-positive risk. Tighten to a full peer-row regex (e.g. `/town\s+town\s+USDC/`).
- `$0.50` substring at line 839 matches 4 cells (TODAY/MONTH/YEAR/LIFETIME) — cannot isolate MONTH. Anchor with column context: `/MONTH\s+\$0\.50/m`.
- Snapshot seed uses `assetCode: 'USDC'` at line 283 while 47.5 precedent (`townhouse-earnings-e2e.test.ts:351`) and connector default may use `'USD'`. Dormant in 48.7 (Tests 1-2 don't read seed); fails latently if a future gate-tightening asserts delta values.
- Tests 4 and 5 use fixed `sleep()` budgets (300ms / 700ms / 1500ms) instead of polling `waitForFrame(predicate, {budget})` — flake-prone under CI load (vitest pool=fork on shared runners). Lines 672, 681, 706, 752, 760.
- `probePortFree` at line 210 treats 1s connect timeout as "port free" — inverted semantics. A slow-SYN-ACK bound port falsely reports free, causing later `hs up` to fail with a Docker error instead of a friendly preflight message.
- `cleanupContainersAndVolumes` at lines 132-147 doesn't `docker network rm townhouse-hs-net` — network artifacts persist across runs. Idempotent today but a daemon-version drift could surface routing issues.
- Cleanup at lines 414-444 doesn't `docker stop -t 5` before `rmSync(tmpDir, { force: true })` — risk of `EBUSY` on overlayfs if containers are still flushing bind-mounted files.
- Test 7 `lo.process.kill('SIGKILL')` at lines 906-911 leaves dockerode follow-stream pending; no `await waitForExit`. On the next suite iteration, reconnect attempts may collide with cleanup.
- `instance.lastFrame() ?? ''` pattern (~11 sites) masks `undefined` (no render yet) — diagnostic obscures "Ink failed to mount" vs "frame missing token". Distinguish via `expect(instance.lastFrame()).toBeDefined()` first.
- Missing 47.5 P5 cross-check: `docker exec ${HS_API_NAME} stat -c "%a %s" /.townhouse/earnings-snapshots.jsonl` to prove the bind mount and seed reached the container.
- Port pre-flight at lines 214-228 only probes 9401/28090 — misses 9400 (`townhouse-test-infra.sh` Fastify), 28700+ container-internal ports. Pre-warm collision possible if test-infra is left running.
- `/api/transport` readiness check at lines 340-343 doesn't confirm `/api/earnings` plugin registered. Plugin-order regression would surface as opaque 404 in Test 2.
- `parseLastJsonLine` at lines 177-193 walks back to first line starting with `{` — could parse a structured log envelope as the success body. Mitigated today by `expect(addBody.ok).toBe(true)` at line 383 but fragile.
- ActivityTicker disjunction `/no settlements yet|press \[a\] when|activity arrives|\[a\] activity/` at lines 485-487 accepts wildly different ticker states — broad assertion misses regressions where ticker copy renders the wrong empty-state variant.

## Deferred from: code review of 49-3-persistent-akash-foreign-client-pod (2026-05-19)

- **D1: Raw TCP probe in waitForSocks5Bound** — `docker/src/entrypoint-foreign-pod.ts` uses a raw TCP connect probe to detect SOCKS5 readiness. A real SOCKS5 protocol greeting probe would be more accurate. Pre-existing from 49.1 deferred-work.md D1; the 3× retry inside ToonClient.start() absorbs the gap for now.
- **D2: Tor circuits not fully built when SOCKS5 binds** — The SOCKS5 port binds before Tor circuits are usable for outbound .anyone tunnels. Real fix is the same as D1 (SOCKS5 greeting probe confirms circuits); current workaround is ToonClient.start() retry.
- **D3: Lease owner pubkey pending Task 8 deploy** — Story footer records `dev.jonathan.green@gmail.com` as owner; Akash Console wallet pubkey must be appended after the first `scripts/akash-deploy.sh foreign-toon-client` run.
- **D4: AKASH_FOREIGN_POD_URL trailing slash in smoke test URL composition** — `packages/townhouse/src/__integration__/akash-foreign-pod-smoke.test.ts` constructs URLs as `${AKASH_FOREIGN_POD_URL}/healthz`; a trailing slash in the env var produces double-slash. Low risk for operator-controlled env; fix with `url.replace(/\/$/, '')`.
- **D5: AC #2 publish fails against fresh test apex (HS propagation delay)** — `socks5.ts` uses a 2s socket timeout for the SOCKS5 connect. A freshly-started `townhouse hs up` apex has not yet had its HS descriptor indexed by the public ATOR DHT; the pod's ATOR proxy (ator-public mode, 5.78.181.0:9052) accepts the SOCKS5 CONNECT but can't route within 2s. Smoke tests 3, 4, 9 fail against a 60-second-old apex. In production (operator apex running for hours/days), the descriptor IS indexed and the first connect succeeds within 2s. Fix: extend the socks5.ts socket timeout from 2s to 30s for the initial connect attempt, OR add a "HS readiness probe" that confirms the DHT has indexed the descriptor before running the publish tests. Belongs in a small transport-hardening story alongside D1.

## Deferred from: code review of 49-4-paid-packet-earnings-receipt-evm-and-sol-on-akash (2026-05-20)

- **D1 (49.4): Hardcoded ATOR proxy `5.78.181.0:9052`** — `packages/townhouse/src/__integration__/akash-paid-earnings-smoke.test.ts:813-815` hardcodes the public ATOR introduction proxy. Should be env-overridable (`ATOR_SOCKS5_PROXY`) with a fallback to localhost; deferred to next transport-config refactor.
- **D2 (49.4): Hardcoded apex EVM address `0x90F79bf6…`** — `packages/townhouse/src/__integration__/akash-paid-earnings-smoke.test.ts:700` is the deterministic Anvil acct[1]; runtime parse from pod `/healthz` is a polish item, not a correctness gap.
- **D3 (49.4): `EXPECTED_FEE = 1_000_000n` hand-linked to SDL value** — Test file duplicates the value baked into `deploy/akash/foreign-toon-client.sdl.yaml`. Future polish: parse `TOON_FEE_PER_EVENT` from pod `/healthz` at runtime; deferred to next test-helpers refactor.
- **D4 (49.4): `parseLastJsonLine` duplicated from 47.5** — Same helper exists in `townhouse-earnings-e2e.test.ts` and `akash-paid-earnings-smoke.test.ts`. Extract to `_test-helpers.ts` in a follow-up cleanup PR.
- **D5 (49.4): `townhouse hs up` exit semantics assumption** — Test assumes `hs up` returns exit code 0 after orchestration completes (works per 49.3 precedent). Document the assumption explicitly if the orchestrator behavior changes.
- **D6 (49.4): Fixed 8s sleep for BTP handshake** — `akash-paid-earnings-smoke.test.ts:741` waits a magic 8s for connector↔relay BTP handshake. Replace with poll on `adminClientA.getPeers()` for `connected: true` in a future refactor.
- **D7 (49.4): `example.invalid` DNS resolver pitfalls** — Preflight unit tests (AC #6) probe `https://example.invalid/*`. RFC 6761 guarantees no resolution, but corporate DNS / split-horizon resolvers / captive portals may answer. Switch to `http://127.0.0.1:1/` (ECONNREFUSED) if false-positive resolution becomes a CI issue.
- **D8 (49.4): Single provider for two critical leases (anvil+faucet)** — Both currently on `akash1hgulk6…`. Multi-provider distribution is an Epic 49.5 stability concern; campaign artifact, not a blocking issue.
- **D9 (49.4): AC #2 Mill `node add mill` synthetic substitution** — Test substitutes a synthetic Mill registration (nodes.yaml write + `connectorAdmin.registerPeer`) for the real `townhouse node add mill` 6-step lifecycle. Acknowledged in AC #2 BLOCKED-STRUCTURAL scope; revisit when Mill SOL settlement routing layer ships.
- **D10 (49.4): `captureLogsOnFailure` writes to `process.cwd()`** — Inconsistent with workspace-rooted logs. 47.5 has the same pattern; anchor to `WORKSPACE_ROOT` from `_test-helpers.ts` in the next test-helpers refactor.

## Deferred from: 49-4 post-review-pass-1 GREEN re-run attempt (2026-05-20)

- **D-49.4-PR1-1 (49.5 prerequisite): Akash provider quality is the binding constraint on a deterministic GREEN gate.** 4 consecutive provider failures across 1 hour of redeploy churn (Solana validator io_uring crash, two foreign-pod providers with broken outbound HTTPS / dead ingress). 49.5 should either pre-vet a small allow-list of known-good providers, use a private Akash provider, or switch the foreign-pod off Akash for the gate. Capture this as an Epic 49.5 architecture decision before its CI gate runs.
- **D-49.4-PR1-2 (49.5 prerequisite): pod boot resilience now landed but unverified in live evidence.** Patch in `docker/src/entrypoint-foreign-pod.ts` lines ~725-746 makes drip best-effort + lets `pollEvmBalance`/`pollSolBalance` run regardless. Pod self-heals when operator pre-funds via `anvil_setBalance` / Solana `requestAirdrop`. Image rebuilt + pushed: `ghcr.io/toon-protocol/akash-foreign-toon-client:demo@sha256:571e0e66920b206b34d63bc08eabb456bab410b2586b38824b18cec3d9044cf8`. 49.5's gate inherits this — first live evidence that the resilience path actually fires is owed to 49.5.
- **D-49.4-PR1-3: `scripts/akash-deploy.sh` readiness probe is broken for `/healthz`-only services.** Currently probes the bare ingress URL `/` and expects 2xx, but Fastify-served pods (foreign-toon-client) return 404 for `/`. Probe times out the full 300s waiting for `/` to respond, even when the pod is healthy. Fix: parameterize the readiness path per service (e.g. `READINESS_PATH=/healthz`) or default it to `/healthz` for foreign-pod-class deployments.
- **D-49.4-PR1-4: P2 substitution-verification guard refined.** Original implementation counted text occurrences of `TOON_FEE_PER_EVENT=`, which broke after the SDL header was extended with the same string in comments. Now counts env-LINE matches via a regex-anchored grep. Documented inline in `scripts/akash-deploy.sh:render_foreign_toon_client_sdl`. No further action needed; flagged here only for awareness during the next SDL-template audit.

## Deferred from: code review of 49-5-live-e2e-gate-real-anyone-loop-akash-evm-sol (2026-05-27)

- **W1 (49.5): Ephemeral JWK has no persistent Arweave authorship** — `docker/src/entrypoint-dvm.ts:241`. By design for free-tier path; ephemeral key rotates on restart. Revisit if persistent DVM identity becomes a product requirement.
- **W2 (49.5): `connectorUrl` set to HTTP admin URL in ToonClient config** — `townhouse-dvm-arweave-e2e.test.ts`. ToonClient uses `btpUrl` for actual BTP; `connectorUrl` is unused at runtime. Misleads future readers but benign.
- **W3 (49.5): `direct_fund_evm` impersonation on Akash Anvil requires `--allow-impersonation`** — `townhouse-e2e-local-hs.sh`. Akash Anvil started in dev mode so it works; verify Anvil flags if ever redeployed in non-dev mode.
- **W4 (49.5): 90s `AbortSignal` timeout kills entire retry loop in earnings poll** — `local-docker-hs-paid-earnings-smoke.test.ts:~446`. On a 90s abort, the `RETRY_BUDGET_MS=270_000` budget is never utilised. Revisit if earnings poll becomes flaky on slow CI.
- **W5 (49.5): `TOON_FEE_PER_EVENT=0` accepted without minimum guard** — `scripts/akash-deploy.sh:~368`. Zero silently creates a free-publish SDL. Add a minimum-value guard in a future SDL validation refactor.
- **W6 (49.5): `dvmDestination` hardcoded as `'g.townhouse'`** — `townhouse-dvm-arweave-e2e.test.ts:~2065`. Brittle if operator uses a different ILP address prefix. Parameterise when multi-operator support lands.
- **W7 (49.5): DVM subprocess inherits full vitest env** — `townhouse-dvm-arweave-e2e.test.ts:~236`. `VITEST_*` vars removed; residual vars low-risk. Add an explicit allowlist if spurious env interference occurs.
- **W8 (49.5): Town relay generates new Nostr key on every `hs up`** — `townhouse-e2e-local-hs.sh:~548`. By design; double-`up` requires re-registration. Document in operator runbook.
- **W9 (49.5): `DVM_ANON_VOLUME` constant declared but never cleaned up** — `townhouse-dvm-arweave-e2e.test.ts:78`. Dead constant, no runtime impact. Remove in next test-file pass.
- **W10 (49.5): `aDestination` remains `''` on abrupt `beforeAll` kill** — `townhouse-dvm-arweave-e2e.test.ts:~305`. Race only on process interruption; not a normal test path.
- **W11 (49.5): `verify_network_isolation` grep lacks word anchors** — `townhouse-e2e-local-hs.sh:~655`. False-positive risk if similarly-named containers exist on CI; low in practice.
- **W12 (49.5): `direct_fund_evm` assumes `0x` prefix on client EVM address** — `townhouse-e2e-local-hs.sh:~262`. All hardcoded constants carry `0x`; runtime path verified in smoke. Harden if client image ever returns bare-hex address.
- **W13 (49.5): Connector `3.6.3` prerequisite in spec but `3.7.0` shipped** — Intentional upgrade; acknowledged in `v0.1-pilot-readiness.md`. No action needed; spec Hard Rule 7 should be amended during review resolution.
