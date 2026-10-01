import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Settings as SettingsIcon,
  Wifi,
  Clock,
  Download,
  Upload,
  Trash2,
  CheckCircle2,
  AlertCircle,
  Smartphone,
  Globe,
  Palette,
  Vibrate,
  ShieldCheck,
  RefreshCw,
  Server
} from 'lucide-react';
import { settingsApi } from '../api';
import type { AppSettings } from '../services/storage';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { applyCorsProxy } from '../services/steamClient';

export function SettingsPage() {
  const { t, i18n } = useTranslation();
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [syncBusy, setSyncBusy] = useState(false);
  const [testBusy, setTestBusy] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [proxyTestBusy, setProxyTestBusy] = useState(false);
  const [proxyTestResult, setProxyTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const [installPrompt, setInstallPrompt] = useState<any>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    settingsApi.get().then(setSettings);

    const handleBeforeInstall = (e: any) => {
      e.preventDefault();
      setInstallPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    return () => window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
  }, []);

  if (!settings) {
    return <div className="p-6 text-center text-xs text-base-500">{t('common.loading')}</div>;
  }

  const handleUpdate = async (patch: Partial<AppSettings>) => {
    const updated = await settingsApi.update(patch);
    setSettings(updated);
    setMessage({ text: t('settings.saved'), type: 'success' });
    setTimeout(() => setMessage(null), 3000);
  };

  const handleSyncTime = async () => {
    setSyncBusy(true);
    setMessage(null);
    try {
      const res = await settingsApi.syncTime();
      setSettings((prev) => (prev ? { ...prev, timeOffsetSec: res.offsetSeconds } : null));
      setMessage({
        text: t('settings.syncSuccess', { offset: res.offsetSeconds }),
        type: 'success'
      });
    } catch (err: any) {
      setMessage({
        text: `${t('settings.syncFailed')}: ${err?.message || ''}`,
        type: 'error'
      });
    } finally {
      setSyncBusy(false);
    }
  };

  const handleTestConnection = async () => {
    setTestBusy(true);
    setTestResult(null);
    const start = performance.now();
    try {
      const res = await settingsApi.syncTime();
      const elapsed = Math.round(performance.now() - start);
      setTestResult({
        ok: true,
        message: `${t('common.success')}! Latency: ${elapsed}ms | Steam Time: ${new Date(res.serverTime * 1000).toLocaleTimeString()} (Offset: ${res.offsetSeconds}s)`
      });
    } catch (err: any) {
      setTestResult({
        ok: false,
        message: err?.message || 'Connection error (CORS or Network)'
      });
    } finally {
      setTestBusy(false);
    }
  };

  const handleTestProxy = async () => {
    if (!settings?.corsProxyUrl) return;
    setProxyTestBusy(true);
    setProxyTestResult(null);
    const start = performance.now();
    try {
      const targetUrl = 'https://api.steampowered.com/ITwoFactorService/QueryTime/v0001';
      let proxyUrl = settings.corsProxyUrl.trim();
      if (!proxyUrl.startsWith('http://') && !proxyUrl.startsWith('https://')) {
        proxyUrl = `https://${proxyUrl}`;
        handleUpdate({ corsProxyUrl: proxyUrl });
      }
      const fullUrl = applyCorsProxy(targetUrl, proxyUrl);

      const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded' };
      if (settings.corsProxySecret?.trim()) {
        headers['X-Proxy-Secret'] = settings.corsProxySecret.trim();
      }

      const res = await fetch(fullUrl, {
        method: 'POST',
        headers,
        body: 'steamid=0',
        signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(6000) : undefined
      });

      const elapsed = Math.round(performance.now() - start);
      if (res.ok) {
        setProxyTestResult({
          ok: true,
          message: `Worker OK! Latency: ${elapsed}ms (HTTP ${res.status})`
        });
      } else if (res.status === 401) {
        setProxyTestResult({
          ok: false,
          message: `Worker 401 Unauthorized (X-Proxy-Secret mismatch).`
        });
      } else {
        setProxyTestResult({
          ok: false,
          message: `Worker returned HTTP ${res.status}`
        });
      }
    } catch (err: any) {
      setProxyTestResult({
        ok: false,
        message: `Worker error: ${err?.message || 'Network error'}`
      });
    } finally {
      setProxyTestBusy(false);
    }
  };

  const handleBackupExport = async () => {
    await settingsApi.exportBackup();
  };

  const handleBackupImport = async (file: File) => {
    try {
      const text = await file.text();
      const res = await settingsApi.importBackup(text);
      const freshSettings = await settingsApi.get();
      setSettings(freshSettings);
      setMessage({
        text: `Restored ${res.accountsImported} accounts and proxy settings from backup.`,
        type: 'success'
      });
    } catch (err: any) {
      setMessage({
        text: `Import failed: ${err?.message || 'Invalid backup file'}`,
        type: 'error'
      });
    }
  };

  const handleClearAll = async () => {
    if (
      !window.confirm(
        'WARNING: This will permanently delete ALL accounts, settings, and local data from this browser!\n\nAre you sure?'
      )
    ) {
      return;
    }
    localStorage.clear();
    if (typeof indexedDB !== 'undefined') {
      indexedDB.deleteDatabase('SteamWebAuthDB');
    }
    window.location.reload();
  };

  return (
    <div className="space-y-5 max-w-4xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2">
          <SettingsIcon className="text-accent-500" />
          {t('settings.title')}
        </h1>
        <p className="text-xs sm:text-sm text-base-500">
          Configure Steam connection mode, clock synchronization, offline backups, and appearance.
        </p>
      </div>

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

      {/* 1. Direct Steam Connection */}
      <Card className="p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Wifi className="text-emerald-500" size={18} />
            <h2 className="text-base font-bold">{t('settings.connection')}</h2>
          </div>
          <span className="rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
            {t('settings.zeroProxy')}
          </span>
        </div>
        <p className="text-xs text-base-500 leading-relaxed">
          {t('settings.connectionDesc')}
        </p>

        <div className="pt-1 flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <Button
            variant="secondary"
            className="h-9 px-4 text-xs gap-1.5"
            onClick={handleTestConnection}
            disabled={testBusy}
          >
            <RefreshCw size={14} className={testBusy ? 'animate-spin' : ''} />
            {t('settings.testConnection')}
          </Button>
          {testResult && (
            <div
              className={`text-xs p-2 rounded-xl border ${
                testResult.ok
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                  : 'border-danger/30 bg-danger/10 text-danger'
              }`}
            >
              {testResult.message}
            </div>
          )}
        </div>
      </Card>

      {/* 2. CORS Proxy Settings (Optional) */}
      <Card className="p-5 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Globe className="text-accent-500" size={18} />
            <h2 className="text-base font-bold">{t('settings.corsProxyTitle')}</h2>
          </div>
          <span className="rounded-full bg-accent-500/10 px-2.5 py-0.5 text-xs font-semibold text-accent-500 dark:text-[#00d2ff]">
            {t('settings.corsProxyBadge')}
          </span>
        </div>
        <p className="text-xs text-base-500 leading-relaxed">
          {t('settings.corsProxyDesc')}
        </p>

        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-base-400">{t('settings.proxyUrlLabel')}</label>
            <div className="mt-1 flex flex-col sm:flex-row gap-2">
              <Input
                type="text"
                placeholder={t('settings.proxyUrlPlaceholder')}
                value={settings.corsProxyUrl || ''}
                onChange={(e) => handleUpdate({ corsProxyUrl: e.target.value })}
                onBlur={(e) => {
                  let val = e.target.value.trim();
                  if (val && !val.startsWith('http://') && !val.startsWith('https://')) {
                    val = `https://${val}`;
                    handleUpdate({ corsProxyUrl: val });
                  }
                }}
                className="text-xs font-mono flex-1"
              />
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  className="h-10 text-xs px-3 gap-1 flex-shrink-0"
                  onClick={handleTestProxy}
                  disabled={proxyTestBusy || !settings.corsProxyUrl}
                >
                  <RefreshCw size={13} className={proxyTestBusy ? 'animate-spin' : ''} />
                  {t('settings.test')}
                </Button>
                {settings.corsProxyUrl && (
                  <Button
                    variant="secondary"
                    className="h-10 text-xs px-3 flex-shrink-0"
                    onClick={() => {
                      handleUpdate({ corsProxyUrl: '', corsProxySecret: '' });
                      setProxyTestResult(null);
                    }}
                  >
                    {t('settings.reset')}
                  </Button>
                )}
              </div>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-base-400">
                {t('settings.proxySecretLabel')}
              </label>
              <span className="text-[10px] text-base-500 font-normal">Security & Quota</span>
            </div>
            <Input
              type="password"
              placeholder={t('settings.proxySecretPlaceholder')}
              value={settings.corsProxySecret || ''}
              onChange={(e) => handleUpdate({ corsProxySecret: e.target.value })}
              className="text-xs font-mono mt-1"
            />
            <p className="text-[11px] text-base-500 mt-1">
              {t('settings.proxySecretHint')}
            </p>
          </div>

          {proxyTestResult && (
            <div
              className={`text-xs p-2.5 rounded-xl border ${
                proxyTestResult.ok
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                  : 'border-danger/30 bg-danger/10 text-danger'
              }`}
            >
              {proxyTestResult.message}
            </div>
          )}

          <p className="text-[11px] text-base-500">
            Örnekler: <code>https://steam-proxy.kullaniciadi.workers.dev/</code> veya <code>http://localhost:8080/</code>
          </p>
        </div>
      </Card>

      {/* 3. Steam Time Sync */}
      <Card className="p-5 space-y-3">
        <div className="flex items-center gap-2">
          <Clock className="text-accent-500" size={18} />
          <h2 className="text-base font-bold">{t('settings.timeSync')}</h2>
        </div>
        <p className="text-xs text-base-500 leading-relaxed">
          {t('settings.timeSyncDesc')}
        </p>

        <div className="rounded-xl border border-white/[0.08] bg-black/40 p-3 text-xs text-base-400 space-y-1">
          <p className="font-semibold text-white/90">
            {t('settings.offlineTotpInfoTitle')}
          </p>
          <p className="leading-relaxed">
            {t('settings.offlineTotpInfoDesc')}
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-xl bg-base-100/70 dark:bg-base-800/50 border border-base-200 dark:border-base-700/60">
          <div>
            <div className="text-xs text-base-400">{t('settings.activeOffset')}</div>
            <div className="font-mono text-lg font-bold text-accent-500">
              {settings.timeOffsetSec >= 0 ? `+${settings.timeOffsetSec}` : settings.timeOffsetSec} s
            </div>
            {settings.lastTimeSync && (
              <div className="text-[11px] text-base-400">
                {t('settings.lastSync', { time: new Date(settings.lastTimeSync).toLocaleString() })}
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1.5 text-xs text-base-400">
              <span>{t('settings.manualOffset')}</span>
              <input
                type="number"
                className="input-base w-16 h-8 text-xs font-mono text-center"
                value={settings.timeOffsetSec}
                onChange={(e) => handleUpdate({ timeOffsetSec: Number(e.target.value) || 0 })}
                title="Offset in seconds (+ / -)"
              />
              <span>s</span>
            </div>

            <Button
              variant="primary"
              className="h-9 px-4 text-xs gap-1.5"
              onClick={handleSyncTime}
              disabled={syncBusy}
            >
              <RefreshCw size={14} className={syncBusy ? 'animate-spin' : ''} />
              {t('settings.syncNow')}
            </Button>
          </div>
        </div>
      </Card>

      {/* 3. Appearance & Preferences */}
      <Card className="p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Palette className="text-accent-500" size={18} />
          <h2 className="text-base font-bold">{t('settings.appearance')}</h2>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="text-xs font-medium text-base-500 mb-1 block">
              {t('settings.language')}
            </label>
            <select
              className="input-base text-xs sm:text-sm h-10 w-full"
              value={settings.language}
              onChange={(e) => {
                const lang = e.target.value as 'en' | 'ru' | 'tr';
                void i18n.changeLanguage(lang);
                void handleUpdate({ language: lang });
              }}
            >
              <option value="en">English (EN)</option>
              <option value="tr">Türkçe (TR)</option>
              <option value="ru">Русский (RU)</option>
            </select>
          </div>

          <div>
            <label className="text-xs font-medium text-base-500 mb-1 block">
              {t('settings.theme')}
            </label>
            <select
              className="input-base text-xs sm:text-sm h-10 w-full"
              value={settings.theme}
              onChange={(e) => {
                const th = e.target.value as 'light' | 'dark';
                document.documentElement.classList.toggle('dark', th === 'dark');
                void handleUpdate({ theme: th });
              }}
            >
              <option value="dark">Dark Theme (Cyber / Steam)</option>
              <option value="light">Light Theme</option>
            </select>
          </div>
        </div>

        <div className="pt-2">
          <label className="flex items-center gap-2.5 text-xs font-medium cursor-pointer">
            <input
              type="checkbox"
              checked={settings.vibrateOnCopy}
              onChange={(e) => handleUpdate({ vibrateOnCopy: e.target.checked })}
              className="rounded text-accent-500"
            />
            <span className="flex items-center gap-1.5">
              <Vibrate size={15} className="text-base-400" />
              {t('settings.vibrateOnCopy')}
            </span>
          </label>
        </div>
      </Card>

      {/* 4. Backup & Restore */}
      <Card className="p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Server className="text-accent-500" size={18} />
          <h2 className="text-base font-bold">{t('settings.backup')}</h2>
        </div>
        <p className="text-xs text-base-500 leading-relaxed">
          {t('settings.backupDesc')}
        </p>

        <div className="flex flex-wrap gap-2.5">
          <Button variant="secondary" className="gap-1.5 text-xs h-9 px-4" onClick={handleBackupExport}>
            <Download size={14} />
            {t('settings.exportBackup')}
          </Button>

          <Button
            variant="secondary"
            className="gap-1.5 text-xs h-9 px-4"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload size={14} />
            {t('settings.importBackup')}
          </Button>

          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(e) => {
              if (e.target.files && e.target.files[0]) {
                handleBackupImport(e.target.files[0]);
              }
            }}
          />

          <Button variant="danger" className="gap-1.5 text-xs h-9 px-4 ml-auto" onClick={handleClearAll}>
            <Trash2 size={14} />
            {t('settings.wipeAll')}
          </Button>
        </div>
      </Card>

      {/* 5. PWA Install */}
      {installPrompt && (
        <Card className="p-5 flex items-center justify-between gap-4 border-accent-500/40 bg-accent-500/5">
          <div>
            <h3 className="font-bold text-sm flex items-center gap-1.5">
              <Smartphone size={16} className="text-accent-500" />
              {t('settings.pwaInstall')}
            </h3>
            <p className="text-xs text-base-500 mt-0.5">
              Install SteamGuard directly onto your phone or PC desktop for instant access without a browser bar.
            </p>
          </div>
          <Button
            variant="primary"
            className="text-xs px-4 h-9 gap-1.5 flex-shrink-0"
            onClick={() => installPrompt.prompt()}
          >
            <Download size={14} />
            {t('settings.installBtn')}
          </Button>
        </Card>
      )}
    </div>
  );
}
