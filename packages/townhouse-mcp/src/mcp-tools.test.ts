import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock apex-lifecycle so lifecycle tools don't touch fs / spawn real processes.
vi.mock('./apex-lifecycle.js', () => ({
  spawnUpDetached: vi.fn(() => 4242),
  readUpStatus: vi.fn(() => ({ events: ['e'], done: true, failed: false })),
}));

import { dispatchTool, TOOL_DEFINITIONS, type ToolCtx } from './mcp-tools.js';
import { ApiError, ApexUnreachableError } from './api-client.js';
import { CliError } from './cli-driver.js';
import { spawnUpDetached, readUpStatus } from './apex-lifecycle.js';
import type { ApiClient } from './api-client.js';
import type { CliDriver } from './cli-driver.js';
import type { ResolvedConfig } from './config.js';

function ctx(over: {
  api?: Partial<ApiClient>;
  cli?: Partial<CliDriver>;
  cfg?: Partial<ResolvedConfig>;
}): ToolCtx {
  return {
    api: (over.api ?? {}) as unknown as ApiClient,
    cli: (over.cli ?? {}) as unknown as CliDriver,
    cfg: {
      apiUrl: 'http://127.0.0.1:9400',
      configDir: '/tmp/th',
      townhouseBin: 'townhouse',
      autoUp: true,
      transport: 'direct',
      ...over.cfg,
    },
  };
}

const parse = (r: { content: { text: string }[] }): unknown =>
  JSON.parse(r.content[0]!.text);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('TOOL_DEFINITIONS', () => {
  it('exposes the documented operator surface', () => {
    expect(TOOL_DEFINITIONS.map((t) => t.name).sort()).toEqual(
      [
        'townhouse_add_node',
        'townhouse_balances',
        'townhouse_chains',
        'townhouse_channels',
        'townhouse_credits',
        'townhouse_down',
        'townhouse_earnings',
        'townhouse_health',
        'townhouse_init',
        'townhouse_list_nodes',
        'townhouse_logs',
        'townhouse_metrics',
        'townhouse_remove_node',
        'townhouse_seed',
        'townhouse_set_node_fees',
        'townhouse_status',
        'townhouse_transport',
        'townhouse_up',
        'townhouse_up_status',
        'townhouse_withdraw',
      ].sort()
    );
  });

  it('every tool has an object input schema + description', () => {
    for (const t of TOOL_DEFINITIONS) {
      expect(t.inputSchema['type']).toBe('object');
      expect(typeof t.description).toBe('string');
    }
  });
});

describe('dispatchTool — API-backed tools', () => {
  it('townhouse_balances returns the API payload as JSON', async () => {
    const api = { balances: vi.fn().mockResolvedValue({ entries: [], ts: 1 }) };
    const res = await dispatchTool(ctx({ api }), 'townhouse_balances', {});
    expect(res.isError).toBeFalsy();
    expect(parse(res)).toEqual({ entries: [], ts: 1 });
  });

  it('townhouse_add_node forwards the node type', async () => {
    const api = {
      addNode: vi.fn().mockResolvedValue({ step: 'register-peer' }),
    };
    await dispatchTool(ctx({ api }), 'townhouse_add_node', { type: 'mill' });
    expect(api.addNode).toHaveBeenCalledWith({ type: 'mill' });
  });

  it('townhouse_set_node_fees strips `type` from the patch body', async () => {
    const api = { setNodeConfig: vi.fn().mockResolvedValue({ ok: true }) };
    await dispatchTool(ctx({ api }), 'townhouse_set_node_fees', {
      type: 'town',
      feePerEvent: 5,
    });
    expect(api.setNodeConfig).toHaveBeenCalledWith('town', { feePerEvent: 5 });
  });

  it('townhouse_withdraw passes the request through', async () => {
    const api = { withdraw: vi.fn().mockResolvedValue({ txHash: '0xabc' }) };
    const args = {
      nodeType: 'town',
      chainFamily: 'evm',
      token: 'native',
      recipient: '0x0',
      amount: '1',
    };
    await dispatchTool(ctx({ api }), 'townhouse_withdraw', args);
    expect(api.withdraw).toHaveBeenCalledWith(args);
  });
});

describe('dispatchTool — CLI-backed tools', () => {
  it('townhouse_chains op=list reads the API', async () => {
    const api = { chains: vi.fn().mockResolvedValue([{ chainType: 'evm' }]) };
    await dispatchTool(ctx({ api }), 'townhouse_chains', { op: 'list' });
    expect(api.chains).toHaveBeenCalled();
  });

  it('townhouse_chains op=add shells the CLI with passthrough args', async () => {
    const cli = { runJson: vi.fn().mockResolvedValue({ ok: true }) };
    await dispatchTool(ctx({ cli }), 'townhouse_chains', {
      op: 'add',
      args: ['--chain-type', 'evm'],
    });
    expect(cli.runJson).toHaveBeenCalledWith([
      'chains',
      'add',
      '--chain-type',
      'evm',
    ]);
  });

  it('townhouse_credits op=balance shells the CLI with --token', async () => {
    const cli = { runJson: vi.fn().mockResolvedValue({ credits: '0' }) };
    await dispatchTool(ctx({ cli }), 'townhouse_credits', {
      op: 'balance',
      token: 'eth',
    });
    expect(cli.runJson).toHaveBeenCalledWith([
      'credits',
      'balance',
      '--token',
      'eth',
    ]);
  });

  it('townhouse_logs tails NDJSON and filters by service', async () => {
    const cli = {
      runNdjson: vi.fn().mockResolvedValue([
        { service: 'town', level: 'info', message: 'a' },
        { service: 'mill', level: 'info', message: 'b' },
      ]),
    };
    const res = await dispatchTool(ctx({ cli }), 'townhouse_logs', {
      service: 'town',
    });
    expect(cli.runNdjson).toHaveBeenCalledWith(['logs', '--lines', '100']);
    expect(parse(res)).toMatchObject({ count: 1 });
  });
});

describe('dispatchTool — lifecycle (mocked apex-lifecycle)', () => {
  it('townhouse_up spawns detached and returns a poll handle', async () => {
    const res = await dispatchTool(ctx({}), 'townhouse_up', {});
    expect(spawnUpDetached).toHaveBeenCalledWith(
      expect.objectContaining({ townhouseBin: 'townhouse' }),
      'direct'
    );
    expect(parse(res)).toMatchObject({
      started: true,
      pid: 4242,
      poll: 'townhouse_up_status',
    });
  });

  it('townhouse_up honours an explicit hs transport', async () => {
    await dispatchTool(ctx({}), 'townhouse_up', { transport: 'hs' });
    expect(spawnUpDetached).toHaveBeenCalledWith(expect.anything(), 'hs');
  });

  it('townhouse_up_status reads the job record', async () => {
    const res = await dispatchTool(ctx({}), 'townhouse_up_status', {});
    expect(readUpStatus).toHaveBeenCalled();
    expect(parse(res)).toMatchObject({ done: true });
  });
});

describe('dispatchTool — error encoding', () => {
  it('encodes an unreachable apex as a booting/retry hint', async () => {
    const api = {
      balances: vi
        .fn()
        .mockRejectedValue(new ApexUnreachableError('http://127.0.0.1:9400')),
    };
    const res = await dispatchTool(ctx({ api }), 'townhouse_balances', {});
    expect(res.isError).toBe(true);
    expect(res.content[0]!.text).toMatch(/booting/i);
    expect(res.content[0]!.text).toContain('townhouse_up_status');
  });

  it('encodes a retryable ApiError as "retry shortly"', async () => {
    const api = {
      earnings: vi.fn().mockRejectedValue(new ApiError('busy', 503, true)),
    };
    const res = await dispatchTool(ctx({ api }), 'townhouse_earnings', {});
    expect(res.isError).toBe(true);
    expect(res.content[0]!.text).toMatch(/retry shortly/i);
  });

  it('encodes a non-retryable ApiError with its detail', async () => {
    const api = {
      withdraw: vi
        .fn()
        .mockRejectedValue(
          new ApiError('insufficient_balance', 400, false, 'need more')
        ),
    };
    const res = await dispatchTool(ctx({ api }), 'townhouse_withdraw', {
      nodeType: 'town',
      chainFamily: 'evm',
      token: 'native',
      recipient: '0x0',
      amount: '1',
    });
    expect(res.content[0]!.text).toBe('insufficient_balance: need more');
  });

  it('encodes a CLI failure with its stderr', async () => {
    const cli = {
      runJson: vi
        .fn()
        .mockRejectedValue(new CliError('boom', 1, 'wallet locked')),
    };
    const res = await dispatchTool(ctx({ cli }), 'townhouse_seed', {});
    expect(res.isError).toBe(true);
    expect(res.content[0]!.text).toMatch(/wallet locked/);
  });

  it('reports an unknown tool', async () => {
    const res = await dispatchTool(ctx({}), 'townhouse_bogus', {});
    expect(res.isError).toBe(true);
    expect(res.content[0]!.text).toMatch(/Unknown tool/);
  });
});
