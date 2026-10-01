import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Inbox,
  RefreshCw,
  CheckCircle2,
  XCircle,
  ArrowRightLeft,
  ShoppingBag,
  LogIn,
  AlertCircle,
  ExternalLink,
  Zap,
  StopCircle
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { accountApi, steamApi } from '../api';
import type { StoredAccount } from '../services/storage';
import type { ConfirmationItem } from '../services/steamClient';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';

export function ConfirmationsPage() {
  const { t } = useTranslation();
  const [accounts, setAccounts] = useState<StoredAccount[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string>('all');
  const [confirmations, setConfirmations] = useState<ConfirmationItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{
    current: number;
    total: number;
    percent: number;
    successCount: number;
  } | null>(null);
  const abortBatchRef = useRef(false);
  const [autoConfirmEnabled, setAutoConfirmEnabled] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const [isCorsBlocked, setIsCorsBlocked] = useState(false);
  const [directSteamUrl, setDirectSteamUrl] = useState<string>('https://steamcommunity.com/mobileconf/conf');

  // Auto-refresh interval (in seconds, 0 = off)
  const [autoRefreshSec, setAutoRefreshSec] = useState<number>(30);
  const [isRateLimited, setIsRateLimited] = useState(false);
  const [rateLimitTimer, setRateLimitTimer] = useState<number>(0);

  const loadAccounts = useCallback(async () => {
    const res = await accountApi.list();
    setAccounts(res.items);
  }, []);

  // Rate limit cooldown countdown timer
  useEffect(() => {
    if (rateLimitTimer <= 0) {
      if (isRateLimited) setIsRateLimited(false);
      return;
    }
    const timer = setInterval(() => {
      setRateLimitTimer((prev) => (prev > 1 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [rateLimitTimer, isRateLimited]);

  const fetchConfirmations = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    setIsCorsBlocked(false);
    try {
      const url = await steamApi.getDirectConfirmationUrl(selectedAccountId);
      setDirectSteamUrl(url);

      if (selectedAccountId === 'all') {
        const items = await steamApi.allConfirmations();
        setConfirmations(items);
      } else {
        const items = await steamApi.confirmations(selectedAccountId);
        setConfirmations(items);
      }
    } catch (err: any) {
      if (err?.message?.includes('RATE_LIMITED') || err?.message?.includes('429')) {
        setIsRateLimited(true);
        setRateLimitTimer(45);
        setMessage({
          text: '⚠️ Steam geçici hız sınırı uyguladı (HTTP 429). İstekler 45 saniye duraklatıldı.',
          type: 'error'
        });
      } else if (err?.message === 'CORS_BLOCKED') {
        setIsCorsBlocked(true);
      } else {
        setMessage({
          text: err?.message || 'Failed to fetch Steam confirmations.',
          type: 'error'
        });
      }
    } finally {
      setLoading(false);
    }
  }, [selectedAccountId]);

  useEffect(() => {
    loadAccounts();
  }, [loadAccounts]);

  useEffect(() => {
    fetchConfirmations();
  }, [fetchConfirmations]);

  // Auto-refresh timer (automatically paused when rate limited)
  useEffect(() => {
    if (autoRefreshSec <= 0 || isRateLimited) return;
    const interval = setInterval(fetchConfirmations, autoRefreshSec * 1000);
    return () => clearInterval(interval);
  }, [autoRefreshSec, fetchConfirmations, isRateLimited]);

  const handleRespond = async (item: ConfirmationItem, accept: boolean) => {
    setProcessingId(item.id);
    setMessage(null);
    try {
      const success = await steamApi.respond(item.accountId, item.id, item.nonce, accept);
      if (success) {
        setConfirmations((prev) => prev.filter((c) => c.id !== item.id));
        setMessage({
          text: accept ? 'Confirmation accepted successfully!' : 'Confirmation declined.',
          type: 'success'
        });
      } else {
        setMessage({
          text: 'Steam returned failure for this operation.',
          type: 'error'
        });
      }
    } catch (err: any) {
      if (err?.message?.includes('RATE_LIMITED') || err?.message?.includes('429')) {
        setIsRateLimited(true);
        setRateLimitTimer(45);
      }
      setMessage({
        text: err?.message || 'Error communicating with Steam.',
        type: 'error'
      });
    } finally {
      setProcessingId(null);
    }
  };

  const handleBatch = async (accept: boolean, isAuto = false) => {
    if (confirmations.length === 0 || batchBusy) return;
    if (!isAuto) {
      const actionName = accept ? t('confirmations.acceptAll') : t('confirmations.rejectAll');
      if (!window.confirm(`${actionName} (${confirmations.length})?`)) return;
    }

    setBatchBusy(true);
    abortBatchRef.current = false;
    setMessage(null);
    let successCount = 0;
    const total = confirmations.length;
    setBatchProgress({ current: 0, total, percent: 0, successCount: 0 });

    for (let i = 0; i < total; i++) {
      if (abortBatchRef.current) break;
      const item = confirmations[i];
      let ok = false;
      try {
        ok = await steamApi.respond(item.accountId, item.id, item.nonce, accept);
      } catch (err: any) {
        if (err?.message?.includes('RATE_LIMITED') || err?.message?.includes('429')) {
          // Pause batch for 3.5 seconds and retry once
          await new Promise((r) => setTimeout(r, 3500));
          try {
            ok = await steamApi.respond(item.accountId, item.id, item.nonce, accept);
          } catch {
            // continue
          }
        }
      }

      if (ok) {
        successCount++;
        setConfirmations((prev) => prev.filter((c) => c.id !== item.id));
      }

      const current = i + 1;
      setBatchProgress({
        current,
        total,
        percent: Math.round((current / total) * 100),
        successCount
      });

      // Polite 500ms rate-limit delay between Steam confirmation requests
      if (i < total - 1 && !abortBatchRef.current) {
        await new Promise((r) => setTimeout(r, 500));
      }
    }

    setBatchBusy(false);
    setBatchProgress(null);
    await fetchConfirmations();
    setMessage({
      text: `Toplu işlem tamamlandı: ${successCount}/${total} onay ${accept ? 'kabul edildi' : 'reddedildi'}.`,
      type: 'success'
    });
  };

  // Auto-confirm effect
  useEffect(() => {
    if (autoConfirmEnabled && confirmations.length > 0 && !batchBusy && !loading) {
      handleBatch(true, true);
    }
  }, [autoConfirmEnabled, confirmations.length, batchBusy, loading]);

  const missingSessionAccounts = useMemo(() => {
    return accounts.filter((a) => !a.session?.steamLoginSecure && !a.session?.oauthToken);
  }, [accounts]);

  return (
    <div className="space-y-4 max-w-full overflow-hidden">
      {/* Rate Limit Warning Banner */}
      {isRateLimited && (
        <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-3.5 sm:p-4 text-xs sm:text-sm text-amber-300 flex items-start gap-2.5 shadow-glow">
          <AlertCircle size={18} className="text-amber-400 flex-shrink-0 mt-0.5" />
          <div className="space-y-1">
            <div className="font-bold text-white flex items-center gap-2">
              <span>Steam Hız Sınırı (Rate Limit — HTTP 429)</span>
              <span className="font-mono text-[11px] bg-amber-500/20 px-2 py-0.5 rounded-full text-amber-400">
                {rateLimitTimer}s beklemede
              </span>
            </div>
            <p className="text-base-300 text-[12px] leading-relaxed">
              Steam sunucuları çok sık onay sorgusu yapıldığı için geçici olarak yanıt vermeyi kısıtladı. Otomatik yenileme ve istekler güvenlik amacıyla {rateLimitTimer} saniye boyunca duraklatıldı.
            </p>
          </div>
        </div>
      )}

      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 w-full">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2">
            <Inbox className="text-accent-500" />
            {t('confirmations.title')}
          </h1>
          <p className="text-xs sm:text-sm text-base-500">
            Real-time Steam trade, market, and login mobile confirmations.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
          {/* Account Filter */}
          <select
            className="input-base text-xs sm:text-sm py-1.5 h-8 sm:h-9 flex-1 sm:flex-none min-w-[120px]"
            value={selectedAccountId}
            onChange={(e) => setSelectedAccountId(e.target.value)}
          >
            <option value="all">{t('confirmations.allAccounts')} ({accounts.length})</option>
            {accounts.map((acc) => (
              <option key={acc.id} value={acc.id}>
                {acc.alias} ({acc.accountName})
              </option>
            ))}
          </select>

          {/* Auto refresh select */}
          <select
            className="input-base text-xs py-1.5 h-8 sm:h-9 w-auto"
            value={autoRefreshSec}
            onChange={(e) => setAutoRefreshSec(Number(e.target.value))}
            title="Auto refresh interval"
          >
            <option value={0}>Auto: Off</option>
            <option value={15}>Auto: 15s</option>
            <option value={30}>Auto: 30s</option>
            <option value={60}>Auto: 60s</option>
          </select>

          {/* Direct Steam Confirmation Link */}
          <a
            href={directSteamUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="button-secondary h-8 sm:h-9 px-2.5 sm:px-3 text-xs gap-1.5 flex items-center hover:border-accent-500 hover:text-accent-500 rounded-xl"
            title="Steam resmi mobil onay sayfasını yeni sekmede aç"
          >
            <ExternalLink size={13} />
            <span className="hidden xs:inline">Steam'de Aç</span>
          </a>

          {/* Manual Refresh Button */}
          <Button
            variant="secondary"
            className="h-8 sm:h-9 px-2.5 sm:px-3 text-xs gap-1.5 rounded-xl"
            onClick={fetchConfirmations}
            disabled={loading || isRateLimited}
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            <span className="hidden xs:inline">{t('confirmations.refresh')}</span>
          </Button>

          {/* Auto-Confirm Toggle */}
          <Button
            variant="secondary"
            className={`h-8 sm:h-9 px-2.5 sm:px-3 text-xs gap-1.5 rounded-xl transition-all ${
              autoConfirmEnabled
                ? 'bg-amber-500/20 text-amber-400 border-amber-500/40 shadow-glow'
                : 'text-base-400'
            }`}
            onClick={() => setAutoConfirmEnabled(!autoConfirmEnabled)}
            title="Yeni gelen tüm pazar ve takas onaylarını otomatik kabul et"
          >
            <Zap size={13} className={autoConfirmEnabled ? 'text-amber-400 fill-amber-400' : ''} />
            <span>{autoConfirmEnabled ? 'Oto: Açık' : 'Oto: Kapalı'}</span>
          </Button>

          {/* Batch Actions */}
          {confirmations.length > 0 && (
            <div className="flex items-center gap-1.5 w-full sm:w-auto mt-1 sm:mt-0">
              <Button
                variant="primary"
                className="flex-1 sm:flex-none h-8 sm:h-9 px-3 text-xs gap-1 bg-emerald-600 hover:bg-emerald-700 rounded-xl font-bold"
                onClick={() => handleBatch(true)}
                disabled={batchBusy || loading || isRateLimited}
              >
                <CheckCircle2 size={14} />
                {t('confirmations.acceptAll')} ({confirmations.length})
              </Button>
              <Button
                variant="danger"
                className="h-8 sm:h-9 px-3 text-xs gap-1 rounded-xl"
                onClick={() => handleBatch(false)}
                disabled={batchBusy || loading || isRateLimited}
              >
                <XCircle size={14} />
                <span className="hidden xs:inline">{t('confirmations.rejectAll')}</span>
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Live Batch Progress Bar */}
      {batchProgress && (
        <Card className="p-4 border-accent-500/40 bg-accent-500/10 space-y-2.5 rounded-2xl shadow-glow">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <RefreshCw size={16} className="animate-spin text-accent-500" />
              <span className="font-bold text-sm text-white">
                Toplu Onaylanıyor: {batchProgress.current} / {batchProgress.total} (%{batchProgress.percent})
              </span>
            </div>
            <Button
              variant="danger"
              className="h-7 px-3 text-xs gap-1 bg-red-600/80 hover:bg-red-600 text-white"
              onClick={() => { abortBatchRef.current = true; }}
            >
              <StopCircle size={14} />
              Durdur
            </Button>
          </div>
          <div className="w-full bg-black/60 rounded-full h-2.5 overflow-hidden border border-white/10">
            <div
              className="bg-[#00d2ff] h-2.5 transition-all duration-200 rounded-full shadow-glow"
              style={{ width: `${batchProgress.percent}%` }}
            />
          </div>
          <div className="text-[11px] text-base-400 flex justify-between">
            <span>Steam Rate-Limit korumalı sıralı işlem yapılıyor...</span>
            <span className="text-emerald-400 font-mono font-bold">{batchProgress.successCount} Başarılı</span>
          </div>
        </Card>
      )}

      {/* Message Banner */}
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

      {/* CORS Blocked Info & 1-Click Steam Direct Open */}
      {isCorsBlocked && (
        <Card className="p-5 border-amber-500/40 bg-amber-500/5 space-y-4 rounded-2xl">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-amber-500/15 text-amber-400 border border-amber-500/30">
              <AlertCircle size={22} />
            </div>
            <div className="space-y-1.5 flex-1">
              <h3 className="font-bold text-base text-white flex items-center gap-2">
                Tarayıcı Güvenlik Engeli (Steam CORS Kısıtlaması)
              </h3>
              <p className="text-xs sm:text-sm text-base-300 leading-relaxed">
                Steam sunucuları, tarayıcılardan doğrudan <code>steamcommunity.com</code> adresine yapılan çapraz kökenli (cross-origin) onay sorgularına izin vermez. Bekleyen market veya takas onaylarınız Steam'de hazırdır.
              </p>
            </div>
          </div>

          <div className="pt-2 border-t border-white/[0.08] flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
            <div className="text-xs text-base-400">
              💡 <strong>Hızlı Çözüm:</strong> İmzalanmış resmi Steam sayfasına giderek 1 tıkla onaylayabilirsiniz.
            </div>

            <a
              href={directSteamUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="button-primary h-10 px-5 text-xs font-bold gap-2 flex items-center justify-center bg-[#00d2ff] hover:bg-[#38bdf8] text-black shadow-glow"
            >
              <span>Steam'de Doğrudan Aç ve Onayla</span>
              <ExternalLink size={15} />
            </a>
          </div>

          <div className="rounded-xl border border-white/[0.06] bg-black/50 p-3 text-xs text-base-400 space-y-1.5">
            <div className="font-semibold text-white/90">
              🚀 Uygulama İçinden Tek Tıkla Onaylamak İsterseniz:
            </div>
            <ul className="list-disc list-inside space-y-1 pl-1 text-[12px]">
              <li>
                <strong>Seçenek 1 (En Kolayı):</strong> Chrome Web Store'dan <strong>"Allow CORS: Access-Control-Allow-Origin"</strong> eklentisini kurup açın. Sayfayı yenilediğinizde onaylarınız doğrudan bu ekranda butonlarıyla listelenecektir.
              </li>
              <li>
                <strong>Seçenek 2:</strong> <Link to="/settings" className="text-accent-500 underline">Ayarlar</Link> sayfasına giderek yerel veya kendinize ait bir <strong>CORS Proxy</strong> adresi tanımlayın.
              </li>
            </ul>
          </div>
        </Card>
      )}

      {/* Missing session alert for accounts */}
      {missingSessionAccounts.length > 0 && (
        <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-3.5 text-xs text-base-700 dark:text-base-300 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <AlertCircle size={18} className="text-amber-400 flex-shrink-0 mt-0.5" />
            <div className="space-y-0.5">
              <div className="font-bold text-white">
                Oturum Çerezi (steamLoginSecure) Tanımlı Değil ({missingSessionAccounts.length} Hesap)
              </div>
              <p className="text-base-400 text-[11px] leading-relaxed">
                Steam takas ve pazar onaylarını listeleyebilmek için <code>steamLoginSecure</code> oturum çerezi zorunludur. (2FA kodları çevrimdışı çalışır, ancak onay listesi için çerez gereklidir).
              </p>
            </div>
          </div>
          <Link
            to={`/accounts/${missingSessionAccounts[0].id}`}
            className="button-primary h-8 px-3 text-xs font-bold gap-1.5 self-start sm:self-center flex-shrink-0 bg-[#00d2ff] hover:bg-[#38bdf8] text-black"
          >
            Çerezi Ekle <ExternalLink size={12} />
          </Link>
        </div>
      )}

      {/* Confirmation Items List */}
      <div className="space-y-3">
        {confirmations.map((item) => {
          const isBusy = processingId === item.id || batchBusy;

          return (
            <Card
              key={item.id}
              className="relative overflow-hidden rounded-2xl border border-base-200/80 bg-white/90 p-4 transition-all duration-200 hover:border-accent-500/50 hover:shadow-md dark:border-white/[0.08] dark:bg-[#07070a] dark:hover:border-[#00d2ff]/50 dark:hover:shadow-glow"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-start gap-3 min-w-0">
                  <div
                    className={`mt-1 flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl border ${
                      item.type === 'login'
                        ? 'border-purple-500/30 bg-purple-500/15 text-purple-400'
                        : item.type === 'market'
                          ? 'border-amber-500/30 bg-amber-500/15 text-amber-400'
                          : 'border-accent-500/30 bg-accent-500/15 text-[#00d2ff]'
                    }`}
                  >
                    {item.type === 'login' && <LogIn size={22} />}
                    {item.type === 'market' && <ShoppingBag size={22} />}
                    {item.type === 'trade' && <ArrowRightLeft size={22} />}
                  </div>

                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-extrabold text-sm sm:text-base text-base-900 dark:text-white">
                        {item.headline}
                      </span>
                      <Badge variant="primary" className="text-[10px]">
                        {item.accountAlias}
                      </Badge>
                      <Badge
                        variant={item.type === 'login' ? 'warning' : 'success'}
                        className="text-[10px] capitalize"
                      >
                        {item.type}
                      </Badge>
                    </div>

                    <p className="text-xs sm:text-sm text-base-600 dark:text-base-300 break-words leading-relaxed">
                      {item.summary}
                    </p>

                    <div className="text-[11px] font-mono text-base-400 dark:text-base-500">
                      ID: {item.id}
                    </div>
                  </div>
                </div>

                {/* Accept / Decline Action Buttons */}
                <div className="flex items-center gap-2 w-full sm:w-auto justify-end sm:justify-start flex-shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-base-200/60 dark:border-white/[0.06]">
                  <Button
                    variant="primary"
                    className="flex-1 sm:flex-none h-9 px-4 text-xs font-bold gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white dark:bg-emerald-500 dark:text-black dark:hover:bg-emerald-400 shadow-glow-emerald rounded-xl"
                    disabled={isBusy || isRateLimited}
                    onClick={() => handleRespond(item, true)}
                  >
                    <CheckCircle2 size={15} />
                    {t('confirmations.accept')}
                  </Button>
                  <Button
                    variant="danger"
                    className="flex-1 sm:flex-none h-9 px-4 text-xs font-bold gap-1.5 shadow-sm dark:bg-red-500/20 dark:text-red-400 dark:border-red-500/30 dark:hover:bg-red-600 dark:hover:text-white rounded-xl"
                    disabled={isBusy || isRateLimited}
                    onClick={() => handleRespond(item, false)}
                  >
                    <XCircle size={15} />
                    {t('confirmations.reject')}
                  </Button>
                </div>
              </div>
            </Card>
          );
        })}

        {/* Empty state */}
        {!loading && confirmations.length === 0 && (
          <div className="rounded-3xl border-2 border-dashed border-base-200 dark:border-white/[0.08] p-8 sm:p-14 text-center dark:bg-black/50">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-base-100 dark:bg-white/[0.04] text-base-400 dark:text-base-500 mb-3">
              <Inbox size={32} />
            </div>
            <h3 className="text-base font-bold text-base-800 dark:text-white">
              {t('confirmations.noPending')}
            </h3>
            <p className="mt-1 text-xs text-base-500 dark:text-base-400 max-w-sm mx-auto leading-relaxed">
              Trades, market listings, or Steam sign-in confirmation requests will appear here in real time.
            </p>
            <Button
              variant="secondary"
              className="mt-5 text-xs gap-1.5 h-9 px-4"
              onClick={fetchConfirmations}
            >
              <RefreshCw size={13} />
              Check Again
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
