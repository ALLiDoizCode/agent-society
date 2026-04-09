#!/usr/bin/env tsx
/**
 * Deploy Mina Payment Channel zkApp to lightnet
 *
 * Acquires a funded account from the Mina accounts manager,
 * deploys the PaymentChannel zkApp, and prints the deployed address.
 *
 * Usage: tsx scripts/deploy-mina-zkapp.ts
 *
 * Environment:
 *   MINA_GRAPHQL_URL  - Mina GraphQL endpoint (default: http://localhost:19085/graphql)
 *   MINA_ACCOUNTS_URL - Accounts manager endpoint (default: http://localhost:19181)
 */

const GRAPHQL_URL = process.env.MINA_GRAPHQL_URL || 'http://localhost:19085/graphql';
const ACCOUNTS_URL = process.env.MINA_ACCOUNTS_URL || 'http://localhost:19181';

async function main() {
  // Dynamic import to avoid pulling o1js into global scope
  const { Mina, PrivateKey, AccountUpdate, fetchAccount } = await import('o1js');
  const { PaymentChannel } = await import('@toon-protocol/mina-zkapp');

  // Connect to lightnet
  const network = Mina.Network({
    mina: GRAPHQL_URL,
    archive: '', // no archive needed for deploy
  });
  Mina.setActiveInstance(network);

  // Acquire a funded deployer account from accounts manager
  const acquireRes = await fetch(`${ACCOUNTS_URL}/acquire-account`, { method: 'POST' });
  if (!acquireRes.ok) {
    throw new Error(`Failed to acquire Mina account: ${acquireRes.status} ${acquireRes.statusText}`);
  }
  const deployerAccount = await acquireRes.json() as { pk: string; sk: string };
  const deployerKey = PrivateKey.fromBase58(deployerAccount.sk);
  const deployerPub = deployerKey.toPublicKey();

  console.error(`Deployer: ${deployerPub.toBase58()}`);

  // Generate a fresh keypair for the zkApp
  const zkAppKey = PrivateKey.random();
  const zkAppAddress = zkAppKey.toPublicKey();

  console.error(`zkApp address: ${zkAppAddress.toBase58()}`);

  // Compile the contract (proof-level=none on lightnet, but compile is still required)
  console.error('Compiling PaymentChannel zkApp...');
  await PaymentChannel.compile();

  // Fetch deployer account from chain
  await fetchAccount({ publicKey: deployerPub });

  // Deploy
  console.error('Deploying...');
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
