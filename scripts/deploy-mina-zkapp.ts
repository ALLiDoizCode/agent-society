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

// MINA_SKIP_INIT=1 deploys the bare zkApp account but does NOT initialize the
// channel (leaves channelState=UNINIT/0). Use this when the CLIENT opens the
// channel on-chain with the real (client, apex) participant keys via
// `openMinaChannel` — the single-party deployer-init below sets a channelHash =
// Poseidon(deployer.x, deployer.x, 0) that the connector's claimFromChannel
// (which uses Poseidon(apex.x, client.x, 0)) cannot reproduce, so the on-chain
// claimFromChannel fails with "Supplied participant keys do not match the
// on-chain channelHash". Skipping init lets the client's openMinaChannel write
// the correct channelHash so the connector can settle on-chain.
const SKIP_INIT = process.env.MINA_SKIP_INIT === '1';

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
  const { Mina, PrivateKey, AccountUpdate, fetchAccount, Field } = o1js;
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

  // Idempotency (deterministic mode): skip the (slow, proof-generating) deploy
  // ONLY when the zkApp account already exists on-chain AND its channel is already
  // OPEN. A prior *bare* deploy (pre deploy-shape fix) leaves the account present
  // but UNINITIALIZED (channelState=0) — that account is unusable by the connector
  // (provedState/state-read fails), so do NOT treat it as a no-op. We cannot
  // re-deploy over an existing account, so surface the stale-account case clearly:
  // the operator must reset the lightnet (`townhouse-dev-infra.sh` recreates
  // `townhouse-dev-mina`) so this deterministic key deploys fresh.
  if (ZKAPP_PRIVATE_KEY) {
    const existing = await fetchAccount({ publicKey: zkAppAddress }).catch(
      () => ({ account: undefined })
    );
    if (existing.account) {
      // PaymentChannel appState order: [channelHash, balanceCommitment,
      // nonceField, channelState, …] → channelState is index 3.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const appState = (existing.account as any).zkapp?.appState;
      const channelState = BigInt(appState?.[3]?.toString() ?? '0');
      if (channelState === 1n) {
        console.error(
          'zkApp account already exists on-chain and channel is OPEN — skipping deploy (idempotent).'
        );
        console.log(zkAppAddress.toBase58());
        return;
      }
      if (SKIP_INIT && channelState === 0n) {
        // MINA_SKIP_INIT path: a bare (uninitialized) deploy already exists. The
        // CLIENT opens the channel on-chain with the correct (client, apex)
        // participants, so an UNINIT account is the expected baseline — no-op.
        console.error(
          'zkApp account exists, channelState=0 (UNINIT) and MINA_SKIP_INIT=1 — ' +
            'leaving it for the client to open on-chain (idempotent).'
        );
        console.log(zkAppAddress.toBase58());
        return;
      }
      throw new Error(
        `Deterministic Mina zkApp ${zkAppAddress.toBase58()} already exists on-chain but is NOT OPEN ` +
          `(channelState=${channelState}; likely a stale bare-deploy from before the deploy-shape fix). ` +
          `Cannot re-deploy over an existing account. Reset the lightnet (recreate townhouse-dev-mina via ` +
          `scripts/townhouse-dev-infra.sh) so this deterministic key deploys + initializes fresh.`
      );
    }
  }

  // Acquire the deployer. On PUBLIC devnet there is no lightnet
  // accounts-manager — set MINA_DEPLOYER_PRIVATE_KEY to a funded base58 ("EK…")
  // key and we use it directly. Otherwise (lightnet) acquire a funded account
  // from the o1labs accounts-manager: its `/acquire-account` endpoint is HTTP
  // GET (POST → "Method Not Allowed" on `compatible-latest-lightnet`);
  // `unlockAccount` returns an unlocked key so we can sign without a separate
  // unlock.
  let deployerKey: PrivateKey;
  const deployerEnvKey = process.env.MINA_DEPLOYER_PRIVATE_KEY?.trim();
  if (deployerEnvKey) {
    deployerKey = PrivateKey.fromBase58(deployerEnvKey);
    console.error('Using deployer from MINA_DEPLOYER_PRIVATE_KEY (public devnet)');
  } else {
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
    deployerKey = PrivateKey.fromBase58(deployerAccount.sk);
  }
  const deployerPub = deployerKey.toPublicKey();
  console.error(`Deployer: ${deployerPub.toBase58()}`);

  // Readiness gate (issue #173): wait until the deployer/fee-payer account
  // actually EXISTS and is funded on-chain before we build the deploy tx.
  //
  // The lightnet accounts-manager may hand back a key the moment its container
  // is up, but the Mina daemon's ledger has not yet seen (or finished syncing)
  // the genesis-funded balance for it — so `fetchAccount` / o1js `getAccount`
  // 404s ("Could not find account for public key …") and the deploy throws
  // before any tx is built. Poll until the account is queryable AND has a
  // non-zero balance (enough to cover the new-account fund + deploy fee), so
  // the subsequent `Mina.transaction` precondition read resolves. Tunable via
  // MINA_DEPLOYER_WAIT_ATTEMPTS (default 60) × MINA_DEPLOYER_WAIT_INTERVAL_MS
  // (default 2000) ≈ 2 minutes, which comfortably covers lightnet warm-up and a
  // public-devnet faucet-funded deployer that is still propagating.
  const waitAttempts = Number(process.env.MINA_DEPLOYER_WAIT_ATTEMPTS ?? '60');
  const waitIntervalMs = Number(
    process.env.MINA_DEPLOYER_WAIT_INTERVAL_MS ?? '2000'
  );
  // Need at least the new-account funding (1 MINA) + the deploy fee on hand.
  const MIN_DEPLOYER_BALANCE = 1_100_000_000n; // 1.1 MINA, in nanomina
  console.error(
    `Waiting for deployer account to be funded/queryable on-chain ` +
      `(up to ${waitAttempts} × ${waitIntervalMs}ms)…`
  );
  let deployerFunded = false;
  let lastBalance = 0n;
  for (let attempt = 1; attempt <= waitAttempts; attempt++) {
    const res = await fetchAccount({ publicKey: deployerPub }).catch(
      (err: unknown) => ({
        account: undefined,
        error: err instanceof Error ? err.message : String(err),
      })
    );
    if (res.account) {
      // o1js exposes balance as a UInt64-ish; toString() → nanomina decimal.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const balRaw = (res.account as any).balance;
      lastBalance = BigInt(balRaw?.toString?.() ?? balRaw ?? '0');
      if (lastBalance >= MIN_DEPLOYER_BALANCE) {
        deployerFunded = true;
        console.error(
          `Deployer funded after ${attempt} attempt(s): balance=${lastBalance} nanomina`
        );
        break;
      }
      console.error(
        `  attempt ${attempt}/${waitAttempts}: account present but balance ` +
          `${lastBalance} < ${MIN_DEPLOYER_BALANCE} nanomina — waiting…`
      );
    } else {
      console.error(
        `  attempt ${attempt}/${waitAttempts}: deployer account not on-chain yet ` +
          `(${(res as { error?: string }).error ?? 'not found'}) — waiting…`
      );
    }
    if (attempt < waitAttempts) {
      await new Promise((r) => setTimeout(r, waitIntervalMs));
    }
  }
  if (!deployerFunded) {
    throw new Error(
      `Deployer ${deployerPub.toBase58()} is not funded/queryable on ${GRAPHQL_URL} ` +
        `after ${waitAttempts} attempts (last balance=${lastBalance} nanomina, ` +
        `need ≥${MIN_DEPLOYER_BALANCE}). On lightnet the daemon may still be ` +
        `syncing the genesis balance — increase MINA_DEPLOYER_WAIT_ATTEMPTS or ` +
        `confirm the accounts-manager (${ACCOUNTS_URL}) handed back a funded key. ` +
        `On public devnet, fund the deployer from the faucet first.`
    );
  }

  // Compile the contract (proof-level=none on lightnet, but compile is still required)
  console.error('Compiling PaymentChannel zkApp (o1js — slow, ~30-120s)…');
  await PaymentChannel.compile();

  // Re-fetch deployer account from chain (refresh into o1js's active-instance
  // cache after the slow compile, so the deploy-tx precondition read is current).
  await fetchAccount({ publicKey: deployerPub });

  // Deploy, then initialize the channel in a SECOND transaction.
  //
  // Why not one atomic tx: `initializeChannel` reads
  // `this.channelState.getAndRequireEquals()` (a witness against the on-chain
  // account). In the SAME tx as `deploy()` the account does not yet exist in the
  // ledger, so o1js throws `channelState.get() failed … Could not find account`.
  // The init method must run AFTER the deploy account is on-chain and fetched
  // into o1js's active-instance cache.
  //
  // Why initialize at all: a bare `deploy()` leaves the zkApp UNINITIALIZED
  // (channelState=0) with `provedState=false` on a real lightnet (unlike the
  // LocalBlockchain test env). With `provedState=false` the connector's
  // `MinaPaymentChannelSDK.getChannelState` (`channelState.get()`) cannot resolve
  // the account state → `mina_claim_verification_failed`. Running the proven
  // `initializeChannel` method here yields `provedState=true` + an OPEN channel,
  // so `getChannelState` returns a real OPEN state and the client opener
  // (`openMinaChannelOnChain`) idempotently finds it OPEN (currentState===OPEN →
  // skips re-init).
  //
  // Participants: the on-chain contract stores only
  // `channelHash = Poseidon(participantA.x, participantB.x, nonce)` (not A/B
  // themselves). For this deterministic dev channel we use the deployer pubkey for
  // BOTH participants (single-party dev channel — the same default the client
  // opener applies when `peerPublicKey` is omitted). The connector's participant
  // MEMBERSHIP check reads from its own `_participantCache` (populated only on
  // connector-initiated opens), not from on-chain — so the on-chain participants
  // here do not gate the connector. nonce/timeout/tokenId mirror the opener
  // defaults (Field(0) / 86400 / '1') so a later opener call is a true no-op.
  const DEPLOY_FEE = 100_000_000; // 0.1 MINA, in nanomina
  const zkApp = new PaymentChannel(zkAppAddress);

  console.error('Deploying…');
  const deployTx = await Mina.transaction(
    { sender: deployerPub, fee: DEPLOY_FEE },
    async () => {
      AccountUpdate.fundNewAccount(deployerPub);
      await zkApp.deploy();
    }
  );
  await deployTx.prove();
  deployTx.sign([deployerKey, zkAppKey]);
  const pendingDeploy = await deployTx.send();
  console.error(`Deploy tx sent: ${pendingDeploy.hash}`);
  const includedDeploy = await pendingDeploy.wait();
  console.error(`Deploy included in block. Status: ${includedDeploy.status}`);

  if (SKIP_INIT) {
    // Bare deploy only — the CLIENT opens the channel on-chain with the correct
    // (client, apex) participants via openMinaChannel. Report the address and
    // return; channelState stays 0 (UNINIT) until the client initializes it.
    console.error(
      'MINA_SKIP_INIT=1 — deployed bare zkApp (channelState=0); client will open the channel on-chain.'
    );
    console.log(zkAppAddress.toBase58());
    return;
  }

  // Initialize the channel (separate tx). Re-fetch BOTH the zkApp and the
  // fee-payer into o1js's active-instance cache so the `getAndRequireEquals()`
  // precondition read resolves against the now-on-chain account.
  console.error('Initializing channel (open)…');
  await fetchAccount({ publicKey: zkAppAddress });
  await fetchAccount({ publicKey: deployerPub });
  const INIT_NONCE = Field(0);
  const INIT_TIMEOUT = Field(86_400);
  const INIT_TOKEN_ID = Field(1);
  const initTx = await Mina.transaction(
    { sender: deployerPub, fee: DEPLOY_FEE },
    async () => {
      // participantA = participantB = deployerPub (single-party dev channel).
      await zkApp.initializeChannel(
        deployerPub,
        deployerPub,
        INIT_NONCE,
        INIT_TIMEOUT,
        INIT_TOKEN_ID
      );
    }
  );
  await initTx.prove();
  initTx.sign([deployerKey]);
  const pendingInit = await initTx.send();
  console.error(`Init tx sent: ${pendingInit.hash}`);
  const includedInit = await pendingInit.wait();
  console.error(`Init included in block. Status: ${includedInit.status}`);

  // Verify the channel is OPEN on-chain before reporting success.
  await fetchAccount({ publicKey: zkAppAddress });
  const verify = await fetchAccount({ publicKey: zkAppAddress });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const finalState = (verify.account as any)?.zkapp?.appState?.[3]?.toString();
  console.error(`Post-init channelState (appState[3]) = ${finalState}`);
  if (finalState !== '1') {
    throw new Error(
      `Channel did not reach OPEN (channelState=${finalState}) after initializeChannel`
    );
  }

  // Print the zkApp address to stdout (for capture by infra script)
  console.log(zkAppAddress.toBase58());
}

main().catch((err) => {
  console.error('Mina zkApp deployment failed:', err);
  process.exit(1);
});
