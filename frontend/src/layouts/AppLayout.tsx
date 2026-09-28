import { useState, useEffect, useMemo } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ShieldCheck,
  KeyRound,
  Inbox,
  FileText,
  Settings as SettingsIcon,
  Download,
  Wifi,
  Clock
} from 'lucide-react';
import { ThemeToggle } from '../components/ThemeToggle';
import { LanguageSwitcher } from '../components/LanguageSwitcher';
import { Button } from '../components/ui/Button';
import { InstallModal } from '../components/InstallModal';
import { settingsApi, steamApi } from '../api';

export function AppLayout() {
  const { t, i18n } = useTranslation();
  const [pendingCount, setPendingCount] = useState<number>(0);
  const [timeOffset, setTimeOffset] = useState<number>(0);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [canInstall, setCanInstall] = useState(false);
  const [showInstallModal, setShowInstallModal] = useState(false);

  // Check pending confirmations count periodically
  useEffect(() => {
    let isMounted = true;
    const checkConfirmations = async () => {
      try {
        const items = await steamApi.allConfirmations();
        if (isMounted) setPendingCount(items.length);
      } catch {
        // ignore in background
      }
    };

    checkConfirmations();
    const interval = setInterval(checkConfirmations, 30000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, []);

  // Fetch initial settings & time offset
  useEffect(() => {
    settingsApi.get().then((s) => {
      setTimeOffset(s.timeOffsetSec || 0);
      if (s.language && s.language !== i18n.language) {
        void i18n.changeLanguage(s.language);
      }
    });
  }, [i18n]);

  const isStandalone = useMemo(() => {
    if (typeof window === 'undefined') return true;
    return (
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as any).standalone === true
    );
  }, []);

  // PWA Install prompt listener and auto-popup
  useEffect(() => {
    if (isStandalone) return;

    const handleBeforeInstall = (e: any) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setCanInstall(true);

      const dismissedUntil = Number(localStorage.getItem('steamweb_pwa_dismissed_until') || '0');
      if (Date.now() > dismissedUntil) {
        setShowInstallModal(true);
      }
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstall);

    // Auto-prompt on mobile devices after 3 seconds if not dismissed
    const isMobile = typeof window !== 'undefined' && /iphone|ipad|ipod|android/.test(window.navigator.userAgent.toLowerCase());
    const dismissedUntil = Number(localStorage.getItem('steamweb_pwa_dismissed_until') || '0');
    let timer: any = null;
    if (isMobile && Date.now() > dismissedUntil) {
      timer = setTimeout(() => {
        setShowInstallModal(true);
      }, 3000);
    }

    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
    };
  }, [isStandalone]);

  const handleInstallClick = () => {
    setShowInstallModal(true);
  };

  const navLinks = useMemo(
    () => [
      { to: '/accounts', label: t('nav.accounts'), icon: KeyRound },
      {
        to: '/confirmations',
        label: t('nav.confirmations'),
        icon: Inbox,
        badge: pendingCount > 0 ? pendingCount : undefined
      },
      { to: '/logs', label: t('nav.logs'), icon: FileText },
      { to: '/settings', label: t('nav.settings'), icon: SettingsIcon }
    ],
    [t, pendingCount]
  );

  return (
    <div className="min-h-screen bg-base-50 text-base-900 transition-colors dark:bg-black dark:text-base-100 flex flex-col md:grid md:grid-cols-[260px_1fr]">
      {/* Desktop Sidebar */}
      <aside className="hidden md:flex flex-col border-r border-base-200/80 bg-white/70 p-4 backdrop-blur dark:border-base-800/80 dark:bg-black sticky top-0 h-screen">
        <div className="mb-6 flex items-center gap-2.5 px-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-tr from-accent-600 to-cyan-400 text-black shadow-lg shadow-accent-500/25">
            <ShieldCheck size={24} className="text-black" />
          </div>
          <div>
            <div className="text-base font-extrabold tracking-tight dark:text-white flex items-center gap-1.5">
              <span>SteamGuard</span>
              <span className="rounded-md bg-accent-500/15 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-accent-500 dark:bg-accent-500/20 dark:text-[#00d2ff]">
                OLED
              </span>
            </div>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-base-400 dark:text-base-500">
              100% In-Browser PWA
            </div>
          </div>
        </div>

        <nav className="flex-1 space-y-1.5">
          {navLinks.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `flex items-center justify-between rounded-xl px-3.5 py-2.5 text-sm font-semibold transition-all ${
                    isActive
                      ? 'bg-accent-500 text-black shadow-glow dark:bg-[#00d2ff] dark:text-black font-bold'
                      : 'text-base-600 hover:bg-base-100 dark:text-base-400 dark:hover:text-white dark:hover:bg-base-900/90'
                  }`
                }
              >
                <div className="flex items-center gap-3">
                  <Icon size={18} />
                  <span>{item.label}</span>
                </div>
                {item.badge !== undefined && (
                  <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-danger px-1.5 text-[11px] font-bold text-white shadow-glow-danger animate-pulse">
                    {item.badge}
                  </span>
                )}
              </NavLink>
            );
          })}
        </nav>

        {/* Desktop Sidebar Footer */}
        <div className="mt-auto space-y-3 pt-4 border-t border-base-200/60 dark:border-base-800/80">
          {!isStandalone && (
            <Button
              variant="primary"
              className="w-full gap-2 text-xs py-2 shadow-glow bg-[#00d2ff] hover:bg-[#38bdf8] text-black font-bold"
              onClick={handleInstallClick}
            >
              <Download size={14} />
              {t('settings.installBtn') || 'Uygulamayı Yükle'}
            </Button>
          )}

          <div className="flex items-center justify-between text-xs text-base-500 px-1">
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-full bg-emerald-500 animate-ping" />
              <span className="font-medium text-emerald-600 dark:text-emerald-400">
                {t('offlineReady')}
              </span>
            </span>
            <span className="font-mono text-[11px] text-base-400 dark:text-base-500">
              {timeOffset !== 0 ? `${timeOffset > 0 ? '+' : ''}${timeOffset}s` : '0s sync'}
            </span>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex flex-1 flex-col min-w-0 pb-24 md:pb-8">
        {/* Top Header */}
        <header className="sticky top-0 z-30 flex items-center justify-between border-b border-base-200/80 bg-white/80 px-4 py-3 backdrop-blur dark:border-base-800/80 dark:bg-black/90">
          <div className="flex items-center gap-2 md:hidden">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-accent-500 text-black shadow-sm">
              <ShieldCheck size={20} className="text-black" />
            </div>
            <span className="font-bold text-sm tracking-tight dark:text-white">SteamGuard</span>
            <span className="rounded-md bg-accent-500/15 px-1.5 py-0.5 text-[9px] font-bold text-accent-500 dark:text-[#00d2ff]">
              OLED
            </span>
          </div>

          <div className="hidden md:flex items-center gap-2 text-xs text-base-500 font-medium">
            <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
              <Wifi size={12} />
              <span>100% In-Browser Engine</span>
            </span>
            <span className="text-base-700 dark:text-base-700">•</span>
            <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 bg-base-100 dark:bg-base-900 text-base-400 border border-base-200 dark:border-base-800">
              <Clock size={12} />
              <span>Clock Offset: {timeOffset}s</span>
            </span>
          </div>

          <div className="flex items-center gap-2 ml-auto">
            {!isStandalone && (
              <Button
                variant="secondary"
                className="md:hidden h-8 px-2 text-xs gap-1 border-accent-500/40 text-accent-400 bg-accent-500/10"
                onClick={handleInstallClick}
              >
                <Download size={14} />
                Yükle
              </Button>
            )}
            <LanguageSwitcher />
            <ThemeToggle />
          </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 p-3 sm:p-5 md:p-6 max-w-7xl w-full mx-auto">
          <Outlet />
        </main>
      </div>

      {/* Mobile Bottom Navigation Bar (Phone-Optimized with Safe Area) */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 border-t border-base-200/90 bg-white/95 px-2 pt-2 pb-[max(0.6rem,env(safe-area-inset-bottom))] backdrop-blur-md shadow-2xl dark:border-base-800/80 dark:bg-black/95 flex justify-around items-center">
        {navLinks.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `flex flex-col items-center justify-center py-1 px-3 rounded-xl transition text-[11px] font-medium relative ${
                  isActive
                    ? 'text-accent-500 font-bold dark:text-[#00d2ff]'
                    : 'text-base-500 hover:text-base-800 dark:text-base-400 dark:hover:text-base-200'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <div className="relative">
                    <Icon size={20} className={isActive ? 'text-accent-500 dark:text-[#00d2ff]' : ''} />
                    {item.badge !== undefined && (
                      <span className="absolute -top-1.5 -right-2.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-danger px-1 text-[9px] font-bold text-white shadow-glow-danger animate-pulse">
                        {item.badge}
                      </span>
                    )}
                  </div>
                  <span className="mt-1">{item.label}</span>
                  {isActive && (
                    <span className="mt-0.5 h-1 w-3 rounded-full bg-accent-500 dark:bg-[#00d2ff] shadow-glow" />
                  )}
                </>
              )}
            </NavLink>
          );
        })}
      </nav>

      {/* PWA Guided Install Modal */}
      <InstallModal
        isOpen={showInstallModal}
        onClose={() => setShowInstallModal(false)}
        deferredPrompt={deferredPrompt}
        onInstalled={() => {
          setCanInstall(false);
          setDeferredPrompt(null);
        }}
      />
    </div>
  );
}
