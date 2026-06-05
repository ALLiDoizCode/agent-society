#!/usr/bin/env node
// Derive a Mina B62 public key from a base58-encoded Mina private key.
//
// Usage: node scripts/derive-mina-pubkey.mjs <minaPrivateKeyBase58>
//   → prints the B62... public key on stdout (single line), or exits non-zero.
//
// Used by scripts/townhouse-e2e-local-hs.sh `resolve_apex_mina_signer` to obtain
// the apex's Mina settlement recipient (participant B for the client's Mina
// payment-channel claim) from the apex Mina keyId that `townhouse hs up` fills
// into connector.yaml. Connector 3.9.1 does not log a "Mina settlement signer
// resolved" line, so the harness derives the pubkey directly instead of grepping
// the connector log.
//
// Network: 'devnet' — matches the client's MINA_CLAIM_NETWORK
// (packages/client/src/signing/mina-signer.ts) so the derived recipient equals
// the address the connector verifies the claim against. (mina-signer's
// derivePublicKey is network-independent, but we pass the same network the
// claim path uses for parity.)
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const privateKey = process.argv[2];
if (!privateKey) {
  console.error('usage: derive-mina-pubkey.mjs <minaPrivateKeyBase58>');
  process.exit(2);
}

let Client;
{
  // mina-signer ships CJS and is a dependency of @toon-protocol/client (NOT a
  // root dep), so a bare `require('mina-signer')` from scripts/ fails under
  // pnpm's isolated node_modules. Anchor a `createRequire` at the client
  // package (same technique deploy-mina-zkapp.ts uses for o1js), with a
  // fallback to this script's own location for hoisted layouts.
  const anchors = [
    join(__dirname, '..', 'packages', 'client', 'package.json'),
    import.meta.url,
  ];
  let lastErr;
  for (const anchor of anchors) {
    try {
      const req = createRequire(anchor);
      const mod = req('mina-signer');
      Client = mod.default ?? mod.Client ?? mod;
      break;
    } catch (e) {
      lastErr = e;
    }
  }
  if (!Client) {
    console.error(`mina-signer not resolvable: ${lastErr?.message}`);
    process.exit(3);
  }
}

try {
  const client = new Client({ network: 'devnet' });
  const pub = client.derivePublicKey(privateKey);
  if (!pub || !/^B62[a-zA-Z0-9]{40,60}$/.test(pub)) {
    console.error(`derived value is not a B62 pubkey: ${pub}`);
    process.exit(4);
  }
  process.stdout.write(pub);
} catch (e) {
  console.error(`derivePublicKey failed: ${e.message}`);
  process.exit(5);
}
