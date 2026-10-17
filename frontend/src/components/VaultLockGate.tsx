/**
 * Lock screen for the encrypted vault.
 *
 * Rendered instead of the app while the vault is shut. Nothing in the app
 * reads a secret in this state: `db.getAccounts()` throws `VaultLockedError`
 * rather than returning empty results.
 */

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Lock, ShieldCheck, KeyRound, Loader2, AlertTriangle } from 'lucide-react';
import { Button } from './ui/Button';
import { SecretInput } from './ui/SecretInput';
import {
  attachAutoLock,
  getVaultConfig,
  getVaultStatus,
  hasPasskey,
  hasPassphrase,
  isVaultConfigLoaded,
  onVaultChange,
  unlockWithPasskey,
  unlockWithPassphrase,
  type VaultStatus
} from '../services/vault';
import { describeVaultError } from '../services/vaultErrors';

export function VaultLockGate({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const [vault, setVault] = useState<{ loaded: boolean; status: VaultStatus }>(() => ({
    loaded: isVaultConfigLoaded(),
    status: getVaultStatus()
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The passphrase lives in the input element only. A controlled field would
  // copy it into the `value` attribute, i.e. into the page markup.
  const passphraseRef = useRef<HTMLInputElement>(null);

  // Until the config is known we treat the vault as locked, otherwise a record
  // written by the vault could be read as plain text during startup.
  const locked = !vault.loaded || vault.status === 'locked';
  const config = getVaultConfig();
  const passkeyAvailable = hasPasskey();
  const passphraseAvailable = hasPassphrase();

  useEffect(() => onVaultChange((status) => setVault({ loaded: true, status })), []);

  // Keeps the inactivity timer running only while the vault is open.
  useEffect(() => (locked ? undefined : attachAutoLock()), [locked]);

  useEffect(() => {
    if (!locked) setError(null);
  }, [locked]);

  const withBusy = async (run: () => unknown) => {
    setBusy(true);
    setError(null);
    try {
      await run();
      // Whether it succeeded or not, the typed passphrase has served its
      // purpose; keeping it around only widens the window for a leak.
      if (passphraseRef.current) passphraseRef.current.value = '';
    } catch (err) {
      // WebCrypto and some browsers reject with an empty message; describeVaultError
      // turns known failures into a translated sentence and never returns blank.
      setError(describeVaultError(err, (key) => t(key), t('vault.unlockFailed')));
    } finally {
      setBusy(false);
    }
  };

  const unlockWithTypedPassphrase = () => {
    const typed = passphraseRef.current?.value ?? '';
    if (!typed) return undefined;
    return withBusy(async () => {
      await unlockWithPassphrase(typed);
    });
  };

  if (!locked) return <>{children}</>;

  if (!vault.loaded) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-base-50 dark:bg-black">
        <Loader2 size={28} className="animate-spin text-accent-500" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-base-50 p-6 dark:bg-black">
      <div className="w-full max-w-sm rounded-2xl border border-base-200 bg-white/90 p-6 shadow-2xl backdrop-blur dark:border-white/10 dark:bg-[#0a0a0f]">
        <div className="mb-5 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent-500 text-black">
            <Lock size={20} className="text-black" />
          </div>
          <div>
            <h1 className="text-base font-extrabold tracking-tight dark:text-white">
              {t('vault.lockedTitle')}
            </h1>
            <p className="text-[11px] text-base-500">{t('vault.lockedSubtitle')}</p>
          </div>
        </div>

        <div className="space-y-4">
          {passkeyAvailable && (
            <Button
              variant="primary"
              className="w-full gap-2"
              disabled={busy}
              onClick={() => withBusy(unlockWithPasskey)}
            >
              {busy ? <Loader2 size={16} className="animate-spin" /> : <ShieldCheck size={16} />}
              {t('vault.unlockWithPasskey')}
            </Button>
          )}

          {passphraseAvailable && (
            <div className="space-y-2">
              <SecretInput
                ref={passphraseRef}
                autoComplete="current-password"
                placeholder={t('vault.passphrasePlaceholder')}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void unlockWithTypedPassphrase();
                }}
              />
              <Button
                variant="secondary"
                className="w-full gap-2"
                disabled={busy}
                onClick={unlockWithTypedPassphrase}
              >
                <KeyRound size={16} />
                {t('vault.unlockWithPassphrase')}
              </Button>
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/10 p-2.5 text-xs text-danger">
              <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {!passkeyAvailable && !passphraseAvailable && (
            <p className="text-xs text-danger">{t('vault.noUnlockMethod')}</p>
          )}

          {config?.prf && (
            <p className="text-[11px] leading-relaxed text-base-500">{t('vault.passkeyHint')}</p>
          )}
        </div>
      </div>
    </div>
  );
}