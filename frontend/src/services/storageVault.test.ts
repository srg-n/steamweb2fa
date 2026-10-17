/**
 * @vitest-environment jsdom
 */
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';

const PASSPHRASE = 'correct horse battery';

type StorageModule = typeof import('./storage');
type VaultModule = typeof import('./vault');

const account = {
  id: 'acc_1',
  alias: 'Test',
  accountName: 'tester',
  steamid: '76561198000000001',
  sharedSecret: 'c2hhYXJlc2VjcmV0',
  identitySecret: 'aWRlbnRpdHlzZWNyZXQ=',
  revocationCode: 'R12345',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
};

/** Reloads storage + vault against a fresh database for every test. */
async function boot() {
  vi.resetModules();
  // A new factory per test keeps runs independent.
  (globalThis as any).indexedDB = new IDBFactory();
  const vault = (await import('./vault')) as VaultModule;
  const storage = (await import('./storage')) as StorageModule;
  await vault.loadVaultConfig();
  return { db: storage.db, vault, storage };
}

describe('storage: encrypted records', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps secrets in plain text while the vault is disabled', async () => {
    const { db, storage } = await boot();
    await db.saveAccount(account);

    const rows = await storage.db.getAccounts();
    // The UI never receives secrets, vault or not.
    expect(rows[0].secretFields).toContain('sharedSecret');
    expect((rows[0] as any).sharedSecret).toBeUndefined();

    const full = await db.getAccountWithSecrets(account.id);
    expect(full?.sharedSecret).toBe(account.sharedSecret);
  });

  it('encrypts every secret field once the vault is enabled', async () => {
    const { db, vault, storage } = await boot();
    await db.saveAccount(account);
    await vault.enableVault({ usePasskey: false, usePassphrase: true, passphrase: PASSPHRASE });
    // The app performs this step explicitly after enabling the vault.
    await db.migrateToVault();

    const raw = await readRawRecord(storage, account.id);
    expect(raw.v).toBe(2);
    expect(raw.sharedSecret).toBeUndefined();
    expect(raw.identitySecret).toBeUndefined();
    expect(raw.revocationCode).toBeUndefined();
    expect(Object.keys(raw.secrets).sort()).toEqual(['identitySecret', 'revocationCode', 'sharedSecret']);
    // The ciphertext must not contain the secret anywhere.
    expect(JSON.stringify(raw.secrets)).not.toContain(account.sharedSecret);

    const restored = await db.getAccountWithSecrets(account.id);
    expect(restored?.sharedSecret).toBe(account.sharedSecret);
    expect(restored?.revocationCode).toBe('R12345');
  });

  it('encrypts session tokens as well', async () => {
    const { db, vault, storage } = await boot();
    await db.saveAccount({
      ...account,
      session: { steamLoginSecure: 'cookie', oauthToken: 'jwt', refreshToken: 'refresh' }
    });
    await vault.enableVault({ usePasskey: false, usePassphrase: true, passphrase: PASSPHRASE });
    await db.migrateToVault();

    const raw = await readRawRecord(storage, account.id);
    expect(raw.session).toBeUndefined();
    expect(Object.keys(raw.secrets)).toContain('session.oauthToken');

    const restored = await db.getAccountWithSecrets(account.id);
    expect(restored?.session).toEqual({
      steamLoginSecure: 'cookie',
      oauthToken: 'jwt',
      refreshToken: 'refresh'
    });
  });

  it('refuses to hand out secrets while the vault is locked', async () => {
    const { db, vault } = await boot();
    await vault.enableVault({ usePasskey: false, usePassphrase: true, passphrase: PASSPHRASE });
    await db.saveAccount(account);
    vault.lockVault();

    // Metadata is fine to read: it holds no secret.
    const summaries = await db.getAccounts();
    expect(summaries).toHaveLength(1);
    expect((summaries[0] as any).sharedSecret).toBeUndefined();

    // Anything that reveals a secret must fail loudly instead of returning
    // empty results, so the UI cannot show "no accounts" instead of "locked".
    await expect(db.getAccountWithSecrets(account.id)).rejects.toThrow(vault.VaultLockedError);
    await expect(db.getSecret(account.id, 'sharedSecret')).rejects.toThrow(vault.VaultLockedError);
    await expect(db.getLiveCodes(0)).rejects.toThrow(vault.VaultLockedError);

    // Writing is refused too, so nothing is silently stored as plain text.
    await expect(db.saveAccount(account)).rejects.toThrow(vault.VaultLockedError);
  });

  it('re-encrypts existing plain-text records when the vault is enabled', async () => {
    const { db, vault, storage } = await boot();
    await db.saveAccount(account);
    await db.saveSettings({ corsProxyUrl: 'https://proxy.dev', corsProxySecret: 'proxy-secret' });

    await vault.enableVault({ usePasskey: false, usePassphrase: true, passphrase: PASSPHRASE });
    await db.migrateToVault();

    const raw = await readRawRecord(storage, account.id);
    expect(raw.sharedSecret).toBeUndefined();
    expect(raw.v).toBe(2);

    const settingsRaw = await readRawRecord(storage, 'app_settings');
    expect(settingsRaw.value.corsProxySecret).toBeUndefined();
    expect(settingsRaw.secrets.corsProxySecret).toBeTruthy();

    const restored = await db.getAccountWithSecrets(account.id);
    expect(restored?.sharedSecret).toBe(account.sharedSecret);
    expect((await db.getSettings()).corsProxySecret).toBe('proxy-secret');
  });

  it('migrating twice does not double-encrypt', async () => {
    const { db, vault, storage } = await boot();
    await db.saveAccount(account);
    await vault.enableVault({ usePasskey: false, usePassphrase: true, passphrase: PASSPHRASE });

    await db.migrateToVault();
    const first = await readRawRecord(storage, account.id);
    await db.migrateToVault();
    const second = await readRawRecord(storage, account.id);

    expect(second.secrets).toEqual(first.secrets);
    const restored = await db.getAccountWithSecrets(account.id);
    expect(restored?.sharedSecret).toBe(account.sharedSecret);
  });

  it('writes records back in plain text when the vault is turned off', async () => {
    const { db, vault, storage } = await boot();
    await vault.enableVault({ usePasskey: false, usePassphrase: true, passphrase: PASSPHRASE });
    await db.saveAccount(account);

    const encrypted = await readRawRecord(storage, account.id);
    expect(encrypted.sharedSecret).toBeUndefined();

    await db.migrateToPlaintext();
    await vault.disableVault();

    const plaintext = await readRawRecord(storage, account.id);
    expect(plaintext.sharedSecret).toBe(account.sharedSecret);
    expect(plaintext.v).toBeUndefined();
    expect(plaintext.secrets).toBeUndefined();

    const restored = await db.getAccountWithSecrets(account.id);
    expect(restored?.sharedSecret).toBe(account.sharedSecret);
  });

  it('returns secrets on demand instead of with the list', async () => {
    const { db, vault } = await boot();
    await vault.enableVault({ usePasskey: false, usePassphrase: true, passphrase: PASSPHRASE });
    await db.saveAccount(account);

    const [summary] = await db.getAccounts();
    // Nothing sensitive in the list payload.
    expect((summary as any).sharedSecret).toBeUndefined();
    expect((summary as any).identitySecret).toBeUndefined();
    expect(summary.secretFields).toEqual(
      expect.arrayContaining(['sharedSecret', 'identitySecret', 'revocationCode'])
    );

    // Explicit, field-scoped read.
    await expect(db.getSecret(account.id, 'revocationCode')).resolves.toBe('R12345');
  });

  it('produces codes without ever exposing the secret', async () => {
    const { db, vault } = await boot();
    await vault.enableVault({ usePasskey: false, usePassphrase: true, passphrase: PASSPHRASE });
    await db.saveAccount(account);

    const codes = await db.getLiveCodes(0);
    expect(codes).toHaveLength(1);
    expect(codes[0].accountId).toBe(account.id);
    expect(codes[0].code).toMatch(/^\w{5}$/);
    expect(JSON.stringify(codes)).not.toContain(account.sharedSecret);
  });

  it('keeps the export backup usable while the vault is open', async () => {
    const { db, vault } = await boot();
    await vault.enableVault({ usePasskey: false, usePassphrase: true, passphrase: PASSPHRASE });
    await db.saveAccount(account);

    const backup = JSON.parse(await db.exportFullBackup());
    expect(backup.accounts[0].sharedSecret).toBe(account.sharedSecret);
    expect(backup.accounts[0].secrets).toBeUndefined();

    // Importing into a clean database restores a working account.
    (globalThis as any).indexedDB = new IDBFactory();
    const fresh = (await import('./storage')).db;
    await fresh.importFullBackup(JSON.stringify(backup));
    const imported = await fresh.getAccountWithSecrets(backup.accounts[0].id);
    expect(imported?.sharedSecret).toBe(account.sharedSecret);
  });

  it('keeps the proxy secret out of localStorage with the vault enabled', async () => {
    const { db, vault } = await boot();
    await vault.enableVault({ usePasskey: false, usePassphrase: true, passphrase: PASSPHRASE });
    await db.saveSettings({ corsProxyUrl: 'https://proxy.dev', corsProxySecret: 'proxy-secret' });

    expect(localStorage.getItem('sw_settings') || '').not.toContain('proxy-secret');
    expect((await db.getSettings()).corsProxySecret).toBe('proxy-secret');
  });

  it('wipes the vault metadata when the vault is disabled', async () => {
    const { db, vault, storage } = await boot();
    await vault.enableVault({ usePasskey: false, usePassphrase: true, passphrase: PASSPHRASE });
    await db.migrateToPlaintext();
    await vault.disableVault();

    expect(await readRawRecord(storage, 'vault_config')).toBeUndefined();
    expect(vault.getVaultStatus()).toBe('disabled');
  });
});

/** Reads a record straight from IndexedDB, bypassing the storage layer. */
async function readRawRecord(storage: StorageModule, key: string): Promise<any> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('SteamWebAuthDB');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  const store = key === 'app_settings' || key === 'vault_config' ? 'settings' : 'accounts';
  return new Promise((resolve, reject) => {
    const request = db.transaction(store, 'readonly').objectStore(store).get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}