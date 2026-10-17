/**
 * Vault state machine.
 *
 * Responsibilities:
 *  - own the single in-memory data encryption key (never persisted in the clear),
 *  - persist only *wrapped* copies of that key (passkey/PRF and/or passphrase),
 *  - expose lock/unlock state so the UI can gate access to secrets,
 *  - auto-lock on inactivity and when the tab is hidden.
 *
 * This module never imports `storage` (which imports it) to keep the
 * dependency graph acyclic: persistence is injected by `storage`.
 */

import {
  createDataKey,
  decryptField,
  encryptField,
  importDataKey,
  randomSalt,
  unwrapWithPassphrase,
  unwrapWithPrfKey,
  wrapWithPassphrase,
  wrapWithPrfKey,
  type EncryptedBlob
} from './vaultCrypto';
import { derivePrfKey, enrollPrfCredential, type PrfCredential } from './prfVault';
import { base64ToUint8Array, uint8ArrayToBase64 } from './steamCrypto';
import { VaultError, type VaultErrorCode } from './vaultErrors';

export type VaultStatus = 'disabled' | 'locked' | 'unlocked';

export interface VaultRecoveryEnvelope {
  salt: string;
  iterations: number;
  blob: EncryptedBlob;
}

export interface VaultConfig {
  version: 2;
  enabled: boolean;
  createdAt: string;
  autoLockSec: number;
  /** Probe encrypted with the DEK: proves an unlock produced the right key. */
  check: EncryptedBlob;
  /** Wrapped by a WebAuthn passkey via the PRF extension. */
  prf?: { credential: PrfCredential; salt: string; blob: EncryptedBlob } | null;
  /** Wrapped by PBKDF2-SHA-256 from a recovery passphrase. */
  passphrase?: VaultRecoveryEnvelope | null;
}

export const VAULT_CONFIG_KEY = 'vault_config';

const CHECK_RECORD = 'vault';
const CHECK_FIELD = 'check';
const CHECK_PLAINTEXT = 'steamguard-vault-ok';
const DEFAULT_AUTO_LOCK_SEC = 300;
const MIN_AUTO_LOCK_SEC = 30;
const MIN_PASSPHRASE_LENGTH = 8;

/**
 * Remembers that this device created a passkey but could not derive a vault
 * key from it (older Windows Hello, some security keys). The settings screen
 * then hides the option instead of asking the user to authenticate again for a
 * result we already know. Clearing it is one click, so an OS update can be
 * followed by a retry.
 */
export const PRF_UNAVAILABLE_KEY = 'sw_prf_unavailable';

export function isPrfKnownUnavailable(): boolean {
  try {
    return localStorage.getItem(PRF_UNAVAILABLE_KEY) === '1';
  } catch {
    return false;
  }
}

export function markPrfUnavailable(): void {
  try {
    localStorage.setItem(PRF_UNAVAILABLE_KEY, '1');
  } catch {
    // best effort
  }
}

export function clearPrfUnavailable(): void {
  try {
    localStorage.removeItem(PRF_UNAVAILABLE_KEY);
  } catch {
    // best effort
  }
}

export class VaultLockedError extends Error {
  readonly code: VaultErrorCode;

  constructor(message = 'The vault is locked. Unlock it to continue.', code: VaultErrorCode = 'locked') {
    super(message);
    this.name = 'VaultLockedError';
    this.code = code;
  }
}

interface VaultPersistence {
  load(): Promise<VaultConfig | null>;
  save(config: VaultConfig): Promise<void>;
  clear(): Promise<void>;
}

let persistence: VaultPersistence | null = null;
let config: VaultConfig | null = null;
let dek: CryptoKey | null = null;
/** Raw DEK bytes, held only while unlocked so recovery copies can be re-wrapped. */
let dekRaw: Uint8Array | null = null;
let loaded = false;
const listeners = new Set<(status: VaultStatus) => void>();

export function configureVaultPersistence(next: VaultPersistence): void {
  persistence = next;
}

function status(): VaultStatus {
  if (!config?.enabled) return 'disabled';
  return dek ? 'unlocked' : 'locked';
}

function emit(): void {
  const current = status();
  listeners.forEach((listener) => listener(current));
}

export function onVaultChange(listener: (status: VaultStatus) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getVaultStatus(): VaultStatus {
  return status();
}

export function getVaultConfig(): VaultConfig | null {
  return config;
}

export function isVaultUnlocked(): boolean {
  return Boolean(dek);
}

/**
 * False until the vault metadata has been read from IndexedDB. Callers must
 * treat "unknown" as "locked": reading a record before the config is loaded
 * would look like an unencrypted database.
 */
export function isVaultConfigLoaded(): boolean {
  return loaded;
}

export function hasPasskey(): boolean {
  return Boolean(config?.prf);
}

export function hasPassphrase(): boolean {
  return Boolean(config?.passphrase);
}

/** Throws when a caller needs the DEK but the vault is not open. */
export function requireVaultKey(): CryptoKey {
  if (!dek) throw new VaultLockedError();
  return dek;
}

export async function loadVaultConfig(): Promise<void> {
  if (!persistence) {
    loaded = true;
    emit();
    return;
  }
  config = await persistence.load();
  loaded = true;
  emit();
}

/**
 * Called when the metadata cannot be read at all (unusable storage). The app
 * must not wait forever for a vault that will never be described.
 */
export function markVaultConfigUnavailable(): void {
  config = null;
  loaded = true;
  emit();
}

// ---------------------------------------------------------------------------
// Locking
// ---------------------------------------------------------------------------

function wipe(bytes: Uint8Array | null): void {
  if (bytes) bytes.fill(0);
}

/** Drops the DEK from memory. */
export function lockVault(): void {
  wipe(dekRaw);
  dekRaw = null;
  dek = null;
  emit();
}

let autoLockTimer: ReturnType<typeof setTimeout> | null = null;

/** (Re)arms the inactivity timer. No-op unless the vault is open. */
export function touchVault(): void {
  if (autoLockTimer) clearTimeout(autoLockTimer);
  if (!config?.enabled || !dek) return;
  autoLockTimer = setTimeout(lockVault, Math.max(MIN_AUTO_LOCK_SEC, config.autoLockSec) * 1000);
}

/**
 * Locks the vault when the tab is hidden and on inactivity. Returns a cleanup
 * function for the caller to use as an effect teardown.
 */
export function attachAutoLock(): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => undefined;

  const onActivity = () => touchVault();
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') lockVault();
    else touchVault();
  };

  window.addEventListener('pointerdown', onActivity);
  window.addEventListener('keydown', onActivity);
  document.addEventListener('visibilitychange', onVisibility);
  touchVault();

  return () => {
    if (autoLockTimer) clearTimeout(autoLockTimer);
    window.removeEventListener('pointerdown', onActivity);
    window.removeEventListener('keydown', onActivity);
    document.removeEventListener('visibilitychange', onVisibility);
  };
}

// ---------------------------------------------------------------------------
// Enabling / disabling
// ---------------------------------------------------------------------------

export interface EnableVaultOptions {
  /** Create a passkey and wrap the DEK with the authenticator's PRF output. */
  usePasskey: boolean;
  /** Also store a passphrase-wrapped copy. This is the recovery path. */
  usePassphrase: boolean;
  passphrase?: string;
  userName?: string;
}

async function buildCheck(key: CryptoKey): Promise<EncryptedBlob> {
  return encryptField(key, CHECK_RECORD, CHECK_FIELD, CHECK_PLAINTEXT);
}

/**
 * Creates a new DEK, stores the requested wrapped copies and opens the vault.
 * At least one unlock method is mandatory so the vault can never become
 * permanently unreadable.
 */
export async function enableVault(options: EnableVaultOptions): Promise<VaultConfig> {
  if (!persistence) throw new Error('Vault storage is not ready.');
  if (!options.usePasskey && !options.usePassphrase) {
    throw new VaultError('no_method', 'Choose at least one unlock method.');
  }
  if (options.usePassphrase) {
    if (!options.passphrase) {
      throw new VaultError('short_passphrase', 'A recovery passphrase is required.');
    }
    if (options.passphrase.length < MIN_PASSPHRASE_LENGTH) {
      throw new VaultError(
        'short_passphrase',
        `The recovery passphrase must be at least ${MIN_PASSPHRASE_LENGTH} characters.`
      );
    }
  }

  const { key, raw } = await createDataKey();
  const next: VaultConfig = {
    version: 2,
    enabled: true,
    createdAt: new Date().toISOString(),
    autoLockSec: DEFAULT_AUTO_LOCK_SEC,
    check: await buildCheck(key),
    prf: null,
    passphrase: null
  };

  if (options.usePasskey) {
    // One prompt: the salt is handed to the authenticator while the passkey is
    // created, so the vault key comes back with it. Devices that cannot derive
    // a key here are skipped instead of prompting a second time.
    try {
      const salt = randomSalt();
      const credential = await enrollPrfCredential(options.userName || 'SteamGuard user', salt);

      if (credential.prfKey) {
        next.prf = {
          credential: { credentialId: credential.credentialId },
          salt: uint8ArrayToBase64(salt),
          blob: await wrapWithPrfKey(credential.prfKey, raw)
        };
      } else if (!options.usePassphrase) {
        throw new VaultError(
          'prf_unsupported',
          'This device cannot derive a vault key. Add a recovery passphrase and try again.'
        );
      } else {
        markPrfUnavailable();
        console.warn(
          '[SteamGuard] The passkey was created but this device derives no vault key; using the recovery passphrase.'
        );
      }
    } catch (err) {
      if (!options.usePassphrase) throw err;
      markPrfUnavailable();
      console.warn(
        '[SteamGuard] Passkey unusable for the vault; falling back to the recovery passphrase.',
        err
      );
    }
  }

  if (options.usePassphrase) {
    next.passphrase = await wrapWithPassphrase(raw, options.passphrase as string);
  }

  await persistence.save(next);
  config = next;
  dek = key;
  dekRaw = raw;
  emit();
  touchVault();
  return next;
}

/**
 * Turns the vault off. `flushPlaintext` must first rewrite every record in the
 * clear, otherwise the stored data would stay encrypted with a key we are
 * about to discard.
 */
export async function disableVault(): Promise<void> {
  if (!persistence) return;
  await persistence.clear();
  config = null;
  wipe(dekRaw);
  dekRaw = null;
  dek = null;
  loaded = true;
  emit();
}

// ---------------------------------------------------------------------------
// Unlocking
// ---------------------------------------------------------------------------

async function adoptKey(raw: Uint8Array): Promise<void> {
  const key = await importDataKey(raw);
  if (!config?.check) {
    wipe(raw);
    throw new VaultLockedError('Vault metadata is incomplete.');
  }

  let probe: string;
  try {
    probe = await decryptField(key, CHECK_RECORD, CHECK_FIELD, config.check);
  } catch {
    wipe(raw);
    throw new VaultLockedError('Unlocked with the wrong key.');
  }

  if (probe !== CHECK_PLAINTEXT) {
    wipe(raw);
    throw new VaultLockedError('Unlocked with the wrong key.');
  }

  dek = key;
  dekRaw = raw;
  emit();
  touchVault();
}

export async function unlockWithPasskey(): Promise<void> {
  if (!config?.prf) throw new VaultLockedError('No passkey is registered for this vault.', 'no_passkey');
  const salt = base64ToUint8Array(config.prf.salt);
  try {
    const prfKey = await derivePrfKey(config.prf.credential, salt);
    await adoptKey(await unwrapWithPrfKey(prfKey, config.prf.blob));
  } catch (err) {
    throw asUnlockError(err);
  }
}

export async function unlockWithPassphrase(passphrase: string): Promise<void> {
  if (!config?.passphrase) {
    throw new VaultLockedError('No recovery passphrase is set.', 'no_passphrase');
  }
  try {
    await adoptKey(await unwrapWithPassphrase(config.passphrase, passphrase));
  } catch (err) {
    throw asUnlockError(err);
  }
}

/**
 * WebCrypto rejects with an `OperationError` whose message is an empty string,
 * which would leave the user staring at a silent, unresponsive button. Every
 * unlock failure therefore ends up with a message the UI can show.
 */
function asUnlockError(err: unknown): VaultLockedError {
  if (err instanceof VaultLockedError && err.message) return err;
  const detail = err instanceof Error && err.message ? err.message : '';
  return new VaultLockedError(
    detail
      ? `The vault could not be opened with this method. (${detail})`
      : 'The vault could not be opened with this method.',
    'wrong_key'
  );
}

// ---------------------------------------------------------------------------
// Recovery management
// ---------------------------------------------------------------------------

/** Recovers the raw DEK through an already-authenticated method. */
async function rawDekViaPasskey(): Promise<Uint8Array> {
  if (!config?.prf) throw new VaultLockedError();
  const prfKey = await derivePrfKey(config.prf.credential, base64ToUint8Array(config.prf.salt));
  return unwrapWithPrfKey(prfKey, config.prf.blob);
}

/** Adds a recovery passphrase to a vault that has none. */
export async function addPassphrase(passphrase: string): Promise<void> {
  if (!config || !dek || !dekRaw) throw new VaultLockedError();
  if (config.passphrase) throw new Error('A recovery passphrase is already set.');
  if (passphrase.length < MIN_PASSPHRASE_LENGTH) {
    throw new VaultError(
      'short_passphrase',
      `The recovery passphrase must be at least ${MIN_PASSPHRASE_LENGTH} characters.`
    );
  }

  config.passphrase = await wrapWithPassphrase(dekRaw, passphrase);
  await persistence!.save(config);
  emit();
}

/** Rotates the recovery passphrase; requires proving the current one. */
export async function changePassphrase(currentPassphrase: string, nextPassphrase: string): Promise<void> {
  if (!config?.passphrase) throw new VaultLockedError('No recovery passphrase is set.', 'no_passphrase');
  if (nextPassphrase.length < MIN_PASSPHRASE_LENGTH) {
    throw new VaultError(
      'short_passphrase',
      `The recovery passphrase must be at least ${MIN_PASSPHRASE_LENGTH} characters.`
    );
  }

  // Prove the old passphrase first, then re-wrap whatever it unwrapped.
  let raw: Uint8Array;
  try {
    raw = await unwrapWithPassphrase(config.passphrase, currentPassphrase);
  } catch (err) {
    throw asUnlockError(err);
  }

  config.passphrase = await wrapWithPassphrase(raw, nextPassphrase);
  wipe(raw);
  await persistence!.save(config);
  emit();
}

/** Drops the passphrase copy. Refuses to leave the vault without any way in. */
export async function removePassphrase(passphrase: string): Promise<void> {
  if (!config?.passphrase) throw new VaultLockedError();
  if (!config.prf) {
    throw new Error('Register a passkey before removing the recovery passphrase.');
  }

  let raw: Uint8Array;
  try {
    raw = await unwrapWithPassphrase(config.passphrase, passphrase);
  } catch (err) {
    throw asUnlockError(err);
  }

  // Sanity check that the passphrase we were given is really the right one.
  const key = await importDataKey(raw);
  const probe = await decryptField(key, CHECK_RECORD, CHECK_FIELD, config.check);
  wipe(raw);
  if (probe !== CHECK_PLAINTEXT) throw new VaultLockedError('Wrong passphrase.', 'wrong_key');

  config.passphrase = null;
  await persistence!.save(config);
  emit();
}

export async function setAutoLock(seconds: number): Promise<void> {
  if (!config) return;
  config.autoLockSec = Math.max(MIN_AUTO_LOCK_SEC, Math.floor(seconds));
  await persistence!.save(config);
  touchVault();
}

/** Re-wraps the DEK under a freshly enrolled passkey (keeps the passphrase). */
export async function addPasskey(userName?: string): Promise<void> {
  if (!config || !dekRaw) throw new VaultLockedError();

  const salt = randomSalt();
  const credential = await enrollPrfCredential(userName || 'SteamGuard user', salt);
  if (!credential.prfKey) {
    throw new VaultError(
      'prf_unsupported',
      'This device cannot derive a vault key from a passkey.'
    );
  }

  config.prf = {
    credential: { credentialId: credential.credentialId },
    salt: uint8ArrayToBase64(salt),
    blob: await wrapWithPrfKey(credential.prfKey, dekRaw)
  };
  await persistence!.save(config);
  emit();
}

/** Exposed for tests and for re-wrapping flows that must recover the raw key. */
export async function recoverRawDekViaPasskey(): Promise<Uint8Array> {
  return rawDekViaPasskey();
}