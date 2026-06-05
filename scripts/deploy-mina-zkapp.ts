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

const GRAPHQL_URL =
  process.env.MINA_GRAPHQL_URL || 'http://localhost:19085/graphql';
const ACCOUNTS_URL = process.env.MINA_ACCOUNTS_URL || 'http://localhost:19181';
const ZKAPP_PRIVATE_KEY = process.env.MINA_ZKAPP_PRIVATE_KEY?.trim() || '';

async function main() {
  // Dynamic import to avoid pulling o1js into global scope
  const { Mina, PrivateKey, AccountUpdate, fetchAccount } =
    await import('o1js');
  const { PaymentChannel } = await import('@toon-protocol/mina-zkapp');

  // Connect to lightnet
  const network = Mina.Network({
    mina: GRAPHQL_URL,
    archive: '', // no archive needed for deploy
  });
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

  // Acquire a funded deployer account from accounts manager
  const acquireRes = await fetch(`${ACCOUNTS_URL}/acquire-account`, {
    method: 'POST',
  });
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

  // Deploy
  console.error('Deploying…');
  const zkApp = new PaymentChannel(zkAppAddress);
  const deployTx = await Mina.transaction(deployerPub, async () => {
    AccountUpdate.fundNewAccount(deployerPub);
    await zkApp.deploy();
  });
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
