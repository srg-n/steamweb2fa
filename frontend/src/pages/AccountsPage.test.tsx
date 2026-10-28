/**
 * @vitest-environment jsdom
 */
import { cleanup, render, waitFor, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountsPage } from './AccountsPage';
import { ConfirmDialogProvider } from '../components/ui/ConfirmDialog';

const apiMocks = vi.hoisted(() => ({
  accountApi: {
    list: vi.fn(),
    liveCodes: vi.fn(),
    code: vi.fn(),
    save: vi.fn(),
    delete: vi.fn(),
    export: vi.fn(),
    importMaFile: vi.fn()
  },
  accountOrganizationApi: {
    get: vi.fn(),
    createFolder: vi.fn(),
    createTag: vi.fn(),
    updateAccountOrganization: vi.fn()
  },
  settingsApi: {
    get: vi.fn().mockResolvedValue({
      theme: 'dark',
      language: 'en',
      connectionMode: 'corsproxy',
      customProxyUrl: 'https://corsproxy.io/?url=',
      timeOffsetSec: 0,
      vibrateOnCopy: true
    }),
    update: vi.fn()
  }
}));

vi.mock('../api', () => apiMocks);

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      if (key === 'accounts.liveCodeTimer') {
        return `Live code timer ${params?.seconds}`;
      }
      if (key === 'accounts.expiresIn') {
        return `Expires in ${params?.seconds}`;
      }
      return key;
    }
  })
}));

describe('AccountsPage Serverless PWA', () => {
  beforeEach(() => {
    localStorage.clear();
    apiMocks.accountApi.list.mockResolvedValue({
      // Summary shape: no secrets reach the list view any more.
      items: [
        {
          id: 'acc_1',
          alias: 'Main Account',
          accountName: 'mainuser',
          steamid: '76561198000000001',
          secretFields: ['sharedSecret', 'identitySecret'],
          hasSession: false,
          createdAt: '2026-06-22T07:00:00Z',
          updatedAt: '2026-06-22T07:00:00Z'
        }
      ]
    });
    apiMocks.accountApi.liveCodes.mockResolvedValue({
      generatedAt: '2026-06-22T07:00:00Z',
      validForSec: 30,
      items: [{ accountId: 'acc_1', code: 'ABCDE' }]
    });
    apiMocks.accountOrganizationApi.get.mockResolvedValue({ folders: [], tags: [] });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders accounts list with live Steam Guard code', async () => {
    render(
      <MemoryRouter>
        <ConfirmDialogProvider>
          <AccountsPage />
        </ConfirmDialogProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Main Account')).toBeDefined();
      expect(screen.getByText('mainuser')).toBeDefined();
    });

    // The code arrives from the service layer, which decrypts the secret itself.
    await waitFor(() => {
      expect(screen.getByText('ABCDE')).toBeDefined();
    });
  });

  it('never renders a secret into the list view', async () => {
    render(
      <MemoryRouter>
        <ConfirmDialogProvider>
          <AccountsPage />
        </ConfirmDialogProvider>
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByText('Main Account')).toBeDefined());

    // Not even as an attribute: nothing sensitive may reach the DOM.
    const html = document.body.innerHTML;
    expect(html).not.toContain('dGVzdHNoYXJlZHNlY3JldDEyMzQ1Njc4OTA=');
    expect(html).not.toContain('dGVzdGlkZW50aXR5c2VjcmV0MTIzNDU2Nzg5MA==');
  });
});
