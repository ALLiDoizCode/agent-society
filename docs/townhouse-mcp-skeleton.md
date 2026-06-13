# Townhouse MCP Server — Skeleton (extracted from `@toon-protocol/client-mcp`)

Concrete starting skeleton for `@toon-protocol/townhouse-mcp`, adapted from the shipped `client-mcp` (main @ #221/#222). Companion to `docs/townhouse-mcp-design.md`.

## File-by-file mapping

| client-mcp | townhouse-mcp | adaptation |
|---|---|---|
| `src/mcp.ts` (stdio bin) | `src/mcp.ts` | near-verbatim; `ensureDaemon` → `autoUpIfEnabled` |
| `src/mcp-tools.ts` | `src/mcp-tools.ts` | same `TOOL_DEFINITIONS` + `dispatchTool(ok/err)` shape; `townhouse_*` tools routed to **api OR cli** |
| `src/control-client.ts` (HTTP→daemon) | `src/api-client.ts` | same `ApiError`/`Unreachable` + AbortController idiom, but targets the **existing** Fastify API `:9400` |
| `src/control-api.ts` (wire types) | *(reuse `@toon-protocol/townhouse` exported types)* | don't redefine — import them |
| `src/daemon/lifecycle.ts` (spawn detached + PID lock + waitForReady) | `src/apex-lifecycle.ts` | **key divergence below** — `up` is a bootstrap that exits, not a daemon |
| `src/daemon/config.ts` | `src/config.ts` | env precedence; `TOWNHOUSE_MNEMONIC`/`_API_URL`/`_CONFIG_DIR`/`_AUTOUP`/`_BIN` |
| `src/daemon.ts` (daemon bin) | — | **dropped**: the apex is the daemon (§0 of design) |
| `src/index.ts` | `src/index.ts` | exports |
| `tsup.config.ts` | `tsup.config.ts` | same noExternal/external bundling rationale |

### The one structural divergence — `up` is not a daemon

client-mcp **detaches** `toon-clientd run` because the daemon *is* the long-lived process and must outlive the ephemeral MCP session. For townhouse, **`townhouse up` is a bootstrap command that exits** once Docker containers are started — Docker (the connector + town/mill/dvm + the Fastify API) holds the long-lived apex independently.

But we still borrow client-mcp's **detached-spawn + append-log** idiom, for a different reason: a multi-minute `up`/`hs up` must survive the MCP session ending mid-boot. So:

- `up`/`hs_up` spawn `townhouse up --json` **detached**, piping its NDJSON progress to `<configDir>/up.log` (+ a small `up.status.json`).
- `up_status` **reads/tails that log**, so progress is available regardless of MCP-process lifetime.
- If the MCP server dies mid-boot, Docker containers already started persist; townhouse's `BootReconciler` + a follow-up `up`/`status` reconciles the rest.

This reuses `spawnDaemonDetached` almost verbatim (detached, `unref()`, `openSync(log,'a')`), just pointed at the CLI's `up` subcommand instead of a `run` daemon. No PID lock needed — townhouse owns single-apex enforcement; we add only a lightweight "is an up already in flight" guard via `up.status.json`.

---

## `src/mcp.ts`

```ts
#!/usr/bin/env node
/**
 * `townhouse-mcp` — thin MCP stdio server exposing the Townhouse OPERATOR
 * surface to a Claude agent (Desktop or Code). Holds NO chain keys: every tool
 * maps to either the `townhouse` CLI (lifecycle / config / $) or the apex
 * Fastify API :9400 (live telemetry). Unlike client-mcp there is NO second
 * daemon — the apex (connector + API, started by `townhouse up`) IS the
 * long-lived layer (see docs/townhouse-mcp-design.md §0).
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
} from '@modelcontextprotocol/sdk/types.js';
import { ApiClient } from './api-client.js';
import { CliDriver } from './cli-driver.js';
import { dispatchTool, TOOL_DEFINITIONS } from './mcp-tools.js';
import { resolveConfig } from './config.js';
import { autoUpIfEnabled } from './apex-lifecycle.js';

/** stdout carries the MCP protocol — all logging must go to stderr. */
function log(msg: string): void {
  console.error(`[townhouse-mcp] ${msg}`);
}

async function main(): Promise<void> {
  const cfg = resolveConfig();
  const api = new ApiClient({ baseUrl: cfg.apiUrl });
  const cli = new CliDriver(cfg); // bin, configDir, mnemonic, env passthrough

  // Kick off apex bring-up; don't block server init (image pulls / HS bootstrap
  // are slow). Tools report "booting — retry" until the API answers.
  void autoUpIfEnabled(api, cli, cfg);

  const server = new Server(
    { name: 'townhouse-operator', version: '0.1.0' },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOL_DEFINITIONS,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params.name;
    const args = (request.params.arguments ?? {}) as Record<string, unknown>;
    return (await dispatchTool({ api, cli, cfg }, name, args)) as CallToolResult;
  });

  await server.connect(new StdioServerTransport());
  log(`ready; api=${cfg.apiUrl} bin=${cfg.townhouseBin}`);
}

main().catch((err) => {
  log(err instanceof Error ? (err.stack ?? err.message) : String(err));
  process.exitCode = 1;
});
```

---

## `src/api-client.ts` (← control-client.ts)

```ts
/**
 * Thin HTTP client for the apex Fastify control API (`127.0.0.1:9400`, started
 * by `townhouse up`). Live telemetry + money/config endpoints. Holds no keys;
 * the apex owns the wallet. Mirrors client-mcp's ControlClient error/timeout idiom.
 */
import type {
  // Reuse the exact request/response types exported from @toon-protocol/townhouse
  // so the wire shape stays in lockstep (earnings, balances, nodes, withdraw…).
} from '@toon-protocol/townhouse';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryable: boolean,
    readonly detail?: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Thrown when the apex API is unreachable (stack not up / wrong port). */
export class ApexUnreachableError extends Error {
  constructor(readonly baseUrl: string, readonly causedBy?: unknown) {
    super(`townhouse apex API not reachable at ${baseUrl}`);
    this.name = 'ApexUnreachableError';
  }
}

export interface ApiClientOptions {
  baseUrl: string;
  /** Per-request timeout, ms. Default 35000 (withdraw waits on broadcast). */
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export class ApiClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: ApiClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.timeoutMs = opts.timeoutMs ?? 35_000;
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  }

  /** Liveness probe: does the apex API answer GET /api/nodes? */
  async ping(): Promise<boolean> {
    try {
      await this.request('GET', '/api/nodes');
      return true;
    } catch (err) {
      if (err instanceof ApexUnreachableError) return false;
      return err instanceof ApiError; // reachable-but-errored still counts as up
    }
  }

  // ── Telemetry / read ────────────────────────────────────────────────────
  listNodes() { return this.request('GET', '/api/nodes'); }
  nodeRuntime() { return this.request('GET', '/nodes'); }
  earnings() { return this.request('GET', '/api/earnings'); }
  balances() { return this.request('GET', '/wallet/balances'); }
  chains() { return this.request('GET', '/api/chains'); }
  transport() { return this.request('GET', '/api/transport'); }
  network() { return this.request('GET', '/api/network'); }

  // ── Mutate (money / topology) ─────────────────────────────────────────────
  addNode(body: { type: 'town' | 'mill' | 'dvm' }) { return this.request('POST', '/api/nodes', body); }
  removeNode(id: string) { return this.request('DELETE', `/api/nodes/${id}`); }
  setNodeConfig(type: string, body: unknown) { return this.request('PATCH', `/nodes/${type}/config`, body); }
  withdraw(body: unknown) { return this.request('POST', '/wallet/withdraw', body); }
  setTransport(body: unknown) { return this.request('PATCH', '/api/transport', body); }
  setNetwork(body: unknown) { return this.request('PATCH', '/api/network', body); }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method,
        headers: body ? { 'content-type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch (err) {
      throw new ApexUnreachableError(this.baseUrl, err);
    } finally {
      clearTimeout(timer);
    }
    const text = await res.text();
    const json = text ? safeJson(text) : undefined;
    if (!res.ok) {
      const e = (json ?? {}) as { error?: string; retryable?: boolean; detail?: string };
      throw new ApiError(e.error ?? `HTTP ${res.status}`, res.status, e.retryable ?? res.status === 503, e.detail);
    }
    return json as T;
  }
}

function safeJson(t: string): unknown { try { return JSON.parse(t); } catch { return undefined; } }
```

---

## `src/cli-driver.ts` (new — no client-mcp analog, the operator's lifecycle surface)

```ts
/**
 * Drives the `townhouse` CLI for lifecycle + config + money mutations that the
 * Fastify API doesn't cover (and that must work BEFORE the apex is up). Always
 * consumes `--json`; never scrapes human text. Injects TOWNHOUSE_MNEMONIC and
 * config dir into the child env (keys live at the townhouse layer, §3).
 */
import { spawn } from 'node:child_process';
import type { ResolvedConfig } from './config.js';

export class CliError extends Error {
  constructor(message: string, readonly exitCode: number, readonly stderr: string) {
    super(message);
    this.name = 'CliError';
  }
}

export class CliDriver {
  constructor(private readonly cfg: ResolvedConfig) {}

  private childEnv(): NodeJS.ProcessEnv {
    return {
      ...process.env,
      ...(this.cfg.mnemonic ? { TOWNHOUSE_MNEMONIC: this.cfg.mnemonic } : {}),
      ...(this.cfg.configDir ? { TOWNHOUSE_CONFIG_DIR: this.cfg.configDir } : {}),
    };
  }

  /** Run a short-lived command with `--json`, parse one JSON object. */
  async runJson<T>(args: string[]): Promise<T> {
    const { stdout, stderr, code } = await this.exec([...args, '--json']);
    if (code !== 0) throw new CliError(`townhouse ${args.join(' ')} exited ${code}`, code, stderr);
    return JSON.parse(stdout) as T;
  }

  /** Low-level spawn → buffered {stdout,stderr,code}. */
  private exec(args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.cfg.townhouseBin, args, { env: this.childEnv() });
      let stdout = '', stderr = '';
      child.stdout.on('data', (d) => (stdout += d));
      child.stderr.on('data', (d) => (stderr += d));
      child.on('error', reject);
      child.on('close', (code) => resolve({ stdout, stderr, code: code ?? -1 }));
    });
  }
}
```

---

## `src/apex-lifecycle.ts` (← daemon/lifecycle.ts, retargeted to `up`)

```ts
/**
 * Apex bring-up. NOT a daemon (the apex is Docker-resident); this only handles
 * the long-running `townhouse up`/`hs up` bootstrap: spawn it DETACHED with its
 * NDJSON progress appended to <configDir>/up.log so a multi-minute boot survives
 * the ephemeral MCP session, and so `up_status` can read progress from the log.
 * Reuses client-mcp's spawnDaemonDetached idiom (detached + unref + append log).
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, openSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ApiClient } from './api-client.js';
import type { CliDriver } from './cli-driver.js';
import type { ResolvedConfig } from './config.js';

export function upLogPath(cfg: ResolvedConfig): string {
  return join(cfg.configDir, 'up.log');
}

/** Is the apex API answering? */
export async function isApexReachable(api: ApiClient): Promise<boolean> {
  return api.ping();
}

/** Spawn `townhouse up` detached, NDJSON → up.log. Returns child pid. */
export function spawnUpDetached(cfg: ResolvedConfig, transport: 'direct' | 'hs' = 'direct'): number {
  mkdirSync(cfg.configDir, { recursive: true });
  const out = openSync(upLogPath(cfg), 'a'); // append; never truncate operator history
  const args = transport === 'hs' ? ['hs', 'up', '--json'] : ['up', '--json'];
  const child = spawn(cfg.townhouseBin, args, {
    detached: true,
    stdio: ['ignore', out, out],
    env: {
      ...process.env,
      ...(cfg.mnemonic ? { TOWNHOUSE_MNEMONIC: cfg.mnemonic } : {}),
      TOWNHOUSE_CONFIG_DIR: cfg.configDir,
    },
  });
  child.unref();
  if (child.pid === undefined) throw new Error('Failed to spawn `townhouse up` (no pid)');
  return child.pid;
}

/** Read the latest progress events from up.log (NDJSON, partial-line safe). */
export function readUpStatus(cfg: ResolvedConfig): { events: unknown[]; done: boolean } {
  const path = upLogPath(cfg);
  if (!existsSync(path)) return { events: [], done: false };
  const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean);
  const events = lines.map((l) => safeJson(l)).filter(Boolean);
  const done = events.some((e: any) => e?.step === 'done' || e?.step === 'error');
  return { events, done };
}

/** If AUTOUP and the apex is down, kick off `up` once. Best-effort, non-blocking. */
export async function autoUpIfEnabled(api: ApiClient, _cli: CliDriver, cfg: ResolvedConfig): Promise<void> {
  if (!cfg.autoUp) return;
  if (await isApexReachable(api)) return;
  // Lightweight in-flight guard so we don't double-up.
  const { events, done } = readUpStatus(cfg);
  if (events.length > 0 && !done) return; // an up is already running
  try { spawnUpDetached(cfg, cfg.transport); } catch { /* surfaced via tool errors */ }
}

function safeJson(t: string): unknown { try { return JSON.parse(t); } catch { return undefined; } }
```

---

## `src/mcp-tools.ts` (← mcp-tools.ts) — abbreviated

Same shape as client-mcp: a `TOOL_DEFINITIONS` array of JSON-Schema tools and a single `dispatchTool` switch that **always resolves a `ToolResult`** (errors encoded as `isError:true` text, never thrown). The only structural difference is that dispatch routes to **either `api` or `cli`** depending on the tool, and `apex_booting` maps to a "booting — retry" message exactly like client-mcp's "bootstrapping — retry".

```ts
import { ApiError, ApexUnreachableError } from './api-client.js';
import type { ApiClient } from './api-client.js';
import type { CliDriver } from './cli-driver.js';
import type { ResolvedConfig } from './config.js';
import { readUpStatus, spawnUpDetached } from './apex-lifecycle.js';

export interface ToolDefinition { name: string; description: string; inputSchema: Record<string, unknown>; }
export interface ToolResult { content: { type: 'text'; text: string }[]; isError?: boolean; }
export interface ToolCtx { api: ApiClient; cli: CliDriver; cfg: ResolvedConfig; }

const EMPTY = { type: 'object', properties: {}, additionalProperties: false } as const;

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  // ── lifecycle ──
  { name: 'townhouse_init', description: 'Create config; load TOWNHOUSE_MNEMONIC or generate+return a fresh seed.', inputSchema: { type: 'object', properties: { preset: { type: 'string' }, network: { type: 'string' } }, additionalProperties: false } },
  { name: 'townhouse_up', description: 'Boot the apex (direct default). Returns a handle; poll townhouse_up_status.', inputSchema: { type: 'object', properties: { transport: { type: 'string', enum: ['direct', 'hs'] } }, additionalProperties: false } },
  { name: 'townhouse_up_status', description: 'Per-step boot progress from the up.log job record.', inputSchema: EMPTY },
  { name: 'townhouse_down', description: 'Stop the apex stack.', inputSchema: { type: 'object', properties: { hs: { type: 'boolean' } }, additionalProperties: false } },
  { name: 'townhouse_status', description: 'Apex/connector/node/.anyone health.', inputSchema: EMPTY },
  // ── nodes ──
  { name: 'townhouse_list_nodes', description: 'List provisioned nodes.', inputSchema: EMPTY },
  { name: 'townhouse_add_node', description: 'Provision a town|mill|dvm node.', inputSchema: { type: 'object', properties: { type: { type: 'string', enum: ['town', 'mill', 'dvm'] } }, required: ['type'], additionalProperties: false } },
  { name: 'townhouse_remove_node', description: 'Deprovision a node by id.', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false } },
  { name: 'townhouse_set_node_fees', description: 'Tune town feePerEvent / mill feeBasisPoints / dvm feePerJob+kindPricing.', inputSchema: { type: 'object', properties: { type: { type: 'string' }, feePerEvent: { type: 'number' }, feeBasisPoints: { type: 'number' }, feePerJob: { type: 'number' }, kindPricing: { type: 'object' }, enabled: { type: 'boolean' } }, required: ['type'], additionalProperties: false } },
  // ── chains / transport ──
  { name: 'townhouse_chains', description: 'List/add/remove settlement chains.', inputSchema: { type: 'object', properties: { op: { type: 'string', enum: ['list', 'add', 'remove'] } }, additionalProperties: true } },
  { name: 'townhouse_transport', description: 'Get or flip transport (direct ↔ hidden-service).', inputSchema: { type: 'object', properties: { set: { type: 'string', enum: ['direct', 'hs'] } }, additionalProperties: false } },
  // ── wallet / earnings / $ ──
  { name: 'townhouse_balances', description: 'EVM/SOL/AR balances.', inputSchema: EMPTY },
  { name: 'townhouse_earnings', description: 'Apex + per-peer earnings with deltas.', inputSchema: EMPTY },
  { name: 'townhouse_seed', description: 'Reveal the operator mnemonic for backup (agent owns it).', inputSchema: EMPTY },
  { name: 'townhouse_withdraw', description: 'Withdraw earnings to a recipient (EVM v1). Optional dryRun for an estimate.', inputSchema: { type: 'object', properties: { nodeType: { type: 'string' }, chainFamily: { type: 'string' }, token: { type: 'string' }, recipient: { type: 'string' }, amount: { type: 'string' }, dryRun: { type: 'boolean' } }, required: ['nodeType', 'chainFamily', 'token', 'recipient', 'amount'], additionalProperties: false } },
  { name: 'townhouse_credits', description: 'Buy / check Arweave upload credits.', inputSchema: { type: 'object', properties: { op: { type: 'string', enum: ['buy', 'balance'] }, token: { type: 'string' }, amount: { type: 'string' }, quoteOnly: { type: 'boolean' } }, required: ['op'], additionalProperties: false } },
  // ── telemetry ──
  { name: 'townhouse_logs', description: 'Tail a bounded slice of node logs.', inputSchema: { type: 'object', properties: { service: { type: 'string' }, level: { type: 'string' }, maxLines: { type: 'number' } }, additionalProperties: false } },
  { name: 'townhouse_metrics', description: 'One connector metrics snapshot.', inputSchema: EMPTY },
  { name: 'townhouse_channels', description: 'Open payment channels.', inputSchema: EMPTY },
  { name: 'townhouse_health', description: 'Probe apex/api/nodes/.anyone.', inputSchema: EMPTY },
];

export async function dispatchTool(ctx: ToolCtx, name: string, args: Record<string, unknown>): Promise<ToolResult> {
  const { api, cli, cfg } = ctx;
  try {
    switch (name) {
      // lifecycle → CLI / job record
      case 'townhouse_init': return ok(await cli.runJson(['init', ...presetArgs(args)]));
      case 'townhouse_up': { const pid = spawnUpDetached(cfg, (args['transport'] as any) ?? cfg.transport); return ok({ started: true, pid, poll: 'townhouse_up_status' }); }
      case 'townhouse_up_status': return ok(readUpStatus(cfg));
      case 'townhouse_down': return ok(await cli.runJson(args['hs'] ? ['hs', 'down'] : ['down']));
      case 'townhouse_status': return ok(await statusPreferApi(ctx));
      // nodes → API when up, CLI fallback
      case 'townhouse_list_nodes': return ok(await api.listNodes());
      case 'townhouse_add_node': return ok(await api.addNode({ type: args['type'] as any }));
      case 'townhouse_remove_node': return ok(await api.removeNode(String(args['id'])));
      case 'townhouse_set_node_fees': return ok(await api.setNodeConfig(String(args['type']), stripType(args)));
      // chains / transport
      case 'townhouse_chains': return ok(await chains(ctx, args));
      case 'townhouse_transport': return ok(args['set'] ? await api.setTransport({ mode: args['set'] }) : await api.transport());
      // wallet / $
      case 'townhouse_balances': return ok(await api.balances());
      case 'townhouse_earnings': return ok(await api.earnings());
      case 'townhouse_seed': return ok(await cli.runJson(['wallet', 'seed', '--confirm']));
      case 'townhouse_withdraw': return ok(await api.withdraw(args));
      case 'townhouse_credits': return ok(await credits(cli, args));
      // telemetry
      case 'townhouse_logs': return ok(await tailLogs(ctx, args));
      case 'townhouse_metrics': return ok(await metricsSnapshot(ctx));
      case 'townhouse_channels': return ok(await cli.runJson(['channels']));
      case 'townhouse_health': return ok(await cli.runJson(['health']));
      default: return err(`Unknown tool: ${name}`);
    }
  } catch (e) {
    if (e instanceof ApexUnreachableError) {
      // Mirror client-mcp's "bootstrapping — retry": the apex may be booting.
      return err(`Townhouse apex API not reachable at ${e.baseUrl}. If AUTOUP is on it may be booting (image pulls / HS bootstrap can take minutes) — poll townhouse_up_status and retry. Check ${cfg.configDir}/up.log.`);
    }
    if (e instanceof ApiError && e.retryable) return err(`Apex busy/booting — retry shortly. (${e.message})`);
    if (e instanceof ApiError) return err(`${e.message}${e.detail ? `: ${e.detail}` : ''}`);
    return err(e instanceof Error ? e.message : String(e));
  }
}

const ok = (d: unknown): ToolResult => ({ content: [{ type: 'text', text: JSON.stringify(d, null, 2) }] });
const err = (m: string): ToolResult => ({ content: [{ type: 'text', text: m }], isError: true });

// (helpers presetArgs/stripType/chains/credits/statusPreferApi/tailLogs/metricsSnapshot omitted — thin glue)
```

---

## `src/config.ts` (← daemon/config.ts) — env precedence

```ts
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface ResolvedConfig {
  apiUrl: string;       // TOWNHOUSE_API_URL              default http://127.0.0.1:9400
  mnemonic?: string;    // TOWNHOUSE_MNEMONIC             operator seed (no password, §3)
  configDir: string;    // TOWNHOUSE_CONFIG_DIR           default ~/.townhouse
  townhouseBin: string; // TOWNHOUSE_BIN                  default 'townhouse' (PATH)
  autoUp: boolean;      // TOWNHOUSE_AUTOUP               default true
  transport: 'direct' | 'hs'; // TOWNHOUSE_TRANSPORT_MODE default direct
}

export function resolveConfig(env = process.env): ResolvedConfig {
  return {
    apiUrl: env['TOWNHOUSE_API_URL'] ?? 'http://127.0.0.1:9400',
    ...(env['TOWNHOUSE_MNEMONIC'] ? { mnemonic: env['TOWNHOUSE_MNEMONIC'] } : {}),
    configDir: env['TOWNHOUSE_CONFIG_DIR'] ?? join(homedir(), '.townhouse'),
    townhouseBin: env['TOWNHOUSE_BIN'] ?? 'townhouse',
    autoUp: env['TOWNHOUSE_AUTOUP'] !== '0',
    transport: env['TOWNHOUSE_TRANSPORT_MODE'] === 'hs' ? 'hs' : 'direct',
  };
}
```

---

## `tsup.config.ts` (← client-mcp, simplified — one stdio bin, no daemon)

```ts
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/mcp.ts'], // library + the single stdio bin
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  outDir: 'dist',
  banner: { js: `import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);` },
  // Inline workspace + crypto deps (not on npm / avoid version skew) — same
  // rationale as @toon-protocol/townhouse & client-mcp.
  noExternal: ['@toon-protocol/townhouse', '@toon-protocol/core', '@noble/curves', '@noble/hashes', '@scure/bip32', '@scure/bip39'],
  external: ['o1js', 'mina-signer', '@solana/web3.js', 'socks-proxy-agent'],
});
```

## `package.json` (sketch)

```jsonc
{
  "name": "@toon-protocol/townhouse-mcp",
  "version": "0.1.0",
  "type": "module",
  "bin": { "townhouse-mcp": "./dist/mcp.js" },
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "files": ["dist", "README.md"],
  "scripts": {
    "build": "tsup",
    "test": "vitest run",
    "test:integration": "vitest run --config vitest.integration.config.ts"
  },
  "dependencies": { "@modelcontextprotocol/sdk": "^1.12.0", "ws": "^8.18.0" },
  "devDependencies": { "@toon-protocol/townhouse": "workspace:*", "tsup": "...", "vitest": "..." },
  "publishConfig": { "access": "public" }
}
```

## Registration (README) — mirrors client-mcp's table

| | Name |
|---|---|
| npm package | `@toon-protocol/townhouse-mcp` |
| MCP server name (handshake) | `townhouse-operator` |
| MCP server bin | `townhouse-mcp` |

```bash
claude mcp add townhouse -e TOWNHOUSE_MNEMONIC="word1 … word12" -- townhouse-mcp
```
```json
{ "mcpServers": { "townhouse": { "command": "townhouse-mcp",
  "env": { "TOWNHOUSE_MNEMONIC": "word1 … word12" } } } }
```

---

## Testable seams (mirror client-mcp's 68-test split)

- **`mcp-tools.ts`** — `dispatchTool` is pure (inject a fake `ApiClient`/`CliDriver`); unit-test the tool→api/cli mapping + the `apex_booting`/error encoding. (client-mcp tests this exact seam.)
- **`api-client.ts`** — inject `fetchImpl`; assert method/path/body + `ApiError`/`ApexUnreachableError` mapping.
- **`apex-lifecycle.ts`** — `readUpStatus` against a fixture `up.log` (partial-line + done/error detection); `autoUpIfEnabled` in-flight guard.
- **gated live integration** (`RUN_LIVE_OPERATOR_E2E`, like client-mcp's `RUN_LIVE_HS_E2E`) — real `townhouse init`→`up`→`add_node`→`earnings`→`withdraw(dryRun)` against local Docker chains.
