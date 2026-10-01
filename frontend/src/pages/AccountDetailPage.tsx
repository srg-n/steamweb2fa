import { useCallback, useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  KeyRound,
  Download,
  Trash2,
  Check,
  Copy,
  Clock,
  ShieldAlert,
  ArrowLeft,
  RefreshCw,
  Eye,
  EyeOff,
  Folder,
  Tag,
  Save,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Sparkles,
  LogIn
} from 'lucide-react';
import { accountApi, accountOrganizationApi, steamApi, settingsApi } from '../api';
import type { StoredAccount, FolderItem, TagItem } from '../services/storage';
import type { ConfirmationItem } from '../services/steamClient';
import { generateSteamGuardCode } from '../services/steamCrypto';
import { steamAuth } from '../services/steamAuth';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Input } from '../components/ui/Input';
import { Badge } from '../components/ui/Badge';

export function AccountDetailPage() {
  const { t } = useTranslation();
  const params = useParams<{ id: string }>();
  const navigate = useNavigate();
  const accountId = params.id as string;

  const [account, setAccount] = useState<StoredAccount | null>(null);
  const [folders, setFolders] = useState<FolderItem[]>([]);
  const [tags, setTags] = useState<TagItem[]>([]);
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

  // Session fields
  const [steamLoginSecure, setSteamLoginSecure] = useState('');
  const [sessionid, setSessionid] = useState('');
  const [oauthToken, setOauthToken] = useState('');
  const [refreshToken, setRefreshToken] = useState('');

  // Automated Steam Login via Worker
  const [autoLoginPassword, setAutoLoginPassword] = useState('');
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
    setTags(orgRes.tags);
    setSelectedFolderId(acc.folderId || 'none');
    setSelectedTagNames(acc.tags || []);
    setTimeOffset(setRes.timeOffsetSec || 0);

    setSteamLoginSecure(acc.session?.steamLoginSecure || '');
    setSessionid(acc.session?.sessionid || '');
    setOauthToken(acc.session?.oauthToken || '');
    setRefreshToken(acc.session?.refreshToken || '');
  }, [accountId, navigate]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Update live code
  useEffect(() => {
    if (!account?.sharedSecret) return;

    const updateCode = () => {
      const code = generateSteamGuardCode(account.sharedSecret, timeOffset);
      setCurrentCode(code);
    };

    updateCode();

    const interval = setInterval(() => {
      const nowSec = Math.floor(Date.now() / 1000) + timeOffset;
      const next = 30 - (nowSec % 30) || 30;
      setSecondsLeft(next);
      if (next === 30) {
        updateCode();
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
    if (account?.session?.steamLoginSecure) {
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
        tags: selectedTagNames,
        session: {
          steamLoginSecure: steamLoginSecure.trim() || undefined,
          sessionid: sessionid.trim() || undefined,
          oauthToken: oauthToken.trim() || undefined,
          refreshToken: refreshToken.trim() || undefined
        }
      });
      setMessage({ text: t('accountDetail.sessionSaved'), type: 'success' });
      await loadData();
    } catch (err: any) {
      setMessage({ text: err?.message || 'Failed to save', type: 'error' });
    } finally {
      setSaveBusy(false);
    }
  };

  const handleAutoLogin = async () => {
    if (!account || !autoLoginPassword) return;
    setAutoLoginBusy(true);
    setAutoLoginStatus('Steam RSA anahtarı alınıyor...');
    setMessage(null);
    try {
      const settings = await settingsApi.get();
      const res = await steamAuth.loginWithCredentials(
        account,
        autoLoginPassword,
        settings,
        (status) => setAutoLoginStatus(status)
      );

      if (res.success && res.steamLoginSecure) {
        setSteamLoginSecure(res.steamLoginSecure);
        if (res.sessionid) setSessionid(res.sessionid);
        if (res.oauthToken) setOauthToken(res.oauthToken);
        if (res.refreshToken) setRefreshToken(res.refreshToken);
        setAutoLoginPassword('');
        setAutoLoginStatus(null);
        setMessage({
          text: 'Giriş başarılı! steamLoginSecure çerezi otomatik tanımlandı ve onaylar aktif edildi.',
          type: 'success'
        });
        await loadData();
        await loadConfirmations();
      } else {
        throw new Error(res.error || 'Giriş başarısız oldu.');
      }
    } catch (err: any) {
      setAutoLoginStatus(null);
      setMessage({
        text: `Otomatik giriş başarısız: ${err?.message || 'Bilinmeyen hata'}`,
        type: 'error'
      });
    } finally {
      setAutoLoginBusy(false);
    }
  };

  const handleRefreshToken = async () => {
    if (!account?.session?.refreshToken) return;
    setRefreshBusy(true);
    setMessage(null);
    try {
      const settings = await settingsApi.get();
      const res = await steamAuth.refreshWithRefreshToken(account, settings);
      if (res.success && res.steamLoginSecure) {
        setSteamLoginSecure(res.steamLoginSecure);
        setMessage({
          text: 'Oturum RefreshToken ile başarıyla yenilendi!',
          type: 'success'
        });
        await loadData();
        await loadConfirmations();
      } else {
        throw new Error(res.error || 'Yenileme başarısız.');
      }
    } catch (err: any) {
      const raw = err?.message || 'Bilinmeyen hata';
      const cleanMsg = raw.startsWith('Oturum yenileme hatası:')
        ? raw
        : `Oturum yenileme hatası: ${raw}`;
      setMessage({
        text: cleanMsg,
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
      alert(err?.message || 'Failed to respond');
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
          Back to Accounts
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
              {account.session?.steamLoginSecure ? (
                <Badge variant="success" className="text-[10px]">Session Active</Badge>
              ) : (
                <Badge variant="warning" className="text-[10px]">Session Needed</Badge>
              )}
            </div>
            <p className="text-xs text-base-500 dark:text-base-400 font-mono mt-0.5">
              Login: {account.accountName} | SteamID: {account.steamid || t('accountDetail.noSteamId')}
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
              Steam Guard 2FA
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
                  <span className="font-mono">{secondsLeft}s left</span>
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
            Confirmations for {account.alias}
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
              No pending confirmations for this account.
            </div>
          )}
        </div>
      </Card>

      {/* Account Settings & Session Form */}
      <Card className="p-5 space-y-4">
        <h2 className="text-base font-bold">Account Settings & Steam Session</h2>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="text-xs font-medium text-base-500 mb-1 block">Alias / Nickname</label>
            <Input value={alias} onChange={(e) => setAlias(e.target.value)} />
          </div>

          <div>
            <label className="text-xs font-medium text-base-500 mb-1 block">Folder</label>
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
              <h3 className="text-sm font-bold text-white">Otomatik Steam Girişi (2FA Otomatik Çözülür)</h3>
            </div>
            {account.session?.refreshToken && (
              <Button
                variant="secondary"
                className="h-8 px-3 text-xs gap-1.5 border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
                onClick={handleRefreshToken}
                disabled={refreshBusy || autoLoginBusy}
              >
                <RefreshCw size={12} className={refreshBusy ? 'animate-spin' : ''} />
                RefreshToken ile Yenile
              </Button>
            )}
          </div>
          <p className="text-xs text-base-400 leading-relaxed">
            F12 ile uğraşmadan oturum açın. Worker şifrenizi yerel RSA ile şifreler, <strong>Steam Guard 2FA kodunu otomatik üretip onaylar</strong> ve <code>steamLoginSecure</code> çerezini hesabınıza anında kaydeder.
          </p>

          <div className="flex flex-col sm:flex-row gap-2 pt-1">
            <Input
              type="password"
              placeholder={`"${account.accountName}" için Steam şifresi`}
              value={autoLoginPassword}
              onChange={(e) => setAutoLoginPassword(e.target.value)}
              className="text-xs flex-1"
              disabled={autoLoginBusy}
            />
            <Button
              variant="primary"
              className="h-10 text-xs px-4 gap-2 flex-shrink-0 bg-[#00d2ff] hover:bg-[#38bdf8] text-black font-bold shadow-glow"
              onClick={handleAutoLogin}
              disabled={autoLoginBusy || !autoLoginPassword}
            >
              <LogIn size={14} className={autoLoginBusy ? 'animate-spin' : ''} />
              {autoLoginBusy ? 'Giriş Yapılıyor...' : 'Otomatik Giriş Yap & Çerezi Al'}
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
            {t('accountDetail.steamSessionTitle')} (Manuel Düzenleme)
          </div>
          <p className="text-xs text-base-400">
            Required for checking and approving trade offers without opening the Steam mobile app.
          </p>

          <div className="space-y-2">
            <div>
              <label className="text-xs font-medium text-base-500 mb-1 block">
                {t('accountDetail.steamLoginSecure')}
              </label>
              <Input
                placeholder="76561198...%7C%7C..."
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
                  placeholder="32 character hex"
                  value={sessionid}
                  onChange={(e) => setSessionid(e.target.value)}
                />
              </div>

              <div>
                <label className="text-xs font-medium text-base-500 mb-1 block">
                  {t('accountDetail.oauthToken')}
                </label>
                <Input
                  placeholder="Bearer token or JWT"
                  value={oauthToken}
                  onChange={(e) => setOauthToken(e.target.value)}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Revocation Code */}
        {account.revocationCode && (
          <div className="rounded-xl border border-warning/40 bg-warning/10 p-3 text-xs space-y-2">
            <div className="font-semibold text-base-800 dark:text-base-200 flex items-center justify-between">
              <span>{t('accountDetail.recoveryCodeTitle')}</span>
              <button
                type="button"
                className="text-xs text-accent-500 hover:underline flex items-center gap-1"
                onClick={() => setShowRevocationCode((prev) => !prev)}
              >
                {showRevocationCode ? <EyeOff size={13} /> : <Eye size={13} />}
                {showRevocationCode ? 'Hide' : 'Show'}
              </button>
            </div>
            {showRevocationCode && (
              <div className="font-mono text-sm font-bold tracking-wider text-base-900 dark:text-base-100">
                {account.revocationCode}
              </div>
            )}
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
