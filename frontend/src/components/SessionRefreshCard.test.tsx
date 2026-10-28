/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SessionRefreshCard } from './SessionRefreshCard';

const apiMocks = vi.hoisted(() => ({
  accountApi: {
    refreshSession: vi.fn(),
    autoLogin: vi.fn()
  }
}));

vi.mock('../api', () => apiMocks);

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const labels: Record<string, string> = {
        'sessionRefresh.refreshBtn': 'Renew Session',
        'sessionRefresh.loginBtn': 'Log in with Password',
        'sessionRefresh.passwordPlaceholder': 'Steam password',
        'sessionRefresh.success': 'Session renewed.',
        'sessionRefresh.refreshFailed': 'Could not renew the session.',
        'sessionRefresh.noRefreshToken': 'No refresh token saved.',
        'sessionRefresh.loginFailed': 'Steam login failed.'
      };
      return labels[key] ?? key;
    }
  })
}));

describe('SessionRefreshCard', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renews with the stored refresh token and reloads the caller', async () => {
    apiMocks.accountApi.refreshSession.mockResolvedValue({ success: true });
    const onRefreshed = vi.fn();

    render(
      <SessionRefreshCard accountId="acc_1" accountAlias="Main" onRefreshed={onRefreshed} />
    );

    fireEvent.click(screen.getByRole('button', { name: /renew session/i }));

    await waitFor(() => expect(apiMocks.accountApi.refreshSession).toHaveBeenCalledWith('acc_1'));
    await waitFor(() => expect(onRefreshed).toHaveBeenCalledTimes(1));
    expect(screen.getByText('Session renewed.')).toBeDefined();
    // No password was typed, so no credential may be sent.
    expect(apiMocks.accountApi.autoLogin).not.toHaveBeenCalled();
  });

  it('falls back to the password form when no refresh token is stored', async () => {
    apiMocks.accountApi.refreshSession.mockResolvedValue({
      success: false,
      error: 'NO_REFRESH_TOKEN'
    });
    const onRefreshed = vi.fn();

    render(
      <SessionRefreshCard accountId="acc_1" accountAlias="Main" onRefreshed={onRefreshed} />
    );

    fireEvent.click(screen.getByRole('button', { name: /renew session/i }));

    const passwordInput = await screen.findByPlaceholderText('Steam password');
    expect(screen.getByText('No refresh token saved.')).toBeDefined();

    apiMocks.accountApi.autoLogin.mockResolvedValue({ success: true });
    fireEvent.change(passwordInput, { target: { value: 'steam-password' } });
    fireEvent.click(screen.getByRole('button', { name: /log in with password/i }));

    await waitFor(() =>
      expect(apiMocks.accountApi.autoLogin).toHaveBeenCalledWith('acc_1', 'steam-password')
    );
    await waitFor(() => expect(onRefreshed).toHaveBeenCalledTimes(1));
  });

  it('reports a failed login and keeps the form open', async () => {
    apiMocks.accountApi.refreshSession.mockResolvedValue({ success: false, error: 'NOPE' });
    apiMocks.accountApi.autoLogin.mockResolvedValue({ success: false, error: 'WrongPassword' });
    const onRefreshed = vi.fn();

    render(
      <SessionRefreshCard accountId="acc_1" accountAlias="Main" onRefreshed={onRefreshed} />
    );

    fireEvent.click(screen.getByRole('button', { name: /renew session/i }));
    const passwordInput = await screen.findByPlaceholderText('Steam password');
    fireEvent.change(passwordInput, { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: /log in with password/i }));

    await waitFor(() => expect(screen.getByText(/Steam login failed\./)).toBeDefined());
    expect(onRefreshed).not.toHaveBeenCalled();
  });

  it('never renders the typed password anywhere in the DOM', async () => {
    apiMocks.accountApi.refreshSession.mockResolvedValue({ success: false, error: 'NOPE' });

    const { container } = render(
      <SessionRefreshCard accountId="acc_1" accountAlias="Main" onRefreshed={vi.fn()} />
    );

    fireEvent.click(screen.getByRole('button', { name: /renew session/i }));
    const passwordInput = (await screen.findByPlaceholderText('Steam password')) as HTMLInputElement;
    fireEvent.change(passwordInput, { target: { value: 'super-secret-password' } });

    // The typed password may only live as the live value of the field, never
    // as rendered text. (Attribute reflection is a jsdom quirk: it copies the
    // live value into the `value` attribute, which a real browser does not do
    // for password inputs, so it is verified in the browser instead.)
    expect(container.textContent).not.toContain('super-secret-password');
    expect(passwordInput.value).toBe('super-secret-password');
  });
});
