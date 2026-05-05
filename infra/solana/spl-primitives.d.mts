export const SYSTEM_PROGRAM_ID: string;
export const TOKEN_PROGRAM_ID: string;
export const ASSOCIATED_TOKEN_PROGRAM_ID: string;
export const RENT_SYSVAR_ID: string;

export interface Keypair {
  privateKey: Uint8Array;
  publicKey: Uint8Array;
  pubkeyBase58: string;
}

export interface AccountInfo {
  data: [string, string];
  executable: boolean;
  lamports: number;
  owner: string;
}

export type Rpc = (method: string, params?: unknown[]) => Promise<any>;

export interface InstructionInput {
  programId: string;
  keys: Array<{ pubkey: string; isSigner: boolean; isWritable: boolean }>;
  data: Uint8Array;
}

export function base58Encode(bytes: Uint8Array): string;
export function base58Decode(str: string): Uint8Array;
export function writeU32LE(buf: Uint8Array, offset: number, value: number): void;
export function writeU64LE(buf: Uint8Array, offset: number, value: bigint): void;
export function readU64LE(buf: Uint8Array, offset: number): bigint;
export function padTo32(bytes: Uint8Array): Uint8Array;
export function findPDA(
  seeds: Uint8Array[],
  programId: Uint8Array
): { pda: Uint8Array; bump: number };
export function deriveATA(walletBase58: string, mintBase58: string): string;

export function makeRpc(rpcUrl: string): Rpc;
export function getLatestBlockhash(rpc: Rpc): Promise<string>;
export function getAccountInfo(rpc: Rpc, pubkey: string): Promise<AccountInfo | null>;
export function getMinimumBalanceForRentExemption(rpc: Rpc, dataLen: number): Promise<number>;
export function requestAirdrop(rpc: Rpc, pubkey: string, lamports: number): Promise<string>;
export function waitForConfirmation(rpc: Rpc, signature: string, timeoutMs?: number): Promise<void>;

export function buildAndSendTransaction(
  rpc: Rpc,
  feePayer: Keypair,
  instructions: InstructionInput[],
  additionalSigners?: Keypair[]
): Promise<string>;

export function keypairFromJsonArray(arr: number[]): Keypair;

export function createMint(
  rpc: Rpc,
  payer: Keypair,
  mintKeypair: Keypair,
  mintAuthority: string,
  decimals: number
): Promise<string>;

export function createAssociatedTokenAccount(
  rpc: Rpc,
  payer: Keypair,
  wallet: string,
  mint: string
): Promise<string>;

export function mintTo(
  rpc: Rpc,
  payer: Keypair,
  mint: string,
  destination: string,
  mintAuthority: Keypair,
  amount: bigint
): Promise<string>;

export function transferChecked(
  rpc: Rpc,
  payer: Keypair,
  source: string,
  mint: string,
  destination: string,
  authority: Keypair,
  amount: bigint,
  decimals: number
): Promise<string>;

export function getSplTokenBalance(rpc: Rpc, tokenAccount: string): Promise<bigint>;
