import { describe, it, expect } from 'vitest';
import {
  createDataKey,
  decryptField,
  encryptField,
  importDataKey,
  unwrapWithPassphrase,
  unwrapWithPrfKey,
  wrapWithPassphrase,
  wrapWithPrfKey
} from './vaultCrypto';

const SECRET = 'dGVzdHNoYXJlZHNlY3JldDEyMzQ1Njc4OT0=';

describe('vaultCrypto', () => {
  it('round-trips a field with the data key', async () => {
    const { key } = await createDataKey();
    const blob = await encryptField(key, 'acc_1', 'sharedSecret', SECRET);

    expect(blob.data).not.toContain(SECRET);
    await expect(decryptField(key, 'acc_1', 'sharedSecret', blob)).resolves.toBe(SECRET);
  });

  it('uses a fresh nonce for every encryption', async () => {
    const { key } = await createDataKey();
    const first = await encryptField(key, 'acc_1', 'sharedSecret', SECRET);
    const second = await encryptField(key, 'acc_1', 'sharedSecret', SECRET);

    expect(first.iv).not.toBe(second.iv);
    expect(first.data).not.toBe(second.data);
  });

  it('binds a ciphertext to its record and field', async () => {
    const { key } = await createDataKey();
    const blob = await encryptField(key, 'acc_1', 'sharedSecret', SECRET);

    // Copying the blob to another account must not decrypt.
    await expect(decryptField(key, 'acc_2', 'sharedSecret', blob)).rejects.toThrow();
    // Swapping fields inside the same record must not decrypt either.
    await expect(decryptField(key, 'acc_1', 'identitySecret', blob)).rejects.toThrow();
  });

  it('rejects a different data key', async () => {
    const first = await createDataKey();
    const second = await createDataKey();
    const blob = await encryptField(first.key, 'acc_1', 'sharedSecret', SECRET);

    await expect(decryptField(second.key, 'acc_1', 'sharedSecret', blob)).rejects.toThrow();
  });

  it('round-trips the data key through a passphrase', async () => {
    const { raw } = await createDataKey();
    const envelope = await wrapWithPassphrase(raw, 'correct horse battery');

    expect(envelope.salt).toBeTruthy();
    expect(envelope.iterations).toBeGreaterThanOrEqual(100_000);

    const unwrapped = await unwrapWithPassphrase(envelope, 'correct horse battery');
    expect(Array.from(unwrapped)).toEqual(Array.from(raw));

    // The recovered bytes must be usable as the data key again.
    const key = await importDataKey(unwrapped);
    const blob = await encryptField(key, 'acc_1', 'sharedSecret', SECRET);
    await expect(decryptField(key, 'acc_1', 'sharedSecret', blob)).resolves.toBe(SECRET);
  });

  it('rejects a wrong passphrase', async () => {
    const { raw } = await createDataKey();
    const envelope = await wrapWithPassphrase(raw, 'correct horse battery');

    await expect(unwrapWithPassphrase(envelope, 'wrong horse battery')).rejects.toThrow();
  });

  it('uses a unique salt per passphrase envelope', async () => {
    const { raw } = await createDataKey();
    const first = await wrapWithPassphrase(raw, 'same passphrase');
    const second = await wrapWithPassphrase(raw, 'same passphrase');

    expect(first.salt).not.toBe(second.salt);
    expect(first.blob.iv).not.toBe(second.blob.iv);
  });

  it('round-trips the data key through a PRF key', async () => {
    const { raw } = await createDataKey();
    const prfKey = crypto.getRandomValues(new Uint8Array(32));
    const blob = await wrapWithPrfKey(prfKey, raw);

    const unwrapped = await unwrapWithPrfKey(prfKey, blob);
    expect(Array.from(unwrapped)).toEqual(Array.from(raw));
  });

  it('rejects a PRF key from another credential', async () => {
    const { raw } = await createDataKey();
    const blob = await wrapWithPrfKey(crypto.getRandomValues(new Uint8Array(32)), raw);
    const otherKey = crypto.getRandomValues(new Uint8Array(32));

    await expect(unwrapWithPrfKey(otherKey, blob)).rejects.toThrow();
  });
});