import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  KeyRound,
  Download,
  Trash2,
  Upload,
  Plus,
  Search,
  Check,
  Copy,
  Clock,
  ExternalLink,
  ShieldCheck,
  Folder,
  Tag,
  Inbox,
  FileCode,
  FileUp,
  SlidersHorizontal,
  X
} from 'lucide-react';
import { accountApi, accountOrganizationApi, settingsApi } from '../api';
import type { StoredAccount, FolderItem, TagItem } from '../services/storage';
import { generateSteamGuardCode } from '../services/steamCrypto';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Input } from '../components/ui/Input';

export function AccountsPage() {
  const { t } = useTranslation();
  const [accounts, setAccounts] = useState<StoredAccount[]>([]);
  const [folders, setFolders] = useState<FolderItem[]>([]);
  const [tags, setTags] = useState<TagItem[]>([]);
  const [timeOffset, setTimeOffset] = useState<number>(0);
  const [vibrateOnCopy, setVibrateOnCopy] = useState<boolean>(true);

  // Live timer & codes state
  const [secondsLeft, setSecondsLeft] = useState<number>(() => {
    const nowSec = Math.floor(Date.now() / 1000);
    return 30 - (nowSec % 30) || 30;
  });
  const [liveCodes, setLiveCodes] = useState<Record<string, string>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Filters & Search
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedFolder, setSelectedFolder] = useState<string>('all');
  const [selectedTag, setSelectedTag] = useState<string>('all');

  // Import Modal state
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [importTab, setImportTab] = useState<'upload' | 'paste' | 'manual'>('upload');
  const [importJsonText, setImportJsonText] = useState('');
  const [importAlias, setImportAlias] = useState('');
  const [importError, setImportError] = useState<string | null>(null);
  const [importBusy, setImportBusy] = useState(false);

  // Manual Account Setup state
  const [manualAccountName, setManualAccountName] = useState('');
  const [manualAlias, setManualAlias] = useState('');
  const [manualSharedSecret, setManualSharedSecret] = useState('');
  const [manualIdentitySecret, setManualIdentitySecret] = useState('');
  const [manualSteamId, setManualSteamId] = useState('');
  const [manualRevocation, setManualRevocation] = useState('');

  // Drag & drop highlight state
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadData = useCallback(async () => {
    const [accRes, orgRes, setRes] = await Promise.all([
      accountApi.list(),
      accountOrganizationApi.get(),
      settingsApi.get()
    ]);
    setAccounts(accRes.items);
    setFolders(orgRes.folders);
    setTags(orgRes.tags);
    setTimeOffset(setRes.timeOffsetSec || 0);
    setVibrateOnCopy(setRes.vibrateOnCopy ?? true);
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Recalculate 2FA codes for all accounts
  const updateLiveCodes = useCallback(
    (offset = timeOffset) => {
      const codes: Record<string, string> = {};
      for (const acc of accounts) {
        if (acc.sharedSecret) {
          codes[acc.id] = generateSteamGuardCode(acc.sharedSecret, offset);
        }
      }
      setLiveCodes(codes);
    },
    [accounts, timeOffset]
  );

  // Synchronous tick every 1000ms for exact Steam 30s TOTP interval
  useEffect(() => {
    updateLiveCodes();

    const interval = setInterval(() => {
      const nowSec = Math.floor(Date.now() / 1000) + timeOffset;
      const nextSeconds = 30 - (nowSec % 30) || 30;
      setSecondsLeft(nextSeconds);

      // When the 30-second window turns over, regenerate all codes
      if (nextSeconds === 30) {
        updateLiveCodes();
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [updateLiveCodes, timeOffset]);

  // Copy code to clipboard with visual and haptic feedback
  const handleCopyCode = async (accountId: string, code: string) => {
    if (!code || code === '-----' || code === 'ERROR') return;

    try {
      await navigator.clipboard.writeText(code);
      setCopiedId(accountId);

      // Native mobile haptic vibration
      if (vibrateOnCopy && typeof navigator !== 'undefined' && navigator.vibrate) {
        navigator.vibrate([25]);
      }

      setTimeout(() => {
        setCopiedId((current) => (current === accountId ? null : current));
      }, 2000);
    } catch (err) {
      console.error('Failed to copy code to clipboard', err);
    }
  };

  // Delete account handler
  const handleDeleteAccount = async (accountId: string, alias: string) => {
    if (!window.confirm(`${t('accounts.deleteConfirm')}\n\n${alias}`)) return;
    await accountApi.delete(accountId);
    await loadData();
  };

  // Export single .maFile handler
  const handleExportAccount = async (accountId: string) => {
    await accountApi.export(accountId);
  };

  // Process raw .maFile JSON string
  const processMaFileContent = async (content: string, alias?: string) => {
    return await accountApi.importMaFile(content, alias);
  };

  // Handle file selection (single or multiple)
  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setImportBusy(true);
    setImportError(null);

    let importedCount = 0;
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const text = await file.text();
        const fallbackAlias = file.name.replace(/\.mafile$/i, '').replace(/\.json$/i, '');
        await processMaFileContent(text, fallbackAlias);
        importedCount++;
      }

      await loadData();
      setIsImportModalOpen(false);
      setImportJsonText('');
      setImportAlias('');
    } catch (err: any) {
      setImportError(err?.message || t('accounts.importFailed'));
    } finally {
      setImportBusy(false);
    }
  };

  // Handle Manual Setup submit
  const handleManualSubmit = async () => {
    if (!manualSharedSecret.trim()) {
      setImportError(t('accounts.requiredSharedSecret'));
      return;
    }
    if (!manualIdentitySecret.trim()) {
      setImportError(t('accounts.requiredIdentitySecret'));
      return;
    }

    setImportBusy(true);
    setImportError(null);
    try {
      const now = new Date().toISOString();
      const newAcc: StoredAccount = {
        id: 'acc_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8),
        alias: manualAlias.trim() || manualAccountName.trim() || 'SteamAccount',
        accountName: manualAccountName.trim() || 'SteamAccount',
        steamid: manualSteamId.trim(),
        sharedSecret: manualSharedSecret.trim(),
        identitySecret: manualIdentitySecret.trim(),
        revocationCode: manualRevocation.trim() || undefined,
        createdAt: now,
        updatedAt: now
      };

      await accountApi.save(newAcc);
      await loadData();
      setIsImportModalOpen(false);

      // Reset fields
      setManualAlias('');
      setManualAccountName('');
      setManualSharedSecret('');
      setManualIdentitySecret('');
      setManualSteamId('');
      setManualRevocation('');
    } catch (err: any) {
      setImportError(err?.message || t('accounts.saveFailed'));
    } finally {
      setImportBusy(false);
    }
  };

  // Add quick demo account for instant testing
  const handleAddDemoAccount = async () => {
    setImportBusy(true);
    try {
      const demoAccount: StoredAccount = {
        id: 'demo_' + Date.now(),
        alias: 'Demo Trader',
        accountName: 'demo_user_777',
        steamid: '76561198000000001',
        sharedSecret: 'dGVzdHNoYXJlZHNlY3JldDEyMzQ1Njc4OTA=', // base64
        identitySecret: 'dGVzdGlkZW50aXR5c2VjcmV0MTIzNDU2Nzg5MA==',
        revocationCode: 'R12345',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      await accountApi.save(demoAccount);
      await loadData();
    } finally {
      setImportBusy(false);
    }
  };

  // Filter accounts list
  const filteredAccounts = useMemo(() => {
    return accounts.filter((acc) => {
      const q = searchQuery.toLowerCase().trim();
      const matchesQuery =
        !q ||
        acc.alias.toLowerCase().includes(q) ||
        acc.accountName.toLowerCase().includes(q) ||
        acc.steamid.includes(q);

      const matchesFolder = selectedFolder === 'all' || acc.folderId === selectedFolder;
      const matchesTag = selectedTag === 'all' || (acc.tags && acc.tags.includes(selectedTag));

      return matchesQuery && matchesFolder && matchesTag;
    });
  }, [accounts, searchQuery, selectedFolder, selectedTag]);

  // Compute countdown gauge percentage (30s)
  const progressPercent = ((30 - secondsLeft) / 30) * 100;
  const isExpiringSoon = secondsLeft <= 5;

  return (
    <div className="space-y-4">
      {/* Top Banner & Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2">
            <KeyRound className="text-accent-500" />
            {t('accounts.title')}
          </h1>
          <p className="text-xs sm:text-sm text-base-500">
            {t(accounts.length === 1 ? 'accounts.countOne' : 'accounts.countOther', {
              count: accounts.length
            })}
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Global 30s Timer Indicator */}
          <div className={`flex items-center gap-2 rounded-xl border px-3 py-1.5 shadow-sm transition-colors ${
            isExpiringSoon
              ? 'border-danger/40 bg-danger/10 text-danger'
              : 'border-base-200 bg-white/80 dark:border-white/[0.08] dark:bg-black'
          }`}>
            <Clock
              size={15}
              className={`transition-colors ${isExpiringSoon ? 'text-danger animate-pulse' : 'text-accent-500 dark:text-[#00d2ff]'}`}
            />
            <div className="flex flex-col">
              <span className="font-mono text-xs font-bold leading-tight">
                {secondsLeft}s
              </span>
            </div>
            {/* Mini Progress Bar */}
            <div className="w-12 h-1.5 bg-base-200 dark:bg-white/[0.06] rounded-full overflow-hidden">
              <div
                className={`h-full transition-all duration-1000 ease-linear rounded-full ${
                  isExpiringSoon ? 'bg-danger shadow-glow-danger' : 'bg-accent-500 dark:bg-[#00d2ff] shadow-glow'
                }`}
                style={{ width: `${100 - progressPercent}%` }}
              />
            </div>
          </div>

          {/* Import Button */}
          <Button
            variant="primary"
            className="gap-1.5 text-xs sm:text-sm shadow-sm"
            onClick={() => setIsImportModalOpen(true)}
          >
            <Plus size={16} />
            {t('accounts.import')}
          </Button>
        </div>
      </div>

      {/* Filter and Search Bar */}
      {accounts.length > 0 && (
        <div className="flex flex-col sm:flex-row items-center gap-2">
          <div className="relative flex-1 w-full">
            <Search
              size={15}
              className="absolute left-3.5 top-1/2 -translate-y-1/2 text-base-400 pointer-events-none"
            />
            <input
              type="text"
              className="input-base !pl-10 text-xs sm:text-sm h-10 w-full"
              placeholder={t('accounts.searchPlaceholder')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button
                type="button"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-base-400 hover:text-base-600 dark:hover:text-white transition p-1"
                onClick={() => setSearchQuery('')}
              >
                <X size={14} />
              </button>
            )}
          </div>

          {folders.length > 0 && (
            <select
              className="input-base text-xs sm:text-sm h-10 w-full sm:w-auto"
              value={selectedFolder}
              onChange={(e) => setSelectedFolder(e.target.value)}
            >
              <option value="all">{t('accounts.allFolders')}</option>
              {folders.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          )}

          {tags.length > 0 && (
            <select
              className="input-base text-xs sm:text-sm h-10 w-full sm:w-auto"
              value={selectedTag}
              onChange={(e) => setSelectedTag(e.target.value)}
            >
              <option value="all">{t('accounts.allTags')}</option>
              {tags.map((tg) => (
                <option key={tg.id} value={tg.id}>
                  {tg.name}
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      {/* Accounts Grid / Cards */}
      <div className="grid gap-3 sm:gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
        {filteredAccounts.map((account) => {
          const code = liveCodes[account.id] || '-----';
          const isCopied = copiedId === account.id;

          return (
            <Card
              key={account.id}
              className="relative flex flex-col justify-between overflow-hidden rounded-2xl border border-base-200/80 bg-white/90 p-4 transition-all duration-200 hover:border-accent-500/50 hover:shadow-md dark:border-white/[0.08] dark:bg-[#07070a] dark:hover:border-[#00d2ff]/50 dark:hover:shadow-glow"
            >
              {/* Account Card Header */}
              <div>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="font-extrabold text-base text-base-900 dark:text-white tracking-tight truncate">
                      {account.alias}
                    </h3>
                    <p className="text-xs text-base-500 dark:text-base-400 font-mono truncate">
                      {account.accountName}
                    </p>
                  </div>

                  <div className="flex items-center gap-1">
                    <Link
                      to={`/accounts/${account.id}`}
                      className="rounded-lg p-1.5 text-base-400 hover:bg-base-100 dark:hover:bg-base-900 hover:text-base-600 dark:hover:text-white transition"
                      title={t('accounts.details')}
                    >
                      <SlidersHorizontal size={15} />
                    </Link>
                    <button
                      onClick={() => handleExportAccount(account.id)}
                      className="rounded-lg p-1.5 text-base-400 hover:bg-base-100 dark:hover:bg-base-900 hover:text-base-600 dark:hover:text-white transition"
                      title={t('accounts.export')}
                    >
                      <Download size={15} />
                    </button>
                    <button
                      onClick={() => handleDeleteAccount(account.id, account.alias)}
                      className="rounded-lg p-1.5 text-base-400 hover:bg-danger/10 hover:text-danger transition"
                      title={t('common.delete')}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>

                {/* SteamID and Badges */}
                <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-[11px]">
                  {account.steamid && (
                    <span className="font-mono text-base-400 dark:text-base-500 text-[10px]">
                      {account.steamid}
                    </span>
                  )}
                  {account.session?.steamLoginSecure ? (
                    <span className="rounded-full bg-emerald-500/15 border border-emerald-500/30 px-2 py-0.5 font-bold text-emerald-600 dark:text-emerald-400 text-[10px] tracking-wide">
                      {t('accounts.sessionActive')}
                    </span>
                  ) : (
                    <span className="rounded-full bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 font-medium text-amber-600 dark:text-amber-400 text-[10px]">
                      {t('accounts.codeOnly')}
                    </span>
                  )}
                </div>
              </div>

              {/* 2FA Code Display & Copy Box */}
              <div className="mt-4 pt-3 border-t border-base-200/60 dark:border-white/[0.06]">
                <button
                  type="button"
                  onClick={() => handleCopyCode(account.id, code)}
                  className={`w-full group rounded-2xl p-3.5 flex items-center justify-between transition-all select-none ${
                    isCopied
                      ? 'bg-emerald-500/15 border-2 border-emerald-500/60 shadow-glow-emerald'
                      : 'bg-base-100/90 dark:bg-black border border-base-200 dark:border-white/[0.08] hover:border-accent-500/60 dark:hover:border-[#00d2ff]/60'
                  }`}
                >
                  <div className="flex flex-col text-left">
                    <span className="text-[10px] uppercase font-bold tracking-wider text-base-400 dark:text-base-500">
                      {t('accounts.guardLabel')}
                    </span>
                    <span
                      className={`font-mono text-2xl sm:text-3xl font-black tracking-widest transition-colors ${
                        isCopied
                          ? 'text-emerald-500 dark:text-emerald-400'
                          : isExpiringSoon
                            ? 'text-danger dark:text-danger animate-pulse'
                            : 'text-base-900 dark:text-[#00d2ff]'
                      }`}
                    >
                      {code}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5 text-xs font-semibold">
                    {isCopied ? (
                      <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-bold animate-bounce">
                        <Check size={16} />
                        {t('accounts.copied')}
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-base-400 group-hover:text-accent-500 dark:group-hover:text-[#00d2ff] transition-colors">
                        <Copy size={16} />
                        <span className="text-[11px] font-medium hidden sm:inline">
                          {t('common.copy')}
                        </span>
                      </span>
                    )}
                  </div>
                </button>

                {/* Visual Progress Bar under Code */}
                <div className="mt-2.5 w-full h-1.5 bg-base-200 dark:bg-white/[0.06] rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all duration-1000 ease-linear rounded-full ${
                      isExpiringSoon
                        ? 'bg-danger shadow-glow-danger'
                        : 'bg-accent-500 dark:bg-[#00d2ff] shadow-glow'
                    }`}
                    style={{ width: `${100 - progressPercent}%` }}
                  />
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      {/* Empty State / Welcome */}
      {accounts.length === 0 && (
        <div className="rounded-3xl border-2 border-dashed border-base-200 dark:border-base-800 p-8 sm:p-14 text-center max-w-2xl mx-auto my-6">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-accent-500/10 text-accent-500 mb-4 shadow-inner">
            <ShieldCheck size={36} />
          </div>
          <h2 className="text-xl sm:text-2xl font-bold text-base-900 dark:text-base-100">
            {t('accounts.noAccountsYet')}
          </h2>
          <p className="mt-2 text-xs sm:text-sm text-base-500 leading-relaxed max-w-md mx-auto">
            {t('accounts.emptyHint')}
          </p>

          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <Button
              variant="primary"
              className="gap-2 px-5 py-2.5 shadow-md shadow-accent-500/20"
              onClick={() => setIsImportModalOpen(true)}
            >
              <FileUp size={16} />
              {t('accounts.import')}
            </Button>
            <Button
              variant="secondary"
              className="gap-2 px-5 py-2.5"
              onClick={handleAddDemoAccount}
              disabled={importBusy}
            >
              <KeyRound size={16} />
              {t('accounts.addDemo')}
            </Button>
          </div>
        </div>
      )}

      {/* Import / Add Account Modal */}
      {isImportModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md animate-fade-in">
          <div className="w-full max-w-lg rounded-3xl bg-white dark:bg-[#07070a] border border-base-200 dark:border-white/[0.1] p-6 shadow-2xl dark:shadow-amoled-card space-y-4">
            {/* Modal Header */}
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold flex items-center gap-2 dark:text-white">
                <FileUp className="text-accent-500 dark:text-[#00d2ff]" size={20} />
                {t('accounts.import')}
              </h3>
              <button
                className="rounded-lg p-1 text-base-400 hover:text-base-600 dark:hover:text-white"
                onClick={() => setIsImportModalOpen(false)}
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Tabs */}
            <div className="flex rounded-xl bg-base-100 dark:bg-black p-1 text-xs font-semibold border border-transparent dark:border-white/[0.06]">
              <button
                type="button"
                className={`flex-1 py-1.5 rounded-lg transition ${
                  importTab === 'upload'
                    ? 'bg-white dark:bg-[#161622] text-accent-500 dark:text-[#00d2ff] shadow-sm'
                    : 'text-base-500 hover:text-base-800 dark:text-base-400 dark:hover:text-white'
                }`}
                onClick={() => setImportTab('upload')}
              >
                {t('accounts.file')} (.maFile)
              </button>
              <button
                type="button"
                className={`flex-1 py-1.5 rounded-lg transition ${
                  importTab === 'paste'
                    ? 'bg-white dark:bg-[#161622] text-accent-500 dark:text-[#00d2ff] shadow-sm'
                    : 'text-base-500 hover:text-base-800 dark:text-base-400 dark:hover:text-white'
                }`}
                onClick={() => setImportTab('paste')}
              >
                {t('accounts.pasteJson')}
              </button>
              <button
                type="button"
                className={`flex-1 py-1.5 rounded-lg transition ${
                  importTab === 'manual'
                    ? 'bg-white dark:bg-[#161622] text-accent-500 dark:text-[#00d2ff] shadow-sm'
                    : 'text-base-500 hover:text-base-800 dark:text-base-400 dark:hover:text-white'
                }`}
                onClick={() => setImportTab('manual')}
              >
                {t('accounts.addManual')}
              </button>
            </div>

            {/* Error Message */}
            {importError && (
              <div className="rounded-xl border border-danger/30 bg-danger/10 p-3 text-xs text-danger font-medium">
                {importError}
              </div>
            )}

            {/* Tab 1: Upload File Drag & Drop */}
            {importTab === 'upload' && (
              <div className="space-y-3">
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setIsDragging(true);
                  }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setIsDragging(false);
                    handleFiles(e.dataTransfer.files);
                  }}
                  onClick={() => fileInputRef.current?.click()}
                  className={`cursor-pointer rounded-2xl border-2 border-dashed p-8 text-center transition-all ${
                    isDragging
                      ? 'border-accent-500 bg-accent-500/10'
                      : 'border-base-300 dark:border-base-700 hover:border-accent-500/60 bg-base-50/50 dark:bg-base-800/30'
                  }`}
                >
                  <Upload size={32} className="mx-auto text-accent-500 mb-2" />
                  <div className="text-sm font-semibold">
                    {t('accounts.chooseFile')}
                  </div>
                  <div className="text-xs text-base-400 mt-1">
                    {t('accounts.multiFileHint')}
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    accept=".maFile,.json,text/plain"
                    className="hidden"
                    onChange={(e) => handleFiles(e.target.files)}
                  />
                </div>
              </div>
            )}

            {/* Tab 2: Paste JSON */}
            {importTab === 'paste' && (
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-medium text-base-500 mb-1 block">
                    {t('accounts.optionalAlias')}
                  </label>
                  <Input
                    placeholder={t('accounts.aliasPlaceholder')}
                    value={importAlias}
                    onChange={(e) => setImportAlias(e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-base-500 mb-1 block">
                    {t('accounts.rawJson')}
                  </label>
                  <textarea
                    rows={6}
                    className="input-base w-full font-mono text-xs p-2.5 resize-none"
                    placeholder='{"shared_secret": "...", "identity_secret": "...", "account_name": "..."}'
                    value={importJsonText}
                    onChange={(e) => setImportJsonText(e.target.value)}
                  />
                </div>
                <Button
                  variant="primary"
                  className="w-full"
                  disabled={importBusy || !importJsonText.trim()}
                  onClick={async () => {
                    setImportBusy(true);
                    setImportError(null);
                    try {
                      await processMaFileContent(importJsonText, importAlias);
                      await loadData();
                      setIsImportModalOpen(false);
                      setImportJsonText('');
                    } catch (err: any) {
                      setImportError(err?.message || t('accounts.invalidMaFile'));
                    } finally {
                      setImportBusy(false);
                    }
                  }}
                >
                  {importBusy ? t('accounts.importing') : t('accounts.import')}
                </Button>
              </div>
            )}

            {/* Tab 3: Manual Setup */}
            {importTab === 'manual' && (
              <div className="space-y-2.5 max-h-[60vh] overflow-y-auto pr-1">
                <div>
                  <label className="text-xs font-medium text-base-500 mb-1 block">
                    {t('accounts.manualAlias')}
                  </label>
                  <Input
                    placeholder={t('accounts.manualAliasPlaceholder')}
                    value={manualAlias}
                    onChange={(e) => setManualAlias(e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-base-500 mb-1 block">
                    {t('accounts.manualUsername')}
                  </label>
                  <Input
                    placeholder={t('accounts.manualUsernamePlaceholder')}
                    value={manualAccountName}
                    onChange={(e) => setManualAccountName(e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-base-500 mb-1 block">
                    {t('accounts.manualSharedSecret')}
                  </label>
                  <Input
                    placeholder={t('accounts.manualSharedSecretPlaceholder')}
                    value={manualSharedSecret}
                    onChange={(e) => setManualSharedSecret(e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-base-500 mb-1 block">
                    {t('accounts.manualIdentitySecret')}
                  </label>
                  <Input
                    placeholder={t('accounts.manualIdentitySecretPlaceholder')}
                    value={manualIdentitySecret}
                    onChange={(e) => setManualIdentitySecret(e.target.value)}
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs font-medium text-base-500 mb-1 block">
                      {t('accounts.manualSteamId')}
                    </label>
                    <Input
                      placeholder={t('accounts.manualSteamIdPlaceholder')}
                      value={manualSteamId}
                      onChange={(e) => setManualSteamId(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-base-500 mb-1 block">
                      {t('accounts.manualRevocation')}
                    </label>
                    <Input
                      placeholder={t('accounts.manualRevocationPlaceholder')}
                      value={manualRevocation}
                      onChange={(e) => setManualRevocation(e.target.value)}
                    />
                  </div>
                </div>
                <div className="pt-2">
                  <Button
                    variant="primary"
                    className="w-full"
                    disabled={importBusy || !manualSharedSecret.trim() || !manualIdentitySecret.trim()}
                    onClick={handleManualSubmit}
                  >
                    {importBusy ? t('accounts.importing') : t('common.save')}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
