#!/usr/bin/env tsx
/**
 * Deploy Mina Payment Channel zkApp to lightnet
 *
 * Acquires a funded account from the Mina accounts manager, deploys the
 * PaymentChannel zkApp, and prints the deployed zkApp address to STDOUT (all
 * diagnostics go to STDERR, so the caller can capture the address cleanly).
 *
 * Usage: tsx scripts/deploy-mina-zkapp.ts
 *
 * Environment:
 *   MINA_GRAPHQL_URL        - Mina GraphQL endpoint (default: http://localhost:19085/graphql)
 *   MINA_ACCOUNTS_URL       - Accounts manager endpoint (default: http://localhost:19181)
 *   MINA_ZKAPP_PRIVATE_KEY  - OPTIONAL base58 (`EK…`) zkApp private key. When set
 *                             the zkApp uses this DETERMINISTIC keypair instead of
 *                             a random one — so the e2e bring-up captures a STABLE
 *                             `zkAppAddress` across runs (Phase-2 Stage 3). When
 *                             unset, a fresh random keypair is generated (legacy).
 *
 * Idempotency: in deterministic mode, if the zkApp account already exists
 * on-chain (a prior deploy on this lightnet), the deploy is SKIPPED and the
 * existing address is printed — re-running is a no-op. (Lightnet is ephemeral:
 * a fresh container has no account, so the first run deploys.)
 */

// Type-only imports (erased at compile time — they do NOT add o1js to this
// module's ESM graph; the runtime load is a CJS `require` inside main(), see the
// comment there for why the build instance must match the zkApp's).
import type * as O1js from 'o1js';
import type * as MinaZkApp from '@toon-protocol/mina-zkapp';

const GRAPHQL_URL =
  process.env.MINA_GRAPHQL_URL || 'http://localhost:19085/graphql';
const ACCOUNTS_URL = process.env.MINA_ACCOUNTS_URL || 'http://localhost:19181';
const ZKAPP_PRIVATE_KEY = process.env.MINA_ZKAPP_PRIVATE_KEY?.trim() || '';

async function main() {
  // o1js + the zkApp MUST be loaded through the SAME o1js module instance, and
  // both must be resolvable from this script (which lives in scripts/, NOT a
  // package — neither `o1js` nor `@toon-protocol/mina-zkapp` is a root
  // dependency, so a bare `import('o1js')` from here fails with
  // ERR_MODULE_NOT_FOUND).
  //
  // Two problems, one fix:
  //
  // (1) Resolution. `@toon-protocol/mina-zkapp` only resolves from inside the
  //     workspace. We anchor a `createRequire` at the mina-zkapp package
  //     (absolute path from this script's location) so its workspace
  //     `node_modules` graph resolves both the zkApp and its o1js.
  //
  // (2) Shared active instance. o1js keeps its "active Mina instance" in a
  //     module-level closure (mina-instance.js). `@toon-protocol/mina-zkapp`
  //     compiles to CommonJS ("module":"commonjs"), so its internal
  //     `import {Mina}` is emitted as `require('o1js')` → o1js's CJS build
  //     (dist/node/index.cjs). o1js's exports map sends ESM `import('o1js')` to
  //     a DIFFERENT build (dist/node/index.js) — a SEPARATE module instance with
  //     a SEPARATE `activeInstance` closure (verified: `esmMina !== cjsMina`).
  //     Calling `setActiveInstance` on the ESM instance while
  //     `PaymentChannel.deploy()` reads the CJS instance throws
  //     `Must call Mina.setActiveInstance first` AFTER a successful compile —
  //     exactly the o1js-2.14 deploy failure this script hit. Requiring o1js
  //     from the same mina-zkapp anchor yields the CJS build the zkApp uses, so
  //     `setActiveInstance` and the contract's `Mina.transaction` share one
  //     active instance.
  const { createRequire } = await import('node:module');
  const { fileURLToPath } = await import('node:url');
  const path = await import('node:path');
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  // scripts/ → repo root → packages/mina-zkapp
  const zkAppDir = path.resolve(scriptDir, '..', 'packages', 'mina-zkapp');
  // Anchor module resolution at the mina-zkapp package so its workspace
  // node_modules graph resolves o1js (to the CJS build the zkApp itself uses).
  const require = createRequire(path.join(zkAppDir, 'package.json'));
  const o1js = require('o1js') as typeof O1js;
  const { Mina, PrivateKey, AccountUpdate, fetchAccount } = o1js;
  // The package can't resolve itself by name (no self-referential symlink in a
  // pnpm workspace), so load the built entry by path. Its own
  // `require('o1js')` resolves to the same CJS build via mina-zkapp's
  // node_modules → one shared o1js active instance.
  const { PaymentChannel } = require(
    path.join(zkAppDir, 'dist', 'index.js')
  ) as typeof MinaZkApp;

  // Connect to lightnet. Pass the GraphQL endpoint as a plain string (the form
  // used by the working SDK Mina e2e); the `{ mina, archive:'' }` object form
  // set a bogus empty archive endpoint.
  const network = Mina.Network(GRAPHQL_URL);
  Mina.setActiveInstance(network);

  // zkApp keypair: deterministic (from MINA_ZKAPP_PRIVATE_KEY) or random.
  // Type inferred from PrivateKey.fromBase58 / PrivateKey.random (o1js is
  // dynamically imported to keep it out of global scope).
  let zkAppKey: ReturnType<typeof PrivateKey.random>;
  if (ZKAPP_PRIVATE_KEY) {
    zkAppKey = PrivateKey.fromBase58(ZKAPP_PRIVATE_KEY);
    console.error(
      'Using DETERMINISTIC zkApp keypair from MINA_ZKAPP_PRIVATE_KEY'
    );
  } else {
    zkAppKey = PrivateKey.random();
    console.error(
      'Using RANDOM zkApp keypair (set MINA_ZKAPP_PRIVATE_KEY for a stable address)'
    );
  }
  const zkAppAddress = zkAppKey.toPublicKey();
  console.error(`zkApp address: ${zkAppAddress.toBase58()}`);

  // Idempotency (deterministic mode): if the zkApp account already exists
  // on-chain, skip the (slow, proof-generating) deploy and just print it.
  if (ZKAPP_PRIVATE_KEY) {
    const existing = await fetchAccount({ publicKey: zkAppAddress }).catch(
      () => ({ account: undefined })
    );
    if (existing.account) {
      console.error(
        'zkApp account already exists on-chain — skipping deploy (idempotent).'
      );
      console.log(zkAppAddress.toBase58());
      return;
    }
  }

  // Acquire a funded deployer account from the o1labs lightnet accounts-manager.
  // Its `/acquire-account` endpoint is HTTP GET (not POST) — a POST returns
  // "Method Not Allowed" on the `compatible-latest-lightnet` image. `unlockAccount`
  // returns an unlocked key so we can sign the deploy without a separate unlock.
  const acquireRes = await fetch(
    `${ACCOUNTS_URL}/acquire-account?unlockAccount=true`,
    { method: 'GET' }
  );
  if (!acquireRes.ok) {
    throw new Error(
      `Failed to acquire Mina account: ${acquireRes.status} ${acquireRes.statusText}`
    );
  }
  const deployerAccount = (await acquireRes.json()) as {
    pk: string;
    sk: string;
  };
  const deployerKey = PrivateKey.fromBase58(deployerAccount.sk);
  const deployerPub = deployerKey.toPublicKey();
  console.error(`Deployer: ${deployerPub.toBase58()}`);

  // Compile the contract (proof-level=none on lightnet, but compile is still required)
  console.error('Compiling PaymentChannel zkApp (o1js — slow, ~30-120s)…');
  await PaymentChannel.compile();

  // Fetch deployer account from chain
  await fetchAccount({ publicKey: deployerPub });

  // Deploy. Specify an explicit fee — the lightnet rejects the implicit/zero
  // default with "Insufficient fee". 0.1 MINA (100_000_000 nanomina) clears the
  // node's minimum for a zkApp command on `compatible-latest-lightnet`.
  console.error('Deploying…');
  const DEPLOY_FEE = 100_000_000; // 0.1 MINA, in nanomina
  const zkApp = new PaymentChannel(zkAppAddress);
  const deployTx = await Mina.transaction(
    { sender: deployerPub, fee: DEPLOY_FEE },
    async () => {
      AccountUpdate.fundNewAccount(deployerPub);
      await zkApp.deploy();
    }
  );
  await deployTx.prove();
  deployTx.sign([deployerKey, zkAppKey]);
  const pendingTx = await deployTx.send();
  console.error(`Transaction sent: ${pendingTx.hash}`);

  // Wait for inclusion
  const includedTx = await pendingTx.wait();
  console.error(`Transaction included in block. Status: ${includedTx.status}`);

  // Print the zkApp address to stdout (for capture by infra script)
  console.log(zkAppAddress.toBase58());
}

main().catch((err) => {
  console.error('Mina zkApp deployment failed:', err);
  process.exit(1);
});
