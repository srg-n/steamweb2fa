import { beforeEach, describe, expect, it, vi } from 'vitest';

// The PRF path needs a real authenticator, so it is mocked. Everything else
// (PBKDF2, AES-GCM, the state machine) runs for real.
const prfMock = vi.hoisted(() => ({
  secret: new Uint8Array(32).fill(7),
  enrolled: false,
  /** Whether the authenticator hands out a vault key while creating. */
  canDerive: true
}));

vi.mock('./prfVault', () => ({
  isPrfSupported: () => true,
  detectPrfSupport: async () => ({
    webauthn: true,
    platformAuthenticator: true,
    browserPrf: true,
    usable: prfMock.canDerive
  }),
  enrollPrfCredential: vi.fn(async () => {
    prfMock.enrolled = true;
    return prfMock.canDerive
      ? { credentialId: 'cred_1', prfKey: prfMock.secret }
      : { credentialId: 'cred_1' };
  }),
  derivePrfKey: vi.fn(async () => prfMock.secret)
}));

type VaultModule = typeof import('./vault');

/** In-memory stand-in for the IndexedDB settings record. */
function createFakePersistence() {
  const store: { value: any } = { value: null };
  return {
    store,
    handlers: {
      load: async () => store.value,
      save: async (config: any) => {
        store.value = JSON.parse(JSON.stringify(config));
      },
      clear: async () => {
        store.value = null;
      }
    }
  };
}

async function loadVault(persistence = createFakePersistence()) {
  vi.resetModules();
  const vault = (await import('./vault')) as VaultModule;
  vault.configureVaultPersistence(persistence.handlers);
  return { vault, persistence };
}

const PASSPHRASE = 'correct horse battery';

describe('vault state machine', () => {
  beforeEach(() => {
    prfMock.enrolled = false;
    prfMock.canDerive = true;
  });

  it('starts disabled and reports no unlock method', async () => {
    const { vault } = await loadVault();
    await vault.loadVaultConfig();

    expect(vault.getVaultStatus()).toBe('disabled');
    expect(vault.hasPasskey()).toBe(false);
    expect(vault.hasPassphrase()).toBe(false);
    expect(() => vault.requireVaultKey()).toThrow(vault.VaultLockedError);
  });

  it('enables with a passkey and a passphrase, then opens immediately', async () => {
    const { vault } = await loadVault();
    await vault.loadVaultConfig();

    const config = await vault.enableVault({
      usePasskey: true,
      usePassphrase: true,
      passphrase: PASSPHRASE
    });

    expect(prfMock.enrolled).toBe(true);
    expect(config.enabled).toBe(true);
    expect(vault.getVaultStatus()).toBe('unlocked');
    expect(vault.hasPasskey()).toBe(true);
    expect(vault.hasPassphrase()).toBe(true);
  });

  it('refuses to enable without any unlock method', async () => {
    const { vault } = await loadVault();
    await vault.loadVaultConfig();

    await expect(
      vault.enableVault({ usePasskey: false, usePassphrase: false })
    ).rejects.toThrow();
  });

  it('refuses a too-short recovery passphrase', async () => {
    const { vault } = await loadVault();
    await vault.loadVaultConfig();

    await expect(
      vault.enableVault({ usePasskey: false, usePassphrase: true, passphrase: 'short' })
    ).rejects.toThrow();
  });

  it('requires the vault to be open before adding a passphrase', async () => {
    const { vault } = await loadVault();
    await vault.loadVaultConfig();
    await vault.enableVault({ usePasskey: true, usePassphrase: false });

    vault.lockVault();
    expect(vault.getVaultStatus()).toBe('locked');

    await expect(vault.addPassphrase(PASSPHRASE)).rejects.toThrow(vault.VaultLockedError);
  });

  it('unlocks with the passphrase after locking, and rejects a wrong one', async () => {
    const { vault } = await loadVault();
    await vault.loadVaultConfig();
    await vault.enableVault({ usePasskey: false, usePassphrase: true, passphrase: PASSPHRASE });
    vault.lockVault();

    expect(vault.getVaultStatus()).toBe('locked');
    await expect(vault.unlockWithPassphrase('not the passphrase')).rejects.toThrow();

    await vault.unlockWithPassphrase(PASSPHRASE);
    expect(vault.getVaultStatus()).toBe('unlocked');
  });

  it('unlocks with the passkey after locking', async () => {
    const { vault } = await loadVault();
    await vault.loadVaultConfig();
    await vault.enableVault({ usePasskey: true, usePassphrase: true, passphrase: PASSPHRASE });
    vault.lockVault();

    await vault.unlockWithPasskey();
    expect(vault.getVaultStatus()).toBe('unlocked');
  });

  it('survives a reload: the wrapped DEK is enough to open it again', async () => {
    const persistence = createFakePersistence();
    const { vault: first } = await loadVault(persistence);
    await first.loadVaultConfig();
    await first.enableVault({
      usePasskey: false,
      usePassphrase: true,
      passphrase: PASSPHRASE
    });

    // A fresh module instance reading the same persisted config.
    const { vault: second } = await loadVault(persistence);
    await second.loadVaultConfig();
    expect(second.getVaultStatus()).toBe('locked');

    await second.unlockWithPassphrase(PASSPHRASE);
    expect(second.getVaultStatus()).toBe('unlocked');
  });

  it('rotates the recovery passphrase and locks out the old one', async () => {
    const { vault } = await loadVault();
    await vault.loadVaultConfig();
    await vault.enableVault({
      usePasskey: false,
      usePassphrase: true,
      passphrase: PASSPHRASE
    });

    await vault.changePassphrase(PASSPHRASE, 'a brand new passphrase');
    vault.lockVault();

    await expect(vault.unlockWithPassphrase(PASSPHRASE)).rejects.toThrow();
    await vault.unlockWithPassphrase('a brand new passphrase');
    expect(vault.getVaultStatus()).toBe('unlocked');
  });

  it('refuses to rotate without proving the current passphrase', async () => {
    const { vault } = await loadVault();
    await vault.loadVaultConfig();
    await vault.enableVault({
      usePasskey: false,
      usePassphrase: true,
      passphrase: PASSPHRASE
    });

    await expect(
      vault.changePassphrase('wrong current passphrase', 'another passphrase')
    ).rejects.toThrow();
  });

  it('will not drop the last unlock method', async () => {
    const { vault } = await loadVault();
    await vault.loadVaultConfig();
    await vault.enableVault({
      usePasskey: false,
      usePassphrase: true,
      passphrase: PASSPHRASE
    });

    await expect(vault.removePassphrase(PASSPHRASE)).rejects.toThrow();
    expect(vault.hasPassphrase()).toBe(true);
  });

  it('drops the passphrase once a passkey exists', async () => {
    const { vault } = await loadVault();
    await vault.loadVaultConfig();
    await vault.enableVault({
      usePasskey: true,
      usePassphrase: true,
      passphrase: PASSPHRASE
    });

    await vault.removePassphrase(PASSPHRASE);
    expect(vault.hasPassphrase()).toBe(false);
    expect(vault.hasPasskey()).toBe(true);

    // Still reachable with the passkey alone.
    vault.lockVault();
    await vault.unlockWithPasskey();
    expect(vault.getVaultStatus()).toBe('unlocked');
  });

  it('notifies subscribers on every transition', async () => {
    const { vault } = await loadVault();
    await vault.loadVaultConfig();

    const seen: string[] = [];
    const unsubscribe = vault.onVaultChange((status) => seen.push(status));

    await vault.enableVault({ usePasskey: false, usePassphrase: true, passphrase: PASSPHRASE });
    vault.lockVault();
    vault.touchVault();

    expect(seen).toEqual(['unlocked', 'locked']);
    unsubscribe();
  });

  it('disabling forgets the vault entirely', async () => {
    const { vault } = await loadVault();
    await vault.loadVaultConfig();
    await vault.enableVault({
      usePasskey: true,
      usePassphrase: true,
      passphrase: PASSPHRASE
    });

    await vault.disableVault();

    expect(vault.getVaultStatus()).toBe('disabled');
    expect(vault.getVaultConfig()).toBeNull();
    expect(() => vault.requireVaultKey()).toThrow(vault.VaultLockedError);
  });

  it('asks the device only once when enabling the passkey', async () => {
    // One Windows/Touch prompt, not two: the vault key is requested while the
    // passkey is created.
    const { vault } = await loadVault();
    await vault.loadVaultConfig();

    const { derivePrfKey } = (await import('./prfVault')) as unknown as {
      derivePrfKey: { mockClear: () => void; mock: { calls: unknown[][] } };
    };
    derivePrfKey.mockClear();

    await vault.enableVault({ usePasskey: true, usePassphrase: true, passphrase: PASSPHRASE });

    expect(vault.hasPasskey()).toBe(true);
    expect(derivePrfKey.mock.calls).toHaveLength(0);
  });

  it('falls back to the passphrase when the device derives no key', async () => {
    prfMock.canDerive = false;

    const { vault } = await loadVault();
    await vault.loadVaultConfig();
    await vault.enableVault({ usePasskey: true, usePassphrase: true, passphrase: PASSPHRASE });

    expect(prfMock.enrolled).toBe(true);
    expect(vault.hasPasskey()).toBe(false);
    expect(vault.hasPassphrase()).toBe(true);

    // No second prompt is triggered while falling back.
    const { derivePrfKey } = (await import('./prfVault')) as unknown as {
      derivePrfKey: { mock: { calls: unknown[][] } };
    };
    expect(derivePrfKey.mock.calls).toHaveLength(0);

    vault.lockVault();
    await vault.unlockWithPassphrase(PASSPHRASE);
    expect(vault.getVaultStatus()).toBe('unlocked');
  });

  it('reports the problem when a passkey was the only option', async () => {
    prfMock.canDerive = false;

    const { vault } = await loadVault();
    await vault.loadVaultConfig();

    await expect(
      vault.enableVault({ usePasskey: true, usePassphrase: false })
    ).rejects.toThrow();
    expect(vault.getVaultStatus()).toBe('disabled');
  });

  it('clamps the auto-lock window', async () => {
    const { vault } = await loadVault();
    await vault.loadVaultConfig();
    await vault.enableVault({ usePasskey: false, usePassphrase: true, passphrase: PASSPHRASE });

    await vault.setAutoLock(5);
    expect(vault.getVaultConfig()?.autoLockSec).toBe(30);

    await vault.setAutoLock(900);
    expect(vault.getVaultConfig()?.autoLockSec).toBe(900);
  });
});