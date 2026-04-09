# Client Key Management & Passkey Authentication Spec

**Status:** Completed
**Package:** `@toon-protocol/client`
**Date:** 2026-03-31

---

## Problem

ToonClient currently expects a raw `secretKey: Uint8Array` passed by the application. The SDK provides `generateMnemonic()` and `fromMnemonic()` for Nostr + EVM derivation, but:

- No key storage, backup, or recovery
- No authentication flow
- No Solana (Ed25519) or Mina (Pallas) key derivation
- No mnemonic lifecycle management
- Every consuming application must re-implement the full key lifecycle

This pushes critical security responsibilities onto each application developer, increasing the risk of insecure implementations.

---

## Proposal

Add a `KeyManager` module to `@toon-protocol/client` that handles the full key lifecycle: generate, derive, store, backup, recover — gated by WebAuthn Passkeys.

---

## Architecture

```
┌──────────────────────────────────────────────────┐
│  Application (Ditto, etc.)                       │
│  • Calls keyManager.create() or .recover()       │
│  • Passes keyManager into ToonClient             │
└──────────────┬───────────────────────────────────┘
               │
┌──────────────▼───────────────────────────────────┐
│  KeyManager                                       │
│  ├── PasskeyAuth      (WebAuthn create/assert)    │
│  ├── KeyDerivation    (mnemonic → all chains)     │
│  ├── KeyVault         (encrypt/decrypt with PRF)  │
│  ├── BackupService    (relay-based backup)        │
│  └── KeyProvider      (supplies keys to client)   │
└──────────────┬───────────────────────────────────┘
               │
┌──────────────▼───────────────────────────────────┐
│  ToonClient (existing)                            │
│  • Receives secretKey, evmPrivateKey, etc.        │
│  • No changes to existing constructor contract    │
└──────────────────────────────────────────────────┘
```

---

## Key Derivation: All Chains from One Mnemonic

Extend the existing SDK `identity.ts` to derive keys for all supported chains:

| Chain | Curve | BIP-44 Path | Library |
|-------|-------|-------------|---------|
| **Nostr** | secp256k1 (Schnorr x-only) | `m/44'/1237'/0'/0/{i}` | nostr-tools |
| **EVM** | secp256k1 (Keccak-256 → address) | Same key as Nostr | viem |
| **Solana** | Ed25519 | `m/44'/501'/0'/0'` | @solana/web3.js (SLIP-0010) |
| **Mina** | Pallas | `m/44'/12586'/0'/0/{i}` | mina-signer |

### Interface

```typescript
interface ToonIdentity {
  mnemonic: string;               // 12-word BIP-39 (only available at creation)
  nostr: {
    secretKey: Uint8Array;        // 32-byte secp256k1
    pubkey: string;               // 64-char hex (x-only Schnorr)
  };
  evm: {
    privateKey: Uint8Array;       // Same as nostr.secretKey
    address: string;              // 0x-prefixed EIP-55 checksummed
  };
  solana: {
    secretKey: Uint8Array;        // 64-byte Ed25519 keypair
    publicKey: string;            // Base58 address
  };
  mina: {
    privateKey: string;           // Base58 Mina private key
    publicKey: string;            // Base58 Mina public key
  };
}

function deriveFullIdentity(mnemonic: string): ToonIdentity;
```

---

## Passkey Authentication

### Registration (Account Creation)

```typescript
const keyManager = new KeyManager({ relayUrls: ['wss://relay.example'] });

// 1. Creates Passkey, generates mnemonic, derives all keys,
//    encrypts and stores locally + backs up to relay
const identity = await keyManager.create();

// 2. Pass into ToonClient as before
const client = new ToonClient({
  secretKey: identity.nostr.secretKey,
  // ... rest of config
});
```

### Assertion (Login / Recovery)

```typescript
// Works on any device where the Passkey has synced
const identity = await keyManager.recover();
```

---

## Encryption: Envelope Pattern with PRF

Uses the proven envelope encryption pattern (same as Bitwarden, 1Password):

```
                  ┌─────────────┐
                  │  Mnemonic   │
                  └──────┬──────┘
                         │ encrypt with DEK
                  ┌──────▼──────┐
                  │  Encrypted  │
                  │  Mnemonic   │
                  └──────┬──────┘
                         │
              ┌──────────┼──────────┐
              │          │          │
       ┌──────▼──┐ ┌────▼────┐ ┌──▼──────┐
       │ Passkey  │ │ Passkey │ │Recovery │
       │   #1     │ │   #2    │ │  Code   │
       │ KEK wrap │ │KEK wrap │ │KEK wrap │
       └─────────┘ └─────────┘ └─────────┘
```

### Flow

1. **Generate** random 256-bit DEK (Data Encryption Key)
2. **Encrypt** mnemonic with DEK using AES-256-GCM
3. **Derive** KEK from Passkey PRF: `HKDF(PRF(CredRandom, salt), info="toon:kek")`
4. **Wrap** DEK with KEK using AES-KW (Key Wrap)
5. **Store** encrypted mnemonic + wrapped DEK(s) as backup payload

### Why Envelope Pattern

- Multiple Passkeys can each wrap the same DEK independently
- Adding/removing a Passkey doesn't re-encrypt the mnemonic
- Recovery code is just another KEK wrapping the same DEK
- Credential loss is survivable (any remaining KEK can unwrap)

---

## Relay Backup

The encrypted backup is published as a **kind:30078** (NIP-78 application-specific data) replaceable event.

### Event Structure

```typescript
{
  kind: 30078,
  pubkey: "<nostr_pubkey>",
  tags: [
    ["d", "toon:identity-backup"],
    ["v", "1"],                       // Schema version
    ["chains", "nostr,evm,solana,mina"]
  ],
  content: JSON.stringify({
    encrypted_mnemonic: "<base64>",   // AES-256-GCM(DEK, mnemonic)
    wrapped_keys: [
      {
        id: "<credential_id_hash>",   // SHA-256 of WebAuthn credential ID
        wrapped_dek: "<base64>",      // AES-KW(KEK, DEK)
        salt: "<base64>",             // PRF salt used for this credential
        created_at: 1234567890
      }
    ],
    recovery_code_wrapped_dek: "<base64>",  // Optional
    iv: "<base64>",                   // GCM nonce for mnemonic encryption
  }),
  created_at: <timestamp>,
  sig: "<schnorr_signature>"
}
```

### Recovery Query

The Nostr pubkey is stored in the Passkey's `userHandle` field (32 bytes raw). On recovery:

```
1. Passkey assertion → extract userHandle → Nostr pubkey
2. Query relay: { kinds: [30078], authors: [pubkey], "#d": ["toon:identity-backup"] }
3. Passkey PRF → HKDF → KEK → unwrap DEK → decrypt mnemonic
4. deriveFullIdentity(mnemonic) → all chain keys restored
```

No Nostr private key is needed to fetch or decrypt the backup.

---

## KeyManager API

```typescript
interface KeyManagerConfig {
  relayUrls: string[];              // Relays for backup storage
  rpId?: string;                    // WebAuthn relying party ID (defaults to window.location.hostname)
  rpName?: string;                  // Display name for Passkey prompt
  storageKey?: string;              // IndexedDB key prefix (default: "toon:keys")
}

class KeyManager {
  constructor(config: KeyManagerConfig);

  // Account lifecycle
  create(): Promise<ToonIdentity>;              // New account + Passkey + backup
  recover(): Promise<ToonIdentity>;             // Recover via synced Passkey
  importMnemonic(mnemonic: string): Promise<ToonIdentity>;  // Import existing
  importNsec(nsec: string): Promise<ToonIdentity>;          // Import Nostr-only (fresh chain keys)

  // Passkey management
  addPasskey(): Promise<void>;                  // Register additional Passkey
  listPasskeys(): Promise<PasskeyInfo[]>;       // List registered credentials
  removePasskey(credentialId: string): Promise<void>;

  // Recovery
  generateRecoveryCode(): Promise<string>;      // Printable recovery code
  recoverWithCode(code: string): Promise<ToonIdentity>;

  // Key access (after create/recover)
  getIdentity(): ToonIdentity | null;
  getNostrSecretKey(): Uint8Array;
  getEvmSigner(): EvmSigner;
  getSolanaSigner(): SolanaSigner;
  getMinaSigner(): MinaSigner;

  // Backup
  backupToRelay(): Promise<void>;               // Publish/update kind:30078

  // Lock/unlock
  lock(): void;                                 // Clear keys from memory
  unlock(): Promise<ToonIdentity>;              // Re-assert Passkey to decrypt local store
}
```

---

## ToonClient Integration

No breaking changes. KeyManager provides keys that ToonClient already accepts:

```typescript
const km = new KeyManager({ relayUrls: ['wss://relay.example'] });
const identity = await km.create(); // or km.recover()

const client = new ToonClient({
  connectorUrl: 'http://localhost:8080',
  secretKey: identity.nostr.secretKey,
  evmPrivateKey: identity.evm.privateKey,
  ilpInfo: {
    pubkey: identity.nostr.pubkey,
    ilpAddress: `g.toon.${identity.nostr.pubkey.slice(0, 8)}`,
  },
  toonEncoder: encodeEventToToon,
  toonDecoder: decodeEventFromToon,
});

// Register chain signers for multi-chain settlement
client.channelManager.registerChainSigner('solana', km.getSolanaSigner());
client.channelManager.registerChainSigner('mina', km.getMinaSigner());

await client.start();
```

---

## Import Flows

### Existing Nostr User (has nsec, no mnemonic)

```
1. importNsec(nsec) →
2. Derive EVM address from same secp256k1 key (free)
3. Generate NEW Solana + Mina keys (different curves, can't derive from nsec)
4. Store all keys in encrypted vault
5. Backup to relay
```

Limitation: Solana/Mina keys are not deterministically linked to the Nostr identity. Documented trade-off for backwards compatibility.

### Existing Nostr User (has mnemonic, NIP-06)

```
1. importMnemonic(mnemonic) →
2. Derive all chain keys deterministically
3. Full parity with fresh accounts
```

---

## Browser Requirements

| Feature | Minimum | Fallback |
|---------|---------|----------|
| WebAuthn (Passkeys) | All modern browsers | NIP-07 extension / nsec import |
| PRF Extension | Safari 18+, Chrome 132+, Android 14+ | Password-encrypted vault (no PRF) |
| IndexedDB | All modern browsers | localStorage (degraded) |
| SubtleCrypto | All modern browsers | None (required) |

When PRF is unavailable, fall back to a user-provided password for KEK derivation via PBKDF2. The backup event format is identical — only the KEK source changes.

---

## Security Considerations

1. **Mnemonic never stored in plaintext** — always encrypted with DEK before persistence
2. **DEK never stored unwrapped** — always wrapped by at least one KEK
3. **Keys cleared on lock()** — `identity` object zeroed in memory
4. **PRF salt is unique per credential** — prevents cross-credential correlation
5. **UV always required** — consistent CredRandomWithUV to ensure deterministic PRF output
6. **Relay backup is opaque** — content is encrypted, relay cannot read mnemonic
7. **No private key getters on signers** — existing pattern preserved (EvmSigner has no `getPrivateKey()`)
8. **Recovery code stored as bcrypt hash** — only the user has the plaintext

---

## File Structure

```
packages/client/src/
├── keys/
│   ├── KeyManager.ts           # Main orchestrator
│   ├── PasskeyAuth.ts          # WebAuthn registration/assertion + PRF
│   ├── KeyDerivation.ts        # Multi-chain derivation from mnemonic
│   ├── KeyVault.ts             # Envelope encryption (DEK/KEK)
│   ├── BackupService.ts        # kind:30078 relay backup/restore
│   ├── types.ts                # ToonIdentity, PasskeyInfo, etc.
│   └── index.ts                # Public exports
├── signing/
│   ├── evm-signer.ts           # (existing)
│   ├── solana-signer.ts        # (existing)
│   └── mina-signer.ts          # (existing)
```

---

## Dependencies (New)

| Package | Purpose |
|---------|---------|
| `@noble/hashes` | HKDF, SHA-256 (already in nostr-tools dep tree) |
| `mina-signer` | Mina key derivation (lighter than o1js for client-side) |
| `@solana/web3.js` | Solana Ed25519 keypair derivation |
| `@noble/ed25519` | SLIP-0010 Ed25519 derivation |

No new dependencies for WebAuthn (browser native) or SubtleCrypto (browser native).

---

## Out of Scope (Future)

- Social recovery (NIP-based trusted contacts)
- Hardware wallet integration (Ledger, Trezor)
- Multi-account switching within KeyManager
- Key rotation (new mnemonic, migrate channels)

---

## Review Notes

- Adversarial review completed
- Findings: 16 total, 10 fixed, 6 acknowledged as design tradeoffs/JS limitations
- Resolution approach: auto-fix for real findings
- Critical fix: recovery code PBKDF2 salt now persisted in VaultData
- Critical fix: single-assertion unlock path when local vault available
