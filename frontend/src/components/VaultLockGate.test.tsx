/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { VaultLockGate } from './VaultLockGate';

const vaultMock = vi.hoisted(() => ({
  status: 'locked' as 'locked' | 'unlocked' | 'disabled',
  loaded: true,
  passkey: false,
  passphrase: true,
  listeners: new Set<(status: string) => void>(),
  unlockPassphrase: vi.fn(async () => undefined),
  unlockPasskey: vi.fn(async () => undefined)
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en', resolvedLanguage: 'en' }
  })
}));

vi.mock('../services/vault', () => ({
  attachAutoLock: () => () => undefined,
  getVaultConfig: () => ({ prf: null, passphrase: {} }),
  getVaultStatus: () => vaultMock.status,
  hasPasskey: () => vaultMock.passkey,
  hasPassphrase: () => vaultMock.passphrase,
  isVaultConfigLoaded: () => vaultMock.loaded,
  onVaultChange: (listener: (status: string) => void) => {
    vaultMock.listeners.add(listener);
    return () => vaultMock.listeners.delete(listener);
  },
  unlockWithPasskey: vaultMock.unlockPasskey,
  unlockWithPassphrase: vaultMock.unlockPassphrase
}));

describe('VaultLockGate', () => {
  beforeEach(() => {
    vaultMock.status = 'locked';
    vaultMock.loaded = true;
    vaultMock.passkey = false;
    vaultMock.passphrase = true;
    vaultMock.listeners.clear();
    vaultMock.unlockPassphrase.mockReset();
    vaultMock.unlockPassphrase.mockResolvedValue(undefined);
  });

  afterEach(cleanup);

  it('blocks the app while the vault is locked', () => {
    render(
      <VaultLockGate>
        <div>secret app content</div>
      </VaultLockGate>
    );

    expect(screen.queryByText('secret app content')).toBeNull();
    expect(screen.getByText('vault.lockedTitle')).toBeTruthy();
  });

  it('waits for the vault config before rendering the app', () => {
    vaultMock.loaded = false;
    render(
      <VaultLockGate>
        <div>secret app content</div>
      </VaultLockGate>
    );

    expect(screen.queryByText('secret app content')).toBeNull();
    expect(screen.queryByText('vault.lockedTitle')).toBeNull();
  });

  it('shows the failure reason when the passphrase is wrong', async () => {
    vaultMock.unlockPassphrase.mockRejectedValue(new Error('The vault could not be opened.'));

    render(
      <VaultLockGate>
        <div>secret app content</div>
      </VaultLockGate>
    );

    const input = screen.getByPlaceholderText('vault.passphrasePlaceholder') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'wrong passphrase' } });
    fireEvent.click(screen.getByText('vault.unlockWithPassphrase'));

    await waitFor(() => expect(screen.getByText('The vault could not be opened.')).toBeTruthy());
    expect(screen.queryByText('secret app content')).toBeNull();
  });

  it('renders the app once the vault reports itself open', async () => {
    render(
      <VaultLockGate>
        <div>secret app content</div>
      </VaultLockGate>
    );

    vaultMock.listeners.forEach((listener) => listener('unlocked'));

    await waitFor(() => expect(screen.getByText('secret app content')).toBeTruthy());
  });

  it('locks the app again when the vault closes', async () => {
    render(
      <VaultLockGate>
        <div>secret app content</div>
      </VaultLockGate>
    );

    vaultMock.listeners.forEach((listener) => listener('unlocked'));
    await waitFor(() => expect(screen.getByText('secret app content')).toBeTruthy());

    vaultMock.listeners.forEach((listener) => listener('locked'));
    await waitFor(() => expect(screen.queryByText('secret app content')).toBeNull());
  });
});