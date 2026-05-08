
## Deferred from: code review of 44-4-connector-release-contract-cross-repo-doc (2026-05-08)

- Bare `CONNECTOR_MIGRATION.md` reference in body-identical mirror is a dangling reference from the connector-side reader's perspective (file lives only in town). Acceptable trade-off for byte-equivalence discipline; consider path-qualifying as `packages/sdk/CONNECTOR_MIGRATION.md (in toon-protocol/town)` in a future tightening pass. — [`packages/sdk/CONNECTOR_RELEASE_CONTRACT.md` `### Townhouse pin discipline`]
- No in-file breadcrumb in connector source pointing to the town mirror — the asymmetric `tail -n +4` discipline lives entirely inside the doc body (`## Verification` section). A single HTML comment at the top of the connector file (`<!-- Mirrored at toon-protocol/town:packages/sdk/CONNECTOR_RELEASE_CONTRACT.md -->`) would make the relationship discoverable without breaking the diff invariant. Follow-up commit on the connector side. — [`/home/jonathan/Documents/connector/CONNECTOR_RELEASE_CONTRACT.md:1`]
- `image-manifest.json` referenced in present tense in the new `### Townhouse pin discipline` paragraph; the file does not yet exist (Story 45.1 will produce it). Forward-applying language is the explicit intent — verb tense to be revisited when 45.1 lands. — [`packages/sdk/CONNECTOR_RELEASE_CONTRACT.md` `### Townhouse pin discipline`]
- PATCH-bump exception clause "...unless the patch fixes a behavior townhouse actively relied on being broken" is unfalsifiable. Reviewer cannot apply mechanically. Could be tightened to a procedural gate (e.g., "...unless the contract canary turns red on the new digest"). Cross-repo follow-up. — [`packages/sdk/CONNECTOR_RELEASE_CONTRACT.md` `### Townhouse pin discipline`]

## Deferred from: code review of 44-4-... (2026-05-08, post-merge re-strategy — pending follow-up cross-repo PR cycle)

_Connector#67 merged before these review-surfaced cross-repo patches could be pushed; per Option A of the post-merge replan, they ship as a follow-up connector PR + sibling town mirror PR. Each fix below was verified body-clean during review (local diff returned empty against the patched mirror). The follow-up should bundle all six in one connector commit + a single town re-mirror PR._

- **Cross-repo P3** — `## Artifacts` table contradicts the multi-arch sentence two lines below: line 14 says `(from the first release after PR #62)`; line 20 says `Multi-arch images ... ship from the first release after PR [#63]`. Sprint-status corroboration: `connector#63 #64 #65` is the multi-arch series. Fix: line 14 `PR #62 → PR #63`. — [`CONNECTOR_RELEASE_CONTRACT.md:14`]
- **Cross-repo P4** — `## Supply-chain signing` opens with "Starting from the first release after PR #66". Story 44.3 close note + connector v3.6.0 release confirm signing is green AT v3.6.0 (cut from PR #66 merge), not "after". Fix: rewrite opener to "Starting from `v3.6.0` (cut after PR #66 merged)" for unambiguous concrete pin. — [`CONNECTOR_RELEASE_CONTRACT.md:69`]
- **Cross-repo P5** — `## Verification` lede says "Two mechanisms guard against future tag-vs-content drift:" but the list is three items (the third is "Town mirror drift detection"). The blank line between item 2 and item 3 also risks renderer divergence. Fix: change "Two" to "Three" and remove the blank line so all three render as a contiguous numbered list. — [`CONNECTOR_RELEASE_CONTRACT.md:181-194`]
- **Cross-repo P6** — Story 44.4 Dev Notes promised that the doc would cross-link to ILPv4 / RFC 0027 context for the "ILP packet wire-format change = MAJOR" rule, but the published doc has no such link. Fix: add to `## References`: `[Interledger Protocol V4 (RFC 0027)](https://github.com/interledger/rfcs/blob/master/0027-interledger-protocol-4/0027-interledger-protocol-4.md) — defines the ILP packet wire format referenced by the MAJOR-bump rule in [API stability](#api-stability)`. (RFC-0027 is the cross-repo-safe reference; the in-town-only `connector-north-star-2026-05-01.md` Dev Notes mentioned would dangle in the connector mirror.) — [`CONNECTOR_RELEASE_CONTRACT.md` `## References`]
- **Cross-repo P7** — `gh api` fenced block in `## Staying current` opens with three backticks and no language hint while every other code block in the doc is tagged `bash`. Cosmetic but visible cross-repo drift. Fix: open the fence as ` ```bash `. — [`CONNECTOR_RELEASE_CONTRACT.md:128`]
- **Cross-repo Q1** — `## Verification` item 3's `diff` example uses an unrunnable `/path/to/town/...` placeholder and is body-identical, which makes the example self-referential when read from the town side. Fix: anchor cwd explicitly ("from the `toon-protocol/connector` repo root, with `toon-protocol/town` cloned alongside as a sibling directory, e.g. `../town`") and replace the placeholder with `../town/packages/sdk/CONNECTOR_RELEASE_CONTRACT.md`. — [`CONNECTOR_RELEASE_CONTRACT.md` `## Verification` item 3]

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
