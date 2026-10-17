/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const STORAGE_UNAVAILABLE_EVENT = 'steamguard:storage-unavailable';

// jsdom does not implement IndexedDB, which is exactly the failure mode the
// vault must survive: secrets are dropped, never downgraded to localStorage.
const account = {
  id: 'acc_1',
  alias: 'Test',
  accountName: 'tester',
  steamid: '76561198000000001',
  sharedSecret: 'c2hhYXJlc2VjcmV0',
  identitySecret: 'aWRlbnRpdHlzZWNyZXQ=',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
};

type StorageModule = typeof import('./storage');

async function loadStorage(): Promise<StorageModule> {
  return import('./storage');
}

describe('storage: secrets never fall back to localStorage', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  // Registered before the module is imported: reading the vault config at
  // startup is itself the first thing that can report an unusable database.
  it('reports the missing vault through an event', async () => {
    const listener = vi.fn();
    window.addEventListener(STORAGE_UNAVAILABLE_EVENT, listener);

    const { db } = await loadStorage();
    await expect(db.getAccounts()).resolves.toEqual([]);

    expect(listener).toHaveBeenCalled();
    window.removeEventListener(STORAGE_UNAVAILABLE_EVENT, listener);
  });

  it('fails loudly instead of mirroring accounts in plain text', async () => {
    const { db, StorageUnavailableError } = await loadStorage();

    await expect(db.saveAccount(account)).rejects.toBeInstanceOf(StorageUnavailableError);
    expect(localStorage.getItem('sw_accounts')).toBeNull();
  });

  it('keeps the proxy secret out of the settings mirror', async () => {
    const { db } = await loadStorage();

    await db.saveSettings({
      corsProxyUrl: 'https://proxy.example.dev',
      corsProxySecret: 'super-secret'
    });

    const mirror = localStorage.getItem('sw_settings');
    expect(mirror).not.toBeNull();
    expect(mirror).not.toContain('super-secret');

    // The returned settings still carry it in memory for the current session.
    const current = await db.getSettings();
    expect(current.corsProxyUrl).toBe('https://proxy.example.dev');
  });
});