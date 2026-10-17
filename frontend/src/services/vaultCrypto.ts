/**
 * Vault primitives.
 *
 * The vault protects Steam secrets at rest. A single random data encryption
 * key (DEK) encrypts every secret field with AES-GCM; the DEK itself is never
 * stored, only wrapped copies of it:
 *
 *   - `prf`       : wrapped by a key derived from a WebAuthn passkey (PRF),
 *                  so the unwrapping key never reaches JavaScript.
 *   - `passphrase`: wrapped by PBKDF2-SHA-256 (600k iterations) from a
 *                  user-chosen recovery passphrase.
 *
 * Losing both copies means losing the vault, so the app always offers at
 * least one recovery path and makes the choice explicit.
 */

import { base64ToUint8Array, uint8ArrayToBase64, uint8ArrayToHex } from './steamCrypto';

const IV_BYTES = 12;
const SALT_BYTES = 16;
const PBKDF2_ITERATIONS = 600_000;
const DATA_ALG = { name: 'AES-GCM', length: 256 } as const;

export interface EncryptedBlob {
  /** base64 96-bit nonce */
  iv: string;
  /** base64 ciphertext + 128-bit GCM tag */
  data: string;
}

function randomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

function subtle(): SubtleCrypto {
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    throw new Error(
      'Web Crypto is unavailable. The vault requires a secure context (https:// or localhost).'
    );
  }
  return crypto.subtle;
}

/**
 * Additional authenticated data binds a ciphertext to its record and field,
 * so a blob cannot be copied to another account or field and still decrypt.
 */
function aadFor(recordId: string, field: string): Uint8Array {
  return new TextEncoder().encode(`steamguard:vault:v2:${recordId}:${field}`);
}

async function importAesKey(raw: Uint8Array, usages: KeyUsage[]): Promise<CryptoKey> {
  return subtle().importKey('raw', raw as BufferSource, DATA_ALG, false, usages);
}

// ---------------------------------------------------------------------------
// Field level encryption (DEK)
// ---------------------------------------------------------------------------

/** AES-GCM never reuses a nonce with the same key, so every call gets a fresh one. */
export async function encryptField(
  dek: CryptoKey,
  recordId: string,
  field: string,
  value: string
): Promise<EncryptedBlob> {
  const iv = randomBytes(IV_BYTES);
  const ct = await subtle().encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource, additionalData: aadFor(recordId, field) as BufferSource },
    dek,
    new TextEncoder().encode(value) as BufferSource
  );
  return { iv: uint8ArrayToBase64(iv), data: uint8ArrayToBase64(new Uint8Array(ct)) };
}

export async function decryptField(
  dek: CryptoKey,
  recordId: string,
  field: string,
  blob: EncryptedBlob
): Promise<string> {
  const plain = await subtle().decrypt(
    {
      name: 'AES-GCM',
      iv: base64ToUint8Array(blob.iv) as BufferSource,
      additionalData: aadFor(recordId, field) as BufferSource
    },
    dek,
    base64ToUint8Array(blob.data) as BufferSource
  );
  return new TextDecoder().decode(plain);
}

// ---------------------------------------------------------------------------
// Data encryption key
// ---------------------------------------------------------------------------

export interface DataKey {
  /** Non-extractable key used for every field. */
  key: CryptoKey;
  /** Raw bytes, only for the duration of the wrapping operation. */
  raw: Uint8Array;
}

/**
 * A fresh DEK per vault. The raw bytes exist only while we wrap them; the
 * import below is `extractable: false` so the key itself can never leave the
 * crypto subsystem.
 */
export async function createDataKey(): Promise<DataKey> {
  const raw = randomBytes(32);
  const key = await importAesKey(raw, ['encrypt', 'decrypt']);
  return { key, raw };
}

export async function importDataKey(raw: Uint8Array): Promise<CryptoKey> {
  return importAesKey(raw, ['encrypt', 'decrypt']);
}

// ---------------------------------------------------------------------------
// Passphrase wrapping (recovery path)
// ---------------------------------------------------------------------------

/**
 * Argon2id parameters for the recovery passphrase.
 *
 * Memory-hard derivation is what makes offline guessing expensive on GPUs and
 * ASICs; PBKDF2 is only CPU-bound. 19 MiB / 2 passes follows the OWASP
 * recommendation for a second-preference KDF.
 */
const ARGON2_MEMORY_KIB = 19 * 1024;
const ARGON2_ITERATIONS = 2;
const ARGON2_PARALLELISM = 1;

type Argon2Kind = 'argon2id' | 'pbkdf2-sha256';

export interface PassphraseEnvelope {
  /** Which KDF produced `blob`, so the format can evolve without guessing. */
  kdf: Argon2Kind;
  salt: string;
  /** PBKDF2 iteration count; unused for Argon2id. */
  iterations: number;
  blob: EncryptedBlob;
}

/**
 * Derives the wrapping key from the passphrase.
 *
 * Argon2id is used when the WebAssembly module can be loaded; otherwise the
 * built-in PBKDF2 path takes over. Both produce a 32-byte key, so a vault
 * written by one can always be opened by the other.
 */
async function deriveWrappingKey(
  passphrase: string,
  salt: Uint8Array,
  kdf: Argon2Kind
): Promise<CryptoKey> {
  const normalised = passphrase.normalize('NFKC');

  if (kdf === 'argon2id') {
    const { argon2id } = await import('hash-wasm');
    const hex = await argon2id({
      password: normalised,
      salt: toHex(salt),
      parallelism: ARGON2_PARALLELISM,
      iterations: ARGON2_ITERATIONS,
      memorySize: ARGON2_MEMORY_KIB,
      hashLength: 32,
      outputType: 'hex'
    });
    return importAesKey(fromHex(hex), ['encrypt', 'decrypt']);
  }

  const material = await subtle().importKey(
    'raw',
    new TextEncoder().encode(normalised) as BufferSource,
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return subtle().deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    material,
    DATA_ALG,
    false,
    ['encrypt', 'decrypt']
  );
}

/** Argon2id when the runtime allows it, PBKDF2 as the safety net. */
async function preferredKdf(): Promise<Argon2Kind> {
  try {
    // A missing module, a CSP without 'wasm-unsafe-eval' or a locked-down
    // runtime all surface here as a rejection.
    await import('hash-wasm');
    return 'argon2id';
  } catch (err) {
    // Say so once: silently using the weaker KDF would be a surprise.
    console.warn(
      `[SteamGuard] Argon2id is unavailable, falling back to PBKDF2: ${String(
        (err as Error)?.message ?? err
      )}`
    );
    return 'pbkdf2-sha256';
  }
}

export async function wrapWithPassphrase(
  rawDek: Uint8Array,
  passphrase: string
): Promise<PassphraseEnvelope> {
  const kdf = await preferredKdf();
  const salt = randomBytes(SALT_BYTES);
  const wrapKey = await deriveWrappingKey(passphrase, salt, kdf);
  return {
    kdf,
    salt: uint8ArrayToBase64(salt),
    iterations: PBKDF2_ITERATIONS,
    blob: await encryptField(wrapKey, 'vault', 'dek', uint8ArrayToBase64(rawDek))
  };
}

export async function unwrapWithPassphrase(
  envelope: PassphraseEnvelope,
  passphrase: string
): Promise<Uint8Array> {
  const salt = base64ToUint8Array(envelope.salt);
  const kdf = envelope.kdf ?? 'pbkdf2-sha256';
  const wrapKey = await deriveWrappingKey(passphrase, salt, kdf);
  const raw = await decryptField(wrapKey, 'vault', 'dek', envelope.blob);
  return base64ToUint8Array(raw);
}

function toHex(bytes: Uint8Array): string {
  return uint8ArrayToHex(bytes);
}

function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Passkey (PRF) wrapping
// ---------------------------------------------------------------------------

/**
 * AES-GCM needs a 32-byte key; the PRF output already is one, so it is
 * imported directly instead of being hashed again.
 */
export async function wrapWithPrfKey(prfKey: Uint8Array, rawDek: Uint8Array): Promise<EncryptedBlob> {
  const key = await importAesKey(prfKey, ['encrypt', 'decrypt']);
  return encryptField(key, 'vault', 'dek-prf', uint8ArrayToBase64(rawDek));
}

export async function unwrapWithPrfKey(
  prfKey: Uint8Array,
  blob: EncryptedBlob
): Promise<Uint8Array> {
  const key = await importAesKey(prfKey, ['encrypt', 'decrypt']);
  const raw = await decryptField(key, 'vault', 'dek-prf', blob);
  return base64ToUint8Array(raw);
}

export function randomSalt(): Uint8Array {
  return randomBytes(32);
}