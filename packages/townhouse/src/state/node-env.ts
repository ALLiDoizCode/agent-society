/**
 * Per-node container environment assembly — shared by the provisioning route
 * (`POST /api/nodes`, src/api/routes/nodes-lifecycle.ts) and the boot rebinder
 * (src/rebind.ts), so a node started at `node add` time and the same node
 * restarted on `hs up` get byte-identical env. Keeping this in `state/` (not the
 * routes layer) lets the CLI rebind path import it without pulling Fastify.
 *
 * NEVER log the *_SECRET_KEY / *_SETTLEMENT_PRIVATE_KEY / *_MNEMONIC / TURBO_TOKEN
 * values produced here — they are secrets.
 */

import { resolveConfigNetworkProfile } from '../config/network-profile.js';
import type { TownhouseConfig } from '../config/schema.js';
import type { NodeType } from '../api/types.js';

/**
 * Resolve the network-mode chain env (EVM_CHAIN/EVM_RPC_URL/EVM_CHAIN_ID/
 * EVM_USDC_ADDRESS/SOLANA_*) the compose template interpolates into the
 * town/mill containers. Same source of truth as the apex connector
 * (hs-config-writer) and the `.env` written by env-writer — so children use the
 * public RPCs for the operator's chosen network instead of the unreachable local
 * `anvil` default (the cause of the "disconnected" boot-loop).
 */
export function buildNetworkNodeEnv(
  config: TownhouseConfig
): Record<string, string> {
  const profile = resolveConfigNetworkProfile(config);
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(profile.nodeEnv)) {
    if (value !== undefined) env[key] = value;
  }
  return env;
}

/**
 * Build the per-node secret/identity env overlay. Callers start from
 * `process.env` and layer this on top (done inside `startNodeViaCompose`); the
 * returned object is the SECRET OVERLAY ONLY.
 */
export function buildNodeEnv(
  type: NodeType,
  nostrSecretKeyHex: string,
  nostrPubkeyHex: string,
  evmPrivateKeyHex: string,
  mnemonic: string | null,
  apexEvmAddress: string,
  chainEnv: Record<string, string>
): Record<string, string> {
  // Town's TOON_SETTLEMENT_PRIVATE_KEY (and mill's settlement key) requires a
  // 0x-prefixed 32-byte hex string. bytesToHex returns unprefixed hex — without
  // the 0x, town crashes at boot with `TOON_SETTLEMENT_PRIVATE_KEY must be a
  // 0x-prefixed 32-byte hex string` (Story 46.4 Finding O).
  const evmPrivateKeyHex0x = `0x${evmPrivateKeyHex}`;
  // The *_NOSTR_PUBKEY overlay is the x-only pubkey derived from the same secret
  // the container already receives — purely informational so operators / SDK
  // clients can read it via `docker inspect` / `node list --json` (issue #81).
  switch (type) {
    case 'town':
      return {
        TOWN_SECRET_KEY: nostrSecretKeyHex,
        TOWN_NOSTR_PUBKEY: nostrPubkeyHex,
        TOWN_SETTLEMENT_PRIVATE_KEY: evmPrivateKeyHex0x,
        APEX_EVM_ADDRESS: apexEvmAddress,
        ...chainEnv,
      };
    case 'mill':
      return {
        MILL_SECRET_KEY: nostrSecretKeyHex,
        MILL_NOSTR_PUBKEY: nostrPubkeyHex,
        MILL_SETTLEMENT_PRIVATE_KEY: evmPrivateKeyHex0x,
        MILL_MNEMONIC: mnemonic ?? '',
        APEX_EVM_ADDRESS: apexEvmAddress,
        ...chainEnv,
      };
    case 'dvm':
      // DVM does no on-chain settlement — no chain env needed.
      return {
        DVM_SECRET_KEY: nostrSecretKeyHex,
        DVM_NOSTR_PUBKEY: nostrPubkeyHex,
      };
  }
}

/**
 * Resolve the mill's Nostr relay URLs with precedence: explicit `bodyRelays`
 * (the `--relays` flag) > persisted `config.nodes.mill.relays` > legacy
 * `MILL_RELAYS` env var (back-compat for operators who exported it before
 * `townhouse hs up`). Trims and drops blank entries. Returns [] when nothing is
 * supplied anywhere — callers turn that into an actionable 400 (provision) or a
 * skip (rebind). Resolving from the request body and config (not just
 * process.env) is what frees `node add mill` from the "MILL_RELAYS must be
 * exported before hs up or the API never sees it" trap.
 */
export function resolveMillRelays(
  bodyRelays: string[] | undefined,
  config: TownhouseConfig
): string[] {
  const fromBody = (bodyRelays ?? []).map((r) => r.trim()).filter(Boolean);
  if (fromBody.length > 0) return fromBody;
  const fromConfig = (config.nodes.mill.relays ?? [])
    .map((r) => r.trim())
    .filter(Boolean);
  if (fromConfig.length > 0) return fromConfig;
  return (process.env['MILL_RELAYS'] ?? '')
    .split(',')
    .map((r) => r.trim())
    .filter(Boolean);
}

/**
 * Resolve the DVM's Arweave Turbo credential with the same precedence chain:
 * `--turbo-token` > `config.nodes.dvm.turboToken` > legacy `TURBO_TOKEN` env.
 * Returns '' when unset anywhere — the DVM boots fine without it (free-tier
 * <100KB uploads still work), so this is intentionally NOT a hard requirement,
 * only an injected value when present.
 */
export function resolveDvmTurboToken(
  bodyToken: string | undefined,
  config: TownhouseConfig
): string {
  return (
    bodyToken?.trim() ||
    config.nodes.dvm.turboToken?.trim() ||
    process.env['TURBO_TOKEN']?.trim() ||
    ''
  );
}

/** Inputs for {@link assembleNodeEnv}. */
export interface AssembleNodeEnvParams {
  type: NodeType;
  nostrSecretKeyHex: string;
  nostrPubkey: string;
  evmPrivateKeyHex: string;
  mnemonic: string | null;
  apexEvmAddress: string;
  config: TownhouseConfig;
  /** mill: pre-resolved relays (from `--relays`). Omit to resolve config/env. */
  relays?: string[];
  /** dvm: pre-resolved Turbo token (from `--turbo-token`). Omit to resolve config/env. */
  turboToken?: string;
}

/**
 * Assemble the COMPLETE container env overlay for one node: identity/secret keys
 * + network chain env + the resolved operator inputs (mill `MILL_RELAYS`, dvm
 * `TURBO_TOKEN`). This is the single source both provisioning and rebind use so
 * the two paths never diverge. When `relays`/`turboToken` are omitted they are
 * resolved from config/env via {@link resolveMillRelays}/{@link resolveDvmTurboToken}.
 */
export function assembleNodeEnv(
  params: AssembleNodeEnvParams
): Record<string, string> {
  const { type, config } = params;
  const env = buildNodeEnv(
    type,
    params.nostrSecretKeyHex,
    params.nostrPubkey,
    params.evmPrivateKeyHex,
    params.mnemonic,
    params.apexEvmAddress,
    buildNetworkNodeEnv(config)
  );
  if (type === 'mill') {
    const relays =
      params.relays && params.relays.length > 0
        ? params.relays
        : resolveMillRelays(undefined, config);
    env['MILL_RELAYS'] = relays.join(',');
  }
  if (type === 'dvm') {
    const token =
      params.turboToken?.trim() || resolveDvmTurboToken(undefined, config);
    if (token) env['TURBO_TOKEN'] = token;
  }
  return env;
}
