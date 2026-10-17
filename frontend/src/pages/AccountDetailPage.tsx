import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Download,
  Trash2,
  Check,
  Clock,
  ArrowLeft,
  RefreshCw,
  Eye,
  EyeOff,
  Save,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Sparkles,
  LogIn
} from 'lucide-react';
import { accountApi, accountOrganizationApi, steamApi, settingsApi } from '../api';
import type { StoredAccount, AccountSummary, FolderItem } from '../services/storage';
import type { ConfirmationItem } from '../services/steamClient';

import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Input } from '../components/ui/Input';
import { Badge } from '../components/ui/Badge';
import { SecretInput } from '../components/ui/SecretInput';

export function AccountDetailPage() {
  const { t } = useTranslation();
  const params = useParams<{ id: string }>();
  const navigate = useNavigate();
  const accountId = params.id as string;

  const [account, setAccount] = useState<AccountSummary | null>(null);
  const [folders, setFolders] = useState<FolderItem[]>([]);
  const [confirmations, setConfirmations] = useState<ConfirmationItem[]>([]);
  const [confirmationsBusy, setConfirmationsBusy] = useState(false);

  // Live TOTP code
  const [currentCode, setCurrentCode] = useState('-----');
  const [secondsLeft, setSecondsLeft] = useState(() => {
    const nowSec = Math.floor(Date.now() / 1000);
    return 30 - (nowSec % 30) || 30;
  });
  const [copied, setCopied] = useState(false);
  const [timeOffset, setTimeOffset] = useState(0);

  // Form states
  const [alias, setAlias] = useState('');
  const [selectedFolderId, setSelectedFolderId] = useState<string>('none');
  const [selectedTagNames, setSelectedTagNames] = useState<string[]>([]);
  const [showRevocationCode, setShowRevocationCode] = useState(false);
  const [revocationCode, setRevocationCode] = useState('');

  // Session fields are never prefilled: they stay encrypted so an injected
  // script cannot read them out of the DOM. Empty means "leave unchanged".
  const [steamLoginSecure, setSteamLoginSecure] = useState('');
  const [sessionid, setSessionid] = useState('');
  const [oauthToken, setOauthToken] = useState('');
  const [refreshToken, setRefreshToken] = useState('');

  // Automated Steam Login via Worker
  // Parola state'e alınmıyor; yalnızca input DOM düğümünde yaşıyor.
  const autoLoginPasswordRef = useRef<HTMLInputElement>(null);
  const [autoLoginBusy, setAutoLoginBusy] = useState(false);
  const [autoLoginStatus, setAutoLoginStatus] = useState<string | null>(null);
  const [refreshBusy, setRefreshBusy] = useState(false);

  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const [saveBusy, setSaveBusy] = useState(false);

  const loadData = useCallback(async () => {
    if (!accountId) return;
    const [acc, orgRes, setRes] = await Promise.all([
      accountApi.get(accountId),
      accountOrganizationApi.get(),
      settingsApi.get()
    ]);

    if (!acc) {
      navigate('/accounts');
      return;
    }

    setAccount(acc);
    setAlias(acc.alias);
    setFolders(orgRes.folders);
    setSelectedFolderId(acc.folderId || 'none');
    setSelectedTagNames(acc.tags || []);
    setTimeOffset(setRes.timeOffsetSec || 0);

    // Session values stay in the vault; only the "is it set?" hint is shown.
    setSteamLoginSecure('');
    setSessionid('');
    setOauthToken('');
    setRefreshToken('');
    setShowRevocationCode(false);
    setRevocationCode('');
  }, [accountId, navigate]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Update live code. The code is requested from the service layer, which
  // decrypts the shared secret only for the moment it is calculated.
  useEffect(() => {
    if (!account?.secretFields.includes('sharedSecret')) return;

    const updateCode = async () => {
      try {
        const res = await accountApi.code(account.id);
        setCurrentCode(res.code);
      } catch {
        setCurrentCode('-----');
      }
    };

    void updateCode();

    const interval = setInterval(() => {
      const nowSec = Math.floor(Date.now() / 1000) + timeOffset;
      const next = 30 - (nowSec % 30) || 30;
      setSecondsLeft(next);
      if (next === 30) {
        void updateCode();
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [account, timeOffset]);

  const loadConfirmations = useCallback(async () => {
    if (!accountId) return;
    setConfirmationsBusy(true);
    try {
      const items = await steamApi.confirmations(accountId);
      setConfirmations(items);
    } catch {
      // ignore
    } finally {
      setConfirmationsBusy(false);
    }
  }, [accountId]);

  useEffect(() => {
    if (account?.hasSession) {
      loadConfirmations();
    }
  }, [account, loadConfirmations]);

  const handleCopy = async () => {
    if (!currentCode || currentCode === '-----') return;
    await navigator.clipboard.writeText(currentCode);
    setCopied(true);
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      navigator.vibrate([25]);
    }
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSaveDetails = async () => {
    if (!account) return;
    setSaveBusy(true);
    setMessage(null);
    try {
      await accountApi.update(account.id, {
        alias: alias.trim() || account.accountName,
        folderId: selectedFolderId === 'none' ? null : selectedFolderId,
        tags: selectedTagNames
      });

      // Only the fields the user actually typed are sent; the untouched ones
      // stay encrypted in the vault.
      const patch: Partial<NonNullable<StoredAccount['session']>> = {};
      if (steamLoginSecure.trim()) patch.steamLoginSecure = steamLoginSecure.trim();
      if (sessionid.trim()) patch.sessionid = sessionid.trim();
      if (oauthToken.trim()) patch.oauthToken = oauthToken.trim();
      if (refreshToken.trim()) patch.refreshToken = refreshToken.trim();
      if (Object.keys(patch).length > 0) {
        await accountApi.updateSession(account.id, patch);
      }

      setMessage({ text: t('accountDetail.sessionSaved'), type: 'success' });
      await loadData();
    } catch (err: any) {
      setMessage({ text: err?.message || t('accountDetail.saveFailed'), type: 'error' });
    } finally {
      setSaveBusy(false);
    }
  };

  const handleAutoLogin = async () => {
    const password = autoLoginPasswordRef.current?.value ?? '';
    if (!account || !password) return;
    setAutoLoginBusy(true);
    setAutoLoginStatus('Steam RSA anahtarı alınıyor...');
    setMessage(null);
    try {
      // The new session is stored by the service layer; only the outcome comes
      // back here, so no cookie or token is rendered anywhere.
      const res = await accountApi.autoLogin(account.id, password, (status) =>
        setAutoLoginStatus(status)
      );

      if (res.success) {
        if (autoLoginPasswordRef.current) autoLoginPasswordRef.current.value = '';
        setAutoLoginStatus(null);
        setMessage({ text: t('accountDetail.autoLoginSuccess'), type: 'success' });
        await loadData();
        await loadConfirmations();
      } else {
        throw new Error(res.error || t('accountDetail.unknownError'));
      }
    } catch (err: any) {
      setAutoLoginStatus(null);
      setMessage({
        text: t('accountDetail.loginError', { message: err?.message || t('accountDetail.unknownError') }),
        type: 'error'
      });
    } finally {
      setAutoLoginBusy(false);
    }
  };

  const handleRefreshToken = async () => {
    if (!account) return;
    if (!account.secretFields.includes('session.refreshToken')) return;
    setRefreshBusy(true);
    setMessage(null);
    try {
      const res = await accountApi.refreshSession(account.id);
      if (res.success) {
        setMessage({
          text: t('accountDetail.refreshSuccess'),
          type: 'success'
        });
        await loadData();
        await loadConfirmations();
      } else {
        throw new Error(res.error || t('accountDetail.unknownError'));
      }
    } catch (err: any) {
      const raw = err?.message || t('accountDetail.unknownError');
      setMessage({
        text: t('accountDetail.refreshError', { message: raw }),
        type: 'error'
      });
    } finally {
      setRefreshBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!account) return;
    if (!window.confirm(`${t('accounts.deleteConfirm')}\n\n${account.alias}`)) return;
    await accountApi.delete(account.id);
    navigate('/accounts');
  };

  const handleExport = async () => {
    if (!account) return;
    await accountApi.export(account.id);
  };

  const handleRespond = async (item: ConfirmationItem, accept: boolean) => {
    try {
      await steamApi.respond(accountId, item.id, item.nonce, accept);
      setConfirmations((prev) => prev.filter((c) => c.id !== item.id));
    } catch (err: any) {
      alert(err?.message || t('confirmations.respondFailed'));
    }
  };

  if (!account) {
    return <div className="p-6 text-center text-sm text-base-500">{t('common.loading')}</div>;
  }

  const isExpiringSoon = secondsLeft <= 5;
  const progressPercent = ((30 - secondsLeft) / 30) * 100;

  return (
    <div className="space-y-4 max-w-4xl mx-auto">
      {/* Top Navigation */}
      <div className="flex items-center justify-between">
        <Link
          to="/accounts"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-base-500 hover:text-accent-500 transition"
        >
          <ArrowLeft size={16} />
          {t('accountDetail.backToAccounts')}
        </Link>

        <div className="flex items-center gap-2">
          <Button variant="secondary" className="h-8 px-3 text-xs gap-1.5" onClick={handleExport}>
            <Download size={14} />
            {t('accountDetail.exportMaFile')}
          </Button>
          <Button variant="danger" className="h-8 px-3 text-xs gap-1.5" onClick={handleDelete}>
            <Trash2 size={14} />
            {t('accountDetail.deleteAccount')}
          </Button>
        </div>
      </div>

      {/* Main Info & 2FA Display Card */}
      <Card className="p-5 overflow-hidden relative rounded-3xl border border-base-200/80 bg-white/90 dark:border-white/[0.08] dark:bg-[#07070a] shadow-sm dark:shadow-amoled-card">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl sm:text-2xl font-black dark:text-white tracking-tight">{account.alias}</h1>
              {account.secretFields.includes('session.steamLoginSecure') ? (
                <Badge variant="success" className="text-[10px]">{t('accountDetail.sessionActive')}</Badge>
              ) : (
                <Badge variant="warning" className="text-[10px]">{t('accountDetail.sessionNeeded')}</Badge>
              )}
            </div>
            <p className="text-xs text-base-500 dark:text-base-400 font-mono mt-0.5">
              {t('accountDetail.loginLabel')}: {account.accountName} | SteamID:{' '}
              {account.steamid || t('accountDetail.noSteamId')}
            </p>
          </div>

          {/* Large TOTP Code Box */}
          <button
            type="button"
            onClick={handleCopy}
            className={`rounded-2xl p-4 flex flex-col items-center justify-center min-w-[210px] border transition-all duration-200 ${
              copied
                ? 'bg-emerald-500/15 border-2 border-emerald-500/60 shadow-glow-emerald'
                : 'bg-base-100/90 dark:bg-black border-base-200 dark:border-white/[0.08] hover:border-accent-500 dark:hover:border-[#00d2ff]/60'
            }`}
          >
            <span className="text-[10px] uppercase font-bold text-base-400 dark:text-base-500 tracking-wider">
              {t('accounts.guardLabel2fa')}
            </span>
            <span
              className={`font-mono text-3xl sm:text-4xl font-black tracking-widest my-1 transition-colors ${
                copied
                  ? 'text-emerald-500 dark:text-emerald-400'
                  : isExpiringSoon
                    ? 'text-danger dark:text-danger animate-pulse'
                    : 'text-accent-500 dark:text-[#00d2ff]'
              }`}
            >
              {currentCode}
            </span>
            <div className="flex items-center gap-1.5 text-xs text-base-400">
              {copied ? (
                <span className="text-emerald-600 dark:text-emerald-400 font-bold flex items-center gap-1">
                  <Check size={14} /> {t('accounts.copied')}
                </span>
              ) : (
                <>
                  <Clock size={12} className={isExpiringSoon ? 'text-danger animate-pulse' : 'text-[#00d2ff]'} />
                  <span className="font-mono">{t('accounts.secondsLeft', { seconds: secondsLeft })}</span>
                </>
              )}
            </div>
          </button>
        </div>

        {/* Progress gauge */}
        <div className="mt-4 w-full h-1.5 bg-base-200 dark:bg-white/[0.06] rounded-full overflow-hidden">
          <div
            className={`h-full transition-all duration-1000 ease-linear rounded-full ${
              isExpiringSoon ? 'bg-danger shadow-glow-danger' : 'bg-accent-500 dark:bg-[#00d2ff] shadow-glow'
            }`}
            style={{ width: `${100 - progressPercent}%` }}
          />
        </div>
      </Card>

      {/* Notification Banner */}
      {message && (
        <div
          className={`flex items-center gap-2 rounded-xl p-3 text-sm border ${
            message.type === 'success'
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
              : 'border-danger/30 bg-danger/10 text-danger'
          }`}
        >
          {message.type === 'success' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
          <span>{message.text}</span>
        </div>
      )}

      {/* Confirmations Card for this Account */}
      <Card className="p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-bold flex items-center gap-2">
            {t('accountDetail.confirmationsFor', { alias: account.alias })}
            {confirmations.length > 0 && (
              <Badge variant="primary" className="text-xs">
                {confirmations.length}
              </Badge>
            )}
          </h2>
          <Button
            variant="secondary"
            className="h-8 px-2.5 text-xs gap-1"
            onClick={loadConfirmations}
            disabled={confirmationsBusy}
          >
            <RefreshCw size={13} className={confirmationsBusy ? 'animate-spin' : ''} />
            {t('confirmations.refresh')}
          </Button>
        </div>

        <div className="space-y-2">
          {confirmations.map((item) => (
            <div
              key={item.id}
              className="flex items-center justify-between gap-3 p-3 rounded-xl border border-base-200 dark:border-base-800 bg-base-50/50 dark:bg-base-800/40"
            >
              <div>
                <div className="text-sm font-semibold">{item.headline}</div>
                <div className="text-xs text-base-500">{item.summary}</div>
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <Button
                  variant="primary"
                  className="h-8 px-3 text-xs bg-emerald-600 hover:bg-emerald-700"
                  onClick={() => handleRespond(item, true)}
                >
                  <CheckCircle2 size={13} />
                </Button>
                <Button
                  variant="danger"
                  className="h-8 px-3 text-xs"
                  onClick={() => handleRespond(item, false)}
                >
                  <XCircle size={13} />
                </Button>
              </div>
            </div>
          ))}

          {confirmations.length === 0 && (
            <div className="text-xs text-base-500 py-3 text-center">
              {t('accountDetail.noConfirmations')}
            </div>
          )}
        </div>
      </Card>

      {/* Account Settings & Session Form */}
      <Card className="p-5 space-y-4">
        <h2 className="text-base font-bold">{t('accountDetail.settingsSessionTitle')}</h2>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="text-xs font-medium text-base-500 mb-1 block">{t('accountDetail.aliasLabel')}</label>
            <Input value={alias} onChange={(e) => setAlias(e.target.value)} />
          </div>

          <div>
            <label className="text-xs font-medium text-base-500 mb-1 block">{t('accountDetail.folderLabel')}</label>
            <select
              className="input-base text-xs sm:text-sm h-10 w-full"
              value={selectedFolderId}
              onChange={(e) => setSelectedFolderId(e.target.value)}
            >
              <option value="none">{t('accountDetail.noFolder')}</option>
              {folders.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Automated Steam Login & Session Fetcher */}
        <div className="p-4 rounded-2xl border border-accent-500/30 bg-accent-500/5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Sparkles className="text-accent-500" size={18} />
              <h3 className="text-sm font-bold text-white">{t('accountDetail.autoLoginTitle')}</h3>
            </div>
            {account.secretFields.includes('session.refreshToken') && (
              <Button
                variant="secondary"
                className="h-8 px-3 text-xs gap-1.5 border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
                onClick={handleRefreshToken}
                disabled={refreshBusy || autoLoginBusy}
              >
                <RefreshCw size={12} className={refreshBusy ? 'animate-spin' : ''} />
                {refreshBusy ? t('accountDetail.refreshing') : t('accountDetail.refreshTokenBtn')}
              </Button>
            )}
          </div>
          <p className="text-xs text-base-400 leading-relaxed">
            {t('accountDetail.autoLoginDesc')}
          </p>

          <div className="flex flex-col sm:flex-row gap-2 pt-1">
            <SecretInput
              ref={autoLoginPasswordRef}
              placeholder={t('accountDetail.passwordPlaceholder')}
              className="text-xs flex-1"
              disabled={autoLoginBusy}
            />
            <Button
              variant="primary"
              className="h-10 text-xs px-4 gap-2 flex-shrink-0 bg-[#00d2ff] hover:bg-[#38bdf8] text-black font-bold shadow-glow"
              onClick={handleAutoLogin}
              disabled={autoLoginBusy}
            >
              <LogIn size={14} className={autoLoginBusy ? 'animate-spin' : ''} />
              {autoLoginBusy ? t('accountDetail.loggingIn') : t('accountDetail.autoLoginBtn')}
            </Button>
          </div>

          {autoLoginStatus && (
            <div className="text-xs p-2.5 rounded-xl border border-accent-500/30 bg-black/60 text-accent-400 flex items-center gap-2 animate-pulse">
              <RefreshCw size={13} className="animate-spin flex-shrink-0" />
              <span>{autoLoginStatus}</span>
            </div>
          )}
        </div>

        {/* Steam Session Cookies Inputs */}
        <div className="pt-2 border-t border-base-200 dark:border-base-800 space-y-3">
          <div className="text-xs font-semibold text-base-700 dark:text-base-300">
            {t('accountDetail.steamSessionTitle')} ({t('accountDetail.manualEdit')})
          </div>
          <p className="text-xs text-base-400">
            {t('accountDetail.manualEditDesc')}
          </p>

          <div className="space-y-2">
            <div>
              <label className="text-xs font-medium text-base-500 mb-1 block">
                {t('accountDetail.steamLoginSecure')}
              </label>
              <Input
                placeholder={t('accountDetail.steamLoginSecurePlaceholder')}
                value={steamLoginSecure}
                onChange={(e) => setSteamLoginSecure(e.target.value)}
              />
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              <div>
                <label className="text-xs font-medium text-base-500 mb-1 block">
                  {t('accountDetail.sessionId')}
                </label>
                <Input
                  placeholder={t('accountDetail.sessionIdPlaceholder')}
                  value={sessionid}
                  onChange={(e) => setSessionid(e.target.value)}
                />
              </div>

              <div>
                <label className="text-xs font-medium text-base-500 mb-1 block">
                  {t('accountDetail.oauthToken')}
                </label>
                <Input
                  placeholder={
                    account.secretFields.includes('session.oauthToken')
                      ? t('accountDetail.oauthTokenStored')
                      : t('accountDetail.oauthTokenPlaceholder')
                  }
                  value={oauthToken}
                  onChange={(e) => setOauthToken(e.target.value)}
                  autoComplete="off"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Revocation Code: kept out of the DOM until the user asks for it. */}
        {account.secretFields.includes('revocationCode') && (
          <div className="rounded-xl border border-warning/40 bg-warning/10 p-3 text-xs space-y-2">
            <div className="font-semibold text-base-800 dark:text-base-200 flex items-center justify-between">
              <span>{t('accountDetail.recoveryCodeTitle')}</span>
              <button
                type="button"
                className="text-xs text-accent-500 hover:underline flex items-center gap-1"
                onClick={async () => {
                  if (showRevocationCode) {
                    setShowRevocationCode(false);
                    setRevocationCode('');
                    return;
                  }
                  try {
                    setRevocationCode(await accountApi.revealSecret(account.id, 'revocationCode'));
                    setShowRevocationCode(true);
                  } catch {
                    setMessage({ text: t('accountDetail.recoveryCodeFailed'), type: 'error' });
                  }
                }}
              >
                {showRevocationCode ? <EyeOff size={13} /> : <Eye size={13} />}
                {showRevocationCode ? t('accountDetail.hideRecoveryCode') : t('accountDetail.showRecoveryCode')}
              </button>
            </div>
            <div className="font-mono text-sm font-bold tracking-wider text-base-900 dark:text-base-100">
              {showRevocationCode && revocationCode ? revocationCode : '••••••'}
            </div>
          </div>
        )}

        <div className="pt-2">
          <Button
            variant="primary"
            className="w-full gap-2 text-xs sm:text-sm"
            onClick={handleSaveDetails}
            disabled={saveBusy}
          >
            <Save size={15} />
            {t('accountDetail.saveOrganization')}
          </Button>
        </div>
      </Card>
    </div>
  );
}
