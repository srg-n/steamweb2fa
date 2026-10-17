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

async function loadStorage(fresh = false): Promise<StorageModule> {
  // A fresh module instance re-runs the startup cleanup, which is what the
  // legacy-plaintext test needs to observe.
  if (fresh) vi.resetModules();
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

  it('deletes legacy plain-text copies even when IndexedDB is unavailable', async () => {
    // Pre-upgrade leftovers: accounts with Steam secrets plus the proxy secret.
    localStorage.setItem(
      'sw_accounts',
      JSON.stringify([{ id: 'a1', sharedSecret: 'c2hhYXJlc2VjcmV0', identitySecret: 'aWQ=' }])
    );
    localStorage.setItem(
      'sw_settings',
      JSON.stringify({ theme: 'dark', corsProxyUrl: 'https://p.dev', corsProxySecret: 'legacy-secret' })
    );

    const { db } = await loadStorage(true);

    // jsdom has no IndexedDB, so the purge must still have run on load.
    expect(localStorage.getItem('sw_accounts')).toBeNull();
    const settings = localStorage.getItem('sw_settings');
    expect(settings || '').not.toContain('legacy-secret');
    expect(settings || '').toContain('https://p.dev');

    // And the vault really is unusable here, which is the scenario the purge
    // has to survive.
    await expect(db.getAccounts()).resolves.toEqual([]);
  });
});