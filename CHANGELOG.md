# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
