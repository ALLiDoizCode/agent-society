# Vendored Solana payment-channel program

`payment_channel.so` is the compiled SBF bytecode of the connector's Solana
payment-channel program. The local-HS E2E Solana validator
(`docker-compose-townhouse-dev.yml` → `townhouse-dev-solana`) loads it at genesis
under the deterministic program-id derived from `payment_channel-keypair.json`
(`EdJxYPDxGvaJuu57DSUptf4soLv8enpdyQJJhHDLiydG`).

## Provenance / version pinning

This bytecode MUST match the on-chain instruction ABI the pinned connector
(`DEFAULT_CONNECTOR_IMAGE` in `packages/townhouse/src/constants.ts`) builds. The
connector's Solana settlement SDK (`claimFromChannel` / `settleChannel`) builds
program instructions with a specific account layout; an older program build
rejects the newer instruction shape with `ProgramError::InvalidArgument`
("invalid program argument").

- **Current build:** connector `v3.9.6` — `@toon-protocol/connector`
  `packages/solana-program` at/after commit `6a8c954`
  ("fix(settlement): decouple Solana claim fee-payer from claiming participant (#99)").
  `#99` changed `process_claim_from_channel` to the fee-payer-decoupled 4-account
  layout `[fee_payer (signer), claimer, channel_pda (writable), instructions_sysvar]`,
  so the connector can unilaterally redeem a peer-signed inbound claim.
- **Previously vendored build** (town commit `7a479f0`, "multi-chain devnet & lazy
  payment channels") predated `#99` and rejected the 3.9.6 connector's
  `CLAIM_FROM_CHANNEL` instruction with `InvalidArgument`, blocking the on-chain
  Solana settle leg.

To rebuild from the connector repo (sibling checkout at `../connector`, tag
`v3.9.6` or later):

```
cd ../connector/packages/solana-program
cargo build-sbf            # requires the Solana SBF toolchain
cp target/deploy/payment_channel.so <town>/contracts/solana/payment_channel.so
```

The program-id keypair here (`payment_channel-keypair.json`) is a documented
dev-only key and is intentionally kept stable so the validator's genesis program-id
does not change across rebuilds. The `.so` bytecode is program-id-agnostic (the id
is not embedded in the bytecode), so dropping in a new build under the same keypair
is sufficient.
