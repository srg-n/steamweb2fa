import { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { FileText, Trash2, Download, RefreshCw, Filter, ShieldCheck, ArrowRightLeft, LogIn, KeyRound } from 'lucide-react';
import { logApi } from '../api';
import type { LocalLogItem } from '../services/storage';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';

export function LogsPage() {
  const { t } = useTranslation();
  const [logs, setLogs] = useState<LocalLogItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');

  const loadLogs = useCallback(async () => {
    setLoading(true);
    try {
      const res = await logApi.list(200);
      setLogs(res.items);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  const handleClear = async () => {
    if (!window.confirm('Clear all local audit logs?')) return;
    await logApi.clear();
    setLogs([]);
  };

  const handleExport = () => {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(logs, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute('download', `SteamGuard_Logs_${new Date().toISOString().slice(0, 10)}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  const filteredLogs = useMemo(() => {
    if (selectedCategory === 'all') return logs;
    return logs.filter((item) => item.category === selectedCategory);
  }, [logs, selectedCategory]);

  return (
    <div className="space-y-4 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2">
            <FileText className="text-accent-500" />
            {t('logs.title')}
          </h1>
          <p className="text-xs sm:text-sm text-base-500">
            Local browser audit log of code generation, trade confirmations, and session activities.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {logs.length > 0 && (
            <>
              <Button variant="secondary" className="h-9 px-3 text-xs gap-1.5" onClick={handleExport}>
                <Download size={14} />
                Export
              </Button>
              <Button variant="danger" className="h-9 px-3 text-xs gap-1.5" onClick={handleClear}>
                <Trash2 size={14} />
                {t('logs.clear')}
              </Button>
            </>
          )}
          <Button variant="secondary" className="h-9 px-3 text-xs gap-1.5" onClick={loadLogs} disabled={loading}>
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </Button>
        </div>
      </div>

      {/* Category Filter Pills */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 text-xs">
        {['all', 'trade', 'login', 'totp', 'system'].map((cat) => (
          <button
            key={cat}
            onClick={() => setSelectedCategory(cat)}
            className={`px-3.5 py-1.5 rounded-xl font-bold transition-all capitalize ${
              selectedCategory === cat
                ? 'bg-accent-500 text-black dark:bg-[#00d2ff] dark:text-black shadow-glow'
                : 'bg-white dark:bg-black border border-base-200 dark:border-white/[0.08] text-base-600 dark:text-base-400 hover:bg-base-100 dark:hover:text-white dark:hover:bg-base-900'
            }`}
          >
            {cat === 'all' ? t('logs.all') : cat}
          </button>
        ))}
      </div>

      {/* Logs List */}
      <Card className="divide-y divide-base-200/60 dark:divide-white/[0.06] p-0 overflow-hidden rounded-3xl border border-base-200/80 dark:border-white/[0.08] dark:bg-[#07070a] shadow-sm dark:shadow-amoled-card">
        {filteredLogs.map((log) => {
          const date = new Date(log.timestamp);
          const timeFormatted = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
          const dateFormatted = date.toLocaleDateString();

          return (
            <div key={log.id} className="p-3.5 sm:p-4 hover:bg-base-50/50 dark:hover:bg-white/[0.02] transition flex items-start gap-3">
              <div className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-base-100 dark:bg-black border border-transparent dark:border-white/[0.08]">
                {log.category === 'trade' && <ArrowRightLeft size={16} className="text-accent-500 dark:text-[#00d2ff]" />}
                {log.category === 'login' && <LogIn size={16} className="text-purple-400" />}
                {log.category === 'totp' && <KeyRound size={16} className="text-emerald-400" />}
                {log.category === 'system' && <ShieldCheck size={16} className="text-amber-400" />}
              </div>

              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center justify-between gap-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-xs sm:text-sm text-base-900 dark:text-base-100">
                      {log.headline}
                    </span>
                    {log.accountAlias && (
                      <Badge variant="primary" className="text-[10px]">
                        {log.accountAlias}
                      </Badge>
                    )}
                  </div>
                  <span className="text-[11px] font-mono text-base-400">
                    {dateFormatted} {timeFormatted}
                  </span>
                </div>

                {log.details && (
                  <p className="text-xs text-base-500 dark:text-base-400 font-mono break-all">
                    {typeof log.details === 'object' ? JSON.stringify(log.details) : log.details}
                  </p>
                )}
              </div>
            </div>
          );
        })}

        {filteredLogs.length === 0 && (
          <div className="p-8 text-center text-xs text-base-500">
            {t('logs.empty')}
          </div>
        )}
      </Card>
    </div>
  );
}
