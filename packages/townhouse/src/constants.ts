/**
 * Shared constants for Townhouse package.
 *
 * Single source of truth for values used across multiple modules
 * (orchestrator, config-generator, CLI).
 */

/** Container name prefix for all Townhouse-managed Docker containers */
export const CONTAINER_PREFIX = 'townhouse-';

/** Internal BTP port exposed by node containers (Docker-internal only) */
export const NODE_BTP_PORT = 3000;

/**
 * Default connector Docker image tag — single source of truth for the workspace.
 *
 * To bump: update this constant, run `pnpm --filter @toon-protocol/townhouse test contract-canary`,
 * then `pnpm --filter @toon-protocol/townhouse test:canary`. See packages/sdk/CONNECTOR_MIGRATION.md
 * for the full checklist and breaking-changes history.
 *
 * Story 44.1 (2026-05-07): bumped to v3.5.0 to consume `GET /admin/hs-hostname`
 * (connector#58 / PR #59). The :3.5.0 tag was published cleanly only after
 * connector PR #60 fixed a docker-release tag-resolution bug — earlier semver
 * tags on GHCR are shifted by one release (see connector#61). Pinning by
 * digest is preferable until Story 45.2's image-manifest.json formalizes it:
 *   ghcr.io/toon-protocol/connector@sha256:e8322ab06e6ded0bf2c9c6a7a59e22b22426277dc09fb8d1cb1951995f1c8309
 */
export const DEFAULT_CONNECTOR_IMAGE = 'ghcr.io/toon-protocol/connector:3.5.0';

/**
 * HD wallet account indices per node type (Story 21.4, D21-008).
 * BIP-44 paths: m/44'/{coin}'/ACCOUNT'/0/0
 */
export const ACCOUNT_INDEX_TOWN = 0;
export const ACCOUNT_INDEX_MILL = 1;
export const ACCOUNT_INDEX_DVM = 2;

/** BLS health port exposed by each node container type (internal Docker port). */
export const TOWN_HEALTH_PORT = 3100;
export const MILL_HEALTH_PORT = 3200;
export const DVM_HEALTH_PORT = 3400;
