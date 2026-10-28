import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyRound, LogIn, RefreshCw, X } from 'lucide-react';
import { accountApi } from '../api';
import { Button } from './ui/Button';
import { SecretInput } from './ui/SecretInput';

/**
 * Appends the underlying error message after the generic i18n text. A bare
 * catch used to swallow the service layer's diagnosis and showed the same
 * "check your password" line for a vault error, a proxy 401 or a real Steam
 * rejection — indistinguishable for the user.
 */
function withFailureDetail(fallback: string, err: unknown): string {
  const detail = typeof err === 'string' ? err : err instanceof Error ? err.message : '';
  return detail ? `${fallback} (${detail})` : fallback;
}

/**
 * Oturum bittiğinde gösterilen "yenile" kartı.
 *
 * Steam çerezi geçerliliğini yitirince kullanıcıya hesap ayarlarına girip
 * elle çerez yapıştırmak kalıyordu. Bu kart aynı işi, kullanıcının zaten
 * bulunduğu sayfada yapar: önce kayıtlı refresh token ile sessiz yenileme,
 * token yoksa ya da yetmezse Steam parolasıyla giriş.
 *
 * Parola React state'e alınmıyor (uncontrolled input); değer yalnızca input
 * DOM düğümünde yaşıyor, böylece outerHTML dökümlerine / hata raporlarına
 * düşmüyor. Giriş başarılıysa ref.current.value elle temizlenir.
 */
export function SessionRefreshCard({
  accountId,
  accountAlias,
  onRefreshed,
  onDismiss
}: {
  accountId: string;
  accountAlias: string;
  /** Yenilemeden sonra çağrılır; dönüş değeri kullanılmaz. */
  onRefreshed: () => unknown;
  onDismiss?: () => void;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState<'token' | 'password' | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [statusType, setStatusType] = useState<'success' | 'error'>('success');
  // Refresh token yoksa ya da reddedildiyse parola yolunu aç.
  const [passwordMode, setPasswordMode] = useState(false);
  // Parola hiçbir zaman React state'e alınmıyor; değer yalnızca input DOM
  // düğümünde yaşıyor, böylece outerHTML dökümlerine düşmüyor.
  const passwordRef = useRef<HTMLInputElement>(null);

  const handleRefresh = async () => {
    setBusy('token');
    setStatus(null);
    try {
      const res = await accountApi.refreshSession(accountId);
      if (res.success) {
        setStatus(t('sessionRefresh.success'));
        setStatusType('success');
        await onRefreshed();
        return;
      }
      const base =
        res.error === 'NO_REFRESH_TOKEN'
          ? t('sessionRefresh.noRefreshToken')
          : t('sessionRefresh.refreshFailed');
      // Reveal the underlying reason: the service layer spells out what Steam
      // rejected (needauth, revoked refresh token, proxy errors...). Without it
      // every failure looks like "wrong password" to the user.
      setStatus(res.error && res.error !== 'NO_REFRESH_TOKEN' ? `${base} (${res.error})` : base);
      setStatusType('error');
      setPasswordMode(true);
    } catch (err) {
      setStatus(withFailureDetail(t('sessionRefresh.refreshFailed'), err));
      setStatusType('error');
      setPasswordMode(true);
    } finally {
      setBusy(null);
    }
  };

  const handlePasswordLogin = async () => {
    const password = passwordRef.current?.value ?? '';
    if (!password) return;
    setBusy('password');
    setStatus(null);
    try {
      const res = await accountApi.autoLogin(accountId, password);
      if (res.success) {
        if (passwordRef.current) passwordRef.current.value = '';
        setPasswordMode(false);
        setStatus(t('sessionRefresh.success'));
        setStatusType('success');
        await onRefreshed();
        return;
      }
      setStatus(withFailureDetail(t('sessionRefresh.loginFailed'), res.error));
      setStatusType('error');
    } catch (err) {
      setStatus(withFailureDetail(t('sessionRefresh.loginFailed'), err));
      setStatusType('error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-3.5 text-xs text-base-700 dark:text-base-300 space-y-3">
      <div className="flex items-start gap-2.5">
        <KeyRound size={18} className="text-amber-400 flex-shrink-0 mt-0.5" />
        <div className="space-y-0.5 flex-1 min-w-0">
          <div className="font-bold text-white">
            {t('sessionRefresh.title', { alias: accountAlias })}
          </div>
          <p className="text-base-400 text-[11px] leading-relaxed">{t('sessionRefresh.desc')}</p>
        </div>
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            className="text-base-400 hover:text-white transition-colors flex-shrink-0"
            title={t('common.close')}
            aria-label={t('common.close')}
          >
            <X size={15} />
          </button>
        )}
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
        {!passwordMode && (
          <Button
            variant="primary"
            className="h-9 px-4 text-xs font-bold gap-1.5 bg-[#00d2ff] hover:bg-[#38bdf8] text-black"
            onClick={handleRefresh}
            disabled={busy !== null}
          >
            <RefreshCw size={14} className={busy === 'token' ? 'animate-spin' : ''} />
            {busy === 'token' ? t('sessionRefresh.refreshing') : t('sessionRefresh.refreshBtn')}
          </Button>
        )}

        {passwordMode && (
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 w-full">
            <SecretInput
              ref={passwordRef}
              className="text-xs flex-1"
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handlePasswordLogin();
              }}
              placeholder={t('sessionRefresh.passwordPlaceholder')}
              autoComplete="current-password"
            />
            <Button
              variant="primary"
              className="h-9 px-4 text-xs font-bold gap-1.5 bg-[#00d2ff] hover:bg-[#38bdf8] text-black"
              onClick={handlePasswordLogin}
              disabled={busy !== null}
            >
              <LogIn size={14} className={busy === 'password' ? 'animate-spin' : ''} />
              {t('sessionRefresh.loginBtn')}
            </Button>
          </div>
        )}
      </div>

      {status && (
        <p
          className={
            statusType === 'success' ? 'text-emerald-400' : 'text-amber-300'
          }
        >
          {status}
        </p>
      )}
    </div>
  );
}
