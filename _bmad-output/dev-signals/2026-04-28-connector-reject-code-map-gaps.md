# Dev Signal: Upstream Connector REJECT_CODE_MAP gaps (F02, F04)

**Date:** 2026-04-28
**Type:** infrastructure
**Epic:** Epic 22 — Restore Green CI Post-Connector v3.3.2 Upgrade
**Priority:** YELLOW

## Headline

The `@toon-protocol/connector` v3.3.2 `REJECT_CODE_MAP` translates only 8 semantic reasons to ILP wire codes, dropping wire fidelity for `F02 Unreachable` and `F04 Insufficient Destination Amount`. Anything our SDK emits at those codes silently degrades to `F00 Invalid Request` (or worse, falls through to `F99 Application Error`), eroding the diagnostic signal a peer's routing layer relies on.

## Technical Summary

In this session we landed a wire→semantic translation in `packages/core/src/utils/reject-code.ts` so SDK callers stop sending raw `T00`/`F00`/`F99` strings into the connector. That fix relies on the connector's `REJECT_CODE_MAP` to round-trip semantic→wire. Two F-class wire codes are missing keys: `unreachable` (F02) and `insufficient_destination_amount` (F04). Both are well-defined in RFC 0027 (ILPv4) and meaningful for routing diagnostics.

## Proposed upstream patch

Repo: `git@github.com:toon-protocol/connector.git`
File: `packages/connector/src/core/payment-handler.ts:80`

```diff
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
 };
```

Also extend `packages/connector/src/core/payment-handler.test.ts` with cases asserting `mapRejectCode('unreachable') === 'F02'` and `mapRejectCode('insufficient_destination_amount') === 'F04'`.

After upstream merges, update `packages/core/src/utils/reject-code.ts` `ILP_TO_SEMANTIC` to map `F02 → 'unreachable'` and `F04 → 'insufficient_destination_amount'` (today both fall through to `'invalid_request'`).

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

## How to file

Once you're ready: `gh issue create -R toon-protocol/connector` with the body above (or copy from this file).

## Open follow-up beyond F02/F04

The full F-class — F01, F05, F07, F08 — is also unmapped. F02/F04 are the ones our v3.3.2 migration actually emits. The rest can wait until they show up in real traffic.
