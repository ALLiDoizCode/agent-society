# Dev Signal: Upstream Connector REJECT_CODE_MAP gaps (F02, F04)

**Date:** 2026-04-28
**Type:** infrastructure
**Epic:** Epic 22 — Restore Green CI Post-Connector v3.3.2 Upgrade
**Priority:** YELLOW
**Status:** Shipped. Connector patch merged and `@toon-protocol/connector` v3.3.3 published to npm (incl. new connector image). Town SDK bumped to `^3.3.3` across `core/sdk/town/mill/docker/package.json` and `ILP_TO_SEMANTIC` updated to map `F02 → 'unreachable'` and `F04 → 'insufficient_destination_amount'` instead of the old `'invalid_request'` fallback. Verified: core unit (2418 ✅), mill EVM e2e AC-5 (4/4 ✅), sdk e2e:docker (70/77 ✅).

## Headline

The `@toon-protocol/connector` v3.3.2 `REJECT_CODE_MAP` translates only 8 semantic reasons to ILP wire codes, dropping wire fidelity for `F02 Unreachable` and `F04 Insufficient Destination Amount`. Anything our SDK emits at those codes silently degrades to `F00 Invalid Request` (or worse, falls through to `F99 Application Error`), eroding the diagnostic signal a peer's routing layer relies on.

## Technical Summary

In this session we landed a wire→semantic translation in `packages/core/src/utils/reject-code.ts` so SDK callers stop sending raw `T00`/`F00`/`F99` strings into the connector. That fix relies on the connector's `REJECT_CODE_MAP` to round-trip semantic→wire. Two F-class wire codes are missing keys: `unreachable` (F02) and `insufficient_destination_amount` (F04). Both are well-defined in RFC 0027 (ILPv4) and meaningful for routing diagnostics.

## Landed upstream patch (scope expanded)

Repo: `git@github.com:toon-protocol/connector.git`
File: `packages/connector/src/core/payment-handler.ts:80`
Branch: `fix/reject-code-map-f02-f04`
Commit: `0391843 fix(connector): map F02 unreachable and F04 insufficient destination amount`

The original proposal was two map entries plus paired tests. After party-mode review (Winston / Amelia / Murat / John), scope expanded modestly to add a structural drift guard:

- `AcceptedSemanticCode` literal-union type listing the published semantic vocabulary
- `satisfies Record<AcceptedSemanticCode, string>` constraint on the map

This converts future drift between the published semantic vocabulary and the wire-code mapping into a compile-time error, rather than a silent runtime fallthrough to F99 — catching exactly the failure mode that produced this dev signal.

```diff
+/**
+ * Semantic reject codes accepted from external `PaymentHandler` callbacks.
+ *
+ * Published vocabulary for `rejectReason.code`. Adding a new code requires
+ * both extending this union and adding the matching wire-code entry to
+ * `REJECT_CODE_MAP` — the `satisfies` constraint on the map enforces
+ * parity at compile time.
+ */
+export type AcceptedSemanticCode =
+  | 'insufficient_funds'
+  | 'expired'
+  | 'unreachable'
+  | 'invalid_request'
+  | 'invalid_amount'
+  | 'insufficient_destination_amount'
+  | 'unexpected_payment'
+  | 'application_error'
+  | 'internal_error'
+  | 'timeout';
+
 export const REJECT_CODE_MAP: Record<string, string> = {
   insufficient_funds: 'T04',
   expired: 'R00',
+  unreachable: 'F02',
   invalid_request: 'F00',
   invalid_amount: 'F03',
+  insufficient_destination_amount: 'F04',
   unexpected_payment: 'F06',
   application_error: 'F99',
   internal_error: 'T00',
   timeout: 'T00',
-};
+} satisfies Record<AcceptedSemanticCode, string>;
```

Tests added in `packages/connector/src/core/payment-handler.test.ts`:
- `mapRejectCode('unreachable') === 'F02'`
- `mapRejectCode('insufficient_destination_amount') === 'F04'`
- Updated the order-sensitive `Object.keys(REJECT_CODE_MAP).toEqual([...])` assertion to include the new keys.

Verification: 22/22 unit tests pass; `tsc --noEmit` clean.

After upstream merges and a new `@toon-protocol/connector` is published to npm, update `packages/core/src/utils/reject-code.ts` `ILP_TO_SEMANTIC` to map `F02 → 'unreachable'` and `F04 → 'insufficient_destination_amount'` (today both fall through to `'invalid_request'`).

## Issue body for `toon-protocol/connector`

> **Title:** `REJECT_CODE_MAP missing F02 (unreachable) and F04 (insufficient destination amount)`
>
> **Body:**
>
> ## Problem
>
> `REJECT_CODE_MAP` in `packages/connector/src/core/payment-handler.ts` translates 8 semantic reasons to ILP wire codes. Two F-class wire codes from RFC 0027 are missing keys, so callers in dependent SDKs (e.g. `@toon-protocol/sdk`) cannot round-trip them through the connector — `mapRejectCode()` falls back to `F99` for any unmapped key.
>
> | Wire code | RFC 0027 name | Semantic key (proposed) | Status |
> |---|---|---|---|
> | F02 | Unreachable | `unreachable` | **missing** |
> | F04 | Insufficient Destination Amount | `insufficient_destination_amount` | **missing** |
>
> ## Impact
>
> Routing diagnostics lose fidelity: a peer that genuinely has no route (F02) or that would underdeliver to the destination (F04) instead reports F99 (`Application Error`). A connector doing routing decisions on those codes can't differentiate "route doesn't exist" from "downstream service crashed."
>
> Confirmed by the recent v3.3.2 work in `@toon-protocol/town`: the SDK had to inline a wire→semantic mapping (`packages/core/src/utils/reject-code.ts`), and we explicitly fold F02/F04 into `'invalid_request'` because there's no semantic key here that round-trips them.
>
> ## Suggested patch
>
> ```diff
> --- a/packages/connector/src/core/payment-handler.ts
> +++ b/packages/connector/src/core/payment-handler.ts
> @@ -80,9 +80,11 @@ export const REJECT_CODE_MAP: Record<string, string> = {
>    insufficient_funds: 'T04',
>    expired: 'R00',
> +  unreachable: 'F02',
>    invalid_request: 'F00',
>    invalid_amount: 'F03',
> +  insufficient_destination_amount: 'F04',
>    unexpected_payment: 'F06',
>    application_error: 'F99',
>    internal_error: 'T00',
>    timeout: 'T00',
>  };
> ```
>
> Plus paired test cases in `payment-handler.test.ts` asserting both new mappings.

## How to file (superseded)

> Originally we planned to file this as an issue. Instead the fix was implemented directly on a connector branch — open as a PR rather than an issue. The "Issue body" block above is preserved as historical context for the original framing.

## Architecture finding from review

The connector has **two distinct error pipelines** that emit the same wire vocabulary:

1. **Wire layer** (`packet-handler.ts`): emits typed `ILPErrorCode` enum values directly. Compiler-enforced exhaustiveness via the enum + switch patterns. F01, F02, F06, F99, T00, T01, T04, R00 are all already generated this way (e.g. `packet-handler.ts:572,578,588,594` for F01; `:933,941` for F02). These paths **never touch `REJECT_CODE_MAP`**.
2. **Semantic layer** (`REJECT_CODE_MAP` in `payment-handler.ts:80`): translates user-supplied `rejectReason.code` strings from `PaymentHandler` callbacks. Consumers at `local-delivery-client.ts:195` and `payment-handler.ts:219`. Stringly-typed, no compiler enforcement (until this patch's `satisfies` clause).

The two pipelines can drift silently — a new `ILPErrorCode` enum value can be added to Pipeline A with no corresponding semantic key in Pipeline B, and nothing will catch it. F02/F04 missing was a symptom of that drift having already happened. The `satisfies` constraint added in this PR is the cheapest structural lock against recurrence within Pipeline B; it does not yet bridge Pipeline A↔B.

## Open follow-ups (deferred from this PR)

1. **Cross-repo Pact-style contract test** between `@toon-protocol/connector`'s `REJECT_CODE_MAP` and the town SDK's `ILP_TO_SEMANTIC`. Round-trip parity (semantic → wire → semantic) loaded from both sides would have caught the F02/F04 gap pre-merge. High value, separate workstream because it requires test infra design.
2. **Tighten `PaymentResponse.rejectReason.code`** from `string` to `AcceptedSemanticCode`. Would make user-supplied unknown codes a compile error at the call site instead of a silent F99 fallthrough. Breaking API change → minor version bump.
3. **F01 / F05 / F07 / F08 semantic-key entries.** F01 is already generated as a typed wire code in `packet-handler.ts` and bypasses `REJECT_CODE_MAP` entirely — adding it to the map matters only if a user's `PaymentHandler` callback returns `{code: 'invalid_packet'}`, which no caller does today. F05/F07/F08 have no observed call sites. Revisit when a real consumer materializes.
