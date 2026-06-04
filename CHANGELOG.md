# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.12.2](https://github.com/toon-protocol/town/compare/v0.12.1...v0.12.2) (2026-06-04)

### Bug Fixes

* **client:** chain-aware explicit-claim path (unblock Solana payment loop) ([#110](https://github.com/toon-protocol/town/issues/110)) ([2ec110c](https://github.com/toon-protocol/town/commit/2ec110c8450eb1e4b9d759a033ce10d6f2d01cf0))

## [0.12.1](https://github.com/toon-protocol/town/compare/v0.12.0...v0.12.1) (2026-06-04)

### Bug Fixes

* **client:** ESM-safe require for SOCKS5 transport deps ([#109](https://github.com/toon-protocol/town/issues/109)) ([2eca549](https://github.com/toon-protocol/town/commit/2eca549a5f75ffea75c885866dace264e5b59764))

## [0.12.0](https://github.com/toon-protocol/town/compare/v0.11.0...v0.12.0) (2026-06-04)

### Features

* **client,docker:** toon-client pays Solana through townhouse (Stage 2c) ([#106](https://github.com/toon-protocol/town/issues/106)) ([e6da845](https://github.com/toon-protocol/town/commit/e6da8450292a6dcb30eb8ace42dcb8dc4e24f066)), closes [#102](https://github.com/toon-protocol/town/issues/102) [#103](https://github.com/toon-protocol/town/issues/103) [#104](https://github.com/toon-protocol/town/issues/104) [#105](https://github.com/toon-protocol/town/issues/105)

## [0.11.0](https://github.com/toon-protocol/town/compare/v0.10.0...v0.11.0) (2026-06-04)

### Features

* **client:** open real on-chain Solana payment channel (Stage 2b) ([#105](https://github.com/toon-protocol/town/issues/105)) ([cbd9dfb](https://github.com/toon-protocol/town/commit/cbd9dfbb1382924569c344e32cbebcc666b721f6))

## [0.10.0](https://github.com/toon-protocol/town/compare/v0.9.0...v0.10.0) (2026-06-04)

### Features

* **town,e2e:** advertise Solana settlement + document Stage-2 client gate ([#104](https://github.com/toon-protocol/town/issues/104)) ([61ea651](https://github.com/toon-protocol/town/commit/61ea65132c5434737f076a1f8d820380e1a2f6f5))

## [0.9.0](https://github.com/toon-protocol/town/compare/v0.8.0...v0.9.0) (2026-06-04)

### Features

* **townhouse:** derive apex Solana + Mina settlement keys from mnemonic ([#103](https://github.com/toon-protocol/town/issues/103)) ([56d99f3](https://github.com/toon-protocol/town/commit/56d99f35304c1c2688b44e3be718e5805ef96f80)), closes [#101](https://github.com/toon-protocol/town/issues/101)

## [0.8.0](https://github.com/toon-protocol/town/compare/v0.7.0...v0.8.0) (2026-06-04)

### Features

* **client:** multi-chain mnemonic identity + real npm-consumer e2e ([#100](https://github.com/toon-protocol/town/issues/100)) ([66291f5](https://github.com/toon-protocol/town/commit/66291f5bb647c4abed2896fb8e1596862423a153))
* **townhouse:** derive apex settlement keyId from the operator mnemonic ([#101](https://github.com/toon-protocol/town/issues/101)) ([17f3ed8](https://github.com/toon-protocol/town/commit/17f3ed800a86879341fc7511542776558d1dff84))

## [0.7.0](https://github.com/toon-protocol/town/compare/v0.6.0...v0.7.0) (2026-06-03)

### Features

* **skills:** add townhouse-live-e2e orchestration skill ([#96](https://github.com/toon-protocol/town/issues/96)) ([ec8e6d5](https://github.com/toon-protocol/town/commit/ec8e6d50453c6c7700db336cc446cf5a6c418c9b))

## [0.6.0](https://github.com/toon-protocol/town/compare/v0.5.4...v0.6.0) (2026-06-03)

### Features

* **client:** add requestBlobStorage helper for kind:5094 Arweave blob uploads ([#92](https://github.com/toon-protocol/town/issues/92)) ([f666b38](https://github.com/toon-protocol/town/commit/f666b389c67d06f42990f66ac295e7d29dea780b))

### Bug Fixes

* **mill:** readable swap-handler logs + clarify mnemonic-derived swap recipient pubkey ([#94](https://github.com/toon-protocol/town/issues/94)) ([977fc91](https://github.com/toon-protocol/town/commit/977fc914b2a0b65e113e56e0f002b91764cd967a)), closes [#88](https://github.com/toon-protocol/town/issues/88) [#87](https://github.com/toon-protocol/town/issues/87) [#80](https://github.com/toon-protocol/town/issues/80) [#88](https://github.com/toon-protocol/town/issues/88)
* **townhouse:** populate NODE_NOSTR_PUBKEY in child node containers ([#81](https://github.com/toon-protocol/town/issues/81)) ([#95](https://github.com/toon-protocol/town/issues/95)) ([07a017f](https://github.com/toon-protocol/town/commit/07a017f6df167a7335eae5d6dc25558cc256ee27))

## [0.5.4](https://github.com/toon-protocol/town/compare/v0.5.3...v0.5.4) (2026-06-03)

### Bug Fixes

* **core:** pin F01 swap-handler reject code to invalid_request (F00) ([#90](https://github.com/toon-protocol/town/issues/90)) ([101714c](https://github.com/toon-protocol/town/commit/101714cee00b7ad47df3e4f0eea652266033c9d6)), closes [#86](https://github.com/toon-protocol/town/issues/86)
* **infra:** let faucet-evm.sh honor EVM_RPC_URL/ANVIL_HOST_RPC over stale Akash lease ([#85](https://github.com/toon-protocol/town/issues/85)) ([7ef89b9](https://github.com/toon-protocol/town/commit/7ef89b9c3ad8271a7acc895b6f0fc9f66cbc4f61)), closes [#83](https://github.com/toon-protocol/town/issues/83)
* **infra:** point Mina dev healthcheck + host port at GraphQL 3085 ([#84](https://github.com/toon-protocol/town/issues/84)) ([dc26462](https://github.com/toon-protocol/town/commit/dc2646228f079418fb91b61d7f99aa2ebdfd40db)), closes [#79](https://github.com/toon-protocol/town/issues/79)
* **townhouse-dev:** bootstrap Solana Mock USDC mint on dev stack ([#82](https://github.com/toon-protocol/town/issues/82)) ([#93](https://github.com/toon-protocol/town/issues/93)) ([3331e0a](https://github.com/toon-protocol/town/commit/3331e0a6ff7b364daf464767e4f2e743839fe2b9))

## [0.5.3](https://github.com/toon-protocol/town/compare/v0.5.2...v0.5.3) (2026-06-03)

### Bug Fixes

* **ci:** skip @anyone-protocol/anyone-client postinstall in installs ([#77](https://github.com/toon-protocol/town/issues/77)) ([85818d7](https://github.com/toon-protocol/town/commit/85818d7cd213d389f6e8f2ac823930d8e7a5e6a5))

## [0.5.2](https://github.com/toon-protocol/town/compare/v0.5.1...v0.5.2) (2026-06-03)

### Bug Fixes

* **townhouse:** wire parent↔child free-routing + DVM/mill job intake ([#76](https://github.com/toon-protocol/town/issues/76)) ([70d1b9f](https://github.com/toon-protocol/town/commit/70d1b9f49bacead43c6d46b7f8cb26f7a696b796))

## [0.5.1](https://github.com/toon-protocol/town/compare/v0.5.0...v0.5.1) (2026-06-03)

### Bug Fixes

* **core:** custom dev-chain EVM is anvil chain-id 31337 (not 31338) ([#75](https://github.com/toon-protocol/town/issues/75)) ([9c56d69](https://github.com/toon-protocol/town/commit/9c56d69c9380e88655190f245a7a31f8c95a4f94))

## [0.5.0](https://github.com/toon-protocol/town/compare/v0.4.0...v0.5.0) (2026-06-03)

### Features

* **core,townhouse:** custom network mode accepts RPC URLs (--evm-url/--sol-url) ([#74](https://github.com/toon-protocol/town/issues/74)) ([34f2aec](https://github.com/toon-protocol/town/commit/34f2aeccd2e4d1991599fccb581aa7fbda95f04f))

## [0.4.0](https://github.com/toon-protocol/town/compare/v0.3.2...v0.4.0) (2026-06-02)

### Features

* **townhouse:** network-mode flag (mainnet/testnet/devnet/custom) for apex + nodes ([#73](https://github.com/toon-protocol/town/issues/73)) ([3f87676](https://github.com/toon-protocol/town/commit/3f876761d0361e478baba139f773e1912960ab4d))

## [0.3.2](https://github.com/toon-protocol/town/compare/v0.3.1...v0.3.2) (2026-06-02)

### Bug Fixes

* **townhouse:** clearer message when node add hits the one-per-type limit ([#72](https://github.com/toon-protocol/town/issues/72)) ([14c791e](https://github.com/toon-protocol/town/commit/14c791ea87f284da2bc4cbf643290a6ffd5b874e))

## [0.3.1](https://github.com/toon-protocol/town/compare/v0.3.0...v0.3.1) (2026-06-02)

### Bug Fixes

* **townhouse:** bump connector pin to 3.8.1 (Mina dual-party settlement fix) ([#71](https://github.com/toon-protocol/town/issues/71)) ([5be2d84](https://github.com/toon-protocol/town/commit/5be2d84486b7c3119a6d7a206ba4d264a50a335e)), closes [toon-protocol/connector#84](https://github.com/toon-protocol/connector/issues/84) [#84](https://github.com/toon-protocol/town/issues/84)

## [0.3.0](https://github.com/toon-protocol/town/compare/v0.2.0...v0.3.0) (2026-06-02)

### Features

* **mill,sdk:** multi-chain Mill chainProviders (EVM/Solana/Mina) + SDK Mina settlement ([#70](https://github.com/toon-protocol/town/issues/70)) ([db3cb12](https://github.com/toon-protocol/town/commit/db3cb12f9cb676f655bd1a1f3b201871f7dcbaea))

## [0.2.0](https://github.com/toon-protocol/town/compare/v0.1.3...v0.2.0) (2026-06-02)

### Features

* **townhouse:** multi-chain connector settlement config (EVM/Solana/Mina) ([#69](https://github.com/toon-protocol/town/issues/69)) ([26a7e7c](https://github.com/toon-protocol/town/commit/26a7e7cf23770f98a45f1a533b7861305cce681a))

## [0.1.3](https://github.com/toon-protocol/town/compare/v0.1.2...v0.1.3) (2026-06-02)

### Bug Fixes

* **release:** use [skip release] not [skip ci] so the release tag triggers publish ([#66](https://github.com/toon-protocol/town/issues/66)) ([b1eb03a](https://github.com/toon-protocol/town/commit/b1eb03a833c7d37f82f482f4ae279d8b1c562107))
* **townhouse:** unbrick townhouse-api image + dashboard/hs-up UX polish ([#67](https://github.com/toon-protocol/town/issues/67)) ([ad282c8](https://github.com/toon-protocol/town/commit/ad282c833f181cca65eee98e90faf44d13a08ca3)), closes [#7](https://github.com/toon-protocol/town/issues/7)

## [0.1.2](https://github.com/toon-protocol/town/compare/v0.1.1...v0.1.2) (2026-06-02)

### Bug Fixes

* **townhouse:** repair npx CLI no-op + npm-facing UX/README ([#65](https://github.com/toon-protocol/town/issues/65)) ([dacdef5](https://github.com/toon-protocol/town/commit/dacdef5c6bd8be3ed232d8ce27552181e33e4b72))

## [0.1.1](https://github.com/toon-protocol/town/compare/v0.1.0...v0.1.1) (2026-06-01)

### Bug Fixes

* **townhouse:** sever runtime npm dep on @toon-protocol/mill (fixes npx 404) ([#64](https://github.com/toon-protocol/town/issues/64)) ([d532d83](https://github.com/toon-protocol/town/commit/d532d83bfe16ae1c16edbf0b27b0a5183d5f068c))
