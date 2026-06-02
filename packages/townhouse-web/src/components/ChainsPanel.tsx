import { useEffect, useState } from 'react';
import type { ChainProviderEntry, ChainType } from '@toon-protocol/townhouse';
import { Button } from './primitives/Button';
import { useChains } from '@/hooks/useChains';
import { useChainsPatch } from '@/hooks/useChainsPatch';

const inputClass =
  'w-full rounded-md border border-ink/15 bg-canvas px-2 py-1 font-geist-sans text-sm text-ink placeholder:text-ink/40 focus:outline-none focus:ring-2 focus:ring-ink/20';

interface NewChainForm {
  chainType: ChainType;
  chainId: string;
  rpcUrl: string;
  wsUrl: string;
  registry: string;
  tokenAddress: string;
  tokenMint: string;
  programId: string;
  graphqlUrl: string;
  zkapp: string;
  keyId: string;
}

const EMPTY_FORM: NewChainForm = {
  chainType: 'evm',
  chainId: '',
  rpcUrl: '',
  wsUrl: '',
  registry: '',
  tokenAddress: '',
  tokenMint: '',
  programId: '',
  graphqlUrl: '',
  zkapp: '',
  keyId: '',
};

/** Build a typed entry from the form, or an error message. */
export function buildEntryFromForm(
  f: NewChainForm
): ChainProviderEntry | { error: string } {
  const chainId = f.chainId.trim();
  if (!chainId) return { error: 'Chain ID is required' };

  if (f.chainType === 'evm') {
    if (!f.rpcUrl || !f.registry || !f.tokenAddress || !f.keyId) {
      return { error: 'EVM needs RPC URL, registry, token address, and key' };
    }
    return {
      chainType: 'evm',
      chainId,
      rpcUrl: f.rpcUrl.trim(),
      registryAddress: f.registry.trim(),
      tokenAddress: f.tokenAddress.trim(),
      keyId: f.keyId.trim(),
    };
  }
  if (f.chainType === 'solana') {
    if (!f.rpcUrl || !f.programId || !f.keyId) {
      return { error: 'Solana needs RPC URL, program ID, and key' };
    }
    return {
      chainType: 'solana',
      chainId,
      rpcUrl: f.rpcUrl.trim(),
      ...(f.wsUrl ? { wsUrl: f.wsUrl.trim() } : {}),
      programId: f.programId.trim(),
      ...(f.tokenMint ? { tokenMint: f.tokenMint.trim() } : {}),
      keyId: f.keyId.trim(),
    };
  }
  // mina
  if (!f.graphqlUrl || !f.zkapp) {
    return { error: 'Mina needs GraphQL URL and zkApp address' };
  }
  return {
    chainType: 'mina',
    chainId,
    graphqlUrl: f.graphqlUrl.trim(),
    zkAppAddress: f.zkapp.trim(),
    ...(f.keyId ? { keyId: f.keyId.trim() } : {}),
  };
}

function describe(c: ChainProviderEntry): string {
  if (c.chainType === 'evm') return `RPC ${c.rpcUrl}`;
  if (c.chainType === 'solana')
    return `RPC ${c.rpcUrl} · program ${c.programId}`;
  return `GraphQL ${c.graphqlUrl} · zkApp ${c.zkAppAddress}`;
}

/**
 * Editable settlement-chain panel (Settings view). Lists configured chains,
 * supports add (adaptive per chain type) + remove, and PATCHes the whole list
 * to /api/chains (which validates + restarts the connector). Keys are
 * write-only — the API returns them redacted as '***'.
 */
export function ChainsPanel(): JSX.Element {
  const { chains, kind, refetch } = useChains();
  const { patch, pending, error: patchError } = useChainsPatch();
  const [draft, setDraft] = useState<ChainProviderEntry[]>([]);
  const [form, setForm] = useState<NewChainForm>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (kind === 'ready') setDraft(chains);
  }, [kind, chains]);

  const setField = (k: keyof NewChainForm, v: string): void =>
    setForm((f) => ({ ...f, [k]: v }));

  function handleAdd(): void {
    setSuccess(null);
    const built = buildEntryFromForm(form);
    if ('error' in built) {
      setFormError(built.error);
      return;
    }
    setFormError(null);
    setDraft((d) => [...d.filter((c) => c.chainId !== built.chainId), built]);
    setForm(EMPTY_FORM);
  }

  function handleRemove(chainId: string): void {
    setSuccess(null);
    setDraft((d) => d.filter((c) => c.chainId !== chainId));
  }

  function handleSave(): void {
    setSuccess(null);
    void patch(draft, () => {
      refetch();
      setSuccess('Settlement chains saved — the connector is restarting.');
    }).catch(() => {
      /* error surfaces via patchError */
    });
  }

  return (
    <section aria-labelledby="chains-heading">
      <h2
        id="chains-heading"
        className="font-geist-sans text-lg font-semibold text-ink tracking-tight-20 mb-1"
      >
        Settlement chains
      </h2>
      <p className="font-geist-sans text-sm text-ink/60 mb-4">
        Chains the connector settles ILP payment claims on (EVM, Solana, Mina).
        Signing keys are write-only — shown as <code>***</code>. Saving restarts
        the connector.
      </p>

      {kind === 'loading' && (
        <p className="font-geist-sans text-sm text-ink/50">Loading…</p>
      )}
      {kind === 'error' && (
        <p className="font-geist-sans text-sm text-red-600">
          Couldn&apos;t load settlement chains.
        </p>
      )}

      {kind !== 'loading' && (
        <>
          <ul className="flex flex-col gap-2 mb-4">
            {draft.length === 0 && (
              <li className="font-geist-sans text-sm text-ink/50">
                No chains configured — the connector uses a built-in dev
                placeholder.
              </li>
            )}
            {draft.map((c) => (
              <li
                key={c.chainId}
                className="flex items-center justify-between gap-3 rounded-md border border-ink/10 px-3 py-2"
              >
                <div className="flex flex-col">
                  <span className="font-geist-sans text-sm font-medium text-ink">
                    {c.chainType.toUpperCase()} · {c.chainId}
                  </span>
                  <span className="font-geist-sans text-xs text-ink/60">
                    {describe(c)}
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleRemove(c.chainId)}
                  aria-label={`Remove ${c.chainId}`}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>

          <div className="rounded-md border border-ink/10 p-3 flex flex-col gap-2 mb-4">
            <span className="font-geist-sans text-sm font-medium text-ink">
              Add a chain
            </span>
            <select
              aria-label="Chain type"
              className={inputClass}
              value={form.chainType}
              onChange={(e) => setField('chainType', e.target.value)}
            >
              <option value="evm">EVM</option>
              <option value="solana">Solana</option>
              <option value="mina">Mina</option>
            </select>
            <input
              className={inputClass}
              placeholder="chain ID (e.g. evm:base:8453)"
              value={form.chainId}
              onChange={(e) => setField('chainId', e.target.value)}
            />
            {form.chainType === 'evm' && (
              <>
                <input
                  className={inputClass}
                  placeholder="RPC URL"
                  value={form.rpcUrl}
                  onChange={(e) => setField('rpcUrl', e.target.value)}
                />
                <input
                  className={inputClass}
                  placeholder="registry address (0x…)"
                  value={form.registry}
                  onChange={(e) => setField('registry', e.target.value)}
                />
                <input
                  className={inputClass}
                  placeholder="token address (0x…)"
                  value={form.tokenAddress}
                  onChange={(e) => setField('tokenAddress', e.target.value)}
                />
                <input
                  className={inputClass}
                  placeholder="signing key (0x…)"
                  value={form.keyId}
                  onChange={(e) => setField('keyId', e.target.value)}
                />
              </>
            )}
            {form.chainType === 'solana' && (
              <>
                <input
                  className={inputClass}
                  placeholder="RPC URL"
                  value={form.rpcUrl}
                  onChange={(e) => setField('rpcUrl', e.target.value)}
                />
                <input
                  className={inputClass}
                  placeholder="WS URL (optional)"
                  value={form.wsUrl}
                  onChange={(e) => setField('wsUrl', e.target.value)}
                />
                <input
                  className={inputClass}
                  placeholder="program ID"
                  value={form.programId}
                  onChange={(e) => setField('programId', e.target.value)}
                />
                <input
                  className={inputClass}
                  placeholder="token mint (optional)"
                  value={form.tokenMint}
                  onChange={(e) => setField('tokenMint', e.target.value)}
                />
                <input
                  className={inputClass}
                  placeholder="signing key"
                  value={form.keyId}
                  onChange={(e) => setField('keyId', e.target.value)}
                />
              </>
            )}
            {form.chainType === 'mina' && (
              <>
                <input
                  className={inputClass}
                  placeholder="GraphQL URL"
                  value={form.graphqlUrl}
                  onChange={(e) => setField('graphqlUrl', e.target.value)}
                />
                <input
                  className={inputClass}
                  placeholder="zkApp address"
                  value={form.zkapp}
                  onChange={(e) => setField('zkapp', e.target.value)}
                />
                <input
                  className={inputClass}
                  placeholder="signing key (optional)"
                  value={form.keyId}
                  onChange={(e) => setField('keyId', e.target.value)}
                />
              </>
            )}
            {formError && (
              <p className="font-geist-sans text-xs text-red-600">
                {formError}
              </p>
            )}
            <div>
              <Button variant="secondary" size="sm" onClick={handleAdd}>
                Add chain
              </Button>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Button variant="primary" onClick={handleSave} disabled={pending}>
              {pending ? 'Saving…' : 'Save & restart connector'}
            </Button>
            {success && (
              <span className="font-geist-sans text-sm text-green-700">
                {success}
              </span>
            )}
            {patchError && (
              <span className="font-geist-sans text-sm text-red-600">
                {patchError}
              </span>
            )}
          </div>
        </>
      )}
    </section>
  );
}
